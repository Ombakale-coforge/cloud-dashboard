import 'dotenv/config';
import { prisma } from '../db.ts';
import { ensureAlertTablesExist } from '../db-alert-tables.ts';
import {
  type EmailDeliveryResult,
  type StoredAccountBudget,
  deliverHtmlEmail,
  listRawBudgets,
  normalizeEmailList,
} from './accountBudgetService.ts';

export interface ServiceUsageRow {
  subscriptionId: string;
  subscriptionName: string;
  service: string;
  cost: number;
  billingCurrency: string;
}

export interface BurstServiceDriver {
  service: string;
  prevMonthDailyAvg: number;
  currentDayCost: number;
  deltaOverDailyAvg: number;
  multipleOfDailyAvg: number | null;
}

export interface AzureDailyBurst {
  evaluationDate: string;
  previousMonth: string;
  daysInPreviousMonth: number;
  subscriptionId: string;
  subscriptionName: string;
  billingCurrency: 'INR' | 'USD';
  previousMonthCost: number;
  previousMonthDailyAvg: number;
  currentDayCost: number;
  percentOfPrevMonth: number;
  thresholdPercent: number;
  thresholdAmount: number;
  minCostFloorApplied: number;
  topDrivers: BurstServiceDriver[];
}

export interface BurstDetectionOptions {
  evaluationDate: string;
  previousMonth: string;
  daysInPreviousMonth?: number;
  thresholdPercent?: number;
  minCostFloorInr?: number;
  minCostFloorUsd?: number;
  minCostFloorOverride?: number;
}

export interface BurstRecipientResolution {
  recipients: string[];
  contactName: string | null;
  usedFallback: boolean;
}

export interface BurstNotificationResult {
  burst: AzureDailyBurst;
  recipients: string[];
  usedFallback: boolean;
  skippedReason?: 'ALREADY_SENT' | 'NO_RECIPIENTS';
  emailResult?: EmailDeliveryResult;
}

export interface BurstEvaluationSummary {
  evaluationDate: string;
  previousMonth: string;
  subscriptionsEvaluated: number;
  burstsDetected: number;
  emailsSent: number;
  skippedAlreadySent: number;
  skippedNoRecipients: number;
  failedCount: number;
  results: BurstNotificationResult[];
}

export const DEFAULT_BURST_CONFIG = {
  thresholdPercent: Number(process.env.AZURE_BURST_THRESHOLD_PERCENT || '10'),
  minCostFloorInr: Number(
    process.env.AZURE_BURST_MIN_COST_INR || process.env.AZURE_BURST_MIN_DELTA_INR || '500'
  ),
  minCostFloorUsd: Number(
    process.env.AZURE_BURST_MIN_COST_USD || process.env.AZURE_BURST_MIN_DELTA_USD || '10'
  ),
  dataLagDays: Number(process.env.AZURE_BURST_DATA_LAG_DAYS || '1'),
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function cleanSubscriptionId(raw: string): string {
  return String(raw || '')
    .replace(/^\/?subscriptions\//i, '')
    .trim()
    .toLowerCase();
}

function normalizeName(raw: string): string {
  return String(raw || '')
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()
    .toLowerCase();
}

export function getDateDaysBefore(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date "${dateStr}". Expected YYYY-MM-DD.`);
  }
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function getPreviousMonthInfo(dateStr: string): {
  previousMonth: string;
  daysInPreviousMonth: number;
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date "${dateStr}". Expected YYYY-MM-DD.`);
  }
  const [y, m] = dateStr.split('-').map((v) => parseInt(v, 10));
  const prevStart = new Date(Date.UTC(y, m - 2, 1));
  const prevEnd = new Date(Date.UTC(y, m - 1, 0));
  const previousMonth = `${prevStart.getUTCFullYear()}-${String(prevStart.getUTCMonth() + 1).padStart(2, '0')}`;
  return {
    previousMonth,
    daysInPreviousMonth: prevEnd.getUTCDate(),
  };
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveCurrency(raw?: string | null): 'INR' | 'USD' {
  return String(raw || '').trim().toUpperCase() === 'USD' ? 'USD' : 'INR';
}

function formatCurrency(amount: number, currency: 'INR' | 'USD'): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ── Pure Detection Logic (Single Day >= X% of Previous Month's Total) ───────

export function detectDailyBursts(
  dayRows: ServiceUsageRow[],
  prevMonthRows: ServiceUsageRow[],
  options: BurstDetectionOptions
): { subscriptionsEvaluated: number; bursts: AzureDailyBurst[] } {
  const thresholdPercent = options.thresholdPercent ?? DEFAULT_BURST_CONFIG.thresholdPercent;
  const minCostFloorInr = options.minCostFloorInr ?? DEFAULT_BURST_CONFIG.minCostFloorInr;
  const minCostFloorUsd = options.minCostFloorUsd ?? DEFAULT_BURST_CONFIG.minCostFloorUsd;
  const daysInPreviousMonth =
    options.daysInPreviousMonth ?? getPreviousMonthInfo(options.evaluationDate).daysInPreviousMonth;

  type SubBucket = {
    subscriptionId: string;
    subscriptionName: string;
    billingCurrency: 'INR' | 'USD';
    prevMonthTotal: number;
    currDayTotal: number;
    services: Map<string, { prevMonth: number; currDay: number }>;
  };

  const subs = new Map<string, SubBucket>();

  const getOrCreate = (row: ServiceUsageRow): SubBucket | null => {
    const key = cleanSubscriptionId(row.subscriptionId);
    if (!key) return null;
    let bucket = subs.get(key);
    if (!bucket) {
      bucket = {
        subscriptionId: row.subscriptionId.trim(),
        subscriptionName: (row.subscriptionName || row.subscriptionId).trim(),
        billingCurrency: resolveCurrency(row.billingCurrency),
        prevMonthTotal: 0,
        currDayTotal: 0,
        services: new Map(),
      };
      subs.set(key, bucket);
    } else if (bucket.subscriptionName === bucket.subscriptionId && row.subscriptionName) {
      bucket.subscriptionName = row.subscriptionName.trim();
    }
    return bucket;
  };

  for (const row of prevMonthRows) {
    const bucket = getOrCreate(row);
    if (!bucket) continue;
    const cost = Number(row.cost) || 0;
    const svcName = (row.service || 'Unknown Azure Service').trim();
    const svc = bucket.services.get(svcName) || { prevMonth: 0, currDay: 0 };
    bucket.prevMonthTotal += cost;
    svc.prevMonth += cost;
    bucket.services.set(svcName, svc);
  }

  for (const row of dayRows) {
    const bucket = getOrCreate(row);
    if (!bucket) continue;
    const cost = Number(row.cost) || 0;
    const svcName = (row.service || 'Unknown Azure Service').trim();
    const svc = bucket.services.get(svcName) || { prevMonth: 0, currDay: 0 };
    bucket.currDayTotal += cost;
    svc.currDay += cost;
    bucket.services.set(svcName, svc);
  }

  const bursts: AzureDailyBurst[] = [];

  for (const bucket of subs.values()) {
    const previousMonthCost = round2(bucket.prevMonthTotal);
    const currentDayCost = round2(bucket.currDayTotal);

    if (previousMonthCost <= 0 || currentDayCost <= 0) continue;

    const percentOfPrevMonth = round2((currentDayCost / previousMonthCost) * 100);
    const thresholdAmount = round2((previousMonthCost * thresholdPercent) / 100);
    const minCostFloorApplied =
      options.minCostFloorOverride !== undefined
        ? options.minCostFloorOverride
        : bucket.billingCurrency === 'USD'
        ? minCostFloorUsd
        : minCostFloorInr;

    if (percentOfPrevMonth < thresholdPercent || currentDayCost < minCostFloorApplied) {
      continue;
    }

    const previousMonthDailyAvg = round2(previousMonthCost / Math.max(1, daysInPreviousMonth));

    const topDrivers: BurstServiceDriver[] = Array.from(bucket.services.entries())
      .map(([service, vals]) => {
        const prevAvg = round2(vals.prevMonth / Math.max(1, daysInPreviousMonth));
        const curr = round2(vals.currDay);
        const delta = round2(curr - prevAvg);
        return {
          service,
          prevMonthDailyAvg: prevAvg,
          currentDayCost: curr,
          deltaOverDailyAvg: delta,
          multipleOfDailyAvg: prevAvg > 0 ? round2(curr / prevAvg) : null,
        };
      })
      .filter((d) => d.currentDayCost > 0 && d.deltaOverDailyAvg > 0)
      .sort((a, b) => b.deltaOverDailyAvg - a.deltaOverDailyAvg)
      .slice(0, 5);

    bursts.push({
      evaluationDate: options.evaluationDate,
      previousMonth: options.previousMonth,
      daysInPreviousMonth,
      subscriptionId: bucket.subscriptionId,
      subscriptionName: bucket.subscriptionName,
      billingCurrency: bucket.billingCurrency,
      previousMonthCost,
      previousMonthDailyAvg,
      currentDayCost,
      percentOfPrevMonth,
      thresholdPercent,
      thresholdAmount,
      minCostFloorApplied,
      topDrivers,
    });
  }

  bursts.sort((a, b) => b.currentDayCost - a.currentDayCost);
  return { subscriptionsEvaluated: subs.size, bursts };
}

// ── Recipient Resolution ────────────────────────────────────────────────────

export function resolveBurstRecipients(
  subscriptionId: string,
  subscriptionName: string,
  azureBudgets: StoredAccountBudget[],
  fallbackEmails: string[]
): BurstRecipientResolution {
  const cleanId = cleanSubscriptionId(subscriptionId);
  const normName = normalizeName(subscriptionName);

  const activeAzure = azureBudgets.filter(
    (b) => b.cloudProvider === 'azure' && b.isActive
  );

  const matched =
    activeAzure.find((b) => cleanSubscriptionId(b.accountId) === cleanId) ||
    activeAzure.find((b) => normalizeName(b.accountName) === normName) ||
    activeAzure.find((b) => normalizeName(b.accountId) === normName) ||
    activeAzure.find((b) => cleanSubscriptionId(b.accountName) === cleanId);

  if (matched) {
    const ownerEmails = normalizeEmailList(
      matched.alertEmails?.length ? matched.alertEmails : matched.alertEmail
    );
    if (ownerEmails.length > 0) {
      return {
        recipients: ownerEmails,
        contactName: matched.contactName || null,
        usedFallback: false,
      };
    }
  }

  return {
    recipients: normalizeEmailList(fallbackEmails),
    contactName: null,
    usedFallback: true,
  };
}

// ── Email Content Builder ───────────────────────────────────────────────────

export function buildDailyBurstEmailContent(
  burst: AzureDailyBurst,
  recipientInfo: BurstRecipientResolution
): { subject: string; html: string; text: string } {
  const cur = burst.billingCurrency;
  const pctStr = `${burst.percentOfPrevMonth.toFixed(1)}%`;
  const currStr = formatCurrency(burst.currentDayCost, cur);
  const prevMonthStr = formatCurrency(burst.previousMonthCost, cur);
  const prevDailyAvgStr = formatCurrency(burst.previousMonthDailyAvg, cur);
  const thresholdAmtStr = formatCurrency(burst.thresholdAmount, cur);

  const subject = `[Azure Cost Burst] ${burst.subscriptionName} burned ${pctStr} of ${burst.previousMonth} spend (${currStr}) on ${burst.evaluationDate}`;

  const driverRows =
    burst.topDrivers.length > 0
      ? burst.topDrivers
          .map((d) => {
            const multStr =
              d.multipleOfDailyAvg !== null ? `${d.multipleOfDailyAvg.toFixed(1)}x avg` : 'New';
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:8px 10px;color:#0f172a;font-size:13px;">${escapeHtml(d.service)}</td>
                <td style="padding:8px 10px;color:#475569;font-size:13px;text-align:right;">${escapeHtml(formatCurrency(d.prevMonthDailyAvg, cur))}/day</td>
                <td style="padding:8px 10px;color:#0f172a;font-size:13px;font-weight:600;text-align:right;">${escapeHtml(formatCurrency(d.currentDayCost, cur))}</td>
                <td style="padding:8px 10px;color:#dc2626;font-size:13px;font-weight:600;text-align:right;">+${escapeHtml(formatCurrency(d.deltaOverDailyAvg, cur))} (${multStr})</td>
              </tr>`;
          })
          .join('')
      : `<tr><td colspan="4" style="padding:10px;color:#64748b;font-size:13px;">No individual service breakdown available.</td></tr>`;

  const fallbackBanner = recipientInfo.usedFallback
    ? `<div style="margin:0 0 16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;color:#92400e;">
         <strong>Fallback Routing:</strong> No active owner email was configured in <code>cloud_account_budgets</code> for this Azure subscription, so this alert was delivered to the fallback address.
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:20px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:660px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0078d4;padding:20px 24px;color:#ffffff;">
      <div style="font-size:11px;letter-spacing:0.8px;text-transform:uppercase;opacity:0.9;">Azure Daily Cost Burst Alert</div>
      <h1 style="margin:6px 0 0;font-size:20px;font-weight:700;">${escapeHtml(burst.subscriptionName)}</h1>
      <div style="margin-top:4px;font-size:12px;opacity:0.9;">Subscription ID: ${escapeHtml(burst.subscriptionId)}</div>
    </div>

    <div style="padding:22px 24px;">
      ${fallbackBanner}

      <table style="width:100%;border-collapse:separate;border-spacing:10px 0;margin:0 -10px 18px;">
        <tr>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;width:33%;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Prev Month (${escapeHtml(burst.previousMonth)})</div>
            <div style="font-size:18px;font-weight:700;color:#334155;margin-top:4px;">${escapeHtml(prevMonthStr)}</div>
            <div style="font-size:11px;color:#64748b;">Avg ${escapeHtml(prevDailyAvgStr)}/day</div>
          </td>
          <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;width:33%;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Eval Day (${escapeHtml(burst.evaluationDate)})</div>
            <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:4px;">${escapeHtml(currStr)}</div>
            <div style="font-size:11px;color:#64748b;">Limit: ${escapeHtml(thresholdAmtStr)} (${burst.thresholdPercent}%)</div>
          </td>
          <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;width:33%;">
            <div style="font-size:11px;color:#b91c1c;text-transform:uppercase;">Share of Prev Month</div>
            <div style="font-size:18px;font-weight:700;color:#dc2626;margin-top:4px;">${escapeHtml(pctStr)}</div>
            <div style="font-size:11px;color:#b91c1c;">in a single day</div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 16px;font-size:13px;color:#334155;line-height:1.5;">
        ${recipientInfo.contactName ? `Hi ${escapeHtml(recipientInfo.contactName)}, ` : ''}On <strong>${escapeHtml(burst.evaluationDate)}</strong>, Azure subscription <strong>${escapeHtml(burst.subscriptionName)}</strong> spent <strong>${escapeHtml(currStr)}</strong> — which is <strong>${escapeHtml(pctStr)}</strong> of its entire <strong>${escapeHtml(burst.previousMonth)}</strong> spend (${escapeHtml(prevMonthStr)}), exceeding the alert rule (<strong>&ge; ${burst.thresholdPercent}% of previous month</strong> and <strong>&ge; ${escapeHtml(formatCurrency(burst.minCostFloorApplied, cur))}</strong>).
      </p>

      <h2 style="margin:0 0 8px;font-size:14px;color:#0f172a;">Top Services Driving the Burst</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Service</th>
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;text-align:right;">Prev Month Avg</th>
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;text-align:right;">Eval Day</th>
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;text-align:right;">Above Avg</th>
          </tr>
        </thead>
        <tbody>${driverRows}</tbody>
      </table>

      <p style="margin:20px 0 0;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
        Cloud Cost Intelligence &amp; FinOps Platform &bull; Automated Azure Daily Cost-Burst Alerting
      </p>
    </div>
  </div>
</body>
</html>`;

  const driversText = burst.topDrivers
    .map(
      (d) =>
        `  - ${d.service}: avg ${formatCurrency(d.prevMonthDailyAvg, cur)}/day -> ${formatCurrency(d.currentDayCost, cur)} (+${formatCurrency(d.deltaOverDailyAvg, cur)})`
    )
    .join('\n');

  const text = [
    subject,
    `Subscription: ${burst.subscriptionName} (${burst.subscriptionId})`,
    `Previous Month (${burst.previousMonth}): ${prevMonthStr} (avg ${prevDailyAvgStr}/day)`,
    `Evaluation Day (${burst.evaluationDate}): ${currStr} (${pctStr} of ${burst.previousMonth})`,
    `Rule: >= ${burst.thresholdPercent}% of prev month (${thresholdAmtStr}) AND >= ${formatCurrency(burst.minCostFloorApplied, cur)}`,
    recipientInfo.usedFallback ? 'Note: Routed via fallback email (no owner mapped in cloud_account_budgets).' : '',
    driversText ? `Top Drivers:\n${driversText}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

// ── Database Queries & Idempotency ──────────────────────────────────────────

async function resolveEvaluationDate(
  explicitDate?: string,
  lagDays = DEFAULT_BURST_CONFIG.dataLagDays
): Promise<string> {
  if (explicitDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
      throw new Error(`Invalid --date "${explicitDate}". Expected YYYY-MM-DD.`);
    }
    return explicitDate;
  }

  const maxAllowedDate = getDateDaysBefore(todayUTC(), lagDays);
  if (!prisma) return maxAllowedDate;

  try {
    const rows: Array<{ latest_date: Date | string | null }> = await prisma.$queryRaw`
      SELECT MAX([usage_date]) AS [latest_date]
      FROM [dbo].[azure_usage_records]
      WHERE [is_duplicate_of_earlier_row] = 0
        AND [is_superseded_by_later_row] = 0
        AND [is_excluded_from_alerts] = 0
        AND [usage_date] <= CAST(${maxAllowedDate} AS DATE)
    `;
    const raw = rows[0]?.latest_date;
    if (raw) {
      return raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
    }
  } catch (err: any) {
    console.warn('[AzureDailyBurst] Failed resolving latest usage_date, using lag default:', err.message);
  }

  return maxAllowedDate;
}

function mapRawUsageRows(
  rows: Array<{
    subscription_id: string;
    subscription_name: string | null;
    service: string | null;
    billing_currency: string | null;
    total_cost: unknown;
  }>
): ServiceUsageRow[] {
  return rows.map((r) => ({
    subscriptionId: String(r.subscription_id || '').trim(),
    subscriptionName: String(r.subscription_name || r.subscription_id || 'Unknown').trim(),
    service: String(r.service || 'Unknown Azure Service').trim(),
    billingCurrency: String(r.billing_currency || 'INR').trim(),
    cost: Number(r.total_cost) || 0,
  }));
}

async function loadEvaluationDayUsage(
  evaluationDate: string,
  usageOnly: boolean
): Promise<ServiceUsageRow[]> {
  if (!prisma) {
    throw new Error('Database client is not initialized (missing DATABASE_URL).');
  }

  const rows: Array<{
    subscription_id: string;
    subscription_name: string | null;
    service: string | null;
    billing_currency: string | null;
    total_cost: unknown;
  }> = usageOnly
    ? await prisma.$queryRaw`
        SELECT
          [subscription_id],
          MAX([subscription_name]) AS [subscription_name],
          [service],
          MAX([billing_currency]) AS [billing_currency],
          SUM(COALESCE([effective_cost], [billed_cost], 0)) AS [total_cost]
        FROM [dbo].[azure_usage_records]
        WHERE [is_duplicate_of_earlier_row] = 0
          AND [is_superseded_by_later_row] = 0
          AND [is_excluded_from_alerts] = 0
          AND [usage_date] = CAST(${evaluationDate} AS DATE)
          AND LOWER(COALESCE([charge_type], '')) = 'usage'
        GROUP BY [subscription_id], [service]
      `
    : await prisma.$queryRaw`
        SELECT
          [subscription_id],
          MAX([subscription_name]) AS [subscription_name],
          [service],
          MAX([billing_currency]) AS [billing_currency],
          SUM(COALESCE([effective_cost], [billed_cost], 0)) AS [total_cost]
        FROM [dbo].[azure_usage_records]
        WHERE [is_duplicate_of_earlier_row] = 0
          AND [is_superseded_by_later_row] = 0
          AND [is_excluded_from_alerts] = 0
          AND [usage_date] = CAST(${evaluationDate} AS DATE)
        GROUP BY [subscription_id], [service]
      `;

  return mapRawUsageRows(rows);
}

async function loadPreviousMonthUsage(
  previousMonth: string,
  usageOnly: boolean
): Promise<ServiceUsageRow[]> {
  if (!prisma) {
    throw new Error('Database client is not initialized (missing DATABASE_URL).');
  }

  const rows: Array<{
    subscription_id: string;
    subscription_name: string | null;
    service: string | null;
    billing_currency: string | null;
    total_cost: unknown;
  }> = usageOnly
    ? await prisma.$queryRaw`
        SELECT
          [subscription_id],
          MAX([subscription_name]) AS [subscription_name],
          [service],
          MAX([billing_currency]) AS [billing_currency],
          SUM(COALESCE([effective_cost], [billed_cost], 0)) AS [total_cost]
        FROM [dbo].[azure_usage_records]
        WHERE [is_duplicate_of_earlier_row] = 0
          AND [is_superseded_by_later_row] = 0
          AND [is_excluded_from_alerts] = 0
          AND [usage_month] = ${previousMonth}
          AND LOWER(COALESCE([charge_type], '')) = 'usage'
        GROUP BY [subscription_id], [service]
      `
    : await prisma.$queryRaw`
        SELECT
          [subscription_id],
          MAX([subscription_name]) AS [subscription_name],
          [service],
          MAX([billing_currency]) AS [billing_currency],
          SUM(COALESCE([effective_cost], [billed_cost], 0)) AS [total_cost]
        FROM [dbo].[azure_usage_records]
        WHERE [is_duplicate_of_earlier_row] = 0
          AND [is_superseded_by_later_row] = 0
          AND [is_excluded_from_alerts] = 0
          AND [usage_month] = ${previousMonth}
        GROUP BY [subscription_id], [service]
      `;

  return mapRawUsageRows(rows);
}

async function getAlreadySentSubscriptionIds(evaluationDate: string): Promise<Set<string>> {
  const sent = new Set<string>();
  if (!prisma) return sent;

  try {
    await ensureAlertTablesExist(prisma);
    const rows: Array<{ subscription_id: string }> = await prisma.$queryRaw`
      SELECT [subscription_id]
      FROM [dbo].[azure_daily_burst_alerts]
      WHERE [evaluation_date] = ${evaluationDate}
        AND [sent] = 1
    `;
    for (const r of rows) {
      sent.add(cleanSubscriptionId(r.subscription_id));
    }
  } catch (err: any) {
    console.warn('[AzureDailyBurst] Could not query azure_daily_burst_alerts:', err.message);
  }
  return sent;
}

async function recordBurstAlertAudit(
  burst: AzureDailyBurst,
  recipients: string[],
  usedFallback: boolean,
  emailResult: EmailDeliveryResult
): Promise<void> {
  if (!prisma) return;
  try {
    await ensureAlertTablesExist(prisma);
    const driversJson = JSON.stringify(burst.topDrivers);
    const recipientsStr = recipients.join(', ');
    const sentBit = emailResult.sent ? 1 : 0;
    const errMsg = emailResult.error ? emailResult.error.slice(0, 1000) : null;

    await prisma.$executeRaw`
      DELETE FROM [dbo].[azure_daily_burst_alerts]
      WHERE [evaluation_date] = ${burst.evaluationDate}
        AND [subscription_id] = ${burst.subscriptionId}
    `;

    await prisma.$executeRaw`
      INSERT INTO [dbo].[azure_daily_burst_alerts] (
        [evaluation_date],
        [previous_month],
        [subscription_id],
        [subscription_name],
        [previous_month_cost],
        [current_day_cost],
        [percent_of_prev_month],
        [billing_currency],
        [threshold_percent],
        [min_cost_floor],
        [top_drivers_json],
        [recipients],
        [used_fallback_email],
        [transport],
        [sent],
        [error_message]
      )
      VALUES (
        ${burst.evaluationDate},
        ${burst.previousMonth},
        ${burst.subscriptionId},
        ${burst.subscriptionName},
        ${burst.previousMonthCost},
        ${burst.currentDayCost},
        ${burst.percentOfPrevMonth},
        ${burst.billingCurrency},
        ${burst.thresholdPercent},
        ${burst.minCostFloorApplied},
        ${driversJson},
        ${recipientsStr},
        ${usedFallback ? 1 : 0},
        ${emailResult.transport},
        ${sentBit},
        ${errMsg}
      )
    `;
  } catch (err: any) {
    console.warn('[AzureDailyBurst] Failed recording burst alert audit row:', err.message);
  }
}

// ── End-to-End Pipeline ─────────────────────────────────────────────────────

export async function evaluateAndNotifyAzureDailyBursts(options?: {
  date?: string;
  thresholdPercent?: number;
  minCostFloorOverride?: number;
  usageOnly?: boolean;
  fallbackEmail?: string;
  ccEmail?: string;
  dryRun?: boolean;
  force?: boolean;
}): Promise<BurstEvaluationSummary> {
  const dryRun = Boolean(options?.dryRun);
  const force = Boolean(options?.force);
  const usageOnly = Boolean(options?.usageOnly);

  const evaluationDate = await resolveEvaluationDate(options?.date);
  const { previousMonth, daysInPreviousMonth } = getPreviousMonthInfo(evaluationDate);

  const [dayRows, prevMonthRows, azureBudgets, alreadySent] = await Promise.all([
    loadEvaluationDayUsage(evaluationDate, usageOnly),
    loadPreviousMonthUsage(previousMonth, usageOnly),
    listRawBudgets('azure'),
    force ? Promise.resolve(new Set<string>()) : getAlreadySentSubscriptionIds(evaluationDate),
  ]);

  const { subscriptionsEvaluated, bursts } = detectDailyBursts(dayRows, prevMonthRows, {
    evaluationDate,
    previousMonth,
    daysInPreviousMonth,
    thresholdPercent: options?.thresholdPercent,
    minCostFloorOverride: options?.minCostFloorOverride,
  });

  const fallbackEmails = normalizeEmailList(
    options?.fallbackEmail ||
      process.env.AZURE_BURST_FALLBACK_EMAIL ||
      process.env.BURST_ALERT_FALLBACK_EMAIL ||
      process.env.ALERT_EMAIL_TO ||
      ''
  );
  const ccEmails = normalizeEmailList(
    options?.ccEmail ||
      process.env.AZURE_BURST_CC_EMAIL ||
      process.env.BURST_ALERT_CC_EMAIL ||
      ''
  );

  let emailsSent = 0;
  let skippedAlreadySent = 0;
  let skippedNoRecipients = 0;
  let failedCount = 0;
  const results: BurstNotificationResult[] = [];

  for (const burst of bursts) {
    const cleanId = cleanSubscriptionId(burst.subscriptionId);
    const recipientInfo = resolveBurstRecipients(
      burst.subscriptionId,
      burst.subscriptionName,
      azureBudgets,
      fallbackEmails
    );

    if (!force && alreadySent.has(cleanId)) {
      skippedAlreadySent++;
      results.push({
        burst,
        recipients: recipientInfo.recipients,
        usedFallback: recipientInfo.usedFallback,
        skippedReason: 'ALREADY_SENT',
      });
      continue;
    }

    if (recipientInfo.recipients.length === 0) {
      skippedNoRecipients++;
      results.push({
        burst,
        recipients: [],
        usedFallback: true,
        skippedReason: 'NO_RECIPIENTS',
      });
      continue;
    }

    const { subject, html, text } = buildDailyBurstEmailContent(burst, recipientInfo);
    const safeSub = burst.subscriptionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);

    try {
      const emailResult = await deliverHtmlEmail({
        recipients: recipientInfo.recipients,
        cc: ccEmails,
        subject,
        html,
        text,
        previewFilename: `azure-daily-burst-${burst.evaluationDate}-${safeSub}-${Date.now()}.html`,
        dryRun,
      });

      if (!dryRun) {
        await recordBurstAlertAudit(burst, recipientInfo.recipients, recipientInfo.usedFallback, emailResult);
        if (emailResult.sent) emailsSent++;
        else failedCount++;
      }

      results.push({
        burst,
        recipients: recipientInfo.recipients,
        usedFallback: recipientInfo.usedFallback,
        emailResult,
      });
    } catch (err: any) {
      failedCount++;
      results.push({
        burst,
        recipients: recipientInfo.recipients,
        usedFallback: recipientInfo.usedFallback,
        emailResult: {
          sent: false,
          previewed: false,
          transport: 'preview',
          recipients: recipientInfo.recipients,
          subject,
          previewPath: '',
          error: err?.message || String(err),
        },
      });
    }
  }

  return {
    evaluationDate,
    previousMonth,
    subscriptionsEvaluated,
    burstsDetected: bursts.length,
    emailsSent,
    skippedAlreadySent,
    skippedNoRecipients,
    failedCount,
    results,
  };
}
