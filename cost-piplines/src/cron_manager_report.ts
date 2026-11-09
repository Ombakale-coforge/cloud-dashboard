import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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
    console.log('\n[1/3] Generating AWS Executive PDF Report...');
    run('npx tsx src/generate_manager_report_pdf.ts');

    // 2. Generate Azure Report PDF
    console.log('\n[2/3] Generating Azure Executive PDF Report...');
    run('npx tsx src/generate_azure_manager_report_pdf.ts');

    // 3. Dispatch Email with both reports attached
    console.log('\n[3/3] Sending email to managers with attached reports...');
    run('npx tsx src/send_manager_report_email.ts');

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
