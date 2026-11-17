import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateAndNotifyAllAccountBudgets } from './server/services/accountBudgetService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function run(cmd: string) {
  console.log(`\n▶ [Cron Job] Running: ${cmd}`);
  execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
}

async function main() {
  console.log('====================================================');
  console.log('🕒 Starting Scheduled Manager Cost & Budget Report Dispatch');
  console.log(`📅 Execution Time: ${new Date().toISOString()}`);
  console.log('====================================================');

  try {
    // 1. Generate AWS Report PDF
    console.log('\n[1/4] Generating AWS Executive PDF Report...');
    run('npx tsx src/generate_manager_report_pdf.ts');

    // 2. Generate GCP Report PDF
    console.log('\n[2/4] Generating GCP Executive PDF Report...');
    run('npx tsx src/generate_gcp_manager_report_pdf.ts');

    // 3. Generate Azure Report PDF
    console.log('\n[3/4] Generating Azure Executive PDF Report...');
    run('npx tsx src/generate_azure_manager_report_pdf.ts');

    // 4. Dispatch Email with all three reports embedded & attached (AWS -> GCP -> Azure)
    console.log('\n[4/5] Sending email to managers with embedded & attached reports (AWS -> GCP -> Azure)...');
    run('npx tsx src/send_manager_report_email.ts');

    // 5. Evaluate manual multi-cloud account budgets (50%, 75%, 100%, >100%)
    console.log('\n[5/5] Evaluating multi-cloud manual account budgets across AWS, Azure, and GCP...');
    const budgetEval = await evaluateAndNotifyAllAccountBudgets();
    console.log(
      `✅ Evaluated ${budgetEval.evaluatedCount} account budget(s) — ${budgetEval.breachedCount} at/over threshold, ${budgetEval.triggeredCount} threshold alert(s) triggered.`
    );

    console.log('\n====================================================');
    console.log('✅ Scheduled Manager Report Email Dispatch Completed Successfully!');
    console.log('====================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ Error during scheduled report execution:', err.message);
    process.exit(1);
  }
}

main();
