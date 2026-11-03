import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import {
  OrganizationsClient,
  paginateListAccounts,
} from '@aws-sdk/client-organizations';
import {
  BudgetsClient,
  DescribeBudgetsCommand,
} from '@aws-sdk/client-budgets';
import { prisma } from './server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const fmtCurrency = (n: number) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface OverBudgetRow {
  rank: number;
  budgetName: string;
  accountName: string;
  accountId: string;
  limit: number;
  actualSpend: number;
  overSpend: number;
  utilizationPct: number;
}

interface TopSpendRow {
  rank: number;
  accountName: string;
  accountId: string;
  status: string;
  spend: number;
  sharePct: number;
}

interface ReportData {
  payerAccountName: string;
  reportMonth: string;
  generatedAt: string;
  currentMonthSpend: number;
  previousMonthSpend: number;
  momPercentChange: number;
  totalBudget: number;
  remainingBudget: number;
  netVariance: number;
  overallUtilizationPct: number;
  activeBudgetCount: number;
  overBudgetCount: number;
  totalOverSpend: number;
  top5OverBudget: OverBudgetRow[];
  top5MostSpend: TopSpendRow[];
}

const META_TOKENS = new Set([
  'csa', 'dap', 'gbl', 'ind', 'us', 'uk', 'eu', 'apac', 'bfs', 'ins', 'tvl', 'oth',
  'prod', 'prd', 'dev', 'uat', 'poc', 'np', 'nonprod', 'test', 'qa', 'stg', 'dr', 'aws', 'sab', ' gis',
]);

function normalize(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getTokens(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function getCore(s: string): string {
  const tokens = getTokens(s);
  const core = tokens.filter((t) => !META_TOKENS.has(t));
  return (core.length > 0 ? core : tokens).join('');
}

function matchBudgetToAccount(
  budgetName: string,
  filterAccountIds: string[],
  linkedAccounts: Array<{ linkedAccountId: string; name: string; status: string }>
): { linkedAccountId: string; name: string } | null {
  if (filterAccountIds.length > 0) {
    const found = linkedAccounts.find((la) => la.linkedAccountId === filterAccountIds[0]);
    if (found) return found;
  }

  const bNorm = normalize(budgetName);
  const bTokens = getTokens(budgetName);
  const bSorted = [...bTokens].sort().join('|');
  const bCore = getCore(budgetName);

  // 1. Direct normalized or token-order-independent match
  let matched = linkedAccounts.find((la) => {
    const aNorm = normalize(la.name);
    const aTokens = getTokens(la.name);
    return (
      (aNorm.length > 0 &&
        (aNorm === bNorm ||
          aNorm.includes(bNorm) ||
          bNorm.includes(aNorm) ||
          bNorm.includes(la.linkedAccountId))) ||
      (aTokens.length > 0 && [...aTokens].sort().join('|') === bSorted)
    );
  });

  // 2. Core workload match
  if (!matched && bCore.length >= 3) {
    const candidates = linkedAccounts.filter((la) => {
      const aCore = getCore(la.name);
      return (
        aCore.length >= 3 &&
        (aCore === bCore ||
          (aCore.length >= 4 && bCore.length >= 4 && (aCore.includes(bCore) || bCore.includes(aCore))))
      );
    });
    if (candidates.length > 0) {
      matched = candidates.sort((a, b) => {
        const aShared = bTokens.filter((t) => getTokens(a.name).includes(t)).length;
        const bShared = bTokens.filter((t) => getTokens(b.name).includes(t)).length;
        return bShared - aShared;
      })[0];
    }
  }

  return matched || null;
}

function firstOfMonthStr(baseDate: Date, monthOffset: number): string {
  const d = new Date(
    Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthOffset, 1)
  );
  return d.toISOString().slice(0, 10);
}

async function fetchReportDataFromAwsSdk(): Promise<ReportData> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
  const region = process.env.AWS_REGION || 'us-east-1';
  const payerAccountName =
    process.env.AWS_ACCOUNT_NAME ||
    process.env.AWS_ACCOUNT_1_NAME ||
    'AWS Account 1 (5076-7238-5186)';

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) not found in .env');
  }

  const credentials = { accessKeyId, secretAccessKey };
  const ceClient = new CostExplorerClient({ region, credentials });
  const orgClient = new OrganizationsClient({ region, credentials });
  const budgetsClient = new BudgetsClient({ region, credentials });

  const matchId = payerAccountName.match(/\(([^)]+)\)/);
  const payerAccountId = matchId
    ? matchId[1].replace(/[^0-9]/g, '')
    : '507672385186';

  const today = new Date();
  const startStr = firstOfMonthStr(today, -2);
  const endStr = firstOfMonthStr(today, 1);

  console.log('☁️ Fetching live data directly from AWS Cost Explorer, Organizations & Budgets APIs...');

  // 1. Fetch Linked Accounts from AWS Organizations
  const linkedAccounts: Array<{ linkedAccountId: string; name: string; status: string }> = [];
  const accountMap = new Map<string, { name: string; status: string }>();
  try {
    for await (const page of paginateListAccounts({ client: orgClient }, {})) {
      for (const acc of page.Accounts || []) {
        if (acc.Id) {
          const name = acc.Name || acc.Id;
          const status = acc.Status || 'ACTIVE';
          linkedAccounts.push({ linkedAccountId: acc.Id, name, status });
          accountMap.set(acc.Id, { name, status });
        }
      }
    }
  } catch (err: any) {
    console.warn('⚠️ Organizations API warning:', err.message);
  }

  // 2. Fetch Monthly Spend by Linked Account from Cost Explorer
  const ceRes = await ceClient.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: startStr, End: endStr },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'LINKED_ACCOUNT' }],
    })
  );

  const monthTotals = new Map<string, number>();
  const monthAccountCosts = new Map<string, Map<string, number>>();

  for (const period of ceRes.ResultsByTime || []) {
    const month = (period.TimePeriod?.Start || '').slice(0, 7);
    let mTotal = 0;
    const accMap = new Map<string, number>();

    for (const grp of period.Groups || []) {
      const accId = grp.Keys?.[0] || 'Unknown';
      const cost = parseFloat(grp.Metrics?.UnblendedCost?.Amount || '0') || 0;
      mTotal += cost;
      accMap.set(accId, cost);
    }

    monthTotals.set(month, Number(mTotal.toFixed(2)));
    monthAccountCosts.set(month, accMap);
  }

  const months = Array.from(monthTotals.keys()).sort();
  const reportMonth = months[months.length - 1] || today.toISOString().slice(0, 7);
  const prevMonth = months.length > 1 ? months[months.length - 2] : '';

  const currentMonthSpend = monthTotals.get(reportMonth) || 0;
  const previousMonthSpend = prevMonth ? monthTotals.get(prevMonth) || 0 : 0;
  const momPercentChange =
    previousMonthSpend > 0
      ? Number((((currentMonthSpend - previousMonthSpend) / previousMonthSpend) * 100).toFixed(1))
      : 0;

  const currAccMap = monthAccountCosts.get(reportMonth) || new Map<string, number>();

  // 3. Fetch AWS Budgets
  const rawBudgets: any[] = [];
  let nextToken: string | undefined;
  do {
    const bRes: any = await budgetsClient.send(
      new DescribeBudgetsCommand({
        AccountId: payerAccountId,
        NextToken: nextToken,
      })
    );
    if (bRes.Budgets) rawBudgets.push(...bRes.Budgets);
    nextToken = bRes.NextToken;
  } while (nextToken);

  const totalBudget = Number(
    rawBudgets
      .reduce((sum, b) => sum + (parseFloat(b.BudgetLimit?.Amount) || 0), 0)
      .toFixed(2)
  );
  const remainingBudget = Math.max(0, Number((totalBudget - currentMonthSpend).toFixed(2)));
  const netVariance = Number((totalBudget - currentMonthSpend).toFixed(2));
  const overallUtilizationPct =
    totalBudget > 0 ? Number(((currentMonthSpend / totalBudget) * 100).toFixed(1)) : 0;

  const evaluatedBudgets: OverBudgetRow[] = rawBudgets.map((b) => {
    const budgetName = b.BudgetName || 'Unnamed Budget';
    const limit = Number((parseFloat(b.BudgetLimit?.Amount) || 0).toFixed(2));
    const awsReportedSpend = Number(
      (parseFloat(b.CalculatedSpend?.ActualSpend?.Amount) || 0).toFixed(2)
    );

    const filterIds: string[] = b.CostFilters?.LinkedAccount || [];
    const matched = matchBudgetToAccount(budgetName, filterIds, linkedAccounts);
    const matchedSpend = matched ? currAccMap.get(matched.linkedAccountId) || 0 : 0;

    const actualSpend = Number(Math.max(awsReportedSpend, matchedSpend).toFixed(2));
    const overSpend = Number((actualSpend - limit).toFixed(2));
    const utilizationPct =
      limit > 0 ? Number(((actualSpend / limit) * 100).toFixed(1)) : 0;

    return {
      rank: 0,
      budgetName,
      accountName: matched?.name || budgetName,
      accountId: matched?.linkedAccountId || '—',
      limit,
      actualSpend,
      overSpend,
      utilizationPct,
    };
  });

  const strictlyOver = evaluatedBudgets
    .filter((b) => b.overSpend > 0)
    .sort((a, b) => b.overSpend - a.overSpend);

  const totalOverSpend = Number(
    strictlyOver.reduce((sum, b) => sum + b.overSpend, 0).toFixed(2)
  );

  // Sort by overSpend descending (or utilizationPct descending if fewer than 5 are strictly over)
  const sortedForTop5 = [...evaluatedBudgets].sort((a, b) => {
    const aOver = a.overSpend > 0 ? 1 : 0;
    const bOver = b.overSpend > 0 ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    if (aOver === 1) return b.overSpend - a.overSpend;
    return b.utilizationPct - a.utilizationPct || b.actualSpend - a.actualSpend;
  });

  const top5OverBudget = sortedForTop5.slice(0, 5).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  // 4. Top 5 Accounts with Most Spend
  const topSpendList = Array.from(currAccMap.entries())
    .map(([accId, spend]) => {
      const meta = accountMap.get(accId);
      return {
        accountName: meta?.name || accId,
        accountId: accId,
        status: meta?.status || 'ACTIVE',
        spend: Number(spend.toFixed(2)),
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const top5MostSpend: TopSpendRow[] = topSpendList.slice(0, 5).map((item, idx) => ({
    rank: idx + 1,
    accountName: item.accountName,
    accountId: item.accountId,
    status: item.status,
    spend: item.spend,
    sharePct:
      currentMonthSpend > 0
        ? Number(((item.spend / currentMonthSpend) * 100).toFixed(1))
        : 0,
  }));

  return {
    payerAccountName,
    reportMonth,
    generatedAt: new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
    currentMonthSpend,
    previousMonthSpend,
    momPercentChange,
    totalBudget,
    remainingBudget,
    netVariance,
    overallUtilizationPct,
    activeBudgetCount: rawBudgets.length,
    overBudgetCount: strictlyOver.length,
    totalOverSpend,
    top5OverBudget,
    top5MostSpend,
  };
}

async function fetchReportDataFromDb(): Promise<ReportData> {
  if (!prisma) {
    throw new Error('Prisma client is not initialized.');
  }

  const account =
    (await prisma.awsAccount.findFirst({ where: { configId: 'account-1' } })) ||
    (await prisma.awsAccount.findFirst({ where: { isPrimary: true } })) ||
    (await prisma.awsAccount.findFirst());

  if (!account) {
    throw new Error('No AWS account found in database.');
  }

  const latestRun = await prisma.awsReportRun.findFirst({
    where: { accountId: account.id, status: 'success' },
    orderBy: { id: 'desc' },
  });

  if (!latestRun) {
    throw new Error(`No successful report run found for account ${account.name}.`);
  }

  const reportRunId = latestRun.id;
  const reportMonth = latestRun.currentMonth || new Date().toISOString().slice(0, 7);

  const [momRows, budgetRows, activeAccounts, linkedAccounts, monthCosts] = await Promise.all([
    prisma.awsMomChange.findMany({
      where: { reportRunId },
      orderBy: { id: 'asc' },
    }),
    prisma.awsBudgetOverview.findMany({
      where: { reportRunId },
      orderBy: { id: 'asc' },
    }),
    prisma.awsActiveAccount.findMany({
      where: { reportRunId },
      orderBy: { currentMonthCost: 'desc' },
    }),
    prisma.awsLinkedAccount.findMany({
      where: { accountId: account.id },
    }),
    prisma.awsCostByLinkedAccount.findMany({
      where: { reportRunId, month: reportMonth },
      orderBy: { cost: 'desc' },
    }),
  ]);

  const currentMomRow =
    momRows.find((r) => r.month === reportMonth) || momRows[momRows.length - 1];

  const currentMonthSpend = Number(
    currentMomRow?.totalCost ?? latestRun.currentMonthTotal ?? 0
  );
  const previousMonthSpend = Number(currentMomRow?.previousMonthCost ?? 0);
  const momPercentChange = Number(currentMomRow?.momPercentChange ?? 0);

  const totalBudget = budgetRows.reduce((sum, b) => sum + Number(b.limitAmount || 0), 0);
  const remainingBudget = Math.max(0, totalBudget - currentMonthSpend);
  const netVariance = totalBudget - currentMonthSpend;
  const overallUtilizationPct =
    totalBudget > 0 ? Number(((currentMonthSpend / totalBudget) * 100).toFixed(1)) : 0;

  const formattedLinked = linkedAccounts.map((la) => ({
    linkedAccountId: la.linkedAccountId,
    name: la.name,
    status: la.status || 'ACTIVE',
  }));

  const evaluatedBudgets: OverBudgetRow[] = budgetRows.map((b) => {
    const limit = Number(b.limitAmount || 0);
    const actualSpend = Number(b.currentUsed || 0);
    const overSpend = Number((actualSpend - limit).toFixed(2));
    const utilizationPct =
      limit > 0 ? Number(((actualSpend / limit) * 100).toFixed(1)) : 0;

    const matched = matchBudgetToAccount(b.budgetName, [], formattedLinked);

    return {
      rank: 0,
      budgetName: b.budgetName,
      accountName: matched?.name || b.budgetName,
      accountId: matched?.linkedAccountId || '—',
      limit,
      actualSpend,
      overSpend,
      utilizationPct,
    };
  });

  const strictlyOver = evaluatedBudgets
    .filter((b) => b.overSpend > 0)
    .sort((a, b) => b.overSpend - a.overSpend);

  const totalOverSpend = strictlyOver.reduce((sum, b) => sum + b.overSpend, 0);

  const sortedForTop5 = [...evaluatedBudgets].sort((a, b) => {
    const aOver = a.overSpend > 0 ? 1 : 0;
    const bOver = b.overSpend > 0 ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    if (aOver === 1) return b.overSpend - a.overSpend;
    return b.utilizationPct - a.utilizationPct || b.actualSpend - a.actualSpend;
  });

  const top5OverBudget = sortedForTop5.slice(0, 5).map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));

  let topSpendCandidates: { accountName: string; accountId: string; status: string; spend: number }[] = [];

  if (activeAccounts.length > 0) {
    topSpendCandidates = activeAccounts.map((a) => ({
      accountName: a.accountName || a.accountId,
      accountId: a.accountId,
      status: a.accountStatus || 'ACTIVE',
      spend: Number(a.currentMonthCost || 0),
    }));
  } else if (monthCosts.length > 0) {
    topSpendCandidates = monthCosts.map((c) => {
      const found = linkedAccounts.find(
        (la) => la.linkedAccountId === c.linkedAccount || la.name === c.linkedAccount
      );
      return {
        accountName: found?.name || c.linkedAccount,
        accountId: found?.linkedAccountId || c.linkedAccount,
        status: found?.status || 'ACTIVE',
        spend: Number(c.cost || 0),
      };
    });
  }

  topSpendCandidates.sort((a, b) => b.spend - a.spend);

  const top5MostSpend: TopSpendRow[] = topSpendCandidates.slice(0, 5).map((item, idx) => ({
    rank: idx + 1,
    accountName: item.accountName,
    accountId: item.accountId,
    status: item.status,
    spend: item.spend,
    sharePct:
      currentMonthSpend > 0
        ? Number(((item.spend / currentMonthSpend) * 100).toFixed(1))
        : 0,
  }));

  return {
    payerAccountName: account.name,
    reportMonth,
    generatedAt: new Date().toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
    currentMonthSpend,
    previousMonthSpend,
    momPercentChange,
    totalBudget,
    remainingBudget,
    netVariance,
    overallUtilizationPct,
    activeBudgetCount: budgetRows.length,
    overBudgetCount: strictlyOver.length,
    totalOverSpend,
    top5OverBudget,
    top5MostSpend,
  };
}

async function fetchReportData(): Promise<ReportData> {
  try {
    return await fetchReportDataFromDb();
  } catch (dbErr: any) {
    console.warn(`⚠️ SQL Server unreachable (${dbErr.message?.split('\n')[0]}). Falling back to live AWS APIs...`);
    return await fetchReportDataFromAwsSdk();
  }
}

function buildReportHtml(data: ReportData): string {
  const isNetOver = data.netVariance < 0;
  const utilizationBarWidth = Math.min(100, Math.max(0, data.overallUtilizationPct));

  const formatMonthLabel = (m: string) => {
    const [y, mo] = m.split('-');
    if (!y || !mo) return m;
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AWS Cost & Budget Executive Summary - ${data.reportMonth}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 11.5px;
      line-height: 1.38;
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 60%, #312e81 100%);
      color: #ffffff;
      padding: 16px 20px;
      border-radius: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
    }
    .header-title {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .header-subtitle {
      font-size: 11px;
      color: #cbd5e1;
      margin-top: 2px;
    }
    .header-meta {
      text-align: right;
      font-size: 10.5px;
      color: #e2e8f0;
    }
    .badge-period {
      display: inline-block;
      background: rgba(99, 102, 241, 0.35);
      border: 1px solid rgba(165, 180, 252, 0.4);
      color: #ffffff;
      font-weight: 700;
      font-size: 10.5px;
      padding: 3px 9px;
      border-radius: 6px;
      margin-bottom: 3px;
    }
    .section {
      margin-bottom: 13px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 13px 16px;
      background: #ffffff;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #f1f5f9;
    }
    .section-title {
      font-size: 12.5px;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .section-subtitle {
      font-size: 10.5px;
      color: #64748b;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 11px;
    }
    .kpi-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .kpi-card.highlight-indigo {
      background: #eef2ff;
      border-color: #c7d2fe;
    }
    .kpi-card.highlight-emerald {
      background: #ecfdf5;
      border-color: #a7f3d0;
    }
    .kpi-card.highlight-rose {
      background: #fff1f2;
      border-color: #fecdd3;
    }
    .kpi-label {
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #475569;
      margin-bottom: 3px;
    }
    .kpi-value {
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }
    .kpi-value.rose {
      color: #e11d48;
    }
    .kpi-value.emerald {
      color: #059669;
    }
    .kpi-sub {
      font-size: 9.5px;
      color: #64748b;
      margin-top: 2px;
    }
    .progress-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 12px;
    }
    .progress-top {
      display: flex;
      justify-content: space-between;
      font-size: 10.5px;
      font-weight: 600;
      margin-bottom: 5px;
    }
    .progress-track {
      width: 100%;
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: ${data.overallUtilizationPct > 100 ? '#e11d48' : '#4f46e5'};
      border-radius: 999px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    th {
      background: #f8fafc;
      color: #475569;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 7px 9px;
      text-align: left;
      border-bottom: 1px solid #cbd5e1;
    }
    th.right, td.right {
      text-align: right;
    }
    td {
      padding: 7.5px 9px;
      border-bottom: 1px solid #f1f5f9;
      color: #1e293b;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .rank-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 19px;
      height: 19px;
      border-radius: 50%;
      font-size: 9.5px;
      font-weight: 700;
      background: #e2e8f0;
      color: #334155;
    }
    .rank-pill.top {
      background: #fee2e2;
      color: #be123c;
    }
    .rank-pill.spend {
      background: #e0e7ff;
      color: #3730a3;
    }
    .mono {
      font-family: Consolas, 'Courier New', monospace;
      font-size: 10px;
      color: #64748b;
    }
    .badge-over {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      background: #ffe4e6;
      color: #be123c;
    }
    .badge-warn {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      background: #fef3c7;
      color: #b45309;
    }
    .badge-share {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      background: #eef2ff;
      color: #4338ca;
    }
    .footer {
      margin-top: 6px;
      text-align: center;
      font-size: 9.5px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div>
      <div class="header-title">Cloud Cost Intelligence — Executive Budget &amp; Spend Report</div>
      <div class="header-subtitle">Account: ${data.payerAccountName}</div>
    </div>
    <div class="header-meta">
      <div class="badge-period">Billing Period: ${formatMonthLabel(data.reportMonth)}</div>
      <div>Generated: ${data.generatedAt}</div>
    </div>
  </div>

  <!-- Section 1: Current Spend vs Total Budget -->
  <div class="section">
    <div class="section-header">
      <div>
        <div class="section-title">1. Current Spend vs. Total Budget Summary</div>
        <div class="section-subtitle">Organization-wide monthly spend compared against configured AWS Budgets</div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card highlight-indigo">
        <div class="kpi-label">Current Month Spend</div>
        <div class="kpi-value">${fmtCurrency(data.currentMonthSpend)}</div>
        <div class="kpi-sub">Prior Month: ${fmtCurrency(data.previousMonthSpend)} (${data.momPercentChange >= 0 ? '+' : ''}${data.momPercentChange.toFixed(1)}% MoM)</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">Total Budget</div>
        <div class="kpi-value">${fmtCurrency(data.totalBudget)}</div>
        <div class="kpi-sub">Across ${data.activeBudgetCount} active AWS budgets</div>
      </div>

      <div class="kpi-card ${data.remainingBudget > 0 ? 'highlight-emerald' : 'highlight-rose'}">
        <div class="kpi-label">Remaining Budget</div>
        <div class="kpi-value ${data.remainingBudget > 0 ? 'emerald' : 'rose'}">${fmtCurrency(data.remainingBudget)}</div>
        <div class="kpi-sub">${
          isNetOver
            ? `Net Variance: -${fmtCurrency(Math.abs(data.netVariance))} (Exceeded)`
            : `Available before reaching total cap`
        }</div>
      </div>

      <div class="kpi-card highlight-rose">
        <div class="kpi-label">Total Over-Spend</div>
        <div class="kpi-value rose">+${fmtCurrency(data.totalOverSpend)}</div>
        <div class="kpi-sub">Across ${data.overBudgetCount} breached budgets</div>
      </div>
    </div>

    <div class="progress-box">
      <div class="progress-top">
        <span>Overall Budget Consumption (${fmtCurrency(data.currentMonthSpend)} of ${fmtCurrency(data.totalBudget)})</span>
        <span style="color: ${data.overallUtilizationPct > 100 ? '#be123c' : '#4338ca'}; font-weight: 800;">
          ${data.overallUtilizationPct.toFixed(1)}% Utilized
        </span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${utilizationBarWidth}%;"></div>
      </div>
    </div>
  </div>

  <!-- Section 2: Top 5 Accounts Over Budget -->
  <div class="section">
    <div class="section-header">
      <div>
        <div class="section-title">2. Top 5 Accounts That Are Over Budget</div>
        <div class="section-subtitle">Accounts ranked by dollar spend above their assigned monthly budget limit</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Budget / Account Name</th>
          <th>Account ID</th>
          <th class="right">Monthly Budget</th>
          <th class="right">Current Spend</th>
          <th class="right">Variance ($)</th>
          <th class="right">Utilization</th>
        </tr>
      </thead>
      <tbody>
        ${data.top5OverBudget
          .map((row) => {
            const isOver = row.overSpend > 0;
            const varianceStr = isOver
              ? `+${fmtCurrency(row.overSpend)}`
              : `-${fmtCurrency(Math.abs(row.overSpend))}`;
            return `
        <tr>
          <td><span class="rank-pill ${isOver ? 'top' : ''}">${row.rank}</span></td>
          <td><strong>${row.budgetName}</strong></td>
          <td class="mono">${row.accountId}</td>
          <td class="right">${fmtCurrency(row.limit)}</td>
          <td class="right"><strong>${fmtCurrency(row.actualSpend)}</strong></td>
          <td class="right" style="color: ${isOver ? '#be123c' : '#475569'}; font-weight: 700;">${varianceStr}</td>
          <td class="right"><span class="${isOver ? 'badge-over' : 'badge-warn'}">${row.utilizationPct.toFixed(1)}%</span></td>
        </tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </div>

  <!-- Section 3: Top 5 Accounts with Most Spend -->
  <div class="section">
    <div class="section-header">
      <div>
        <div class="section-title">3. Top 5 Accounts with Most Spend</div>
        <div class="section-subtitle">Highest-spending linked member accounts in ${formatMonthLabel(data.reportMonth)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Linked Account Name</th>
          <th>Account ID</th>
          <th>Status</th>
          <th class="right">Current Month Spend</th>
          <th class="right">Share of Total Spend</th>
        </tr>
      </thead>
      <tbody>
        ${data.top5MostSpend
          .map(
            (row) => `
        <tr>
          <td><span class="rank-pill spend">${row.rank}</span></td>
          <td><strong>${row.accountName}</strong></td>
          <td class="mono">${row.accountId}</td>
          <td style="color: #059669; font-weight: 600; font-size: 10px;">${row.status}</td>
          <td class="right"><strong>${fmtCurrency(row.spend)}</strong></td>
          <td class="right"><span class="badge-share">${row.sharePct.toFixed(1)}%</span></td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Confidential — Coforge Cloud Cost Intelligence &amp; FinOps Governance Platform
  </div>
</body>
</html>`;
}

function findEdgeExecutable(): string | null {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  console.log('📊 Fetching AWS Spend & Budget metrics...');
  const data = await fetchReportData();

  const outputDir = path.resolve(__dirname, '../cost-dashboard');
  const htmlPath = path.join(outputDir, 'AWS_Manager_Cost_Budget_Report.html');
  const pdfPath = path.join(outputDir, 'AWS_Manager_Cost_Budget_Report.pdf');

  const html = buildReportHtml(data);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const browserExe = findEdgeExecutable();
  if (!browserExe) {
    throw new Error('Could not find Microsoft Edge or Chrome to render PDF.');
  }

  console.log(`🖨️ Rendering PDF via ${path.basename(browserExe)}...`);
  execFileSync(browserExe, [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    htmlPath,
  ]);

  try {
    fs.unlinkSync(htmlPath);
  } catch {}

  console.log(`✅ PDF successfully generated at:\n   ${pdfPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed to generate PDF report:', err.message);
  process.exit(1);
});
