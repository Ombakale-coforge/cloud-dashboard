import { Router, Request, Response } from 'express';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { OrganizationsClient, DescribeAccountCommand } from '@aws-sdk/client-organizations';
import { prisma } from '../db.ts';

const router = Router();

function getAwsCredentials(configId: string) {
  if (configId === 'account-2') {
    if (process.env.AWS_ACCOUNT_2_ACCESS_KEY_ID && process.env.AWS_ACCOUNT_2_SECRET_ACCESS_KEY) {
      return {
        accessKeyId: process.env.AWS_ACCOUNT_2_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_ACCOUNT_2_SECRET_ACCESS_KEY,
        region: process.env.AWS_ACCOUNT_2_REGION || process.env.AWS_REGION || 'us-east-1',
      };
    }
  }
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    };
  }
  return null;
}


async function getLatestRunForAccount(accountParam: string | string[] | any) {
  if (!prisma) return null;
  const configId = accountParam ? String(accountParam).replace('/data/accounts/', '').replace('/data', '') || 'account-1' : 'account-1';

  let account = await prisma.awsAccount.findFirst({
    where: {
      OR: [
        { configId: configId },
        { configId: configId === 'default' ? 'account-1' : configId },
      ],
    },
  });

  if (!account) {
    account = (await prisma.awsAccount.findFirst({ where: { isPrimary: true } })) ||
              (await prisma.awsAccount.findFirst());
  }

  if (!account) return null;

  const latestRun = await prisma.awsReportRun.findFirst({
    where: {
      accountId: account.id,
      status: 'success',
    },
    orderBy: {
      id: 'desc',
    },
  });

  return { account, run: latestRun };
}

// 1. Get list of configured AWS accounts from SQL Server
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED', message: 'SQL Server connection not initialized.' });
    }
    const accounts = await prisma.awsAccount.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    if (!accounts || accounts.length === 0) {
      return res.status(404).json({ error: 'NO_AWS_ACCOUNTS', message: 'No active AWS accounts configured in database.' });
    }

    const formatted = accounts.map((a) => {
      let accountName = a.name;
      let accountId = a.awsAccountId || '';
      const match = a.name.match(/\(([^)]+)\)/);
      if (match) {
        accountId = match[1];
        accountName = a.name.replace(/\s*\([^)]+\)/, '').trim();
      }

      return {
        id: a.configId,
        name: a.name,
        accountId: accountId || a.configId,
        accountName: accountName || a.name,
        path: a.isPrimary ? '/data' : `/data/accounts/${a.configId}`,
      };
    });

    res.json(formatted);
  } catch (err: any) {
    console.error('Error fetching AWS accounts:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 2. Dynamic AWS Dataset endpoint (returns data shaped for dashboard components)
router.get('/dataset/:filename', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }

    const rawFilename = req.params.filename || '';
    const cleanFilename = rawFilename.toLowerCase().replace(/\.csv$/, '').replace(/\.json$/, '');
    const accountParam = req.query.account || req.query.path || 'account-1';
    const targetMonth = req.query.month ? String(req.query.month).trim() : null;

    const accountContext = await getLatestRunForAccount(accountParam);
    if (!accountContext || !accountContext.run) {
      return res.status(404).json({ error: 'NO_RUN_FOUND', message: 'No AWS report run found in database' });
    }

    const { run } = accountContext;
    const reportRunId = run.id;

    switch (cleanFilename) {
      case 'mom_change': {
        const records = await prisma.awsMomChange.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
          'Previous Month Cost': r.previousMonthCost !== null ? Number(r.previousMonthCost) : '',
          Difference: r.difference !== null ? Number(r.difference) : '',
          'MoM % Change': r.momPercentChange !== null ? Number(r.momPercentChange) : '',
        }));
        return res.json(mapped);
      }

      case 'monthly_totals_last_6_months': {
        const records = await prisma.awsMonthlyTotal.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
        }));
        return res.json(mapped);
      }

      case 'current_month_total': {
        const record = await prisma.awsMonthlyTotal.findFirst({
          where: { reportRunId, isCurrentMonth: true },
        });
        return res.json([{ 'Total Cost': Number(record?.totalCost || 0) }]);
      }

      case 'top_10_services': {
        const records = await prisma.awsTopService.findMany({
          where: { reportRunId },
          orderBy: { rank: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Cost: Number(r.cost),
          'Total Cost': Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'latest_month_services': {
        const records = await prisma.awsCostByService.findMany({
          where: { reportRunId, month: run.currentMonth || undefined },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'cost_by_service_wide': {
        const records = await prisma.awsCostByService.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { cost: 'desc' }],
        });
        const monthsSet = new Set<string>();
        const serviceMap: Record<string, Record<string, number>> = {};

        records.forEach((r) => {
          monthsSet.add(r.month);
          if (!serviceMap[r.service]) serviceMap[r.service] = {};
          serviceMap[r.service][r.month] = Number(r.cost);
        });

        const sortedMonths = Array.from(monthsSet).sort();
        const wide = Object.keys(serviceMap).map((srv) => {
          const row: Record<string, any> = { Service: srv };
          let total = 0;
          sortedMonths.forEach((m) => {
            const val = serviceMap[srv][m] || 0;
            row[m] = val;
            total += val;
          });
          row['Total Cost'] = total;
          return row;
        });

        wide.sort((a, b) => b['Total Cost'] - a['Total Cost']);
        return res.json(wide);
      }

      case 'cost_by_linked_account_wide': {
        const records = await prisma.awsCostByLinkedAccount.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { cost: 'desc' }],
        });
        const monthsSet = new Set<string>();
        const accMap: Record<string, Record<string, number>> = {};

        records.forEach((r) => {
          monthsSet.add(r.month);
          if (!accMap[r.linkedAccount]) accMap[r.linkedAccount] = {};
          accMap[r.linkedAccount][r.month] = Number(r.cost);
        });

        const sortedMonths = Array.from(monthsSet).sort();
        const wide = Object.keys(accMap).map((acc) => {
          const row: Record<string, any> = { 'Linked Account': acc };
          sortedMonths.forEach((m) => {
            row[m] = accMap[acc][m] || 0;
          });
          return row;
        });
        return res.json(wide);
      }

      case 'cost_by_linked_account': {
        const records = await prisma.awsCostByLinkedAccount.findMany({
          where: { reportRunId, month: run.currentMonth || undefined },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          'Linked Account': r.linkedAccount,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'account_cost_variance': {
        const records = await prisma.awsAccountCostVariance.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Linked Account': r.linkedAccount,
          'Mean Monthly Cost': Number(r.meanMonthlyCost),
          'Std Dev': Number(r.stdDev),
          'Coeff of Variation': Number(r.coeffOfVariation),
          Min: Number(r.minCost),
          Max: Number(r.maxCost),
          'Latest vs Mean %': Number(r.latestVsMeanPct),
          'Variance Category': r.varianceCategory,
        }));
        return res.json(mapped);
      }

      case 'pareto_analysis':
      case 'cost_concentration_pareto': {
        const records = await prisma.awsParetoAnalysis.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'Total Spend': Number(r.totalSpend),
          '% of Total Spend': Number(r.pctOfTotalSpend),
          'Cumulative Spend': Number(r.cumulativeSpend),
          'Cumulative %': Number(r.cumulativePct),
          Category: r.category,
        }));
        return res.json(mapped);
      }

      case 'anomaly_flags': {
        const records = await prisma.awsAnomalyFlag.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Service: r.service,
          Cost: Number(r.cost),
          'Rolling Mean': Number(r.rollingMean),
          'Rolling Std': Number(r.rollingStd),
          'Z-Score': Number(r.zScore),
          '% vs Mean': Number(r.pctVsMean),
          Severity: r.severity,
          Direction: r.direction,
        }));
        return res.json(mapped);
      }

      case 'recurring_vs_onetime': {
        const records = await prisma.awsRecurringVsOnetime.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'Total Cost': Number(r.totalCost),
          'Active Months': r.activeMonths,
          'Months in Scope': r.monthsInScope,
          'Presence %': Number(r.presencePct),
          Classification: r.classification,
          'Avg Monthly Cost (Active)': Number(r.avgMonthlyCostActive),
          'First Seen': r.firstSeen,
          'Last Seen': r.lastSeen,
        }));
        return res.json(mapped);
      }

      case 'new_services_flag': {
        const records = await prisma.awsNewServiceFlag.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Service: r.service,
          Cost: Number(r.cost),
          'Flag Type': r.flagType,
        }));
        return res.json(mapped);
      }

      case 'category_monthly_costs': {
        const records = await prisma.awsCategoryMonthlyCost.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { id: 'asc' }],
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Category: r.category,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'forecast_simple':
      case 'forecast_next_month': {
        const records = await prisma.awsForecast.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Actual Cost': r.actualCost !== null ? Number(r.actualCost) : '',
          'Forecasted Cost': r.forecastedCost !== null ? Number(r.forecastedCost) : '',
          Method: r.method || '',
        }));
        return res.json(mapped);
      }

      case 'service_volatility':
      case 'cost_volatility': {
        const records = await prisma.awsServiceVolatility.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Mean: Number(r.meanCost),
          'Std Dev': Number(r.stdDev),
          'Coeff of Variation': Number(r.coeffOfVariation),
          Min: Number(r.minCost),
          Max: Number(r.maxCost),
          'Volatility Category': r.volatilityCategory,
        }));
        return res.json(mapped);
      }

      case 'budgets_overview': {
        const records = await prisma.awsBudgetOverview.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Budget Name': r.budgetName,
          'Budget Limit': Number(r.limitAmount),
          'Limit': Number(r.limitAmount),
          'Current Spend': Number(r.currentUsed),
          'Current Used': Number(r.currentUsed),
          'Forecasted Spend': r.forecastedSpend !== null ? Number(r.forecastedSpend) : '',
          'Current vs Budget %': Number(r.currentVsBudgetPercent),
          'Threshold Status': r.thresholdStatus,
          'Health Status': r.healthStatus,
        }));
        return res.json(mapped);
      }

      case 'unbudgeted_accounts': {
        const records = await prisma.awsUnbudgetedAccount.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });

        if (targetMonth && targetMonth.match(/^\d{4}-\d{2}$/)) {
          const [yearStr, monthStr] = targetMonth.split('-');
          const year = parseInt(yearStr, 10);
          const month = parseInt(monthStr, 10);
          const prevDate = new Date(Date.UTC(year, month - 2, 1));
          const prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;

          const accountCosts = await prisma.awsCostByLinkedAccount.findMany({
            where: {
              reportRunId,
              month: { in: [targetMonth, prevMonthStr] },
            },
          });

          const costMap: Record<string, { current: number; previous: number }> = {};
          accountCosts.forEach((ac) => {
            if (!costMap[ac.linkedAccount]) costMap[ac.linkedAccount] = { current: 0, previous: 0 };
            if (ac.month === targetMonth) {
              costMap[ac.linkedAccount].current = Number(ac.cost);
            } else if (ac.month === prevMonthStr) {
              costMap[ac.linkedAccount].previous = Number(ac.cost);
            }
          });

          const mapped = records
            .map((r) => {
              const costs = costMap[r.awsAccountId] || { current: 0, previous: 0 };
              const currentSpend = costs.current;
              const prevSpend = costs.previous;
              const diff = currentSpend - prevSpend;
              const momChange = prevSpend > 0 ? Number(((diff / prevSpend) * 100).toFixed(1)) : 0;

              return {
                'Account Name': r.accountName,
                'Account ID': r.awsAccountId,
                Status: r.status,
                'Current Month Spend': currentSpend,
                'Previous Month Spend': prevSpend,
                'MoM Change %': momChange,
                'Top Cost Driver': r.topCostDriver || 'Cloud Services',
              };
            })
            .sort((a, b) => b['Current Month Spend'] - a['Current Month Spend']);

          return res.json(mapped);
        }

        const mapped = records.map((r) => ({
          'Account Name': r.accountName,
          'Account ID': r.awsAccountId,
          Status: r.status,
          'Current Month Spend': Number(r.currentMonthSpend),
          'Previous Month Spend': Number(r.previousMonthSpend),
          'MoM Change %': Number(r.momChangePercent),
          'Top Cost Driver': r.topCostDriver || '',
        }));
        return res.json(mapped);
      }

      case 'governance_summary': {
        const record = await prisma.awsGovernanceSummary.findFirst({
          where: { reportRunId },
        });
        if (!record) return res.json(null);

        // If targetMonth is provided and different from pipeline run latest month, dynamically compute spend for that month
        if (targetMonth && targetMonth.match(/^\d{4}-\d{2}$/) && targetMonth !== record.selectedMonth) {
          const unbudgetedList = await prisma.awsUnbudgetedAccount.findMany({ where: { reportRunId } });
          const unbudgetedIds = new Set(unbudgetedList.map((u) => u.awsAccountId));

          const monthCosts = await prisma.awsCostByLinkedAccount.findMany({
            where: { reportRunId, month: targetMonth },
          });

          let totalActive = 0;
          let underBudget = 0;
          let noBudget = 0;

          for (const c of monthCosts) {
            const cost = Number(c.cost);
            totalActive += cost;
            if (unbudgetedIds.has(c.linkedAccount)) {
              noBudget += cost;
            } else {
              underBudget += cost;
            }
          }

          const shareUncovered = totalActive > 0 ? Number(((noBudget / totalActive) * 100).toFixed(1)) : 0;

          return res.json({
            totalAccounts: record.totalAccounts,
            activeAccounts: record.activeAccounts,
            suspendedAccounts: record.suspendedAccounts,
            accountsWithBudget: record.accountsWithBudget,
            accountsWithNoBudget: record.accountsWithNoBudget,
            budgetCoveragePct: Number(record.budgetCoveragePct),
            selectedMonth: targetMonth,
            activeSpendTotal: Number(totalActive.toFixed(2)),
            spendUnderBudget: Number(underBudget.toFixed(2)),
            spendWithNoBudget: Number(noBudget.toFixed(2)),
            shareSpendUncoveredPct: shareUncovered,
            sumBudgetLimits: Number(record.sumBudgetLimits),
            suspendedAccountsChargingCount: record.suspendedAccountsChargingCount,
            suspendedAccountsSpendTotal: Number(record.suspendedAccountsSpendTotal),
            suspendedPeriodLabel: record.suspendedPeriodLabel,
          });
        }

        return res.json({
          totalAccounts: record.totalAccounts,
          activeAccounts: record.activeAccounts,
          suspendedAccounts: record.suspendedAccounts,
          accountsWithBudget: record.accountsWithBudget,
          accountsWithNoBudget: record.accountsWithNoBudget,
          budgetCoveragePct: Number(record.budgetCoveragePct),
          selectedMonth: record.selectedMonth,
          activeSpendTotal: Number(record.activeSpendTotal),
          spendUnderBudget: Number(record.spendUnderBudget),
          spendWithNoBudget: Number(record.spendWithNoBudget),
          shareSpendUncoveredPct: Number(record.shareSpendUncoveredPct),
          sumBudgetLimits: Number(record.sumBudgetLimits),
          suspendedAccountsChargingCount: record.suspendedAccountsChargingCount,
          suspendedAccountsSpendTotal: Number(record.suspendedAccountsSpendTotal),
          suspendedPeriodLabel: record.suspendedPeriodLabel,
        });
      }

      default:
        return res.status(404).json({ error: `Dataset ${cleanFilename} not found` });
    }
  } catch (err: any) {
    console.error(`Error serving AWS dataset ${req.params.filename}:`, err.message);
    res.status(500).json({ error: 'DB_QUERY_ERROR', message: err.message });
  }
});

// 3. List all linked accounts for a root account
router.get('/linked-accounts', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    const accountParam = req.query.account || 'account-1';
    const accountContext = await getLatestRunForAccount(accountParam);
    if (!accountContext || !accountContext.run) {
      return res.status(404).json({ error: 'NO_RUN_FOUND', message: 'No AWS report run found in database' });
    }

    const { account, run } = accountContext;
    const reportRunId = run.id;

    const targetMonth = (req.query.month && String(req.query.month).match(/^\d{4}-\d{2}$/))
      ? String(req.query.month).trim()
      : (run.currentMonth || '');

    // Compute previous month string
    let prevMonthStr = '';
    if (targetMonth && targetMonth.match(/^\d{4}-\d{2}$/)) {
      const [yearStr, monthStr] = targetMonth.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const prevDate = new Date(Date.UTC(year, month - 2, 1));
      prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    // 1. Fetch all linked accounts in directory
    const linkedAccounts = await prisma.awsLinkedAccount.findMany({
      where: { accountId: account.id },
      orderBy: { name: 'asc' },
    });

    // 2. Fetch costs for current and previous month
    const monthsToFetch = prevMonthStr ? [targetMonth, prevMonthStr] : [targetMonth];
    const costRecords = await prisma.awsCostByLinkedAccount.findMany({
      where: {
        reportRunId,
        month: { in: monthsToFetch },
      },
    });

    const costMap: Record<string, { current: number; previous: number }> = {};
    costRecords.forEach((c) => {
      if (!costMap[c.linkedAccount]) costMap[c.linkedAccount] = { current: 0, previous: 0 };
      if (c.month === targetMonth) {
        costMap[c.linkedAccount].current = Number(c.cost);
      } else if (c.month === prevMonthStr) {
        costMap[c.linkedAccount].previous = Number(c.cost);
      }
    });

    // 3. Fetch unbudgeted accounts
    const unbudgetedList = await prisma.awsUnbudgetedAccount.findMany({
      where: { reportRunId },
    });
    const unbudgetedMap = new Map(unbudgetedList.map((u) => [u.awsAccountId, u]));

    // 4. Fetch variances
    const variances = await prisma.awsAccountCostVariance.findMany({
      where: { reportRunId },
    });
    const varianceMap = new Map(variances.map((v) => [v.linkedAccount, v]));

    // Collect all accounts
    const allAccountIds = new Set<string>();
    linkedAccounts.forEach((la) => allAccountIds.add(la.linkedAccountId));
    Object.keys(costMap).forEach((idOrName) => allAccountIds.add(idOrName));

    const result = Array.from(allAccountIds).map((accId) => {
      const dirInfo = linkedAccounts.find((la) => la.linkedAccountId === accId || la.name === accId);
      const cleanId = dirInfo ? dirInfo.linkedAccountId : accId;
      const name = dirInfo?.name || unbudgetedMap.get(cleanId)?.accountName || cleanId;
      const status = dirInfo?.status || unbudgetedMap.get(cleanId)?.status || 'ACTIVE';

      const costs = costMap[cleanId] || costMap[name] || { current: 0, previous: 0 };
      const currentSpend = costs.current;
      const previousSpend = costs.previous;
      const diff = currentSpend - previousSpend;
      const momChange = previousSpend > 0 ? Number(((diff / previousSpend) * 100).toFixed(1)) : 0;

      const isUnbudgeted = unbudgetedMap.has(cleanId);
      const topCostDriver = unbudgetedMap.get(cleanId)?.topCostDriver || 'Cloud Infrastructure';
      const v = varianceMap.get(cleanId) || varianceMap.get(name);

      return {
        linkedAccountId: cleanId,
        accountName: name,
        status,
        selectedMonth: targetMonth,
        currentSpend: Number(currentSpend.toFixed(2)),
        previousSpend: Number(previousSpend.toFixed(2)),
        momChangePercent: momChange,
        hasBudget: !isUnbudgeted,
        budgetStatus: isUnbudgeted ? 'Unbudgeted' : 'Budgeted',
        topCostDriver,
        variance: v ? {
          mean: Number(v.meanMonthlyCost),
          stdDev: Number(v.stdDev),
          min: Number(v.minCost),
          max: Number(v.maxCost),
          volatilityCategory: v.varianceCategory,
        } : null,
      };
    });

    result.sort((a, b) => b.currentSpend - a.currentSpend);

    return res.json({
      rootAccount: {
        id: account.configId,
        name: account.name,
        awsAccountId: account.awsAccountId,
      },
      selectedMonth: targetMonth,
      totalLinkedAccounts: result.length,
      activeAccountsCount: result.filter((r) => r.status === 'ACTIVE').length,
      suspendedAccountsCount: result.filter((r) => r.status === 'SUSPENDED').length,
      budgetedCount: result.filter((r) => r.hasBudget).length,
      unbudgetedCount: result.filter((r) => !r.hasBudget).length,
      totalSpend: Number(result.reduce((sum, r) => sum + r.currentSpend, 0).toFixed(2)),
      accounts: result,
    });
  } catch (err: any) {
    console.error('Error in /linked-accounts:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 4. Get 360-degree deep dive details for a single linked account
router.get('/linked-accounts/:linkedAccountId', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    const { linkedAccountId } = req.params;
    const accountParam = req.query.account || 'account-1';
    const accountContext = await getLatestRunForAccount(accountParam);
    if (!accountContext || !accountContext.run) {
      return res.status(404).json({ error: 'NO_RUN_FOUND' });
    }

    const { account, run } = accountContext;
    const reportRunId = run.id;
    const targetMonth = (req.query.month && String(req.query.month).match(/^\d{4}-\d{2}$/))
      ? String(req.query.month).trim()
      : (run.currentMonth || '');

    // 1. Account Directory Info
    const dirInfo = await prisma.awsLinkedAccount.findFirst({
      where: {
        accountId: account.id,
        OR: [
          { linkedAccountId },
          { name: linkedAccountId },
        ],
      },
    });

    const accountName = dirInfo?.name || linkedAccountId;
    const cleanAccountId = dirInfo?.linkedAccountId || linkedAccountId;
    const status = dirInfo?.status || 'ACTIVE';

    // 2. 6-Month Spend History from DB
    const historicalCosts = await prisma.awsCostByLinkedAccount.findMany({
      where: {
        reportRunId,
        OR: [
          { linkedAccount: cleanAccountId },
          { linkedAccount: accountName },
        ],
      },
      orderBy: { month: 'asc' },
    });

    const monthlyTrend = historicalCosts.map((c) => ({
      month: c.month,
      cost: Number(c.cost),
    }));

    // Current & previous month spend
    let currentSpend = 0;
    let previousSpend = 0;
    let prevMonthStr = '';
    if (targetMonth && targetMonth.match(/^\d{4}-\d{2}$/)) {
      const [yearStr, monthStr] = targetMonth.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const prevDate = new Date(Date.UTC(year, month - 2, 1));
      prevMonthStr = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    const currRec = historicalCosts.find((c) => c.month === targetMonth);
    const prevRec = historicalCosts.find((c) => c.month === prevMonthStr);
    currentSpend = currRec ? Number(currRec.cost) : 0;
    previousSpend = prevRec ? Number(prevRec.cost) : 0;
    const diff = currentSpend - previousSpend;
    const momChange = previousSpend > 0 ? Number(((diff / previousSpend) * 100).toFixed(1)) : 0;

    // 3. Variance & Governance from DB
    const varianceRec = await prisma.awsAccountCostVariance.findFirst({
      where: {
        reportRunId,
        OR: [
          { linkedAccount: cleanAccountId },
          { linkedAccount: accountName },
        ],
      },
    });

    const unbudgetedRec = await prisma.awsUnbudgetedAccount.findFirst({
      where: {
        reportRunId,
        OR: [
          { awsAccountId: cleanAccountId },
          { accountName },
        ],
      },
    });

    // 4. Live AWS Data (with try/catch fallback)
    let liveAwsData: any = {
      available: false,
    };

    const credentials = getAwsCredentials(account.configId);
    if (credentials && cleanAccountId.match(/^\d{12}$/)) {
      try {
        const ceClient = new CostExplorerClient({
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
          },
          region: credentials.region,
        });
        const orgClient = new OrganizationsClient({
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
          },
          region: credentials.region,
        });

        const [yearStr, monthStr] = (targetMonth || '2026-09').split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonthDate = new Date(Date.UTC(year, month, 1));
        const endStr = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;

        const [descResult, serviceResult, regionResult] = await Promise.allSettled([
          orgClient.send(new DescribeAccountCommand({ AccountId: cleanAccountId })),
          ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: startStr, End: endStr },
            Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'],
            Filter: {
              Dimensions: { Key: 'LINKED_ACCOUNT', Values: [cleanAccountId] },
            },
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          })),
          ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: startStr, End: endStr },
            Granularity: 'MONTHLY',
            Metrics: ['UnblendedCost'],
            Filter: {
              Dimensions: { Key: 'LINKED_ACCOUNT', Values: [cleanAccountId] },
            },
            GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
          })),
        ]);

        let orgDetails = null;
        if (descResult.status === 'fulfilled' && descResult.value.Account) {
          const acc = descResult.value.Account;
          orgDetails = {
            name: acc.Name,
            email: acc.Email,
            status: acc.Status,
            arn: acc.Arn,
            joinedMethod: acc.JoinedMethod,
            joinedTimestamp: acc.JoinedTimestamp,
          };
        }

        let services: Array<{ service: string; cost: number; sharePct: number }> = [];
        if (serviceResult.status === 'fulfilled') {
          const groups = serviceResult.value.ResultsByTime?.[0]?.Groups || [];
          let totalServCost = 0;
          const mappedServices = groups
            .map((g) => {
              const cost = parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') || 0;
              totalServCost += cost;
              return { service: g.Keys?.[0] || 'Unknown', cost: Number(cost.toFixed(2)) };
            })
            .filter((s) => s.cost > 0)
            .sort((a, b) => b.cost - a.cost);

          services = mappedServices.map((s) => ({
            ...s,
            sharePct: totalServCost > 0 ? Number(((s.cost / totalServCost) * 100).toFixed(1)) : 0,
          }));
        }

        let regions: Array<{ region: string; cost: number; sharePct: number }> = [];
        if (regionResult.status === 'fulfilled') {
          const groups = regionResult.value.ResultsByTime?.[0]?.Groups || [];
          let totalRegCost = 0;
          const mappedRegions = groups
            .map((g) => {
              const cost = parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') || 0;
              totalRegCost += cost;
              return { region: g.Keys?.[0] || 'Unknown', cost: Number(cost.toFixed(2)) };
            })
            .filter((r) => r.cost > 0)
            .sort((a, b) => b.cost - a.cost);

          regions = mappedRegions.map((r) => ({
            ...r,
            sharePct: totalRegCost > 0 ? Number(((r.cost / totalRegCost) * 100).toFixed(1)) : 0,
          }));
        }

        liveAwsData = {
          available: true,
          orgDetails,
          services,
          regions,
        };
      } catch (awsErr: any) {
        console.warn(`[Live AWS Query] Error for account ${cleanAccountId}:`, awsErr.message);
        liveAwsData = {
          available: false,
          error: awsErr.message,
        };
      }
    }

    return res.json({
      account: {
        linkedAccountId: cleanAccountId,
        accountName,
        status,
        rootAccount: {
          id: account.configId,
          name: account.name,
          awsAccountId: account.awsAccountId,
        },
        firstSeenAt: dirInfo?.firstSeenAt,
        lastSeenAt: dirInfo?.lastSeenAt,
      },
      selectedMonth: targetMonth,
      financials: {
        currentMonth: targetMonth,
        currentSpend: Number(currentSpend.toFixed(2)),
        previousSpend: Number(previousSpend.toFixed(2)),
        momChangePercent: momChange,
        historicalMonthlySpend: monthlyTrend,
      },
      variance: varianceRec ? {
        mean: Number(varianceRec.meanMonthlyCost),
        stdDev: Number(varianceRec.stdDev),
        min: Number(varianceRec.minCost),
        max: Number(varianceRec.maxCost),
        latestVsMeanPct: Number(varianceRec.latestVsMeanPct),
        volatilityCategory: varianceRec.varianceCategory,
      } : null,
      governance: {
        hasBudget: !unbudgetedRec,
        status: unbudgetedRec ? 'Unbudgeted' : 'Budgeted',
        topCostDriver: unbudgetedRec?.topCostDriver || (liveAwsData?.services?.[0]?.service) || 'Cloud Infrastructure',
      },
      liveAws: liveAwsData,
    });
  } catch (err: any) {
    console.error('Error in /linked-accounts/:linkedAccountId:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
