/**
 * Azure Daily Cost-Burst Email Dispatcher (>= 10% of Previous Month's Total Spend)
 *
 * Detects Azure subscriptions whose single-day spend reaches >= 10% of the
 * previous month's total spend (and >= the minimum daily cost floor), then emails
 * the concerned owner from `cloud_account_budgets` (or the configured fallback email).
 *
 * Usage:
 *   tsx src/send_azure_daily_burst_alerts.ts                       # Evaluate latest settled day & send emails
 *   tsx src/send_azure_daily_burst_alerts.ts --dry-run             # Preview HTML emails without sending
 *   tsx src/send_azure_daily_burst_alerts.ts --date=2026-11-22     # Evaluate a specific YYYY-MM-DD date
 *   tsx src/send_azure_daily_burst_alerts.ts --threshold=10        # Override % of prev month (default 10)
 *   tsx src/send_azure_daily_burst_alerts.ts --min-cost=500        # Override minimum daily cost floor
 *   tsx src/send_azure_daily_burst_alerts.ts --usage-only          # Exclude purchases/reservations (Usage only)
 *   tsx src/send_azure_daily_burst_alerts.ts --fallback=ops@co.com # Override fallback email for unmapped subs
 *   tsx src/send_azure_daily_burst_alerts.ts --force               # Re-send even if already sent for that date
 */

import { prisma } from './server/db.ts';
import {
  DEFAULT_BURST_CONFIG,
  evaluateAndNotifyAzureDailyBursts,
} from './server/services/azureDailyBurstService.ts';

function readFlagValue(args: string[], prefix: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim();
  const idx = args.indexOf(prefix);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1].trim() : undefined;
}

function parseNumberFlag(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid ${name} "${raw}". Expected a non-negative number.`);
  }
  return num;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const date = readFlagValue(args, '--date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date "${date}". Expected YYYY-MM-DD format.`);
  }

  const minCostRaw = readFlagValue(args, '--min-cost') ?? readFlagValue(args, '--min-delta');

  return {
    date,
    thresholdPercent: parseNumberFlag(readFlagValue(args, '--threshold'), '--threshold'),
    minCostFloorOverride: parseNumberFlag(minCostRaw, '--min-cost'),
    usageOnly: args.includes('--usage-only'),
    fallbackEmail: readFlagValue(args, '--fallback'),
    ccEmail: readFlagValue(args, '--cc'),
    dryRun: args.includes('--dry-run') || args.includes('--preview'),
    force: args.includes('--force'),
  };
}

async function main() {
  let exitCode = 0;
  try {
    const opts = parseCliArgs();
    const threshold = opts.thresholdPercent ?? DEFAULT_BURST_CONFIG.thresholdPercent;
    console.log(
      `[AzureDailyBurst] Started (${new Date().toISOString()}) | date=${opts.date || 'auto-latest'} | ` +
        `threshold=${threshold}% of prev month | minCost=${opts.minCostFloorOverride ?? `₹${DEFAULT_BURST_CONFIG.minCostFloorInr}/$${DEFAULT_BURST_CONFIG.minCostFloorUsd}`} | ` +
        `usageOnly=${opts.usageOnly} | dryRun=${opts.dryRun} | force=${opts.force}`
    );

    const summary = await evaluateAndNotifyAzureDailyBursts(opts);

    console.log(
      `[AzureDailyBurst] Evaluated ${summary.subscriptionsEvaluated} subscription(s) ` +
        `(day ${summary.evaluationDate} vs prev month ${summary.previousMonth}): ${summary.burstsDetected} burst(s) detected.`
    );

    for (const r of summary.results) {
      const b = r.burst;
      const tag = opts.dryRun ? '[DRY-RUN]' : r.skippedReason ? `[SKIP:${r.skippedReason}]` : r.emailResult?.sent ? '[SENT]' : '[FAILED]';
      const route = r.usedFallback ? 'fallback' : 'owner';
      console.log(
        `${tag} "${b.subscriptionName}" (${b.subscriptionId}) | ` +
          `${b.currentDayCost} / ${b.previousMonthCost} ${b.billingCurrency} (${b.percentOfPrevMonth.toFixed(1)}% of ${b.previousMonth}) | ` +
          `to(${route})=${r.recipients.join(', ') || 'NONE'}` +
          (r.emailResult?.previewPath ? ` | preview=${r.emailResult.previewPath}` : '') +
          (r.emailResult?.error ? ` | error=${r.emailResult.error}` : '')
      );
    }

    console.log(
      `[AzureDailyBurst] Summary: sent=${summary.emailsSent}, skippedAlreadySent=${summary.skippedAlreadySent}, ` +
        `skippedNoRecipients=${summary.skippedNoRecipients}, failed=${summary.failedCount}`
    );

    if (!opts.dryRun && summary.failedCount > 0) {
      exitCode = 1;
    }
  } catch (err: any) {
    console.error('[AzureDailyBurst] Fatal error:', err?.message || err);
    exitCode = 1;
  } finally {
    if (typeof prisma?.$disconnect === 'function') {
      await prisma.$disconnect().catch(() => {});
    }
    process.exit(exitCode);
  }
}

main();
