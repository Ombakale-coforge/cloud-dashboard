import 'dotenv/config';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TSX_CLI = path.join(ROOT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

export interface SeedOptions {
  awsOnly: boolean;
  azureOnly: boolean;
  awsCsv: boolean;
  withPdfs: boolean;
  continueOnError: boolean;
  dryRun: boolean;
  help: boolean;
  selfCheck: boolean;
}

export interface SeedStep {
  id: string;
  label: string;
  kind: 'auth' | 'script';
  scriptPath?: string;
  args?: string[];
  requiredEnv?: string[];
}

interface StepResult {
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  durationSec: string;
  detail?: string;
}

export function parseCliArgs(argv: string[]): SeedOptions {
  const opts: SeedOptions = {
    awsOnly: argv.includes('--aws-only'),
    azureOnly: argv.includes('--azure-only'),
    awsCsv: argv.includes('--aws-csv'),
    withPdfs: argv.includes('--with-pdfs'),
    continueOnError: argv.includes('--continue-on-error'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
    selfCheck: argv.includes('--self-check'),
  };

  if (opts.awsOnly && opts.azureOnly) {
    throw new Error('Cannot combine --aws-only and --azure-only.');
  }

  return opts;
}

export function buildSeedPlan(opts: SeedOptions): SeedStep[] {
  const includeAws = !opts.azureOnly;
  const includeAzure = !opts.awsOnly;
  const steps: SeedStep[] = [
    {
      id: 'auth-bootstrap',
      label: 'Bootstrap Admin User (dbo.users)',
      kind: 'auth',
      requiredEnv: ['DATABASE_URL'],
    },
  ];

  if (includeAws) {
    steps.push(
      opts.awsCsv
        ? {
            id: 'aws-seed-csv',
            label: 'Seed AWS Reports from local AWSReports/ CSVs',
            kind: 'script',
            scriptPath: 'src/aws_cost_report/index.ts',
            requiredEnv: ['DATABASE_URL'],
          }
        : {
            id: 'aws-live-pipeline',
            label: 'Sync & Seed AWS Costs, Budgets & Reports (Live API)',
            kind: 'script',
            scriptPath: 'src/aws_cost_pipeline.ts',
            requiredEnv: ['DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
          }
    );
  }

  if (includeAzure) {
    steps.push(
      {
        id: 'azure-focus-ingest',
        label: 'Ingest Azure FOCUS Export Blobs -> azure_usage_records',
        kind: 'script',
        scriptPath: 'src/fetch_data/focus-export/index.ts',
        requiredEnv: [
          'DATABASE_URL',
          'AZURE_TENANT_ID',
          'AZURE_CLIENT_ID',
          'AZURE_CLIENT_SECRET',
          'AZURE_STORAGE_ACCOUNT_NAME',
          'AZURE_STORAGE_CONTAINER_NAME',
        ],
      },
      {
        id: 'azure-budgets-sync',
        label: 'Sync Azure ARM Budgets -> azure_subscription_budgets',
        kind: 'script',
        scriptPath: 'src/fetch_data/sync-azure-budgets.ts',
        requiredEnv: ['DATABASE_URL'],
      },
      {
        id: 'azure-cost-report',
        label: 'Compute 17 Azure FinOps Reports -> azure_report_*',
        kind: 'script',
        scriptPath: 'src/azure_cost_report/index.ts',
        requiredEnv: ['DATABASE_URL'],
      },
      {
        id: 'azure-alerts-preview',
        label: 'Evaluate Azure Cost & Meter Budget Alerts -> azure_cost_alerts',
        kind: 'script',
        scriptPath: 'src/alerts/index.ts',
        args: ['--preview'],
        requiredEnv: ['DATABASE_URL'],
      }
    );
  }

  if (opts.withPdfs) {
    if (includeAws) {
      steps.push({
        id: 'pdf-aws',
        label: 'Generate AWS Executive HTML/PDF Report',
        kind: 'script',
        scriptPath: 'src/generate_manager_report_pdf.ts',
      });
    }
    if (includeAzure) {
      steps.push({
        id: 'pdf-azure',
        label: 'Generate Azure Executive HTML/PDF Report',
        kind: 'script',
        scriptPath: 'src/generate_azure_manager_report_pdf.ts',
      });
    }
    if (includeAws && includeAzure) {
      steps.push({
        id: 'pdf-gcp',
        label: 'Generate GCP Executive HTML/PDF Report',
        kind: 'script',
        scriptPath: 'src/generate_gcp_manager_report_pdf.ts',
      });
    }
  }

  return steps;
}

function getMissingEnv(keys: string[] = []): string[] {
  return keys.filter((k) => !process.env[k]?.trim());
}

function printUsage(): void {
  console.log(`
Unified Multi-Cloud Database Seeder

Usage:
  npm run seed:all -- [options]

Options:
  --aws-only           Seed auth + AWS data only
  --azure-only         Seed auth + Azure data only
  --aws-csv            Seed AWS from local AWSReports/ CSVs instead of live AWS APIs
  --with-pdfs          Also generate executive HTML/PDF reports after DB seeding
  --continue-on-error  Continue remaining steps if a step fails
  --dry-run            Validate env and print ordered execution plan without running
  --self-check         Run internal CLI/plan unit assertions
  -h, --help           Show this help message
`);
}

async function runAuthStep(): Promise<{ skipped?: string }> {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    return { skipped: 'ADMIN_EMAIL / ADMIN_PASSWORD not set' };
  }

  const [{ bootstrapAdmin }, { prisma }] = await Promise.all([
    import('./server/auth/bootstrapAdmin.ts'),
    import('./server/db.ts'),
  ]);

  try {
    await bootstrapAdmin();
  } finally {
    await prisma?.$disconnect?.();
  }
  return {};
}

function runScriptStep(scriptPath: string, args: string[] = []): void {
  const fullPath = path.join(ROOT_DIR, scriptPath);
  if (fs.existsSync(TSX_CLI)) {
    execFileSync(process.execPath, [TSX_CLI, fullPath, ...args], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    return;
  }

  execFileSync('npx', ['tsx', fullPath, ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}

function printSummary(results: StepResult[], totalSec: string): void {
  console.log('\n============================================================');
  console.log('📊 SEED SUMMARY');
  console.log('============================================================');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'SKIPPED' ? '⏭️' : '❌';
    const suffix = r.detail ? ` (${r.detail})` : '';
    console.log(`${icon} [${r.status.padEnd(7)}] ${r.label} — ${r.durationSec}s${suffix}`);
  }
  console.log(`------------------------------------------------------------`);
  console.log(`⏱️  Total elapsed: ${totalSec}s`);
  console.log('============================================================\n');
}

export function runSelfCheck(): void {
  const defaultPlan = buildSeedPlan(parseCliArgs([]));
  assert.deepStrictEqual(
    defaultPlan.map((s) => s.id),
    [
      'auth-bootstrap',
      'aws-live-pipeline',
      'azure-focus-ingest',
      'azure-budgets-sync',
      'azure-cost-report',
      'azure-alerts-preview',
    ],
    'Default plan must include auth, AWS live, and ordered Azure steps'
  );

  // Dependency order: Azure FOCUS ingest must come before budget sync, cost report, and alerts
  const azureIds = defaultPlan.map((s) => s.id);
  assert.ok(azureIds.indexOf('azure-focus-ingest') < azureIds.indexOf('azure-budgets-sync'));
  assert.ok(azureIds.indexOf('azure-focus-ingest') < azureIds.indexOf('azure-cost-report'));
  assert.ok(azureIds.indexOf('azure-focus-ingest') < azureIds.indexOf('azure-alerts-preview'));

  const azureOnlyCsvPdf = buildSeedPlan(
    parseCliArgs(['--azure-only', '--aws-csv', '--with-pdfs'])
  );
  assert.deepStrictEqual(
    azureOnlyCsvPdf.map((s) => s.id),
    [
      'auth-bootstrap',
      'azure-focus-ingest',
      'azure-budgets-sync',
      'azure-cost-report',
      'azure-alerts-preview',
      'pdf-azure',
    ]
  );

  const awsCsvPlan = buildSeedPlan(parseCliArgs(['--aws-only', '--aws-csv', '--with-pdfs']));
  assert.deepStrictEqual(
    awsCsvPlan.map((s) => s.id),
    ['auth-bootstrap', 'aws-seed-csv', 'pdf-aws']
  );

  assert.throws(() => parseCliArgs(['--aws-only', '--azure-only']), /Cannot combine/);
  console.log('✓ seed_all self-check assertions passed.');
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.selfCheck) {
    runSelfCheck();
    return;
  }

  const plan = buildSeedPlan(opts);

  console.log('============================================================');
  console.log(`🌱 Unified Seeder (${opts.dryRun ? 'DRY RUN' : 'LIVE EXECUTION'})`);
  console.log(`📅 Started: ${new Date().toISOString()}`);
  console.log('============================================================');

  if (opts.dryRun) {
    plan.forEach((step, idx) => {
      const missing = getMissingEnv(step.requiredEnv);
      const cmd =
        step.kind === 'auth'
          ? 'bootstrapAdmin()'
          : `tsx ${step.scriptPath}${step.args?.length ? ` ${step.args.join(' ')}` : ''}`;
      const envStatus = missing.length ? `⚠️ Missing env: ${missing.join(', ')}` : '✓ Env OK';
      console.log(`  ${idx + 1}. [${step.id}] ${step.label}`);
      console.log(`     Run: ${cmd} | ${envStatus}`);
    });
    console.log('\n✅ Dry-run complete. Re-run without --dry-run to execute.');
    return;
  }

  const runStart = Date.now();
  const results: StepResult[] = [];
  let hasFailure = false;

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const stepStart = Date.now();
    console.log(`\n▶ [${i + 1}/${plan.length}] ${step.label}...`);

    const missing = getMissingEnv(step.requiredEnv);
    if (missing.length > 0) {
      const msg = `Missing required env: ${missing.join(', ')}`;
      console.error(`❌ [${step.id}] ${msg}`);
      results.push({
        label: step.label,
        status: 'FAIL',
        durationSec: '0.0',
        detail: msg,
      });
      hasFailure = true;
      if (!opts.continueOnError) break;
      continue;
    }

    try {
      if (step.kind === 'auth') {
        const res = await runAuthStep();
        if (res.skipped) {
          console.log(`⏭️  Skipped: ${res.skipped}`);
          results.push({
            label: step.label,
            status: 'SKIPPED',
            durationSec: ((Date.now() - stepStart) / 1000).toFixed(1),
            detail: res.skipped,
          });
          continue;
        }
      } else if (step.scriptPath) {
        runScriptStep(step.scriptPath, step.args);
      }

      results.push({
        label: step.label,
        status: 'PASS',
        durationSec: ((Date.now() - stepStart) / 1000).toFixed(1),
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`❌ [${step.id}] Failed: ${msg}`);
      results.push({
        label: step.label,
        status: 'FAIL',
        durationSec: ((Date.now() - stepStart) / 1000).toFixed(1),
        detail: msg.split('\n')[0],
      });
      hasFailure = true;
      if (!opts.continueOnError) break;
    }
  }

  printSummary(results, ((Date.now() - runStart) / 1000).toFixed(1));

  if (hasFailure) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error('❌ Fatal seeder error:', err?.message || err);
    process.exit(1);
  });
}
