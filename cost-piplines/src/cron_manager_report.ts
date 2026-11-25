import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAndNotifyAllAccountBudgets } from './server/services/accountBudgetService.ts';
import {
  runChildWithCapture,
  startPipelineRunCapture,
  type PipelineStepSummary,
} from './logging/auditLogger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const TSX_CLI = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

async function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  const fullPath = path.join(rootDir, scriptPath);
  console.log(`\n▶ [Cron Job] Running: npx tsx ${scriptPath}${args.length ? ` ${args.join(' ')}` : ''}`);
  if (fs.existsSync(TSX_CLI)) {
    await runChildWithCapture(process.execPath, [TSX_CLI, fullPath, ...args], { cwd: rootDir });
    return;
  }
  await runChildWithCapture('npx', ['tsx', fullPath, ...args], { cwd: rootDir });
}

async function main() {
  const runCapture = startPipelineRunCapture('daily-cost-report-email', {
    command: 'src/cron_manager_report.ts',
  });
  const steps: PipelineStepSummary[] = [];
  let exitCode = 0;

  console.log('====================================================');
  console.log('🕒 Starting Scheduled Manager Cost & Budget Report Dispatch');
  console.log(`📅 Execution Time: ${new Date().toISOString()}`);
  console.log('====================================================');

  const execStep = async (
    id: string,
    label: string,
    fn: () => Promise<string | void>
  ): Promise<void> => {
    const start = Date.now();
    try {
      const detail = await fn();
      steps.push({
        id,
        label,
        status: 'PASS',
        durationSec: ((Date.now() - start) / 1000).toFixed(1),
        ...(detail ? { detail } : {}),
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      steps.push({
        id,
        label,
        status: 'FAIL',
        durationSec: ((Date.now() - start) / 1000).toFixed(1),
        detail: msg.split('\n')[0],
      });
      throw err;
    }
  };

  try {
    // 1. Generate AWS Report PDF
    console.log('\n[1/5] Generating AWS Executive PDF Report...');
    await execStep('pdf-aws', 'Generate AWS Executive PDF Report', () =>
      runScript('src/generate_manager_report_pdf.ts')
    );

    // 2. Generate GCP Report PDF
    console.log('\n[2/5] Generating GCP Executive PDF Report...');
    await execStep('pdf-gcp', 'Generate GCP Executive PDF Report', () =>
      runScript('src/generate_gcp_manager_report_pdf.ts')
    );

    // 3. Generate Azure Report PDF
    console.log('\n[3/5] Generating Azure Executive PDF Report...');
    await execStep('pdf-azure', 'Generate Azure Executive PDF Report', () =>
      runScript('src/generate_azure_manager_report_pdf.ts')
    );

    // 4. Dispatch Email with all three reports embedded & attached (AWS -> GCP -> Azure)
    console.log('\n[4/5] Sending email to managers with embedded & attached reports (AWS -> GCP -> Azure)...');
    await execStep('send-manager-email', 'Send Consolidated Manager Report Email', () =>
      runScript('src/send_manager_report_email.ts', ['--cached'])
    );

    // 5. Evaluate manual multi-cloud account budgets (50%, 75%, 100%, >100%)
    console.log('\n[5/5] Evaluating multi-cloud manual account budgets across AWS, Azure, and GCP...');
    await execStep('evaluate-account-budgets', 'Evaluate Multi-Cloud Account Budgets', async () => {
      const budgetEval = await evaluateAndNotifyAllAccountBudgets();
      const summary = `Evaluated ${budgetEval.evaluatedCount} account budget(s) — ${budgetEval.breachedCount} at/over threshold, ${budgetEval.triggeredCount} threshold alert(s) triggered.`;
      console.log(`✅ ${summary}`);
      return summary;
    });

    console.log('\n====================================================');
    console.log('✅ Scheduled Manager Report Email Dispatch Completed Successfully!');
    console.log('====================================================');
  } catch (err: any) {
    exitCode = 1;
    console.error('\n❌ Error during scheduled report execution:', err?.message || err);
  } finally {
    runCapture.finish({ exitCode, steps });
    process.exit(exitCode);
  }
}

main();
