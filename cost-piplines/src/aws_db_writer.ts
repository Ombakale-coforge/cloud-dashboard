/**
 * src/aws_db_writer.ts
 *
 * Persists AWS Cost Pipeline runs and analytical datasets directly into SQL Server via Prisma Client.
 */

import { PrismaClient } from '../generated/prisma/client.mjs';
import { PrismaMssql } from '@prisma/adapter-mssql';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set in environment variables.");
    }
    const adapter = new PrismaMssql(process.env.DATABASE_URL);
    prismaInstance = new PrismaClient({ adapter });
  }
  return prismaInstance;
}

function safeNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || isNaN(Number(val))) return fallback;
  return Number(val);
}

function safeDecimal(val: any, fallback = 0): string {
  const n = safeNum(val, fallback);
  return n.toFixed(2);
}

export interface AwsAccountConfig {
  id: string;
  name: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  isPrimary?: boolean;
}

export interface MonthlyDataRecord {
  month: string;
  totalCost: number;
  services: Record<string, number>;
}

export interface LinkedAccountData {
  singleMonthRows?: Array<{ "Linked Account": string; Cost: number }>;
  widePivot?: Record<string, Record<string, number>>;
  fullAccountDetails?: Array<{
    Id: string;
    Name?: string;
    Status?: string;
    Arn?: string;
    Email?: string;
  }>;
}

export interface SaveAwsReportRunOptions {
  accountConfig: AwsAccountConfig;
  runStamp: string;
  windowStart?: string | Date | null;
  windowEnd?: string | Date | null;
  monthsHistory?: number;
  monthlyData: MonthlyDataRecord[];
  serviceCols: string[];
  linkedAccountData?: LinkedAccountData | null;
  budgetsData?: any[];
  unbudgetedAccounts?: any[];
  governanceSummary?: any;
  runLog?: string[];
}

/**
 * Persists an AWS pipeline run into SQL Server.
 */
export async function saveAwsReportRunToDb({
  accountConfig,
  runStamp,
  windowStart,
  windowEnd,
  monthsHistory,
  monthlyData,
  serviceCols,
  linkedAccountData,
  budgetsData,
  unbudgetedAccounts,
  governanceSummary,
  runLog,
}: SaveAwsReportRunOptions): Promise<number> {
  const prisma = getPrismaClient();
  const { id: configId, name, region, isPrimary } = accountConfig;

  // Extract 12-digit AWS account ID if in name
  const match = name.match(/\d{4}-?\d{4}-?\d{4}/) || name.match(/\d{12}/);
  const cleanAccountId = match ? match[0].replace(/[^0-9]/g, "") : null;

  console.log(`[DB Writer] Syncing account "${name}" (${configId}) into SQL Server...`);

  // 1. Upsert AwsAccount
  const awsAccount = await prisma.awsAccount.upsert({
    where: { configId },
    update: {
      name,
      awsAccountId: cleanAccountId,
      region,
      isPrimary: !!isPrimary,
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      configId,
      name,
      awsAccountId: cleanAccountId,
      region,
      isPrimary: !!isPrimary,
      isActive: true,
    },
  });

  const monthsCovered = monthlyData.map((m) => m.month);
  const currentMonth = monthsCovered[monthsCovered.length - 1] || null;

  // Clean up any previous runs for this account so we overwrite and maintain exactly 1 clean set of data
  await prisma.awsReportRun.deleteMany({
    where: { accountId: awsAccount.id },
  });

  // 2. Create fresh AwsReportRun
  const reportRun = await prisma.awsReportRun.create({
    data: {
      accountId: awsAccount.id,
      runStamp,
      status: "started",
      startedAt: new Date(),
      windowStart: windowStart ? new Date(windowStart) : null,
      windowEnd: windowEnd ? new Date(windowEnd) : null,
      monthsHistory: monthsHistory || 6,
      monthsCovered: JSON.stringify(monthsCovered),
      currentMonth,
      monthCount: monthlyData.length,
      serviceCount: serviceCols ? serviceCols.length : 0,
      linkedAccountCount: linkedAccountData?.fullAccountDetails?.length || 0,
      budgetCount: budgetsData ? budgetsData.length : 0,
      anomalySigma: 2.0,
      anomalyRollingMonths: 3,
      forecastMethod: "3-Month Rolling Average",
    },
  });

  const reportRunId = reportRun.id;

  try {
    // 3. Upsert linked accounts directory
    if (linkedAccountData?.fullAccountDetails && linkedAccountData.fullAccountDetails.length > 0) {
      for (const la of linkedAccountData.fullAccountDetails) {
        await prisma.awsLinkedAccount.upsert({
          where: {
            accountId_linkedAccountId: {
              accountId: awsAccount.id,
              linkedAccountId: la.Id,
            },
          },
          update: {
            name: la.Name,
            status: la.Status || "ACTIVE",
            lastSeenAt: new Date(),
          },
          create: {
            accountId: awsAccount.id,
            linkedAccountId: la.Id,
            name: la.Name,
            status: la.Status || "ACTIVE",
          },
        });
      }
    }

    // 4. Monthly Totals
    const monthlyTotalRecords = monthlyData.map((m, idx) => ({
      reportRunId,
      month: m.month,
      totalCost: safeDecimal(m.totalCost) as any,
      isCurrentMonth: idx === monthlyData.length - 1,
    }));
    if (monthlyTotalRecords.length > 0) {
      await prisma.awsMonthlyTotal.createMany({ data: monthlyTotalRecords });
    }

    // 5. Cost by Service (unpivoted long format)
    const costByServiceRecords = [];
    for (const m of monthlyData) {
      for (const s of serviceCols) {
        const cost = m.services[s] || 0;
        if (cost > 0) {
          costByServiceRecords.push({
            reportRunId,
            month: m.month,
            service: s,
            cost: safeDecimal(cost) as any,
          });
        }
      }
    }
    if (costByServiceRecords.length > 0) {
      await prisma.awsCostByService.createMany({ data: costByServiceRecords });
    }

    // 6. Top Services (Current month top 10)
    const latestMonthObj = monthlyData[monthlyData.length - 1];
    if (latestMonthObj) {
      const sortedServices = serviceCols
        .map((s) => ({ service: s, cost: safeNum(latestMonthObj.services[s]) }))
        .filter((s) => s.cost > 0)
        .sort((a, b) => b.cost - a.cost);

      const top10Records = sortedServices.slice(0, 10).map((s, idx) => ({
        reportRunId,
        month: latestMonthObj.month,
        rank: idx + 1,
        service: s.service,
        cost: safeDecimal(s.cost) as any,
      }));
      if (top10Records.length > 0) {
        await prisma.awsTopService.createMany({ data: top10Records });
      }

      // 7. Pareto Analysis
      const totalCost = latestMonthObj.totalCost || 1;
      let cumCost = 0;
      const paretoRecords = sortedServices.map((s, idx) => {
        cumCost += s.cost;
        const cumPct = (cumCost / totalCost) * 100;
        return {
          reportRunId,
          month: latestMonthObj.month,
          rank: idx + 1,
          service: s.service,
          cost: safeDecimal(s.cost) as any,
          cumulativeCost: safeDecimal(cumCost) as any,
          cumulativePercent: cumPct.toFixed(2) as any,
          paretoClass: cumPct <= 80 ? "Top 80%" : "Remaining 20%",
        };
      });
      if (paretoRecords.length > 0) {
        await prisma.awsParetoAnalysis.createMany({ data: paretoRecords });
      }
    }

    // 8. Cost by Linked Account
    if (linkedAccountData?.widePivot) {
      const linkedAccRecords = [];
      const varianceRecords = [];
      const months = monthlyData.map((m) => m.month);
      const currM = months[months.length - 1];
      const prevM = months.length > 1 ? months[months.length - 2] : null;

      for (const [accKey, costsByMonth] of Object.entries(linkedAccountData.widePivot)) {
        for (const [m, cost] of Object.entries(costsByMonth)) {
          if (cost > 0) {
            linkedAccRecords.push({
              reportRunId,
              linkedAccount: accKey,
              month: m,
              cost: safeDecimal(cost) as any,
            });
          }
        }

        const currCost = safeNum(costsByMonth[currM]);
        const prevCost = prevM ? safeNum(costsByMonth[prevM]) : 0;
        const diff = currCost - prevCost;
        const pctChange = prevCost > 0 ? (diff / prevCost) * 100 : 0;

        varianceRecords.push({
          reportRunId,
          linkedAccount: accKey,
          prevMonthCost: safeDecimal(prevCost) as any,
          currMonthCost: safeDecimal(currCost) as any,
          difference: safeDecimal(diff) as any,
          percentageChange: pctChange.toFixed(2) as any,
        });
      }

      if (linkedAccRecords.length > 0) {
        await prisma.awsCostByLinkedAccount.createMany({ data: linkedAccRecords });
      }
      if (varianceRecords.length > 0) {
        await prisma.awsAccountCostVariance.createMany({ data: varianceRecords });
      }
    }

    // 9. MoM Change
    const momRecords = [];
    for (let i = 0; i < monthlyData.length; i++) {
      const curr = monthlyData[i];
      const prev = i > 0 ? monthlyData[i - 1] : null;
      const prevCost = prev ? prev.totalCost : null;
      const diff = prev ? curr.totalCost - prev.totalCost : null;
      const pct = prev && prev.totalCost > 0 ? (diff / prev.totalCost) * 100 : null;

      momRecords.push({
        reportRunId,
        month: curr.month,
        totalCost: safeDecimal(curr.totalCost) as any,
        previousMonthCost: prevCost !== null ? (safeDecimal(prevCost) as any) : null,
        difference: diff !== null ? (safeDecimal(diff) as any) : null,
        momPercentChange: pct !== null ? (pct.toFixed(2) as any) : null,
      });
    }
    if (momRecords.length > 0) {
      await prisma.awsMomChange.createMany({ data: momRecords });
    }

    // 10. Anomaly Flags
    const anomalyRecords = [];
    for (let i = 0; i < monthlyData.length; i++) {
      const curr = monthlyData[i];
      if (i < 2) {
        anomalyRecords.push({
          reportRunId,
          month: curr.month,
          totalCost: safeDecimal(curr.totalCost) as any,
          rollingAvg: null,
          rollingStd: null,
          anomalyFlag: "Normal (insufficient history)",
          isAnomaly: false,
        });
        continue;
      }
      const prior3 = monthlyData.slice(Math.max(0, i - 3), i).map((m) => m.totalCost);
      const mean = prior3.reduce((a, b) => a + b, 0) / prior3.length;
      const variance = prior3.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prior3.length;
      const std = Math.sqrt(variance);
      const isHigh = curr.totalCost > mean + 2 * std;
      const isLow = curr.totalCost < mean - 2 * std && curr.totalCost < mean;
      const flag = isHigh ? "HIGH ANOMALY" : isLow ? "LOW ANOMALY" : "Normal";

      anomalyRecords.push({
        reportRunId,
        month: curr.month,
        totalCost: safeDecimal(curr.totalCost) as any,
        rollingAvg: safeDecimal(mean) as any,
        rollingStd: safeDecimal(std) as any,
        anomalyFlag: flag,
        isAnomaly: isHigh || isLow,
      });
    }
    if (anomalyRecords.length > 0) {
      await prisma.awsAnomalyFlag.createMany({ data: anomalyRecords });
    }

    // 11. Recurring vs One-time
    const recurringRecords = serviceCols.map((s) => {
      const costs = monthlyData.map((m) => m.services[s] || 0);
      const activeMonths = costs.filter((c) => c > 0).length;
      const totalMonths = monthlyData.length;
      const activePct = totalMonths > 0 ? (activeMonths / totalMonths) * 100 : 0;
      const totalCost = costs.reduce((a, b) => a + b, 0);
      const classification =
        activePct >= 80 ? "Recurring" : activePct <= 30 ? "One-time / Intermittent" : "Variable";

      return {
        reportRunId,
        service: s,
        activeMonths,
        totalMonthsInRun: totalMonths,
        activePercent: activePct.toFixed(2) as any,
        totalCostOverPeriod: safeDecimal(totalCost) as any,
        classification,
      };
    });
    if (recurringRecords.length > 0) {
      await prisma.awsRecurringVsOnetime.createMany({ data: recurringRecords });
    }

    // 12. New Services Flag
    const newServiceRecords = [];
    if (monthlyData.length > 1) {
      const priorServices = new Set<string>();
      for (let i = 0; i < monthlyData.length - 1; i++) {
        for (const s of serviceCols) {
          if ((monthlyData[i].services[s] || 0) > 0) priorServices.add(s);
        }
      }
      const latestMonth = monthlyData[monthlyData.length - 1];
      for (const s of serviceCols) {
        const cost = latestMonth.services[s] || 0;
        if (cost > 0 && !priorServices.has(s)) {
          newServiceRecords.push({
            reportRunId,
            service: s,
            costInLatestMonth: safeDecimal(cost) as any,
            firstSeenMonth: latestMonth.month,
            note: "New service in latest month",
          });
        }
      }
    }
    if (newServiceRecords.length > 0) {
      await prisma.awsNewServiceFlag.createMany({ data: newServiceRecords });
    }

    // 13. Category Costs
    const CATEGORY_RULES: Array<[string, string[]]> = [
      ["AI/ML - Bedrock", ["bedrock", "claude"]],
      ["AI/ML - Other", ["sagemaker", "comprehend", "textract", "polly", "transcribe", "lex", "rekognition"]],
      ["Compute", ["ec2", "lightsail", "app runner", "lambda", "elastic container", "batch"]],
      ["Storage", ["s3", "glacier", "efs", "elastic file system", "backup"]],
      ["Database", ["rds", "relational database", "dynamodb", "documentdb", "elasticache", "redshift"]],
      ["Networking", ["vpc", "route 53", "cloudfront", "elastic load balancing", "direct connect", "data transfer"]],
      ["Security & Governance", ["guardduty", "security hub", "waf", "kms", "key management", "secrets manager", "cognito", "config", "audit manager", "certificate manager", "iam"]],
      ["Monitoring & Logging", ["cloudwatch", "cloudtrail", "x-ray"]],
      ["Serverless/Integration", ["step functions", "sqs", "sns", "eventbridge", "api gateway", "appsync"]],
      ["Analytics", ["athena", "glue", "quicksight", "kinesis", "data pipeline", "opensearch", "managed streaming"]],
      ["Tax", ["tax"]],
      ["Support", ["support"]],
    ];

    function categorizeService(serviceName: string): string {
      const nameLower = serviceName.toLowerCase();
      for (const [category, keywords] of CATEGORY_RULES) {
        if (keywords.some((kw) => nameLower.includes(kw))) return category;
      }
      return "Other";
    }

    const categoryRecords = [];
    for (const m of monthlyData) {
      const catTotals: Record<string, number> = {};
      for (const s of serviceCols) {
        const cost = m.services[s] || 0;
        if (cost > 0) {
          const cat = categorizeService(s);
          catTotals[cat] = (catTotals[cat] || 0) + cost;
        }
      }
      const mTotal = m.totalCost || 1;
      for (const [cat, cost] of Object.entries(catTotals)) {
        categoryRecords.push({
          reportRunId,
          month: m.month,
          category: cat,
          cost: safeDecimal(cost) as any,
          sharePercent: ((cost / mTotal) * 100).toFixed(2) as any,
        });
      }
    }
    if (categoryRecords.length > 0) {
      await prisma.awsCategoryMonthlyCost.createMany({ data: categoryRecords });
    }

    // 14. Forecast
    if (monthlyData.length >= 2) {
      const last3 = monthlyData.slice(-3).map((m) => m.totalCost);
      const avg = last3.reduce((a, b) => a + b, 0) / last3.length;
      const lastM = monthlyData[monthlyData.length - 1].month;
      const [y, mo] = lastM.split("-").map(Number);
      
      const m1Date = new Date(Date.UTC(y, mo, 1));
      const m2Date = new Date(Date.UTC(y, mo + 1, 1));
      const nextMonth1 = m1Date.toISOString().slice(0, 7);
      const nextMonth2 = m2Date.toISOString().slice(0, 7);

      const forecastRecords = [
        {
          reportRunId,
          forecastMonth: nextMonth1,
          projectedCost: safeDecimal(avg) as any,
          method: "3-Month Rolling Average",
        },
        {
          reportRunId,
          forecastMonth: nextMonth2,
          projectedCost: safeDecimal(avg) as any,
          method: "3-Month Rolling Average",
        },
      ];
      await prisma.awsForecast.createMany({ data: forecastRecords });
    }

    // 15. Service Volatility
    const volatilityRecords = [];
    for (const s of serviceCols) {
      const costs = monthlyData.map((m) => m.services[s] || 0);
      const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
      if (mean > 0) {
        const variance = costs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / costs.length;
        const std = Math.sqrt(variance);
        const cv = (std / mean) * 100;
        volatilityRecords.push({
          reportRunId,
          service: s,
          mean: safeDecimal(mean) as any,
          stdDev: safeDecimal(std) as any,
          coefficientOfVariationPercent: cv.toFixed(2) as any,
        });
      }
    }
    if (volatilityRecords.length > 0) {
      await prisma.awsServiceVolatility.createMany({ data: volatilityRecords });
    }

    // 16. Budgets
    if (budgetsData && budgetsData.length > 0) {
      const budgetRecords = budgetsData.map((b: any) => {
        const name = b.BudgetName || "Unnamed Budget";
        const limit = parseFloat(b.BudgetLimit?.Amount) || 0;
        const used = parseFloat(b.CalculatedSpend?.ActualSpend?.Amount) || 0;
        const forecast = parseFloat(b.CalculatedSpend?.ForecastedSpend?.Amount) || 0;
        const pct = limit > 0 ? (used / limit) * 100 : 0;
        const isExceeded = pct >= 100;
        const thresholdStatus = isExceeded ? "Exceeded (1)" : pct >= 80 ? "Warning" : "OK";
        const healthStatus = isExceeded ? "Alert" : "Healthy";

        return {
          reportRunId,
          budgetName: name,
          limitAmount: safeDecimal(limit) as any,
          currentUsed: safeDecimal(used) as any,
          forecastedSpend: safeDecimal(forecast) as any,
          currentVsBudgetPercent: pct.toFixed(2) as any,
          thresholdStatus,
          healthStatus,
        };
      });
      await prisma.awsBudgetOverview.createMany({ data: budgetRecords });
    }

    // 17. Unbudgeted Accounts
    if (unbudgetedAccounts && unbudgetedAccounts.length > 0) {
      const unbudgetedRecords = unbudgetedAccounts.map((acc: any) => ({
        reportRunId,
        accountName: acc["Account Name"] || "Unknown",
        awsAccountId: String(acc["Account ID"] || "").replace(/[^0-9]/g, "").slice(0, 12),
        status: acc.Status || "ACTIVE",
        currentMonthSpend: safeDecimal(acc["Current Month Spend"]) as any,
        previousMonthSpend: safeDecimal(acc["Previous Month Spend"]) as any,
        momChangePercent: safeNum(acc["MoM Change %"]).toFixed(2) as any,
        topCostDriver: acc["Top Cost Driver"] || "Cloud Services",
      }));
      await prisma.awsUnbudgetedAccount.createMany({ data: unbudgetedRecords });
    }

    // 18. Governance Summary
    if (governanceSummary) {
      await prisma.awsGovernanceSummary.create({
        data: {
          reportRunId,
          selectedMonth: governanceSummary.selectedMonth || currentMonth || "",
          totalAccounts: safeNum(governanceSummary.totalAccounts),
          activeAccounts: safeNum(governanceSummary.activeAccounts),
          suspendedAccounts: safeNum(governanceSummary.suspendedAccounts),
          accountsWithBudget: safeNum(governanceSummary.accountsWithBudget),
          accountsWithNoBudget: safeNum(governanceSummary.accountsWithNoBudget),
          budgetCoveragePct: safeNum(governanceSummary.budgetCoveragePct).toFixed(2) as any,
          activeSpendTotal: safeDecimal(governanceSummary.activeSpendTotal) as any,
          spendUnderBudget: safeDecimal(governanceSummary.spendUnderBudget) as any,
          spendWithNoBudget: safeDecimal(governanceSummary.spendWithNoBudget) as any,
          shareSpendUncoveredPct: safeNum(governanceSummary.shareSpendUncoveredPct).toFixed(2) as any,
          sumBudgetLimits: safeDecimal(governanceSummary.sumBudgetLimits) as any,
          suspendedAccountsChargingCount: safeNum(governanceSummary.suspendedAccountsChargingCount),
          suspendedAccountsSpendTotal: safeDecimal(governanceSummary.suspendedAccountsSpendTotal) as any,
          suspendedPeriodLabel: governanceSummary.suspendedPeriodLabel || "",
        },
      });
    }

    // Update Report Run to 'success'
    await prisma.awsReportRun.update({
      where: { id: reportRunId },
      data: {
        status: "success",
        completedAt: new Date(),
        durationMs: Date.now() - reportRun.startedAt.getTime(),
        logText: Array.isArray(runLog) ? runLog.join("\n") : "",
      },
    });

    console.log(`[DB Writer] ✅ Successfully saved report run #${reportRunId} to SQL Server!`);
    return reportRunId;
  } catch (dbErr: any) {
    console.error(`[DB Writer] ❌ Error saving report run #${reportRunId} to SQL Server:`, dbErr);
    await prisma.awsReportRun.update({
      where: { id: reportRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        errorMessage: dbErr.message,
        logText: Array.isArray(runLog) ? runLog.join("\n") : "",
      },
    });
    throw dbErr;
  }
}
