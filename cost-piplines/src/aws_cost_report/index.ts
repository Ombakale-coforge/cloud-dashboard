/**
 * src/aws_cost_report/index.ts
 *
 * AWS Report Seeder for SQL Server (Prisma).
 * Ingests generated CSV & JSON reports from AWSReports/ into SQL Server dbo.aws_* tables.
 * Follows the same DB-first + fallback pattern as Azure.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { prisma } from '../server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../cost-dashboard/.env') });

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BASE_REPORTS_DIR = path.join(PROJECT_ROOT, 'AWSReports');

// Basic CSV parser to avoid external import quirks
function readCsvRecords(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === headers.length) {
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx];
      });
      records.push(row);
    }
  }
  return records;
}

function parseCsvLine(text: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim());
  return result;
}

function num(val: any, fallback = 0): number {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

export async function seedAwsReports(): Promise<{ success: boolean; message: string }> {
  if (!prisma) {
    console.warn('⚠️ [AWS Seeder] SQL Server prisma client not available (check DATABASE_URL). Skipping DB seed.');
    return { success: false, message: 'DATABASE_NOT_CONFIGURED' };
  }

  console.log('🌱 [AWS Seeder] Starting AWS SQL Server seeding from AWSReports/...');

  // Discover accounts
  const accountsJsonPath = path.join(BASE_REPORTS_DIR, 'accounts', 'accounts.json');
  let accountsList: Array<{ id: string; name: string; path?: string }> = [];

  if (fs.existsSync(accountsJsonPath)) {
    try {
      accountsList = JSON.parse(fs.readFileSync(accountsJsonPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  if (!accountsList.length) {
    accountsList = [
      { id: 'account-1', name: process.env.AWS_ACCOUNT_NAME || 'AWS Primary Account' },
    ];
  }

  let seededCount = 0;

  for (let i = 0; i < accountsList.length; i++) {
    const accConfig = accountsList[i];
    const configId = accConfig.id || `account-${i + 1}`;
    const accountName = accConfig.name || configId;
    const isPrimary = i === 0;

    // Determine account report directory
    let reportDir = path.join(BASE_REPORTS_DIR, 'accounts', configId, 'latest');
    if (!fs.existsSync(reportDir)) {
      reportDir = path.join(BASE_REPORTS_DIR, 'latest');
    }

    if (!fs.existsSync(reportDir)) {
      console.warn(`  ⚠️ Report folder not found for ${configId}: ${reportDir}`);
      continue;
    }

    console.log(`  📦 Processing account ${configId} (${accountName})...`);

    // 1. Extract 12-digit account ID if present in name
    let extractedAwsId: string | null = null;
    const match = accountName.match(/\b\d{4}-?\d{4}-?\d{4}\b/);
    if (match) {
      extractedAwsId = match[0].replace(/-/g, '');
    }

    // 2. Upsert AwsAccount
    const accountRecord = await prisma.awsAccount.upsert({
      where: { configId },
      update: {
        name: accountName,
        awsAccountId: extractedAwsId,
        isPrimary,
        isActive: true,
      },
      create: {
        configId,
        name: accountName,
        awsAccountId: extractedAwsId,
        isPrimary,
        isActive: true,
      },
    });

    // 3. Create AwsReportRun
    const runStamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const reportRun = await prisma.awsReportRun.create({
      data: {
        accountId: accountRecord.id,
        runStamp,
        status: 'started',
      },
    });

    const reportRunId = reportRun.id;

    // 4. Ingest monthly_totals_last_6_months.csv
    const monthlyTotalsRows = readCsvRecords(path.join(reportDir, 'monthly_totals_last_6_months.csv'));
    let currentMonth = '';
    if (monthlyTotalsRows.length > 0) {
      currentMonth = monthlyTotalsRows[monthlyTotalsRows.length - 1].Month || '';
      await prisma.awsMonthlyTotal.createMany({
        data: monthlyTotalsRows.map((r, idx) => ({
          reportRunId,
          month: r.Month,
          totalCost: num(r['Total Cost']),
          isCurrentMonth: idx === monthlyTotalsRows.length - 1,
        })),
      });
    }

    // 5. Ingest mom_change.csv
    const momRows = readCsvRecords(path.join(reportDir, 'mom_change.csv'));
    if (momRows.length > 0) {
      await prisma.awsMomChange.createMany({
        data: momRows.map((r) => ({
          reportRunId,
          month: r.Month,
          totalCost: num(r['Total Cost']),
          previousMonthCost: r['Previous Month Cost'] ? num(r['Previous Month Cost']) : null,
          difference: r.Difference ? num(r.Difference) : null,
          momPercentChange: r['MoM % Change'] ? num(r['MoM % Change']) : null,
        })),
      });
    }

    // 6. Ingest top_10_services.csv
    const topServicesRows = readCsvRecords(path.join(reportDir, 'top_10_services.csv'));
    if (topServicesRows.length > 0) {
      await prisma.awsTopService.createMany({
        data: topServicesRows.map((r, idx) => ({
          reportRunId,
          month: currentMonth || 'latest',
          rank: idx + 1,
          service: r.Service,
          cost: num(r.Cost || r['Total Cost']),
        })),
      });
    }

    // 7. Ingest cost_by_service_wide.csv (unpivot)
    const serviceWideRows = readCsvRecords(path.join(reportDir, 'cost_by_service_wide.csv'));
    if (serviceWideRows.length > 0) {
      const unpivoted: Array<{ reportRunId: number; month: string; service: string; cost: number }> = [];
      const sample = serviceWideRows[0];
      const monthCols = Object.keys(sample).filter((k) => /^\d{4}-\d{2}$/.test(k));

      serviceWideRows.forEach((row) => {
        const srv = row.Service;
        if (!srv) return;
        monthCols.forEach((m) => {
          unpivoted.push({
            reportRunId,
            month: m,
            service: srv,
            cost: num(row[m]),
          });
        });
      });

      if (unpivoted.length > 0) {
        // Chunk to avoid SQL Server param limits
        for (let j = 0; j < unpivoted.length; j += 400) {
          await prisma.awsCostByService.createMany({
            data: unpivoted.slice(j, j + 400),
          });
        }
      }
    }

    // 8. Ingest cost_by_linked_account_wide.csv (unpivot)
    const linkedWideRows = readCsvRecords(path.join(reportDir, 'cost_by_linked_account_wide.csv'));
    if (linkedWideRows.length > 0) {
      const unpivotedLinked: Array<{ reportRunId: number; linkedAccount: string; month: string; cost: number }> = [];
      const sample = linkedWideRows[0];
      const monthCols = Object.keys(sample).filter((k) => /^\d{4}-\d{2}$/.test(k));

      linkedWideRows.forEach((row) => {
        const acc = row['Linked Account'];
        if (!acc) return;
        monthCols.forEach((m) => {
          unpivotedLinked.push({
            reportRunId,
            linkedAccount: acc,
            month: m,
            cost: num(row[m]),
          });
        });
      });

      if (unpivotedLinked.length > 0) {
        for (let j = 0; j < unpivotedLinked.length; j += 400) {
          await prisma.awsCostByLinkedAccount.createMany({
            data: unpivotedLinked.slice(j, j + 400),
          });
        }
      }
    }

    // 9. Ingest account_cost_variance.csv
    const varianceRows = readCsvRecords(path.join(reportDir, 'account_cost_variance.csv'));
    if (varianceRows.length > 0) {
      await prisma.awsAccountCostVariance.createMany({
        data: varianceRows.map((r) => ({
          reportRunId,
          linkedAccount: r['Linked Account'],
          meanMonthlyCost: num(r['Mean Monthly Cost']),
          stdDev: num(r['Std Dev']),
          coeffOfVariation: num(r['Coeff of Variation']),
          minCost: num(r.Min),
          maxCost: num(r.Max),
          latestVsMeanPct: num(r['Latest vs Mean %']),
          varianceCategory: r['Variance Category'] || 'Normal',
        })),
      });
    }

    // 10. Ingest pareto_analysis.csv / cost_concentration_pareto.csv
    let paretoRows = readCsvRecords(path.join(reportDir, 'pareto_analysis.csv'));
    if (!paretoRows.length) {
      paretoRows = readCsvRecords(path.join(reportDir, 'cost_concentration_pareto.csv'));
    }
    if (paretoRows.length > 0) {
      await prisma.awsParetoAnalysis.createMany({
        data: paretoRows.map((r) => ({
          reportRunId,
          service: r.Service,
          totalSpend: num(r['Total Spend']),
          pctOfTotalSpend: num(r['% of Total Spend']),
          cumulativeSpend: num(r['Cumulative Spend']),
          cumulativePct: num(r['Cumulative %']),
          category: r.Category || 'Other',
        })),
      });
    }

    // 11. Ingest anomaly_flags.csv
    const anomalyRows = readCsvRecords(path.join(reportDir, 'anomaly_flags.csv'));
    if (anomalyRows.length > 0) {
      await prisma.awsAnomalyFlag.createMany({
        data: anomalyRows.map((r) => ({
          reportRunId,
          month: r.Month,
          service: r.Service,
          cost: num(r.Cost),
          rollingMean: num(r['Rolling Mean']),
          rollingStd: num(r['Rolling Std']),
          zScore: num(r['Z-Score']),
          pctVsMean: num(r['% vs Mean']),
          severity: r.Severity || 'Low',
          direction: r.Direction || 'Up',
        })),
      });
    }

    // 12. Ingest recurring_vs_onetime.csv
    const recurringRows = readCsvRecords(path.join(reportDir, 'recurring_vs_onetime.csv'));
    if (recurringRows.length > 0) {
      await prisma.awsRecurringVsOnetime.createMany({
        data: recurringRows.map((r) => ({
          reportRunId,
          service: r.Service,
          totalCost: num(r['Total Cost']),
          activeMonths: parseInt(r['Active Months'] || '1', 10),
          monthsInScope: parseInt(r['Months in Scope'] || '6', 10),
          presencePct: num(r['Presence %']),
          classification: r.Classification || 'Variable',
          avgMonthlyCostActive: num(r['Avg Monthly Cost (Active)']),
          firstSeen: r['First Seen'] || null,
          lastSeen: r['Last Seen'] || null,
        })),
      });
    }

    // 13. Ingest new_services_flag.csv
    const newServiceRows = readCsvRecords(path.join(reportDir, 'new_services_flag.csv'));
    if (newServiceRows.length > 0) {
      await prisma.awsNewServiceFlag.createMany({
        data: newServiceRows.map((r) => ({
          reportRunId,
          month: r.Month,
          service: r.Service,
          cost: num(r.Cost),
          flagType: r['Flag Type'] || 'New Service',
        })),
      });
    }

    // 14. Ingest category_monthly_costs.csv
    const categoryRows = readCsvRecords(path.join(reportDir, 'category_monthly_costs.csv'));
    if (categoryRows.length > 0) {
      await prisma.awsCategoryMonthlyCost.createMany({
        data: categoryRows.map((r) => ({
          reportRunId,
          month: r.Month,
          category: r.Category,
          cost: num(r.Cost),
        })),
      });
    }

    // 15. Ingest forecast_simple.csv / forecast_next_month.csv
    let forecastRows = readCsvRecords(path.join(reportDir, 'forecast_simple.csv'));
    if (!forecastRows.length) {
      forecastRows = readCsvRecords(path.join(reportDir, 'forecast_next_month.csv'));
    }
    if (forecastRows.length > 0) {
      await prisma.awsForecast.createMany({
        data: forecastRows.map((r) => ({
          reportRunId,
          month: r.Month,
          actualCost: r['Actual Cost'] ? num(r['Actual Cost']) : null,
          forecastedCost: r['Forecasted Cost'] ? num(r['Forecasted Cost']) : null,
          method: r.Method || 'Moving Average',
        })),
      });
    }

    // 16. Ingest service_volatility.csv / cost_volatility.csv
    let volatilityRows = readCsvRecords(path.join(reportDir, 'service_volatility.csv'));
    if (!volatilityRows.length) {
      volatilityRows = readCsvRecords(path.join(reportDir, 'cost_volatility.csv'));
    }
    if (volatilityRows.length > 0) {
      await prisma.awsServiceVolatility.createMany({
        data: volatilityRows.map((r) => ({
          reportRunId,
          service: r.Service,
          meanCost: num(r.Mean || r['Mean Monthly Cost']),
          stdDev: num(r['Std Dev']),
          coeffOfVariation: num(r['Coeff of Variation']),
          minCost: num(r.Min),
          maxCost: num(r.Max),
          volatilityCategory: r['Volatility Category'] || 'Medium',
        })),
      });
    }

    // 17. Ingest budgets_overview.csv
    const budgetRows = readCsvRecords(path.join(reportDir, 'budgets_overview.csv'));
    if (budgetRows.length > 0) {
      await prisma.awsBudgetOverview.createMany({
        data: budgetRows.map((r) => ({
          reportRunId,
          budgetName: r['Budget Name'],
          budgetLimit: num(r['Budget Limit']),
          currentSpend: num(r['Current Spend']),
          forecastedSpend: r['Forecasted Spend'] ? num(r['Forecasted Spend']) : null,
          unit: r.Unit || 'USD',
          timeUnit: r['Time Unit'] || 'MONTHLY',
        })),
      });
    }

    // 18. Ingest unbudgeted_accounts.csv
    const unbudgetedRows = readCsvRecords(path.join(reportDir, 'unbudgeted_accounts.csv'));
    if (unbudgetedRows.length > 0) {
      await prisma.awsUnbudgetedAccount.createMany({
        data: unbudgetedRows.map((r) => ({
          reportRunId,
          awsAccountId: (r['Account ID'] || '000000000000').slice(0, 12),
          accountName: r['Account Name'] || 'Unknown',
          monthlySpend: num(r['Monthly Spend']),
          topCostDriver: r['Top Cost Driver'] || null,
        })),
      });
    }

    // 19. Ingest governance_summary.json
    const govSummaryPath = path.join(reportDir, 'governance_summary.json');
    if (fs.existsSync(govSummaryPath)) {
      try {
        const gov = JSON.parse(fs.readFileSync(govSummaryPath, 'utf-8'));
        await prisma.awsGovernanceSummary.create({
          data: {
            reportRunId,
            totalAccounts: gov.totalAccounts || 0,
            activeAccounts: gov.activeAccounts || 0,
            suspendedAccounts: gov.suspendedAccounts || 0,
            accountsWithBudget: gov.accountsWithBudget || 0,
            accountsWithNoBudget: gov.accountsWithNoBudget || 0,
            budgetCoveragePct: num(gov.budgetCoveragePct),
            selectedMonth: gov.selectedMonth || currentMonth,
            activeSpendTotal: num(gov.activeSpendTotal),
            spendUnderBudget: num(gov.spendUnderBudget),
            spendWithNoBudget: num(gov.spendWithNoBudget),
            shareSpendUncoveredPct: num(gov.shareSpendUncoveredPct),
            sumBudgetLimits: num(gov.sumBudgetLimits),
            suspendedAccountsChargingCount: gov.suspendedAccountsChargingCount || 0,
            suspendedAccountsSpendTotal: num(gov.suspendedAccountsSpendTotal),
            suspendedPeriodLabel: gov.suspendedPeriodLabel || 'Current Month',
          },
        });
      } catch (err: any) {
        console.warn(`    ⚠️ Failed to parse governance_summary.json for ${configId}:`, err.message);
      }
    }

    // Mark run as success
    await prisma.awsReportRun.update({
      where: { id: reportRunId },
      data: {
        status: 'success',
        completedAt: new Date(),
        currentMonth,
      },
    });

    console.log(`  ✅ Successfully seeded AWS reports for ${configId} into SQL Server (Run #${reportRunId}).`);
    seededCount++;
  }

  console.log(`🎉 [AWS Seeder] Finished seeding ${seededCount} AWS account(s) into SQL Server.`);
  return { success: true, message: `Seeded ${seededCount} accounts` };
}

// Auto-run if executed directly as a script
if (process.argv[1] && process.argv[1].endsWith('aws_cost_report/index.ts')) {
  seedAwsReports()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error in AWS Seeder:', err);
      process.exit(1);
    });
}
