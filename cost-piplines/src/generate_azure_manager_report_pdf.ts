import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { prisma } from './server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const fmtCurrency = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

interface MonthlySpendPoint {
  month: string;
  spend: number;
}

interface OverBudgetRow {
  rank: number;
  budgetName: string;
  subscriptionName: string;
  subscriptionId: string;
  limit: number;
  actualSpend: number;
  overSpend: number;
  utilizationPct: number;
}

interface TopSpendRow {
  rank: number;
  subscriptionName: string;
  subscriptionId: string;
  status: string;
  spend: number;
  sharePct: number;
}

export interface AzureReportData {
  billingScopeName: string;
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
  last6MonthsSpend: MonthlySpendPoint[];
  top5OverBudget: OverBudgetRow[];
  top5MostSpend: TopSpendRow[];
}

function parseCsvSimple(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] || '').trim();
    });
    return row;
  });
}

async function fetchReportDataFromDb(): Promise<AzureReportData> {
  if (!prisma) {
    throw new Error('Prisma client is not initialized.');
  }

  const latestRun =
    (await prisma.azureReportRun.findFirst({
      where: { status: 'success' },
      orderBy: { id: 'desc' },
    })) ||
    (await prisma.azureReportRun.findFirst({
      orderBy: { id: 'desc' },
    }));

  if (!latestRun) {
    throw new Error('No Azure report run found in SQL Server database.');
  }

  const reportRunId = latestRun.id;

  // Determine report month
  let reportMonth = new Date().toISOString().slice(0, 7);
  if (latestRun.monthsCovered) {
    try {
      const parsed = JSON.parse(latestRun.monthsCovered);
      if (Array.isArray(parsed) && parsed.length > 0) {
        reportMonth = parsed[parsed.length - 1];
      }
    } catch {}
  }

  const [momRows, budgets, subRecords, monthlyTotals] = await Promise.all([
    prisma.azureReportMomChange.findMany({
      where: { reportRunId },
      orderBy: { id: 'asc' },
    }),
    prisma.azureSubscriptionBudget.findMany(),
    prisma.azureReportBySubscription.findMany({
      where: { reportRunId },
      orderBy: { cost: 'desc' },
    }),
    prisma.azureReportMonthlyTotals.findMany({
      where: { reportRunId },
      orderBy: { month: 'asc' },
    }),
  ]);

  const targetMom =
    momRows.find((r) => r.month === reportMonth) ||
    momRows[momRows.length - 1];

  if (targetMom?.month) {
    reportMonth = targetMom.month;
  }

  const currentMonthSpend = Number(targetMom?.totalCost || 0);
  const previousMonthSpend = Number(targetMom?.previousMonthCost || 0);
  const momPercentChange = Number(targetMom?.momPercentChange || 0);

  // Map spend by subscription
  const currentSubRecords = subRecords.filter((s) => s.month === reportMonth);
  const spendMap = new Map<string, number>();
  for (const s of currentSubRecords) {
    const cost = Number(s.cost || 0);
    spendMap.set(s.subscription, (spendMap.get(s.subscription) || 0) + cost);
  }

  // Evaluate Budgets
  const budgetedList = budgets.filter((b) => b.status === 'BUDGETED' && Number(b.amount || 0) > 0);
  const totalBudget = Number(
    budgetedList.reduce((sum, b) => sum + Number(b.amount || 0), 0).toFixed(2)
  );

  const remainingBudget = Math.max(0, Number((totalBudget - currentMonthSpend).toFixed(2)));
  const netVariance = Number((totalBudget - currentMonthSpend).toFixed(2));
  const overallUtilizationPct =
    totalBudget > 0 ? Number(((currentMonthSpend / totalBudget) * 100).toFixed(1)) : 0;

  const evaluatedBudgets: OverBudgetRow[] = budgetedList.map((b) => {
    const limit = Number(b.amount || 0);
    const subName = b.subscriptionName || b.subscriptionId;
    const actualSpend = spendMap.get(subName) || spendMap.get(b.subscriptionId) || 0;
    const overSpend = Number((actualSpend - limit).toFixed(2));
    const utilizationPct = limit > 0 ? Number(((actualSpend / limit) * 100).toFixed(1)) : 0;

    return {
      rank: 0,
      budgetName: b.budgetName || 'Default Budget',
      subscriptionName: subName,
      subscriptionId: b.subscriptionId,
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

  // Top 5 Subscriptions by spend
  const topSubList = [...currentSubRecords].sort((a, b) => Number(b.cost) - Number(a.cost));
  const top5MostSpend: TopSpendRow[] = topSubList.slice(0, 5).map((item, idx) => {
    const cost = Number(item.cost || 0);
    return {
      rank: idx + 1,
      subscriptionName: item.subscription,
      subscriptionId: item.subscription,
      status: 'ACTIVE',
      spend: cost,
      sharePct:
        currentMonthSpend > 0
          ? Number(((cost / currentMonthSpend) * 100).toFixed(1))
          : 0,
    };
  });

  const last6MonthsSpend: MonthlySpendPoint[] = (
    monthlyTotals.length > 0
      ? monthlyTotals.map((m) => ({ month: m.month, spend: Number(m.totalCost || 0) }))
      : momRows.map((m) => ({ month: m.month, spend: Number(m.totalCost || 0) }))
  ).slice(-6);

  return {
    billingScopeName: 'Azure Subscriptions (Consolidated)',
    reportMonth,
    generatedAt: new Date().toLocaleString('en-IN', {
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
    activeBudgetCount: budgetedList.length,
    overBudgetCount: strictlyOver.length,
    totalOverSpend,
    last6MonthsSpend,
    top5OverBudget,
    top5MostSpend,
  };
}

async function fetchReportDataFromCsv(): Promise<AzureReportData> {
  const reportsDir = path.resolve(__dirname, '../AzureUsageReports/latest');
  const momPath = path.join(reportsDir, 'azure_usage_mom_change.csv');
  const subPath = path.join(reportsDir, 'azure_usage_by_subscription.csv');

  if (!fs.existsSync(momPath) || !fs.existsSync(subPath)) {
    throw new Error(`CSV reports not found at ${reportsDir}`);
  }

  const momRecords = parseCsvSimple(fs.readFileSync(momPath, 'utf-8'));
  const subRecords = parseCsvSimple(fs.readFileSync(subPath, 'utf-8'));

  const latestMom = momRecords[momRecords.length - 1] || {};
  const reportMonth = latestMom['Month'] || new Date().toISOString().slice(0, 7);
  const currentMonthSpend = parseFloat(latestMom['Total Cost'] || '0') || 0;
  const previousMonthSpend = parseFloat(latestMom['Previous Month Cost'] || '0') || 0;
  const momPercentChange = parseFloat(latestMom['MoM % Change'] || '0') || 0;

  const last6MonthsSpend: MonthlySpendPoint[] = momRecords.slice(-6).map((m) => ({
    month: m['Month'] || '',
    spend: parseFloat(m['Total Cost'] || '0') || 0,
  }));

  const currentMonthSubs = subRecords
    .filter((s) => s['Month'] === reportMonth)
    .map((s) => ({
      subscription: s['Subscription'] || 'Unknown Subscription',
      cost: parseFloat(s['Cost'] || '0') || 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  const top5MostSpend: TopSpendRow[] = currentMonthSubs.slice(0, 5).map((s, idx) => ({
    rank: idx + 1,
    subscriptionName: s.subscription,
    subscriptionId: s.subscription,
    status: 'ACTIVE',
    spend: s.cost,
    sharePct:
      currentMonthSpend > 0
        ? Number(((s.cost / currentMonthSpend) * 100).toFixed(1))
        : 0,
  }));

  return {
    billingScopeName: 'Azure Subscriptions (Consolidated)',
    reportMonth,
    generatedAt: new Date().toLocaleString('en-IN', {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
    currentMonthSpend,
    previousMonthSpend,
    momPercentChange,
    totalBudget: 0,
    remainingBudget: 0,
    netVariance: 0,
    overallUtilizationPct: 0,
    activeBudgetCount: 0,
    overBudgetCount: 0,
    totalOverSpend: 0,
    last6MonthsSpend,
    top5OverBudget: [],
    top5MostSpend,
  };
}

export async function fetchReportData(): Promise<AzureReportData> {
  try {
    return await fetchReportDataFromDb();
  } catch (dbErr: any) {
    if (dbErr.message?.includes('No Azure report run found')) {
      console.warn(
        `⚠️  No completed Azure report run found in SQL Server. Run 'npm run report:azure' to compute reports from active usage records. Falling back to local AzureUsageReports CSVs...`
      );
    } else {
      console.warn(
        `⚠️  Could not query SQL Server (${dbErr.message?.split('\n')[0]}). Falling back to local AzureUsageReports CSVs...`
      );
    }
    return await fetchReportDataFromCsv();
  }
}

function renderRechartsSpendChart(
  points: MonthlySpendPoint[],
  currencySymbol: string = '₹',
  brandColor: string = '#0078d4',
  accentColor: string = '#bae6fd'
): string {
  if (!points || points.length === 0) {
    return `<div style="text-align: center; color: #64748b; padding: 12px;">No historical monthly data available.</div>`;
  }

  const svgWidth = 640;
  const svgHeight = 135;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 22;
  const padBottom = 26;

  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const maxVal = Math.max(...points.map((p) => p.spend), 1);
  const yMax = Math.ceil((maxVal * 1.15) / 100) * 100;

  const avgVal = points.reduce((sum, p) => sum + p.spend, 0) / points.length;
  const avgY = padTop + chartH - (avgVal / yMax) * chartH;

  const yTicks = [0, yMax * 0.5, yMax];

  const formatShortCurrency = (val: number) => {
    if (val >= 10000000) return `${currencySymbol}${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `${currencySymbol}${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `${currencySymbol}${(val / 1000).toFixed(1)}k`;
    return `${currencySymbol}${Math.round(val)}`;
  };

  const formatMonthName = (mStr: string) => {
    const [y, m] = mStr.split('-');
    if (!y || !m) return mStr;
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
  };

  const slotW = chartW / points.length;
  const barW = Math.min(42, Math.max(24, slotW * 0.55));

  const gridLines = yTicks
    .map((tick) => {
      const y = padTop + chartH - (tick / yMax) * chartH;
      return `
        <line x1="${padLeft}" y1="${y}" x2="${padLeft + chartW}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3 3" stroke-width="1" />
        <text x="${padLeft - 8}" y="${y + 3.5}" text-anchor="end" font-size="9" fill="#94a3b8" font-family="'Segoe UI', sans-serif">${formatShortCurrency(tick)}</text>
      `;
    })
    .join('');

  const bars = points
    .map((p, idx) => {
      const isLatest = idx === points.length - 1;
      const bH = Math.max(2, (p.spend / yMax) * chartH);
      const bX = padLeft + idx * slotW + (slotW - barW) / 2;
      const bY = padTop + chartH - bH;
      const fillColor = isLatest ? brandColor : accentColor;

      return `
        <g class="recharts-bar-group">
          <text x="${bX + barW / 2}" y="${bY - 6}" text-anchor="middle" font-size="9" font-weight="700" fill="${isLatest ? brandColor : '#475569'}" font-family="'Segoe UI', sans-serif">
            ${formatShortCurrency(p.spend)}
          </text>
          <rect x="${bX}" y="${bY}" width="${barW}" height="${bH}" rx="4" ry="4" fill="${fillColor}" />
          <text x="${bX + barW / 2}" y="${padTop + chartH + 16}" text-anchor="middle" font-size="9.5" font-weight="${isLatest ? '700' : '500'}" fill="${isLatest ? '#0f172a' : '#64748b'}" font-family="'Segoe UI', sans-serif">
            ${formatMonthName(p.month)}
          </text>
        </g>
      `;
    })
    .join('');

  const avgLine = `
    <line x1="${padLeft}" y1="${avgY}" x2="${padLeft + chartW}" y2="${avgY}" stroke="#f59e0b" stroke-dasharray="4 3" stroke-width="1.2" />
  `;

  return `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="${svgHeight}" style="overflow: visible; display: block;">
      ${gridLines}
      ${avgLine}
      <line x1="${padLeft}" y1="${padTop + chartH}" x2="${padLeft + chartW}" y2="${padTop + chartH}" stroke="#cbd5e1" stroke-width="1" />
      ${bars}
    </svg>
  `;
}

export function buildAzureReportHtml(data: AzureReportData): string {
  const isNetOver = data.netVariance < 0;
  const utilizationBarWidth = Math.min(100, Math.max(0, data.overallUtilizationPct));
  const avg6MonthSpend =
    data.last6MonthsSpend && data.last6MonthsSpend.length > 0
      ? data.last6MonthsSpend.reduce((sum, p) => sum + p.spend, 0) / data.last6MonthsSpend.length
      : data.currentMonthSpend;

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
  <title>Azure Cost &amp; Budget Executive Summary - ${data.reportMonth}</title>
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
      background: linear-gradient(135deg, #001f3f 0%, #004080 50%, #0078d4 100%);
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
      color: #bae6fd;
      margin-top: 2px;
    }
    .header-meta {
      text-align: right;
      font-size: 10.5px;
      color: #e0f2fe;
    }
    .badge-period {
      display: inline-block;
      background: rgba(14, 165, 233, 0.35);
      border: 1px solid rgba(186, 230, 253, 0.4);
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
    .kpi-card.highlight-azure {
      background: #f0f9ff;
      border-color: #bae6fd;
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
      background: ${data.overallUtilizationPct > 100 ? '#e11d48' : '#0284c7'};
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
      background: #e0f2fe;
      color: #0369a1;
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
      background: #f0f9ff;
      color: #0369a1;
    }
    .badge-avg {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 9.5px;
      font-weight: 700;
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
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
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background: linear-gradient(135deg, #001f3f 0%, #004080 50%, #0078d4 100%); color: #ffffff; padding: 16px 20px; border-radius: 10px; margin-bottom: 14px;">
    <tr>
      <td align="left" style="vertical-align: middle;">
        <div style="font-size: 17px; font-weight: 800; letter-spacing: -0.3px; color: #ffffff;">Azure Cost Intelligence — Executive Budget &amp; Spend Report</div>
        <div style="font-size: 11px; color: #bae6fd; margin-top: 2px;">Scope: ${data.billingScopeName}</div>
      </td>
      <td align="right" style="vertical-align: middle;">
        <div style="display: inline-block; background: rgba(14, 165, 233, 0.35); border: 1px solid rgba(186, 230, 253, 0.4); color: #ffffff; font-weight: 700; font-size: 10.5px; padding: 3px 9px; border-radius: 6px; margin-bottom: 3px;">
          Billing Period: ${formatMonthLabel(data.reportMonth)}
        </div>
        <div style="font-size: 10px; color: #e0f2fe;">Generated: ${data.generatedAt}</div>
      </td>
    </tr>
  </table>

  <!-- Section 1: Current Spend vs Total Budget -->
  <div class="section">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
      <tr>
        <td align="left">
          <div class="section-title">1. Current Spend vs. Total Budget Summary</div>
          <div class="section-subtitle">Consolidated monthly spend compared against configured Azure Subscriptions Budgets</div>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-bottom: 11px;">
      <tr>
        <td width="25%" style="vertical-align: top; border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 12px; background: #f0f9ff;">
          <div class="kpi-label">Current Month Spend</div>
          <div class="kpi-value">${fmtCurrency(data.currentMonthSpend)}</div>
          <div class="kpi-sub">Prior Month: ${fmtCurrency(data.previousMonthSpend)} (${data.momPercentChange >= 0 ? '+' : ''}${data.momPercentChange.toFixed(1)}% MoM)</div>
        </td>
        <td width="25%" style="vertical-align: top; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #f8fafc;">
          <div class="kpi-label">Total Budget</div>
          <div class="kpi-value">${fmtCurrency(data.totalBudget)}</div>
          <div class="kpi-sub">Across ${data.activeBudgetCount} configured subscription budgets</div>
        </td>
        <td width="25%" style="vertical-align: top; border: 1px solid ${data.remainingBudget > 0 ? '#a7f3d0' : '#fecdd3'}; border-radius: 8px; padding: 10px 12px; background: ${data.remainingBudget > 0 ? '#ecfdf5' : '#fff1f2'};">
          <div class="kpi-label">Remaining Budget</div>
          <div class="kpi-value ${data.remainingBudget > 0 ? 'emerald' : 'rose'}">${fmtCurrency(data.remainingBudget)}</div>
          <div class="kpi-sub">${
            isNetOver
              ? `Net Variance: -${fmtCurrency(Math.abs(data.netVariance))} (Exceeded)`
              : `Available before reaching total cap`
          }</div>
        </td>
        <td width="25%" style="vertical-align: top; border: 1px solid #fecdd3; border-radius: 8px; padding: 10px 12px; background: #fff1f2;">
          <div class="kpi-label">Total Over-Spend</div>
          <div class="kpi-value rose">+${fmtCurrency(data.totalOverSpend)}</div>
          <div class="kpi-sub">Across ${data.overBudgetCount} breached budgets</div>
        </td>
      </tr>
    </table>

    <div class="progress-box" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 5px;">
        <tr>
          <td align="left" style="font-size: 10.5px; font-weight: 600; color: #334155;">
            Overall Budget Consumption (${fmtCurrency(data.currentMonthSpend)} of ${fmtCurrency(data.totalBudget)})
          </td>
          <td align="right" style="color: ${data.overallUtilizationPct > 100 ? '#be123c' : '#0284c7'}; font-weight: 800; font-size: 10.5px;">
            ${data.overallUtilizationPct.toFixed(1)}% Utilized
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden;">
        <tr>
          <td width="${utilizationBarWidth}%" style="height: 8px; background: ${data.overallUtilizationPct > 100 ? '#e11d48' : '#0284c7'}; border-radius: 999px;"></td>
          <td width="${Math.max(0, 100 - utilizationBarWidth)}%" style="height: 8px; background: #e2e8f0;"></td>
        </tr>
      </table>
    </div>
  </div>

  <!-- Section 2: 6-Month Spending Trend (Recharts-Style) -->
  <div class="section">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
      <tr>
        <td align="left">
          <div class="section-title">2. 6-Month Spending Trend</div>
          <div class="section-subtitle">Monthly spend progression with 6-month historical average</div>
        </td>
        <td align="right">
          <span class="badge-avg" style="display: inline-block; background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
            6-Month Avg: ${fmtCurrency(avg6MonthSpend)}/mo
          </span>
        </td>
      </tr>
    </table>
    <div style="width: 100%; display: flex; justify-content: center; padding: 2px 0;">
      ${renderRechartsSpendChart(data.last6MonthsSpend, '₹', '#0078d4', '#bae6fd')}
    </div>
    ${
      data.last6MonthsSpend && data.last6MonthsSpend.length > 0
        ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px; border-top: 1px dashed #cbd5e1; padding-top: 6px; font-size: 10px; text-align: center;">
            <tr>
              ${data.last6MonthsSpend
                .map(
                  (p) => `
                <td style="padding: 4px; color: #475569;">
                  <div style="font-weight: 600; color: #64748b;">${formatMonthLabel(p.month)}</div>
                  <div style="font-weight: 700; color: #0f172a; margin-top: 2px;">${fmtCurrency(p.spend)}</div>
                </td>`
                )
                .join('')}
            </tr>
          </table>`
        : ''
    }
  </div>

  <!-- Section 3: Top 5 Subscriptions Over Budget -->
  <div class="section">
    <div class="section-header">
      <div>
        <div class="section-title">3. Top 5 Subscriptions That Are Over Budget</div>
        <div class="section-subtitle">Subscriptions ranked by spend exceeding their monthly budget ceiling</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Budget / Subscription Name</th>
          <th>Subscription ID</th>
          <th class="right">Monthly Budget</th>
          <th class="right">Current Spend</th>
          <th class="right">Variance (INR)</th>
          <th class="right">Utilization</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.top5OverBudget.length === 0
            ? `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 12px;">All tracked Azure subscriptions are within configured budget limits.</td></tr>`
            : data.top5OverBudget
                .map((row) => {
                  const isOver = row.overSpend > 0;
                  const varianceStr = isOver
                    ? `+${fmtCurrency(row.overSpend)}`
                    : `-${fmtCurrency(Math.abs(row.overSpend))}`;
                  return `
        <tr>
          <td><span class="rank-pill ${isOver ? 'top' : ''}">${row.rank}</span></td>
          <td><strong>${row.subscriptionName}</strong></td>
          <td class="mono">${row.subscriptionId}</td>
          <td class="right">${fmtCurrency(row.limit)}</td>
          <td class="right"><strong>${fmtCurrency(row.actualSpend)}</strong></td>
          <td class="right" style="color: ${isOver ? '#be123c' : '#475569'}; font-weight: 700;">${varianceStr}</td>
          <td class="right"><span class="${isOver ? 'badge-over' : 'badge-warn'}">${row.utilizationPct.toFixed(1)}%</span></td>
        </tr>`;
                })
                .join('')
        }
      </tbody>
    </table>
  </div>

  <!-- Section 4: Top 5 Subscriptions with Most Spend -->
  <div class="section">
    <div class="section-header">
      <div>
        <div class="section-title">4. Top 5 Subscriptions with Most Spend</div>
        <div class="section-subtitle">Highest-spending Azure subscriptions in ${formatMonthLabel(data.reportMonth)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Subscription Name</th>
          <th>Identifier</th>
          <th>Status</th>
          <th class="right">Current Month Spend</th>
          <th class="right">Share of Total Spend</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.top5MostSpend.length === 0
            ? `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 12px;">No active subscriptions found for this billing period.</td></tr>`
            : data.top5MostSpend
                .map(
                  (row) => `
        <tr>
          <td><span class="rank-pill spend">${row.rank}</span></td>
          <td><strong>${row.subscriptionName}</strong></td>
          <td class="mono">${row.subscriptionId}</td>
          <td style="color: #059669; font-weight: 600; font-size: 10px;">${row.status}</td>
          <td class="right"><strong>${fmtCurrency(row.spend)}</strong></td>
          <td class="right"><span class="badge-share">${row.sharePct.toFixed(1)}%</span></td>
        </tr>`
                )
                .join('')
        }
      </tbody>
    </table>
  </div>

  <div class="footer">
    Confidential — Coforge Cloud Cost Intelligence &amp; FinOps Governance Platform (Azure)
  </div>
</body>
</html>`;
}

function findBrowserExecutable(): string | null {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) {
    return process.env.BROWSER_PATH;
  }
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/msedge',
    '/snap/bin/chromium',
    '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function toWindowsPath(filePath: string): string {
  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\')) {
    return filePath;
  }

  try {
    const converted = execSync(`wslpath -w "${filePath.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (converted) return converted;
  } catch {}

  const mntMatch = filePath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase();
    const rest = mntMatch[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }

  const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
  const winLinuxPath = filePath.replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}${winLinuxPath}`;
}

export async function generateAzureReport(options: { htmlOnly?: boolean } = {}): Promise<{
  htmlPath: string;
  pdfPath?: string;
  data: AzureReportData;
}> {
  console.log('📊 Fetching Azure Spend & Budget metrics...');
  const data = await fetchReportData();

  const outputDir = path.resolve(__dirname, '../cost-dashboard');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const htmlPath = path.join(outputDir, 'Azure_Manager_Cost_Budget_Report.html');
  const pdfPath = path.join(outputDir, 'Azure_Manager_Cost_Budget_Report.pdf');

  const html = buildAzureReportHtml(data);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  if (options.htmlOnly || process.argv.includes('--html-only')) {
    console.log(`✅ Executive HTML report successfully generated at:\n   ${htmlPath}`);
    return { htmlPath, data };
  }

  const browserExe = findBrowserExecutable();
  if (!browserExe) {
    console.warn(
      `⚠️ Could not find Microsoft Edge or Google Chrome to render PDF automatically.\n   Executive HTML report has been preserved at:\n   ${htmlPath}`
    );
    return { htmlPath, data };
  }

  const isWindowsExe =
    browserExe.toLowerCase().endsWith('.exe') ||
    browserExe.startsWith('/mnt/') ||
    process.platform === 'win32';

  const inputTarget = isWindowsExe ? toWindowsPath(htmlPath) : htmlPath;
  const outputTarget = isWindowsExe ? toWindowsPath(pdfPath) : pdfPath;

  console.log(`🖨️ Rendering Azure PDF via ${path.basename(browserExe)}...`);
  execFileSync(browserExe, [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--log-level=3',
    `--print-to-pdf=${outputTarget}`,
    inputTarget,
  ], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  console.log(`✅ Azure PDF successfully generated at:\n   ${pdfPath}`);
  return { htmlPath, pdfPath, data };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateAzureReport()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to generate Azure PDF report:', err.message);
      process.exit(1);
    });
}
