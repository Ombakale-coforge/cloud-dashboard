import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { OrganizationsClient, DescribeAccountCommand, paginateListAccounts, ListTagsForResourceCommand } from '@aws-sdk/client-organizations';
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

export interface OrgAccountMeta {
  id: string;
  name?: string;
  email?: string;
  status?: string;
  joinedMethod?: string;
  joinedTimestamp?: string;
  ownerName?: string;
  ownerEmails?: string[];
  wbsCode?: string;
}

const orgAccountsCache = new Map<string, { fetchedAt: number; data: Map<string, OrgAccountMeta> }>();
const ORG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCurrentWeekBounds(now = new Date()) {
  const dayOfWeek = now.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 23, 59, 59, 999);
  const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekLabel = `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}, ${weekEnd.getFullYear()}`;
  return { weekStart, weekEnd, weekLabel };
}

export async function getOrgAccountsMetadata(configId: string, dbAccountId?: number): Promise<Map<string, OrgAccountMeta>> {
  const cacheKey = configId || 'account-1';
  const cached = orgAccountsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ORG_CACHE_TTL_MS && cached.data.size > 0) {
    return cached.data;
  }

  const creds = getAwsCredentials(cacheKey);
  if (!creds) {
    return cached?.data || new Map();
  }

  try {
    const orgClient = new OrganizationsClient({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });

    const metaMap = new Map<string, OrgAccountMeta>();
    const accountList: Array<{ id: string; name?: string; email?: string; status?: string; joinedMethod?: string; joinedTimestamp?: string }> = [];

    for await (const page of paginateListAccounts({ client: orgClient }, {})) {
      for (const acc of page.Accounts || []) {
        if (acc.Id) {
          const joinedIso = acc.JoinedTimestamp ? new Date(acc.JoinedTimestamp).toISOString() : undefined;
          const item = {
            id: acc.Id,
            name: acc.Name,
            email: acc.Email,
            status: acc.Status,
            joinedMethod: acc.JoinedMethod,
            joinedTimestamp: joinedIso,
          };
          accountList.push(item);
          metaMap.set(acc.Id, { ...item });
        }
      }
    }

    // Concurrently fetch tags in batches of 10 for Owner Name and WBS Code
    const BATCH_SIZE = 10;
    for (let i = 0; i < accountList.length; i += BATCH_SIZE) {
      const chunk = accountList.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (acc) => {
          try {
            const tagRes = await orgClient.send(new ListTagsForResourceCommand({ ResourceId: acc.id }));
            const tags = tagRes.Tags || [];
            let ownerName: string | undefined;
            let wbsCode: string | undefined;
            const ownerEmailSet = new Set<string>();
            if (acc.email) {
              const accEmails = acc.email.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
              for (const em of accEmails) ownerEmailSet.add(em.toLowerCase());
            }

            for (const t of tags) {
              const k = (t.Key || '').trim().toLowerCase();
              const v = (t.Value || '').trim();
              if (!v) continue;

              // Collect email addresses from owner/contact/POC/manager/requestor/email tags
              if (/(owner|contact|poc|spoc|manager|request(?:or|er)|email|lead)/i.test(k)) {
                const tagEmails = v.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
                for (const em of tagEmails) ownerEmailSet.add(em.toLowerCase());
              }

              // Owner Name detection: "Owner Name", "Owner Name:", "Owner", "Point-of-Contact Name"
              if (!ownerName) {
                if (k === 'owner name' || k === 'owner name:' || k === 'owner' || k === 'account owner') {
                  ownerName = v;
                } else if (k === 'point-of-contact name' || k === 'contact name') {
                  ownerName = v;
                }
              }

              // WBS / Project Code detection: "wbs", "wbs code", "wbscode", "project code", "ledgercode", "prcode"
              if (!wbsCode) {
                if (k.includes('wbs') || k === 'wbs code' || k === 'wbscode') {
                  wbsCode = v;
                } else if (k === 'ledgercode' || k.includes('prcode') || k === 'project code' || k === 'costcenter' || k === 'cost center') {
                  wbsCode = v;
                }
              }
            }

            const existing = metaMap.get(acc.id);
            if (existing) {
              if (ownerName) existing.ownerName = ownerName;
              if (ownerEmailSet.size > 0) existing.ownerEmails = Array.from(ownerEmailSet);
              if (wbsCode) existing.wbsCode = wbsCode;
            }
          } catch {
            // ignore tag fetch failures on individual accounts
          }
        })
      );
    }

    if (metaMap.size > 0) {
      orgAccountsCache.set(cacheKey, { fetchedAt: Date.now(), data: metaMap });

      // Background sync JoinedTimestamp -> firstSeenAt in SQL Server if prisma is available
      if (prisma && dbAccountId) {
        Promise.all(
          Array.from(metaMap.values())
            .filter((m) => m.joinedTimestamp)
            .map((m) =>
              prisma.awsLinkedAccount
                .updateMany({
                  where: { accountId: dbAccountId, linkedAccountId: m.id },
                  data: { firstSeenAt: new Date(m.joinedTimestamp!) },
                })
                .catch(() => null)
            )
        ).catch(() => null);
      }
    }

    return metaMap;
  } catch (err: any) {
    console.warn(`[AWS Orgs Metadata] Could not list accounts for ${cacheKey}:`, err.message);
    return cached?.data || new Map();
  }
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

      // Friendly display mapping:
      // 513167803309 -> AWS-Coforge
      // 507672385186 -> AWS-Encora
      const cleanId = (accountId || a.awsAccountId || '').replace(/[^0-9]/g, '');
      if (cleanId === '513167803309' || a.configId === 'account-2') {
        accountName = 'AWS-Coforge';
      } else if (cleanId === '507672385186' || a.configId === 'account-1' || a.isPrimary) {
        accountName = 'AWS-Encora';
      }

      const formattedName = accountId ? `${accountName} (${accountId})` : accountName;

      return {
        id: a.configId,
        name: formattedName,
        accountId: accountId || a.configId,
        accountName: accountName,
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
        let records = await prisma.awsCostByService.findMany({
          where: { reportRunId, month: run.currentMonth || undefined },
          orderBy: { cost: 'desc' },
        });
        if (records.length === 0) {
          records = await prisma.awsCostByService.findMany({
            where: { reportRunId },
            orderBy: [{ month: 'desc' }, { cost: 'desc' }],
          });
        }
        if (records.length === 0) {
          const topServices = await prisma.awsTopService.findMany({
            where: { reportRunId },
            orderBy: { rank: 'asc' },
          });
          if (topServices.length > 0) {
            return res.json(topServices.map((t) => ({ Service: t.service, Cost: Number(t.cost) })));
          }
        }
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

        if (records.length === 0) {
          try {
            const configId = account.configId || 'account-1';
            let csvPath = path.join(process.cwd(), 'AWSReports', 'accounts', configId, 'latest', 'cost_by_service_wide.csv');
            if (!fs.existsSync(csvPath)) {
              csvPath = path.join(process.cwd(), 'AWSReports', 'latest', 'cost_by_service_wide.csv');
            }
            if (fs.existsSync(csvPath)) {
              const content = fs.readFileSync(csvPath, 'utf-8');
              const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
              if (lines.length >= 2) {
                const headers = lines[0].split(',').map((h) => h.trim());
                const parsedRows = lines.slice(1).map((line) => {
                  const vals = line.split(',').map((v) => v.trim());
                  const row: Record<string, any> = {};
                  headers.forEach((h, idx) => {
                    const numVal = Number(vals[idx]);
                    row[h] = isNaN(numVal) ? vals[idx] : numVal;
                  });
                  return row;
                });
                return res.json(parsedRows);
              }
            }
          } catch (e) {
            // fallback gracefully
          }
        }

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
          'Months Active': r.activeMonths,
          'Months in Scope': r.monthsInScope,
          'Total Months': r.monthsInScope,
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

        const latestMonth = run.currentMonth || '';
        if (targetMonth && targetMonth.match(/^\d{4}-\d{2}$/) && targetMonth !== latestMonth) {
          const [linkedAccounts, targetMonthCosts, latestMonthCosts, monthlyTotals] = await Promise.all([
            prisma.awsLinkedAccount.findMany({
              where: { accountId: accountContext.account.id },
            }),
            prisma.awsCostByLinkedAccount.findMany({
              where: { reportRunId, month: targetMonth },
            }),
            latestMonth
              ? prisma.awsCostByLinkedAccount.findMany({
                  where: { reportRunId, month: latestMonth },
                })
              : Promise.resolve([]),
            prisma.awsMonthlyTotal.findMany({
              where: { reportRunId },
            }),
          ]);

          const targetCostByAccount = new Map<string, number>();
          for (const c of targetMonthCosts) {
            targetCostByAccount.set(c.linkedAccount, Number(c.cost));
          }

          const latestCostByAccount = new Map<string, number>();
          for (const c of latestMonthCosts) {
            latestCostByAccount.set(c.linkedAccount, Number(c.cost));
          }

          const targetTotalRec = monthlyTotals.find((m) => m.month === targetMonth);
          const latestTotalRec = monthlyTotals.find((m) => m.month === latestMonth);
          const targetTotal = targetTotalRec ? Number(targetTotalRec.totalCost) : 0;
          const latestTotal = latestTotalRec ? Number(latestTotalRec.totalCost) : 0;
          const orgMonthRatio = latestTotal > 0 ? targetTotal / latestTotal : 1;

          const metaTokens = new Set([
            'csa', 'dap', 'gbl', 'ind', 'us', 'uk', 'eu', 'apac', 'bfs', 'ins', 'tvl', 'oth',
            'prod', 'prd', 'dev', 'uat', 'poc', 'np', 'nonprod', 'test', 'qa', 'stg', 'dr', 'aws',
          ]);
          const normalize = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const getTokens = (s: string) =>
            String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
          const getCore = (s: string) => {
            const tokens = getTokens(s);
            const core = tokens.filter((t) => !metaTokens.has(t));
            return (core.length > 0 ? core : tokens).join('');
          };

          const mappedForMonth = records.map((r) => {
            const bNameNorm = normalize(r.budgetName);
            const bTokens = getTokens(r.budgetName);
            const bSorted = [...bTokens].sort().join('|');
            const bCore = getCore(r.budgetName);
            const latestBudgetUsed = Number(r.currentUsed);
            const limit = Number(r.limitAmount);

            // 1. Direct normalized or ID match, or exact sorted tokens match (e.g. CSA-Backup-PROD <-> Backup-PROD-CSA)
            let matchedAcc = linkedAccounts.find((la) => {
              const accNorm = normalize(la.name || '');
              const accTokens = getTokens(la.name || '');
              return (
                (accNorm.length > 0 &&
                  (accNorm === bNameNorm ||
                    accNorm.includes(bNameNorm) ||
                    bNameNorm.includes(accNorm) ||
                    bNameNorm.includes(la.linkedAccountId))) ||
                (accTokens.length > 0 && [...accTokens].sort().join('|') === bSorted)
              );
            });

            // 2. Core workload match (e.g. CSA - MobileKotlin1-PoC <-> MobileKotlin1-PoC-CSA)
            if (!matchedAcc && bCore.length >= 3) {
              const candidates = linkedAccounts.filter((la) => {
                const aCore = getCore(la.name || '');
                return (
                  aCore.length >= 3 &&
                  (aCore === bCore ||
                    (aCore.length >= 4 && bCore.length >= 4 && (aCore.includes(bCore) || bCore.includes(aCore))))
                );
              });
              if (candidates.length > 0) {
                matchedAcc = candidates.sort((a, b) => {
                  const aShared = bTokens.filter((t) => getTokens(a.name || '').includes(t)).length;
                  const bShared = bTokens.filter((t) => getTokens(b.name || '').includes(t)).length;
                  return bShared - aShared;
                })[0];
              }
            }

            // 3. Fallback: match by exact latest-month spend if > 0
            if (!matchedAcc && latestBudgetUsed > 0) {
              for (const [accId, latestAccCost] of latestCostByAccount.entries()) {
                if (Math.abs(latestAccCost - latestBudgetUsed) < 0.05) {
                  matchedAcc =
                    linkedAccounts.find((la) => la.linkedAccountId === accId) ||
                    ({ linkedAccountId: accId, name: accId } as any);
                  break;
                }
              }
            }

            let used = 0;
            if (matchedAcc) {
              used =
                targetCostByAccount.get(matchedAcc.linkedAccountId) ??
                targetCostByAccount.get(matchedAcc.name) ??
                0;
            } else {
              // Fallback for shared/group budgets: scale by the month's org spend ratio
              used = Number((latestBudgetUsed * orgMonthRatio).toFixed(2));
            }

            used = Number(used.toFixed(2));
            const pct = limit > 0 ? Number(((used / limit) * 100).toFixed(1)) : 0;
            const isExceeded = pct >= 100;
            const thresholdStatus = isExceeded ? 'Exceeded (1)' : pct >= 80 ? 'Warning' : 'OK';
            const healthStatus = isExceeded ? 'Alert' : 'Healthy';

            return {
              'Budget Name': r.budgetName,
              'Budget Limit': limit,
              'Limit': limit,
              'Current Spend': used,
              'Current Used': used,
              'Forecasted Spend': Number(used.toFixed(2)),
              'Current vs Budget %': pct,
              'Threshold Status': thresholdStatus,
              'Health Status': healthStatus,
            };
          });

          mappedForMonth.sort((a, b) => b['Current Used'] - a['Current Used'] || b.Limit - a.Limit);
          return res.json(mappedForMonth);
        }

        const mapped = records
          .map((r) => ({
            'Budget Name': r.budgetName,
            'Budget Limit': Number(r.limitAmount),
            'Limit': Number(r.limitAmount),
            'Current Spend': Number(r.currentUsed),
            'Current Used': Number(r.currentUsed),
            'Forecasted Spend': r.forecastedSpend !== null ? Number(r.forecastedSpend) : '',
            'Current vs Budget %': Number(r.currentVsBudgetPercent),
            'Threshold Status': r.thresholdStatus,
            'Health Status': r.healthStatus,
          }))
          .sort((a, b) => b['Current Used'] - a['Current Used'] || b.Limit - a.Limit);
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
        const [record, linkedAccs, orgMetaMap] = await Promise.all([
          prisma.awsGovernanceSummary.findFirst({ where: { reportRunId } }),
          prisma.awsLinkedAccount.findMany({ where: { accountId: accountContext.account.id } }),
          getOrgAccountsMetadata(accountContext.account.configId, accountContext.account.id),
        ]);
        if (!record) return res.json(null);

        const { weekStart, weekEnd, weekLabel } = getCurrentWeekBounds();
        const minuteBucketCounts = new Map<string, number>();
        for (const la of linkedAccs) {
          if (la.firstSeenAt) {
            const key = la.firstSeenAt.toISOString().slice(0, 16);
            minuteBucketCounts.set(key, (minuteBucketCounts.get(key) || 0) + 1);
          }
        }

        let newAccountsCurrentWeekCount = 0;
        for (const la of linkedAccs) {
          const meta = orgMetaMap.get(la.linkedAccountId);
          let createdIso = meta?.joinedTimestamp || null;
          if (!createdIso && la.firstSeenAt) {
            const key = la.firstSeenAt.toISOString().slice(0, 16);
            if ((minuteBucketCounts.get(key) || 0) <= 3) {
              createdIso = la.firstSeenAt.toISOString();
            }
          }
          if (createdIso) {
            const dt = new Date(createdIso);
            if (!isNaN(dt.getTime()) && dt >= weekStart && dt <= weekEnd) {
              newAccountsCurrentWeekCount++;
            }
          }
        }

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
            newAccountsCurrentWeekCount,
            currentWeekLabel: weekLabel,
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
          newAccountsCurrentWeekCount,
          currentWeekLabel: weekLabel,
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

    // 1. Fetch all linked accounts in directory & live AWS Organizations metadata
    const [linkedAccounts, orgMetaMap] = await Promise.all([
      prisma.awsLinkedAccount.findMany({
        where: { accountId: account.id },
        orderBy: { name: 'asc' },
      }),
      getOrgAccountsMetadata(account.configId, account.id),
    ]);

    const { weekStart, weekEnd, weekLabel } = getCurrentWeekBounds();
    const minuteBucketCounts = new Map<string, number>();
    for (const la of linkedAccounts) {
      if (la.firstSeenAt) {
        const key = la.firstSeenAt.toISOString().slice(0, 16);
        minuteBucketCounts.set(key, (minuteBucketCounts.get(key) || 0) + 1);
      }
    }

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

    // 3. Fetch unbudgeted accounts, budgets overview, and governance summary
    const [unbudgetedList, budgetsList, govSummary] = await Promise.all([
      prisma.awsUnbudgetedAccount.findMany({ where: { reportRunId } }),
      prisma.awsBudgetOverview.findMany({ where: { reportRunId } }),
      prisma.awsGovernanceSummary.findFirst({ where: { reportRunId } }),
    ]);
    const unbudgetedMap = new Map(unbudgetedList.map((u) => [u.awsAccountId, u]));
    const hasAnyOrgBudgets = budgetsList.length > 0 && (govSummary ? govSummary.accountsWithBudget > 0 : true);
    const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 4. Fetch variances and account requests (for Owner & WBS code mapping)
    const [variances, accountRequests] = await Promise.all([
      prisma.awsAccountCostVariance.findMany({
        where: { reportRunId },
      }),
      (prisma as any).accountRequest ? (prisma as any).accountRequest.findMany({
        select: {
          projectName: true,
          submitterName: true,
          pointOfContact: true,
          accountManager: true,
          wbsCode: true,
          costCenter: true,
          status: true,
        },
      }).catch(() => []) : Promise.resolve([]),
    ]);
    const varianceMap = new Map(variances.map((v) => [v.linkedAccount, v]));

    // Index account requests by normalized project name and words for lookup
    const reqByName = new Map<string, any>();
    if (Array.isArray(accountRequests)) {
      for (const r of accountRequests) {
        if (r.projectName) {
          const normP = normalizeStr(r.projectName);
          if (normP) reqByName.set(normP, r);
        }
      }
    }

    // Collect all accounts
    const allAccountIds = new Set<string>();
    linkedAccounts.forEach((la) => allAccountIds.add(la.linkedAccountId));
    Object.keys(costMap).forEach((idOrName) => allAccountIds.add(idOrName));

    const result = Array.from(allAccountIds).map((accId) => {
      const dirInfo = linkedAccounts.find((la) => la.linkedAccountId === accId || la.name === accId);
      const cleanId = dirInfo ? dirInfo.linkedAccountId : accId;
      const orgMeta = orgMetaMap.get(cleanId);
      const name = orgMeta?.name || dirInfo?.name || unbudgetedMap.get(cleanId)?.accountName || cleanId;
      const status = orgMeta?.status || dirInfo?.status || unbudgetedMap.get(cleanId)?.status || 'ACTIVE';

      // Match account request by name if available
      const normAccountName = normalizeStr(name);
      let matchedReq: any = null;
      for (const [key, r] of reqByName.entries()) {
        if (normAccountName === key || normAccountName.includes(key) || key.includes(normAccountName)) {
          matchedReq = r;
          break;
        }
      }

      // Owner name resolution hierarchy: AWS Orgs Tag -> Account Request (submitterName/pointOfContact) -> Email username fallback
      const ownerName =
        orgMeta?.ownerName ||
        matchedReq?.submitterName ||
        matchedReq?.pointOfContact ||
        (orgMeta?.email ? orgMeta.email.split('@')[0].replace(/[._-]/g, ' ') : null);

      // WBS Code resolution hierarchy: AWS Orgs Tag -> Account Request wbsCode -> Cost Center fallback
      const wbsCode =
        orgMeta?.wbsCode ||
        matchedReq?.wbsCode ||
        matchedReq?.costCenter ||
        null;

      let createdAt: string | null = orgMeta?.joinedTimestamp || null;
      if (!createdAt && dirInfo?.firstSeenAt) {
        const key = dirInfo.firstSeenAt.toISOString().slice(0, 16);
        if ((minuteBucketCounts.get(key) || 0) <= 3) {
          createdAt = dirInfo.firstSeenAt.toISOString();
        }
      }

      let isCreatedCurrentWeek = false;
      if (createdAt) {
        const dt = new Date(createdAt);
        if (!isNaN(dt.getTime()) && dt >= weekStart && dt <= weekEnd) {
          isCreatedCurrentWeek = true;
        }
      }

      const costs = costMap[cleanId] || costMap[name] || { current: 0, previous: 0 };
      const currentSpend = costs.current;
      const previousSpend = costs.previous;
      const diff = currentSpend - previousSpend;
      const momChange = previousSpend > 0 ? Number(((diff / previousSpend) * 100).toFixed(1)) : 0;

      const accNorm = normalizeStr(name);
      const matchesBudgetName = budgetsList.some((b) => {
        const bNorm = normalizeStr(b.budgetName);
        return (
          bNorm.includes(cleanId) ||
          (accNorm.length > 0 && (bNorm === accNorm || bNorm.includes(accNorm) || accNorm.includes(bNorm)))
        );
      });

      const isActive = status === 'ACTIVE';
      const hasBudget =
        isActive &&
        hasAnyOrgBudgets &&
        !unbudgetedMap.has(cleanId) &&
        (currentSpend > 0 || previousSpend > 0 || matchesBudgetName);

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
        hasBudget,
        budgetStatus: !isActive ? 'Closed' : hasBudget ? 'Budgeted' : 'Unbudgeted',
        topCostDriver,
        createdAt,
        joinedMethod: orgMeta?.joinedMethod || null,
        email: orgMeta?.email || null,
        ownerName: ownerName || null,
        wbsCode: wbsCode || null,
        isCreatedCurrentWeek,
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

    const activeResults = result.filter((r) => r.status === 'ACTIVE');
    const newAccountsCurrentWeek = result
      .filter((r) => r.isCreatedCurrentWeek)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const newAccountsCurrentWeekSpend = Number(
      newAccountsCurrentWeek.reduce((sum, r) => sum + r.currentSpend, 0).toFixed(2)
    );

    return res.json({
      rootAccount: {
        id: account.configId,
        name: account.name,
        awsAccountId: account.awsAccountId,
      },
      selectedMonth: targetMonth,
      totalLinkedAccounts: result.length,
      activeAccountsCount: activeResults.length,
      suspendedAccountsCount: result.filter((r) => r.status === 'SUSPENDED').length,
      budgetedCount: activeResults.filter((r) => r.hasBudget).length,
      unbudgetedCount: activeResults.filter((r) => !r.hasBudget).length,
      totalSpend: Number(result.reduce((sum, r) => sum + r.currentSpend, 0).toFixed(2)),
      currentWeekStart: weekStart.toISOString(),
      currentWeekEnd: weekEnd.toISOString(),
      currentWeekLabel: weekLabel,
      newAccountsCurrentWeekCount: newAccountsCurrentWeek.length,
      newAccountsCurrentWeekSpend,
      newAccountsCurrentWeek,
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
    const [varianceRec, unbudgetedRec, budgetsList, govSummary] = await Promise.all([
      prisma.awsAccountCostVariance.findFirst({
        where: {
          reportRunId,
          OR: [
            { linkedAccount: cleanAccountId },
            { linkedAccount: accountName },
          ],
        },
      }),
      prisma.awsUnbudgetedAccount.findFirst({
        where: {
          reportRunId,
          OR: [
            { awsAccountId: cleanAccountId },
            { accountName },
          ],
        },
      }),
      prisma.awsBudgetOverview.findMany({ where: { reportRunId } }),
      prisma.awsGovernanceSummary.findFirst({ where: { reportRunId } }),
    ]);

    const normalizeStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const accNorm = normalizeStr(accountName);
    const matchesBudgetName = budgetsList.some((b) => {
      const bNorm = normalizeStr(b.budgetName);
      return (
        bNorm.includes(cleanAccountId) ||
        (accNorm.length > 0 && (bNorm === accNorm || bNorm.includes(accNorm) || accNorm.includes(bNorm)))
      );
    });
    const hasAnyOrgBudgets = budgetsList.length > 0 && (govSummary ? govSummary.accountsWithBudget > 0 : true);
    const isActiveAcc = status === 'ACTIVE';
    const accHasBudget =
      isActiveAcc &&
      hasAnyOrgBudgets &&
      !unbudgetedRec &&
      (currentSpend > 0 || previousSpend > 0 || matchesBudgetName);

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
        const prevMonthDate = new Date(Date.UTC(year, month - 2, 1));
        const prevStartStr = `${prevMonthDate.getUTCFullYear()}-${String(prevMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
        const nextMonthDate = new Date(Date.UTC(year, month, 1));
        const endStr = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;

        const [descResult, serviceResult, regionResult, tagsResult] = await Promise.allSettled([
          orgClient.send(new DescribeAccountCommand({ AccountId: cleanAccountId })),
          ceClient.send(new GetCostAndUsageCommand({
            TimePeriod: { Start: prevStartStr, End: endStr },
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
          orgClient.send(new ListTagsForResourceCommand({ ResourceId: cleanAccountId })),
        ]);

        let ownerNameFromTags: string | undefined;
        let wbsCodeFromTags: string | undefined;
        let accountTags: Array<{ key: string; value: string }> = [];

        if (tagsResult.status === 'fulfilled' && tagsResult.value.Tags) {
          accountTags = tagsResult.value.Tags.map((t) => ({ key: t.Key || '', value: t.Value || '' }));
          for (const t of tagsResult.value.Tags) {
            const k = (t.Key || '').trim().toLowerCase();
            const v = (t.Value || '').trim();
            if (!v) continue;
            if (!ownerNameFromTags) {
              if (k === 'owner name' || k === 'owner name:' || k === 'owner' || k === 'account owner') {
                ownerNameFromTags = v;
              } else if (k === 'point-of-contact name' || k === 'contact name') {
                ownerNameFromTags = v;
              }
            }
            if (!wbsCodeFromTags) {
              if (k.includes('wbs') || k === 'wbs code' || k === 'wbscode') {
                wbsCodeFromTags = v;
              } else if (k === 'ledgercode' || k.includes('prcode') || k === 'project code' || k === 'costcenter' || k === 'cost center') {
                wbsCodeFromTags = v;
              }
            }
          }
        }

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
            ownerName: ownerNameFromTags || (acc.Email ? acc.Email.split('@')[0].replace(/[._-]/g, ' ') : undefined),
            wbsCode: wbsCodeFromTags,
            tags: accountTags,
          };
        }

        let services: Array<{ service: string; cost: number; previousCost?: number; momChangePercent?: number; sharePct: number }> = [];
        if (serviceResult.status === 'fulfilled') {
          const rbt = serviceResult.value.ResultsByTime || [];
          const currentGroups = rbt.length > 1 ? (rbt[1]?.Groups || []) : (rbt[0]?.Groups || []);
          const prevGroups = rbt.length > 1 ? (rbt[0]?.Groups || []) : [];

          const prevCostMap = new Map<string, number>();
          prevGroups.forEach((g) => {
            const svcName = g.Keys?.[0] || 'Unknown';
            const cost = parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') || 0;
            prevCostMap.set(svcName, Number(cost.toFixed(2)));
          });

          let totalServCost = 0;
          const mappedServices = currentGroups
            .map((g) => {
              const svcName = g.Keys?.[0] || 'Unknown';
              const cost = parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') || 0;
              totalServCost += cost;
              const prevCost = prevCostMap.get(svcName) || 0;
              const momChange = prevCost > 0
                ? Number((((cost - prevCost) / prevCost) * 100).toFixed(1))
                : (cost > 0 ? 100 : 0);
              return {
                service: svcName,
                cost: Number(cost.toFixed(2)),
                previousCost: prevCost,
                momChangePercent: momChange,
              };
            })
            .filter((s) => s.cost > 0 || (s.previousCost && s.previousCost > 0))
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
        hasBudget: accHasBudget,
        status: !isActiveAcc ? 'Closed' : accHasBudget ? 'Budgeted' : 'Unbudgeted',
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
