/**
 * Daily Multi-Cloud Account Budget Email Dispatcher
 *
 * Usage:
 *   tsx src/send_daily_budget_emails.ts                       # Send daily utilization email to all active budgets
 *   tsx src/send_daily_budget_emails.ts --thresholds          # Only send 50%/75%/100%/OVER_BUDGET threshold alerts
 *   tsx src/send_daily_budget_emails.ts --provider=aws        # Filter: all | aws | azure | gcp
 *   tsx src/send_daily_budget_emails.ts --month=2026-11       # Override billing month (YYYY-MM)
 *   tsx src/send_daily_budget_emails.ts --dry-run             # Evaluate & preview without sending external emails
 */

import { prisma } from './server/db.ts';
import {
  buildAccountBudgetEmailContent,
  evaluateAndNotifyAllAccountBudgets,
  getEnrichedBudgets,
  markManualEmailSent,
  normalizeEmailList,
  resolveAccountSpecificTopServices,
  sendAccountUsageEmail,
  shouldSendThresholdAlert,
} from './server/services/accountBudgetService.ts';

const VALID_PROVIDERS = new Set(['all', 'aws', 'azure', 'gcp']);

function readFlagValue(args: string[], prefix: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim();
  const idx = args.indexOf(prefix);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1].trim() : undefined;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const provider = (readFlagValue(args, '--provider') || 'all').toLowerCase();
  if (!VALID_PROVIDERS.has(provider)) {
    throw new Error(`Invalid --provider "${provider}". Expected one of: all, aws, azure, gcp.`);
  }

  const month = readFlagValue(args, '--month');
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid --month "${month}". Expected YYYY-MM format.`);
  }

  return {
    thresholdsOnly: args.includes('--thresholds'),
    dryRun: args.includes('--dry-run') || args.includes('--preview'),
    provider,
    month,
  };
}

async function runThresholdsMode(provider: string, month: string | undefined, dryRun: boolean): Promise<number> {
  if (dryRun) {
    const active = (await getEnrichedBudgets(provider, month)).filter((b) => b.isActive);
    let wouldTrigger = 0;
    for (const item of active) {
      const willSend = shouldSendThresholdAlert(
        item.thresholdCrossed,
        item.evaluationMonth,
        item.lastNotifiedThreshold,
        item.lastNotifiedMonth
      );
      if (willSend) wouldTrigger++;
      const recipients = normalizeEmailList(item.alertEmails?.length ? item.alertEmails : item.alertEmail);
      console.log(
        `[DRY-RUN][threshold] ${item.cloudProvider.toUpperCase()} "${item.accountName}" (${item.accountId}): ` +
          `${item.percentUsed.toFixed(1)}% (${item.status}) | trigger=${willSend} | to=${recipients.join(', ')}`
      );
    }
    console.log(`[DRY-RUN] Threshold summary: ${active.length} active, ${wouldTrigger} would trigger.`);
    return 0;
  }

  const summary = await evaluateAndNotifyAllAccountBudgets({ provider, month });
  let failed = 0;
  for (const r of summary.results) {
    if (!r.emailResult?.sent) failed++;
    console.log(
      `[threshold] ${r.cloudProvider.toUpperCase()} "${r.accountName}" (${r.thresholdCrossed}): ` +
        `sent=${Boolean(r.emailResult?.sent)} via=${r.emailResult?.transport || 'none'}`
    );
  }
  console.log(
    `Threshold evaluation finished: ${summary.evaluatedCount} active, ` +
      `${summary.breachedCount} breached, ${summary.triggeredCount} triggered.`
  );
  return failed > 0 ? 1 : 0;
}

async function runDailyInstantMode(provider: string, month: string | undefined, dryRun: boolean): Promise<number> {
  const active = (await getEnrichedBudgets(provider, month)).filter((b) => b.isActive);
  let sentCount = 0;
  let failedCount = 0;

  for (const item of active) {
    const recipients = normalizeEmailList(item.alertEmails?.length ? item.alertEmails : item.alertEmail);
    if (dryRun) {
      const resolved = await resolveAccountSpecificTopServices(item);
      const { subject } = buildAccountBudgetEmailContent(resolved, 'instant');
      console.log(
        `[DRY-RUN][daily] ${item.cloudProvider.toUpperCase()} "${item.accountName}" (${item.accountId}) | ` +
          `${item.currentSpend}/${item.monthlyBudget} ${item.billingCurrency} (${item.percentUsed.toFixed(1)}%) | ` +
          `to=${recipients.join(', ')} | subject="${subject}"`
      );
      continue;
    }

    try {
      const result = await sendAccountUsageEmail(item, 'instant');
      if (result.sent) {
        await markManualEmailSent(item.id);
        sentCount++;
        console.log(
          `[sent] ${item.cloudProvider.toUpperCase()} "${item.accountName}" -> ${result.recipients.join(', ')} (${result.transport})`
        );
      } else {
        failedCount++;
        console.warn(
          `[failed] ${item.cloudProvider.toUpperCase()} "${item.accountName}" -> ${result.recipients.join(', ')}: ${result.error || 'Preview only'}`
        );
      }
    } catch (err: any) {
      failedCount++;
      console.error(`[error] ${item.cloudProvider.toUpperCase()} "${item.accountName}": ${err.message}`);
    }
  }

  if (dryRun) {
    console.log(`[DRY-RUN] Daily summary: ${active.length} active budget(s) would receive usage emails.`);
    return 0;
  }

  console.log(`Daily utilization email summary: ${active.length} active, ${sentCount} sent, ${failedCount} failed.`);
  return failedCount > 0 ? 1 : 0;
}

async function main() {
  let exitCode = 0;
  try {
    const { thresholdsOnly, dryRun, provider, month } = parseCliArgs();
    console.log(
      `[DailyBudgetEmails] Started (${new Date().toISOString()}) | mode=${
        thresholdsOnly ? 'thresholds' : 'daily-instant'
      } | provider=${provider} | month=${month || 'current'} | dryRun=${dryRun}`
    );

    exitCode = thresholdsOnly
      ? await runThresholdsMode(provider, month, dryRun)
      : await runDailyInstantMode(provider, month, dryRun);
  } catch (err: any) {
    console.error('[DailyBudgetEmails] Fatal error:', err?.message || err);
    exitCode = 1;
  } finally {
    if (typeof prisma?.$disconnect === 'function') {
      await prisma.$disconnect().catch(() => {});
    }
    process.exit(exitCode);
  }
}

main();
