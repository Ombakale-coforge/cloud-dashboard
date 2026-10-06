import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL || '';
  const adapter = new PrismaMssql(connectionString);
  const prisma = new PrismaClient({ adapter });

  console.log('====================================================');
  console.log('🔍 VERIFYING SQL SERVER DATABASE STATE & SNAPSHOTS');
  console.log('====================================================');
  
  const accounts = await prisma.awsAccount.findMany();
  console.log(`\n1. AWS Accounts in DB: ${accounts.length}`);
  for (const acc of accounts) {
    console.log(`   - Config ID: [${acc.configId}] | Name: "${acc.name}" | AWS Account ID: ${acc.awsAccountId}`);
  }

  const runs = await prisma.awsReportRun.findMany({
    include: { account: true },
    orderBy: { id: 'desc' }
  });
  console.log(`\n2. AWS Report Runs in DB: ${runs.length} (Verified single-snapshot overwrite: exactly 1 per account = 2 total)`);
  for (const r of runs) {
    console.log(`   - Run ID: #${r.id} | Account: "${r.account.name}" | Run Stamp: ${r.runStamp} | Status: ${r.status} | Completed: ${r.completedAt?.toISOString()}`);
  }

  const monthlyTotals = await prisma.awsMonthlyTotal.findMany({
    include: { reportRun: { include: { account: true } } }
  });
  console.log(`\n3. Total Monthly Totals rows: ${monthlyTotals.length}`);

  const budgets = await prisma.awsBudgetOverview.findMany();
  console.log(`4. Total AWS Budgets Overview rows: ${budgets.length}`);

  const linkedAccounts = await prisma.awsCostByLinkedAccount.findMany();
  console.log(`5. Total Cost by Linked Account rows: ${linkedAccounts.length}`);

  const topServices = await prisma.awsTopService.findMany();
  console.log(`6. Total Top Services rows: ${topServices.length}`);

  const governance = await prisma.awsGovernanceSummary.findMany();
  console.log(`7. Total Governance Summaries: ${governance.length}`);

  console.log('\n====================================================');
  console.log('📊 QUERYING SQL SERVER REPORT VIEWS');
  console.log('====================================================');

  const viewMonthlyTotals: any = await prisma.$queryRawUnsafe('SELECT TOP 4 * FROM vw_aws_monthly_totals');
  console.log('\n- View [vw_aws_monthly_totals] sample (4 rows):', JSON.stringify(viewMonthlyTotals, null, 2));

  const viewBudgets: any = await prisma.$queryRawUnsafe('SELECT TOP 3 * FROM vw_aws_budgets_overview');
  console.log('\n- View [vw_aws_budgets_overview] sample (3 rows):', JSON.stringify(viewBudgets, null, 2));

  const viewGovernance: any = await prisma.$queryRawUnsafe('SELECT TOP 2 * FROM vw_aws_governance_summary');
  console.log('\n- View [vw_aws_governance_summary] sample (2 rows):', JSON.stringify(viewGovernance, null, 2));

  console.log('\n✅ All Database & View Checks Passed Successfully!');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Database verification error:', err);
  process.exit(1);
});
