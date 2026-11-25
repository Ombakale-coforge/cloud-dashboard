import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { ClientSecretCredential } from '@azure/identity';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { prisma } from '../db.ts';
import { ensureAlertTablesExist } from '../db-alert-tables.ts';
import { DEMO_GCP_PROJECTS, getBigQueryClient, resolveBillingTable } from '../routes/gcp.ts';
import { recordEmailAudit } from '../../logging/auditLogger.ts';
import { convertAzureInrToUsd, getAzureUsdToInrRate } from '../../utils/azureCurrency.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');
const LOG_DIR = path.resolve(__dirname, '../../alerts/logs');
const FALLBACK_JSON_PATH = path.resolve(ROOT_DIR, 'data', 'cloud_account_budgets.json');

export type CloudProvider = 'aws' | 'azure' | 'gcp';
export type AccountBudgetThreshold = '50%' | '75%' | '100%' | 'OVER_BUDGET';
export type AccountBudgetStatus = 'NORMAL' | 'NEAR_50' | 'NEAR_75' | 'AT_100' | 'OVER_BUDGET';

export interface TopServiceCost {
  service: string;
  cost: number;
}

export interface CloudAccountUsageInfo {
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  parentAccountName?: string | null;
  status: string;
  evaluationMonth: string;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  billingCurrency: 'USD' | 'INR';
  conversionRate?: number;
  currentSpendUsd?: number;
  topCostDriver: string;
  topServices: TopServiceCost[];
}

export interface StoredAccountBudget {
  id: number;
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId: string | null;
  monthlyBudget: number;
  billingCurrency: 'USD' | 'INR';
  alertEmail: string;
  alertEmails: string[];
  contactName: string | null;
  isActive: boolean;
  lastNotifiedThreshold: AccountBudgetThreshold | null;
  lastNotifiedMonth: string | null;
  lastNotifiedAt: string | null;
  lastManualEmailAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetEvaluationResult {
  percentUsed: number;
  remainingBudget: number;
  overBudgetAmount: number;
  status: AccountBudgetStatus;
  thresholdCrossed: AccountBudgetThreshold | null;
  rank: number;
}

export interface EnrichedAccountBudget extends StoredAccountBudget, BudgetEvaluationResult {
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  evaluationMonth: string;
  topCostDriver: string;
  topServices: TopServiceCost[];
  nativeCurrency: 'USD' | 'INR';
}

export interface UpsertAccountBudgetInput {
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  monthlyBudget: number;
  billingCurrency?: 'USD' | 'INR';
  alertEmail: string | string[];
  contactName?: string | null;
  isActive?: boolean;
}

export interface EmailDeliveryResult {
  sent: boolean;
  previewed: boolean;
  transport: 'graph' | 'smtp' | 'preview';
  recipients: string[];
  subject: string;
  messageId?: string;
  previewPath: string;
  error?: string;
}

const THRESHOLD_RANK: Record<string, number> = {
  '50%': 1,
  '75%': 2,
  '100%': 3,
  OVER_BUDGET: 4,
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getPreviousMonth(monthStr: string): string {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) return '';
  const [y, m] = monthStr.split('-').map((v) => parseInt(v, 10));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailList(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[;,\s]+/);
  const deduped = new Set<string>();
  for (const part of parts) {
    const cleaned = String(part || '').trim().toLowerCase();
    if (cleaned && EMAIL_REGEX.test(cleaned)) {
      deduped.add(cleaned);
    }
  }
  return Array.from(deduped);
}

export function computeBudgetEvaluation(currentSpend: number, monthlyBudget: number): BudgetEvaluationResult {
  const spend = Number(currentSpend) || 0;
  const limit = Number(monthlyBudget) > 0 ? Number(monthlyBudget) : 1;
  const rawPct = (spend / limit) * 100;
  const percentUsed = Math.round(rawPct * 10) / 10;
  const remainingBudget = round2(Math.max(0, limit - spend));
  const overBudgetAmount = round2(Math.max(0, spend - limit));

  let status: AccountBudgetStatus = 'NORMAL';
  let thresholdCrossed: AccountBudgetThreshold | null = null;
  let rank = 0;

  if (percentUsed > 100 || spend - limit >= 0.01) {
    status = 'OVER_BUDGET';
    thresholdCrossed = 'OVER_BUDGET';
    rank = 4;
  } else if (percentUsed >= 100 || Math.abs(percentUsed - 100) < 0.05) {
    status = 'AT_100';
    thresholdCrossed = '100%';
    rank = 3;
  } else if (percentUsed >= 75) {
    status = 'NEAR_75';
    thresholdCrossed = '75%';
    rank = 2;
  } else if (percentUsed >= 50) {
    status = 'NEAR_50';
    thresholdCrossed = '50%';
    rank = 1;
  }

  return {
    percentUsed,
    remainingBudget,
    overBudgetAmount,
    status,
    thresholdCrossed,
    rank,
  };
}

export function shouldSendThresholdAlert(
  thresholdCrossed: AccountBudgetThreshold | null,
  evaluationMonth: string,
  lastNotifiedThreshold?: string | null,
  lastNotifiedMonth?: string | null
): boolean {
  if (!thresholdCrossed) return false;
  if (!lastNotifiedMonth || lastNotifiedMonth !== evaluationMonth) {
    return true;
  }
  const currentRank = THRESHOLD_RANK[thresholdCrossed] || 0;
  const prevRank = THRESHOLD_RANK[lastNotifiedThreshold || ''] || 0;
  return currentRank > prevRank;
}

function convertAmountToTargetCurrency(
  amount: number,
  sourceCurrency: 'USD' | 'INR',
  targetCurrency: 'USD' | 'INR',
  conversionRate = getAzureUsdToInrRate()
): number {
  if (sourceCurrency === targetCurrency) return round2(amount);
  const rate = conversionRate > 1 ? conversionRate : getAzureUsdToInrRate();
  if (sourceCurrency === 'INR' && targetCurrency === 'USD') {
    return round2(amount / rate);
  }
  if (sourceCurrency === 'USD' && targetCurrency === 'INR') {
    return round2(amount * rate);
  }
  return round2(amount);
}

// ────────────────────────────────────────────────────────────────────────────
// Multi-Cloud Usage Resolution (AWS, Azure, GCP)
// ────────────────────────────────────────────────────────────────────────────

function formatAwsRootName(name: string, configId: string, awsAccountId?: string | null): string {
  const cleanId = (awsAccountId || '').replace(/[^0-9]/g, '');
  let accName = (name || '').replace(/\s*\([^)]+\)/, '').replace(/\s*\(Primary\)|\s*\(Secondary\)/gi, '').trim();
  if (cleanId === '513167803309' || configId === 'account-2') accName = 'AWS-Coforge';
  else if (cleanId === '507672385186' || configId === 'account-1') accName = 'AWS-Encora';
  return awsAccountId ? `${accName} (${awsAccountId})` : accName || configId;
}

async function resolveAwsAccountsUsage(targetMonth?: string): Promise<CloudAccountUsageInfo[]> {
  const results: CloudAccountUsageInfo[] = [];
  const seenAccountIds = new Set<string>();

  if (prisma) {
    try {
      const awsAccounts = await prisma.awsAccount.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' },
      });

      for (const account of awsAccounts) {
        let run = await prisma.awsReportRun.findFirst({
          where: { accountId: account.id, status: 'success' },
          orderBy: { id: 'desc' },
        });
        if (!run) {
          run = await prisma.awsReportRun.findFirst({
            where: { accountId: account.id },
            orderBy: { id: 'desc' },
          });
        }
        if (!run) continue;

        const effectiveMonth =
          targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)
            ? targetMonth
            : run.currentMonth || new Date().toISOString().slice(0, 7);
        const prevMonth = getPreviousMonth(effectiveMonth);
        const monthsToFetch = prevMonth ? [effectiveMonth, prevMonth] : [effectiveMonth];

        const [linkedAccounts, costRecords, unbudgetedList] = await Promise.all([
          prisma.awsLinkedAccount.findMany({
            where: { accountId: account.id },
            orderBy: { name: 'asc' },
          }),
          prisma.awsCostByLinkedAccount.findMany({
            where: { reportRunId: run.id, month: { in: monthsToFetch } },
          }),
          prisma.awsUnbudgetedAccount.findMany({ where: { reportRunId: run.id } }),
        ]);

        const costMap: Record<string, { current: number; previous: number }> = {};
        for (const c of costRecords) {
          if (!costMap[c.linkedAccount]) costMap[c.linkedAccount] = { current: 0, previous: 0 };
          if (c.month === effectiveMonth) costMap[c.linkedAccount].current = Number(c.cost);
          else if (c.month === prevMonth) costMap[c.linkedAccount].previous = Number(c.cost);
        }

        const unbudgetedMap = new Map(unbudgetedList.map((u) => [u.awsAccountId, u]));
        const parentDisplay = formatAwsRootName(account.name, account.configId, account.awsAccountId);

        const allIds = new Set<string>();
        linkedAccounts.forEach((la) => allIds.add(la.linkedAccountId));
        Object.keys(costMap).forEach((k) => allIds.add(k));

        for (const rawId of allIds) {
          const dir = linkedAccounts.find((la) => la.linkedAccountId === rawId || la.name === rawId);
          const cleanId = dir ? dir.linkedAccountId : rawId;
          if (seenAccountIds.has(cleanId)) continue;
          seenAccountIds.add(cleanId);

          const name = dir?.name || unbudgetedMap.get(cleanId)?.accountName || cleanId;
          const status = dir?.status || unbudgetedMap.get(cleanId)?.status || 'ACTIVE';
          const costs = costMap[cleanId] || costMap[name] || { current: 0, previous: 0 };
          const currentSpend = round2(costs.current);
          const previousSpend = round2(costs.previous);
          const momChangePercent =
            previousSpend > 0 ? Number((((currentSpend - previousSpend) / previousSpend) * 100).toFixed(1)) : 0;
          const topDriver =
            unbudgetedMap.get(cleanId)?.topCostDriver ||
            (currentSpend === 0 ? 'No usage recorded' : 'Cloud Infrastructure');

          results.push({
            cloudProvider: 'aws',
            accountId: cleanId,
            accountName: name,
            parentAccountId: account.configId,
            parentAccountName: parentDisplay,
            status,
            evaluationMonth: effectiveMonth,
            currentSpend,
            previousSpend,
            momChangePercent,
            billingCurrency: 'USD',
            conversionRate: getAzureUsdToInrRate(),
            currentSpendUsd: currentSpend,
            topCostDriver: topDriver,
            topServices: [],
          });
        }
      }
    } catch (err: any) {
      console.warn('[AccountBudgetService] AWS DB query failed:', err.message);
    }
  }

  // Fallback to CSV if DB returned nothing
  if (results.length === 0) {
    const csvCandidates = [
      { configId: 'account-1', csvPath: path.join(ROOT_DIR, 'AWSReports', 'latest', 'cost_by_linked_account.csv') },
      { configId: 'account-2', csvPath: path.join(ROOT_DIR, 'AWSReports', 'accounts', 'account-2', 'latest', 'cost_by_linked_account.csv') },
    ];
    for (const candidate of csvCandidates) {
      if (!fs.existsSync(candidate.csvPath)) continue;
      try {
        const lines = fs.readFileSync(candidate.csvPath, 'utf-8').trim().split(/\r?\n/).slice(1);
        for (const line of lines) {
          const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
          if (parts.length < 2) continue;
          const name = parts[0];
          const cost = Number(parts[1]) || 0;
          if (!name || seenAccountIds.has(name)) continue;
          seenAccountIds.add(name);
          results.push({
            cloudProvider: 'aws',
            accountId: name,
            accountName: name,
            parentAccountId: candidate.configId,
            parentAccountName: candidate.configId,
            status: 'ACTIVE',
            evaluationMonth: targetMonth || new Date().toISOString().slice(0, 7),
            currentSpend: round2(cost),
            previousSpend: 0,
            momChangePercent: 0,
            billingCurrency: 'USD',
            conversionRate: getAzureUsdToInrRate(),
            currentSpendUsd: round2(cost),
            topCostDriver: 'Cloud Infrastructure',
            topServices: [],
          });
        }
      } catch {
        // ignore fallback read failure
      }
    }
  }

  return results.sort((a, b) => b.currentSpend - a.currentSpend);
}

async function resolveAzureAccountsUsage(targetMonth?: string): Promise<CloudAccountUsageInfo[]> {
  let records: Array<{ month: string; subscription: string; cost: number }> = [];
  let budgets: Array<{ subscriptionId: string; subscriptionName?: string | null; status: string }> = [];

  if (prisma) {
    try {
      let latestRun = await prisma.azureReportRun.findFirst({
        where: { status: 'success' },
        orderBy: { id: 'desc' },
      });
      if (!latestRun) {
        latestRun = await prisma.azureReportRun.findFirst({ orderBy: { id: 'desc' } });
      }
      if (latestRun) {
        const [subRecords, subBudgets] = await Promise.all([
          prisma.azureReportBySubscription.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { cost: 'desc' },
          }),
          prisma.azureSubscriptionBudget.findMany(),
        ]);
        records = subRecords.map((r) => ({ month: r.month, subscription: r.subscription, cost: Number(r.cost) }));
        budgets = subBudgets;
      }
    } catch (err: any) {
      console.warn('[AccountBudgetService] Azure report DB query failed:', err.message);
    }
  }

  if (records.length === 0) {
    const csvPath = path.join(ROOT_DIR, 'AzureUsageReports', 'latest', 'azure_usage_by_subscription.csv');
    if (fs.existsSync(csvPath)) {
      const content = fs.readFileSync(csvPath, 'utf-8');
      const lines = content.trim().split(/\r?\n/).slice(1);
      for (const line of lines) {
        const [m, s, c] = line.split(',');
        if (m && s && c) {
          records.push({ month: m.trim(), subscription: s.trim(), cost: parseFloat(c.trim()) || 0 });
        }
      }
    }
  }

  const availableMonths = [...new Set(records.map((r) => r.month))].sort();
  const effectiveMonth =
    targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)
      ? targetMonth
      : availableMonths[availableMonths.length - 1] || new Date().toISOString().slice(0, 7);
  const prevMonth = getPreviousMonth(effectiveMonth);

  const subNames = [...new Set(records.map((r) => r.subscription))];
  const budgetMap = new Map(budgets.map((b) => [(b.subscriptionName || b.subscriptionId).toLowerCase(), b]));

  for (const b of budgets) {
    const bName = b.subscriptionName || b.subscriptionId;
    if (bName && !subNames.some((n) => n.toLowerCase() === bName.toLowerCase())) {
      subNames.push(bName);
    }
  }

  const defaultGuid = '264a9a65-67ad-4a39-b124-c41d21aee101';

  const accounts: CloudAccountUsageInfo[] = subNames.map((name, idx) => {
    const currRec = records.find((r) => r.subscription === name && r.month === effectiveMonth);
    const prevRec = records.find((r) => r.subscription === name && r.month === prevMonth);
    const currentSpend = round2(currRec ? currRec.cost : 0);
    const previousSpend = round2(prevRec ? prevRec.cost : 0);
    const momChangePercent =
      previousSpend > 0 ? Number((((currentSpend - previousSpend) / previousSpend) * 100).toFixed(1)) : 0;

    const matchedBudget = budgetMap.get(name.toLowerCase());
    const subId = matchedBudget?.subscriptionId || (idx === 0 ? defaultGuid : `sub-${idx + 1}`);

    return {
      cloudProvider: 'azure',
      accountId: subId,
      accountName: name,
      parentAccountId: 'azure-root',
      parentAccountName: 'Coforge Limited (EnterpriseMaster)',
      status: 'ACTIVE',
      evaluationMonth: effectiveMonth,
      currentSpend,
      previousSpend,
      momChangePercent,
      billingCurrency: 'INR',
      conversionRate: getAzureUsdToInrRate(),
      currentSpendUsd: round2(currentSpend / getAzureUsdToInrRate()),
      topCostDriver: currentSpend === 0 ? 'No usage recorded' : 'Azure Infrastructure',
      topServices: [],
    };
  });

  return accounts.sort((a, b) => b.currentSpend - a.currentSpend);
}

async function resolveGcpAccountsUsage(targetMonth?: string): Promise<CloudAccountUsageInfo[]> {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const anchorQuery =
        targetMonth && /^\d{4}-\d{2}$/.test(targetMonth)
          ? `SELECT DATE '${targetMonth}-01' as curr_date`
          : `SELECT DATE(TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH)) as curr_date FROM \`${dataset}.${table}\``;

      const query = `
        WITH target_date AS (
          ${anchorQuery}
        ),
        target_bounds AS (
          SELECT
            TIMESTAMP(curr_date) as curr_start,
            TIMESTAMP(DATE_ADD(curr_date, INTERVAL 1 MONTH)) as curr_end,
            TIMESTAMP(DATE_SUB(curr_date, INTERVAL 1 MONTH)) as prev_start
          FROM target_date
        ),
        project_monthly AS (
          SELECT
            COALESCE(project.id, 'unassigned') as projectId,
            COALESCE(project.name, project.id, 'Unassigned / Global') as projectName,
            SUM(CASE WHEN usage_start_time >= tb.curr_start AND usage_start_time < tb.curr_end THEN cost ELSE 0 END) as currentSpend,
            SUM(CASE WHEN usage_start_time >= tb.prev_start AND usage_start_time < tb.curr_start THEN cost ELSE 0 END) as previousSpend,
            ANY_VALUE(currency) as currency,
            AVG(currency_conversion_rate) as conversionRate,
            FORMAT_TIMESTAMP('%Y-%m', ANY_VALUE(tb.curr_start)) as evalMonth,
            ANY_VALUE((
              SELECT STRING_AGG(display_name, ', ')
              FROM UNNEST(project.ancestors)
              WHERE resource_name LIKE 'folders/%'
            )) as folderName
          FROM \`${dataset}.${table}\`, target_bounds tb
          WHERE usage_start_time >= tb.prev_start AND usage_start_time < tb.curr_end
          GROUP BY 1, 2
        ),
        project_services AS (
          SELECT
            COALESCE(project.id, 'unassigned') as projectId,
            COALESCE(service.description, 'GCP Service') as serviceName,
            SUM(cost) as serviceCost
          FROM \`${dataset}.${table}\`, target_bounds tb
          WHERE usage_start_time >= tb.curr_start AND usage_start_time < tb.curr_end
          GROUP BY 1, 2
        ),
        project_top_services AS (
          SELECT
            projectId,
            ARRAY_AGG(STRUCT(serviceName as service, serviceCost as cost) ORDER BY serviceCost DESC LIMIT 5) as topServices
          FROM project_services
          GROUP BY projectId
        )
        SELECT
          pm.*,
          pts.topServices
        FROM project_monthly pm
        LEFT JOIN project_top_services pts ON pts.projectId = pm.projectId
        ORDER BY pm.currentSpend DESC
        LIMIT 50
      `;

      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        return rows.map((r: any, idx: number) => {
          const currentSpend = round2(Number(r.currentSpend) || 0);
          const previousSpend = round2(Number(r.previousSpend) || 0);
          const convRate = Number(r.conversionRate) || 95.0;
          const momChangePercent =
            previousSpend > 0 ? Number((((currentSpend - previousSpend) / previousSpend) * 100).toFixed(1)) : 0;
          const projectId = r.projectId || `gcp-project-${idx + 1}`;
          const name =
            projectId === process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_NAME
              ? process.env.GCP_PROJECT_NAME
              : r.projectName || projectId;
          const topServices: TopServiceCost[] = Array.isArray(r.topServices)
            ? r.topServices.map((s: any) => ({
                service: String(s.service || 'GCP Service'),
                cost: round2(Number(s.cost) || 0),
              }))
            : [];
          const currency = String(r.currency || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR';

          return {
            cloudProvider: 'gcp',
            accountId: projectId,
            accountName: name,
            parentAccountId: r.folderName || 'Global / Root',
            parentAccountName: r.folderName || 'GCP Organization',
            status: 'ACTIVE',
            evaluationMonth: r.evalMonth || targetMonth || new Date().toISOString().slice(0, 7),
            currentSpend,
            previousSpend,
            momChangePercent,
            billingCurrency: currency,
            conversionRate: convRate,
            currentSpendUsd: currency === 'USD' ? currentSpend : round2(currentSpend / convRate),
            topCostDriver: topServices[0]?.service || 'Google Cloud Platform',
            topServices,
          };
        });
      }
    } catch (err: any) {
      console.warn('[AccountBudgetService] GCP BigQuery query failed, falling back to demo projects:', err.message);
    }
  }

  return DEMO_GCP_PROJECTS.map((p) => {
    const services = (p.activeServices || []).map((svc, idx) => ({
      service: svc,
      cost: round2(p.currentSpend * (idx === 0 ? 0.5 : 0.5 / Math.max(1, (p.activeServices?.length || 2) - 1))),
    }));
    return {
      cloudProvider: 'gcp',
      accountId: p.projectId,
      accountName: p.name,
      parentAccountId: 'Global / Root',
      parentAccountName: 'GCP Organization',
      status: 'ACTIVE',
      evaluationMonth: targetMonth || new Date().toISOString().slice(0, 7),
      currentSpend: round2(p.currentSpend),
      previousSpend: round2(p.currentSpend * 0.92),
      momChangePercent: 8.7,
      billingCurrency: 'USD',
      conversionRate: 1,
      currentSpendUsd: round2(p.currentSpend),
      topCostDriver: services[0]?.service || 'Compute Engine',
      topServices: services,
    };
  });
}

const USAGE_CACHE_TTL_MS = 60_000;
const usageCache = new Map<
  string,
  { expiresAt: number; data?: CloudAccountUsageInfo[]; inflight?: Promise<CloudAccountUsageInfo[]> }
>();

export async function getCloudAccountsUsage(
  filterProvider: string = 'all',
  targetMonth?: string
): Promise<CloudAccountUsageInfo[]> {
  const normalized = (filterProvider || 'all').toLowerCase();
  const monthKey = targetMonth || 'latest';
  const cacheKey = `${normalized}:${monthKey}`;
  const now = Date.now();

  const existing = usageCache.get(cacheKey);
  if (existing?.data && existing.expiresAt > now) {
    return existing.data;
  }
  if (existing?.inflight) {
    return existing.inflight;
  }

  if (normalized !== 'all') {
    const allEntry = usageCache.get(`all:${monthKey}`);
    if (allEntry?.data && allEntry.expiresAt > now) {
      return allEntry.data.filter((a) => a.cloudProvider === normalized);
    }
    if (allEntry?.inflight) {
      const allData = await allEntry.inflight;
      return allData.filter((a) => a.cloudProvider === normalized);
    }
  }

  const tasks: Promise<CloudAccountUsageInfo[]>[] = [];
  if (normalized === 'all' || normalized === 'aws') {
    tasks.push(resolveAwsAccountsUsage(targetMonth));
  }
  if (normalized === 'all' || normalized === 'azure') {
    tasks.push(resolveAzureAccountsUsage(targetMonth));
  }
  if (normalized === 'all' || normalized === 'gcp') {
    tasks.push(resolveGcpAccountsUsage(targetMonth));
  }

  const inflight = Promise.all(tasks)
    .then((chunks) => {
      const data = chunks.flat();
      usageCache.set(cacheKey, { expiresAt: Date.now() + USAGE_CACHE_TTL_MS, data });
      return data;
    })
    .catch((err) => {
      usageCache.delete(cacheKey);
      throw err;
    });

  usageCache.set(cacheKey, { expiresAt: 0, inflight });
  return inflight;
}

// ────────────────────────────────────────────────────────────────────────────
// Persistence Layer (SQL Server with JSON File Fallback)
// ────────────────────────────────────────────────────────────────────────────

function mapDbRowToStoredBudget(row: any): StoredAccountBudget {
  const rawEmail = String(row.alert_email ?? row.alertEmail ?? '');
  const alertEmails = normalizeEmailList(rawEmail);
  return {
    id: Number(row.id),
    cloudProvider: String(row.cloud_provider ?? row.cloudProvider).toLowerCase() as CloudProvider,
    accountId: String(row.account_id ?? row.accountId),
    accountName: String(row.account_name ?? row.accountName),
    parentAccountId: row.parent_account_id ?? row.parentAccountId ?? null,
    monthlyBudget: Number(row.monthly_budget ?? row.monthlyBudget),
    billingCurrency: (String(row.billing_currency ?? row.billingCurrency ?? 'USD').toUpperCase() === 'INR'
      ? 'INR'
      : 'USD') as 'USD' | 'INR',
    alertEmail: alertEmails.length > 0 ? alertEmails.join(', ') : rawEmail,
    alertEmails,
    contactName: row.contact_name ?? row.contactName ?? null,
    isActive: Boolean(row.is_active ?? row.isActive ?? true),
    lastNotifiedThreshold: (row.last_notified_threshold ?? row.lastNotifiedThreshold ?? null) as
      | AccountBudgetThreshold
      | null,
    lastNotifiedMonth: row.last_notified_month ?? row.lastNotifiedMonth ?? null,
    lastNotifiedAt: row.last_notified_at
      ? new Date(row.last_notified_at).toISOString()
      : row.lastNotifiedAt
      ? new Date(row.lastNotifiedAt).toISOString()
      : null,
    lastManualEmailAt: row.last_manual_email_at
      ? new Date(row.last_manual_email_at).toISOString()
      : row.lastManualEmailAt
      ? new Date(row.lastManualEmailAt).toISOString()
      : null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : row.createdAt
      ? new Date(row.createdAt).toISOString()
      : new Date().toISOString(),
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : row.updatedAt
      ? new Date(row.updatedAt).toISOString()
      : new Date().toISOString(),
  };
}

function readFallbackBudgets(): StoredAccountBudget[] {
  try {
    if (!fs.existsSync(FALLBACK_JSON_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(FALLBACK_JSON_PATH, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: any) => {
      const alertEmails = normalizeEmailList(item.alertEmails ?? item.alertEmail);
      return {
        ...item,
        alertEmail: alertEmails.length > 0 ? alertEmails.join(', ') : String(item.alertEmail || ''),
        alertEmails,
      };
    });
  } catch {
    return [];
  }
}

function writeFallbackBudgets(items: StoredAccountBudget[]): void {
  const dir = path.dirname(FALLBACK_JSON_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FALLBACK_JSON_PATH, JSON.stringify(items, null, 2), 'utf-8');
}

export async function listRawBudgets(filterProvider: string = 'all'): Promise<StoredAccountBudget[]> {
  const normalized = (filterProvider || 'all').toLowerCase();

  if (prisma) {
    try {
      await ensureAlertTablesExist(prisma);
      const rows: any[] =
        normalized === 'all'
          ? await prisma.$queryRaw`
              SELECT * FROM [dbo].[cloud_account_budgets]
              ORDER BY [updated_at] DESC, [id] DESC
            `
          : await prisma.$queryRaw`
              SELECT * FROM [dbo].[cloud_account_budgets]
              WHERE [cloud_provider] = ${normalized}
              ORDER BY [updated_at] DESC, [id] DESC
            `;
      return rows.map(mapDbRowToStoredBudget);
    } catch (err: any) {
      console.warn('[AccountBudgetService] DB listRawBudgets failed, using JSON fallback:', err.message);
    }
  }

  const all = readFallbackBudgets();
  return normalized === 'all' ? all : all.filter((b) => b.cloudProvider === normalized);
}

export async function upsertBudget(input: UpsertAccountBudgetInput): Promise<StoredAccountBudget> {
  const provider = input.cloudProvider.toLowerCase() as CloudProvider;
  const accountId = input.accountId.trim();
  const accountName = input.accountName.trim();
  const parentAccountId = input.parentAccountId ? String(input.parentAccountId).trim() : null;
  const monthlyBudget = round2(Number(input.monthlyBudget));
  const billingCurrency = input.billingCurrency || 'USD';
  const alertEmails = normalizeEmailList(input.alertEmail);
  const alertEmail = alertEmails.join(', ');
  const contactName = input.contactName ? input.contactName.trim() : null;
  const isActive = input.isActive !== undefined ? Boolean(input.isActive) : true;

  if (prisma) {
    try {
      await ensureAlertTablesExist(prisma);
      const existing: any[] = await prisma.$queryRaw`
        SELECT TOP 1 * FROM [dbo].[cloud_account_budgets]
        WHERE [cloud_provider] = ${provider} AND [account_id] = ${accountId}
      `;

      if (existing.length > 0) {
        const existingId = Number(existing[0].id);
        const existingAmount = Number(existing[0].monthly_budget ?? 0);
        const budgetChanged = Math.abs(existingAmount - monthlyBudget) > 0.01;
        await prisma.$executeRaw`
          UPDATE [dbo].[cloud_account_budgets]
          SET
            [account_name] = ${accountName},
            [parent_account_id] = ${parentAccountId},
            [monthly_budget] = ${monthlyBudget},
            [billing_currency] = ${billingCurrency},
            [alert_email] = ${alertEmail},
            [contact_name] = ${contactName},
            [is_active] = ${isActive ? 1 : 0},
            [last_notified_threshold] = ${budgetChanged ? null : existing[0].last_notified_threshold},
            [last_notified_month] = ${budgetChanged ? null : existing[0].last_notified_month},
            [last_notified_at] = ${budgetChanged ? null : existing[0].last_notified_at},
            [updated_at] = SYSUTCDATETIME()
          WHERE [id] = ${existingId}
        `;
        const updated: any[] = await prisma.$queryRaw`
          SELECT TOP 1 * FROM [dbo].[cloud_account_budgets] WHERE [id] = ${existingId}
        `;
        return mapDbRowToStoredBudget(updated[0]);
      } else {
        await prisma.$executeRaw`
          INSERT INTO [dbo].[cloud_account_budgets] (
            [cloud_provider],
            [account_id],
            [account_name],
            [parent_account_id],
            [monthly_budget],
            [billing_currency],
            [alert_email],
            [contact_name],
            [is_active]
          )
          VALUES (
            ${provider},
            ${accountId},
            ${accountName},
            ${parentAccountId},
            ${monthlyBudget},
            ${billingCurrency},
            ${alertEmail},
            ${contactName},
            ${isActive ? 1 : 0}
          )
        `;
        const inserted: any[] = await prisma.$queryRaw`
          SELECT TOP 1 * FROM [dbo].[cloud_account_budgets]
          WHERE [cloud_provider] = ${provider} AND [account_id] = ${accountId}
        `;
        return mapDbRowToStoredBudget(inserted[0]);
      }
    } catch (err: any) {
      console.warn('[AccountBudgetService] DB upsertBudget failed, using JSON fallback:', err.message);
    }
  }

  const all = readFallbackBudgets();
  const idx = all.findIndex((b) => b.cloudProvider === provider && b.accountId === accountId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    const budgetChanged = Math.abs(all[idx].monthlyBudget - monthlyBudget) > 0.01;
    all[idx] = {
      ...all[idx],
      accountName,
      parentAccountId,
      monthlyBudget,
      billingCurrency,
      alertEmail,
      alertEmails,
      contactName,
      isActive,
      lastNotifiedThreshold: budgetChanged ? null : all[idx].lastNotifiedThreshold,
      lastNotifiedMonth: budgetChanged ? null : all[idx].lastNotifiedMonth,
      lastNotifiedAt: budgetChanged ? null : all[idx].lastNotifiedAt,
      updatedAt: now,
    };
    writeFallbackBudgets(all);
    return all[idx];
  } else {
    const nextId = all.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const created: StoredAccountBudget = {
      id: nextId,
      cloudProvider: provider,
      accountId,
      accountName,
      parentAccountId,
      monthlyBudget,
      billingCurrency,
      alertEmail,
      alertEmails,
      contactName,
      isActive,
      lastNotifiedThreshold: null,
      lastNotifiedMonth: null,
      lastNotifiedAt: null,
      lastManualEmailAt: null,
      createdAt: now,
      updatedAt: now,
    };
    all.unshift(created);
    writeFallbackBudgets(all);
    return created;
  }
}

export async function deleteBudget(id: number): Promise<boolean> {
  if (prisma) {
    try {
      await ensureAlertTablesExist(prisma);
      const affected = await prisma.$executeRaw`
        DELETE FROM [dbo].[cloud_account_budgets] WHERE [id] = ${id}
      `;
      return Number(affected) > 0;
    } catch (err: any) {
      console.warn('[AccountBudgetService] DB deleteBudget failed, using JSON fallback:', err.message);
    }
  }

  const all = readFallbackBudgets();
  const next = all.filter((b) => b.id !== id);
  if (next.length === all.length) return false;
  writeFallbackBudgets(next);
  return true;
}

export async function markThresholdNotified(
  id: number,
  threshold: AccountBudgetThreshold,
  month: string
): Promise<void> {
  if (prisma) {
    try {
      await ensureAlertTablesExist(prisma);
      await prisma.$executeRaw`
        UPDATE [dbo].[cloud_account_budgets]
        SET
          [last_notified_threshold] = ${threshold},
          [last_notified_month] = ${month},
          [last_notified_at] = SYSUTCDATETIME(),
          [updated_at] = SYSUTCDATETIME()
        WHERE [id] = ${id}
      `;
      return;
    } catch (err: any) {
      console.warn('[AccountBudgetService] DB markThresholdNotified failed:', err.message);
    }
  }

  const all = readFallbackBudgets();
  const item = all.find((b) => b.id === id);
  if (item) {
    const now = new Date().toISOString();
    item.lastNotifiedThreshold = threshold;
    item.lastNotifiedMonth = month;
    item.lastNotifiedAt = now;
    item.updatedAt = now;
    writeFallbackBudgets(all);
  }
}

export async function markManualEmailSent(id: number): Promise<void> {
  if (prisma) {
    try {
      await ensureAlertTablesExist(prisma);
      await prisma.$executeRaw`
        UPDATE [dbo].[cloud_account_budgets]
        SET
          [last_manual_email_at] = SYSUTCDATETIME(),
          [updated_at] = SYSUTCDATETIME()
        WHERE [id] = ${id}
      `;
      return;
    } catch (err: any) {
      console.warn('[AccountBudgetService] DB markManualEmailSent failed:', err.message);
    }
  }

  const all = readFallbackBudgets();
  const item = all.find((b) => b.id === id);
  if (item) {
    const now = new Date().toISOString();
    item.lastManualEmailAt = now;
    item.updatedAt = now;
    writeFallbackBudgets(all);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Enrichment: Combine Saved Budgets with Live Multi-Cloud Usage
// ────────────────────────────────────────────────────────────────────────────

export function matchAccountUsage(
  budget: Pick<StoredAccountBudget, 'cloudProvider' | 'accountId' | 'accountName'>,
  usageList: CloudAccountUsageInfo[]
): CloudAccountUsageInfo | undefined {
  const candidates = usageList.filter((u) => u.cloudProvider === budget.cloudProvider);
  const bId = budget.accountId.trim().toLowerCase();
  const bName = budget.accountName.trim().toLowerCase();

  return (
    candidates.find((u) => u.accountId.trim().toLowerCase() === bId) ||
    candidates.find((u) => u.accountName.trim().toLowerCase() === bName) ||
    candidates.find((u) => u.accountName.trim().toLowerCase() === bId) ||
    candidates.find((u) => u.accountId.trim().toLowerCase() === bName)
  );
}

export function enrichBudgetWithUsage(
  budget: StoredAccountBudget,
  usage?: CloudAccountUsageInfo,
  fallbackMonth?: string
): EnrichedAccountBudget {
  const nativeCurrency: 'USD' | 'INR' =
    usage?.billingCurrency || (budget.billingCurrency === 'INR' ? 'INR' : 'USD');
  const convRate = usage?.conversionRate || getAzureUsdToInrRate();

  const rawCurrentSpend = usage ? usage.currentSpend : 0;
  const rawPreviousSpend = usage ? usage.previousSpend : 0;

  const currentSpend =
    nativeCurrency === budget.billingCurrency
      ? round2(rawCurrentSpend)
      : budget.billingCurrency === 'USD' && usage?.currentSpendUsd !== undefined
      ? round2(usage.currentSpendUsd)
      : convertAmountToTargetCurrency(rawCurrentSpend, nativeCurrency, budget.billingCurrency, convRate);

  const previousSpend =
    nativeCurrency === budget.billingCurrency
      ? round2(rawPreviousSpend)
      : convertAmountToTargetCurrency(rawPreviousSpend, nativeCurrency, budget.billingCurrency, convRate);

  const evaluation = computeBudgetEvaluation(currentSpend, budget.monthlyBudget);
  const evaluationMonth =
    usage?.evaluationMonth || fallbackMonth || new Date().toISOString().slice(0, 7);

  const topServices = (usage?.topServices || []).map((svc) => ({
    service: svc.service,
    cost:
      nativeCurrency === budget.billingCurrency
        ? round2(svc.cost)
        : convertAmountToTargetCurrency(svc.cost, nativeCurrency, budget.billingCurrency, convRate),
  }));

  return {
    ...budget,
    ...evaluation,
    currentSpend,
    previousSpend,
    momChangePercent: usage?.momChangePercent ?? 0,
    evaluationMonth,
    topCostDriver: usage?.topCostDriver || topServices[0]?.service || 'Cloud Infrastructure',
    topServices,
    nativeCurrency,
  };
}

const ACCOUNT_SERVICE_CACHE_TTL_MS = 300_000;
const accountServiceCache = new Map<
  string,
  { expiresAt: number; services: TopServiceCost[]; inflight?: Promise<TopServiceCost[]> }
>();

function getAwsCredentialsForAccount(configId?: string | null) {
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

async function resolveAwsAccountTopServices(
  accountId: string,
  accountName: string,
  parentAccountId: string | null | undefined,
  evaluationMonth: string
): Promise<TopServiceCost[]> {
  let cleanId = accountId.trim();
  let configId = parentAccountId || null;

  if (prisma && (!/^\d{12}$/.test(cleanId) || !configId)) {
    try {
      const dir = await prisma.awsLinkedAccount.findFirst({
        where: {
          OR: [{ linkedAccountId: cleanId }, { name: accountName }],
        },
        include: { account: true },
      });
      if (dir) {
        if (/^\d{12}$/.test(dir.linkedAccountId)) cleanId = dir.linkedAccountId;
        if (!configId && dir.account?.configId) configId = dir.account.configId;
      }
    } catch {
      // ignore lookup fallback error
    }
  }

  if (!/^\d{12}$/.test(cleanId) || !/^\d{4}-\d{2}$/.test(evaluationMonth)) {
    return [];
  }

  const candidateConfigs = configId ? [configId] : ['account-1', 'account-2'];
  for (const cfg of candidateConfigs) {
    const credentials = getAwsCredentialsForAccount(cfg);
    if (!credentials) continue;
    try {
      const ceClient = new CostExplorerClient({
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
        },
        region: credentials.region,
      });

      const [yearStr, monthStr] = evaluationMonth.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonthDate = new Date(Date.UTC(year, month, 1));
      const endStr = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;

      const res = await ceClient.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: startStr, End: endStr },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          Filter: {
            Dimensions: { Key: 'LINKED_ACCOUNT', Values: [cleanId] },
          },
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
        })
      );

      const groups = res.ResultsByTime?.[0]?.Groups || [];
      const services = groups
        .map((g) => ({
          service: g.Keys?.[0] || 'Unknown AWS Service',
          cost: round2(parseFloat(g.Metrics?.UnblendedCost?.Amount || '0') || 0),
        }))
        .filter((s) => s.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      if (services.length > 0) {
        return services;
      }
    } catch (err: any) {
      console.warn(`[AccountBudgetService] AWS Cost Explorer service query failed for ${cleanId} (${cfg}):`, err.message);
    }
  }

  return [];
}

async function resolveAzureSubscriptionTopServices(
  accountId: string,
  accountName: string,
  evaluationMonth: string
): Promise<TopServiceCost[]> {
  const cleanSubId = accountId.replace(/^\/?subscriptions\//i, '').trim();

  if (prisma && /^\d{4}-\d{2}$/.test(evaluationMonth)) {
    try {
      const dbServices = await prisma.azureUsageRecord.groupBy({
        by: ['service'],
        where: {
          usageMonth: evaluationMonth,
          OR: [
            { subscriptionId: accountId },
            { subscriptionId: cleanSubId },
            { subscriptionName: accountName },
          ],
          isDuplicateOfEarlierRow: false,
          isSupersededByLaterRow: false,
        },
        _sum: { effectiveCost: true, billedCost: true },
      });

      const services = dbServices
        .map((s) => ({
          service: s.service || 'Azure Service',
          cost: round2(Number(s._sum.effectiveCost ?? s._sum.billedCost ?? 0)),
        }))
        .filter((s) => s.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);

      if (services.length > 0) {
        return services;
      }
    } catch (err: any) {
      console.warn(`[AccountBudgetService] Azure subscription service query failed for ${accountName}:`, err.message);
    }
  }

  try {
    const usagePath = path.resolve(ROOT_DIR, 'data', 'azure', 'usage-details.json');
    if (fs.existsSync(usagePath)) {
      const usageData = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
      const normName = accountName.replace(/[\u2010-\u2015]/g, '-').toLowerCase().trim();
      const normId = cleanSubId.replace(/[\u2010-\u2015]/g, '-').toLowerCase().trim();
      const svcMap = new Map<string, number>();

      for (const u of usageData) {
        const dt = String(u.date || u.billingPeriodStartDate || '');
        if (evaluationMonth && !dt.startsWith(evaluationMonth)) continue;
        const uSubId = String(u.subscriptionId || u.SubscriptionId || '').toLowerCase().trim();
        const uSubName = String(u.subscriptionName || u.SubscriptionName || '')
          .replace(/[\u2010-\u2015]/g, '-')
          .toLowerCase()
          .trim();
        const matched =
          (uSubId && (uSubId === normId || uSubId === normName)) ||
          (uSubName && (uSubName === normName || uSubName === normId));
        if (!matched) continue;
        const svc = String(u.consumedService || 'Azure Service');
        svcMap.set(svc, (svcMap.get(svc) || 0) + (Number(u.cost) || 0));
      }

      return Array.from(svcMap.entries())
        .map(([service, cost]) => ({ service, cost: round2(cost) }))
        .filter((s) => s.cost > 0)
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 5);
    }
  } catch {
    // ignore json fallback error
  }

  return [];
}

export async function resolveAccountSpecificTopServices(
  item: EnrichedAccountBudget
): Promise<EnrichedAccountBudget> {
  if (item.topServices && item.topServices.length > 0) {
    return {
      ...item,
      topCostDriver: item.topServices[0].service,
    };
  }

  if (item.currentSpend <= 0) {
    return {
      ...item,
      topServices: [],
      topCostDriver: 'No usage recorded',
    };
  }

  const cacheKey = `${item.cloudProvider}:${item.accountId.toLowerCase()}:${item.evaluationMonth}:${item.billingCurrency}`;
  const now = Date.now();
  const cached = accountServiceCache.get(cacheKey);

  let resolvedServices: TopServiceCost[];
  if (cached && cached.expiresAt > now) {
    resolvedServices = cached.services;
  } else if (cached?.inflight) {
    resolvedServices = await cached.inflight;
  } else {
    const loader = (async (): Promise<TopServiceCost[]> => {
      let nativeServices: TopServiceCost[] = [];
      let nativeCurrency: 'USD' | 'INR' = item.nativeCurrency;

      if (item.cloudProvider === 'aws') {
        nativeCurrency = 'USD';
        nativeServices = await resolveAwsAccountTopServices(
          item.accountId,
          item.accountName,
          item.parentAccountId,
          item.evaluationMonth
        );
      } else if (item.cloudProvider === 'azure') {
        nativeCurrency = 'INR';
        nativeServices = await resolveAzureSubscriptionTopServices(
          item.accountId,
          item.accountName,
          item.evaluationMonth
        );
      }

      return nativeServices.map((s) => ({
        service: s.service,
        cost:
          nativeCurrency === item.billingCurrency
            ? round2(s.cost)
            : convertAmountToTargetCurrency(s.cost, nativeCurrency, item.billingCurrency),
      }));
    })();

    accountServiceCache.set(cacheKey, { expiresAt: 0, services: [], inflight: loader });
    try {
      resolvedServices = await loader;
      accountServiceCache.set(cacheKey, {
        expiresAt: Date.now() + ACCOUNT_SERVICE_CACHE_TTL_MS,
        services: resolvedServices,
      });
    } catch {
      accountServiceCache.delete(cacheKey);
      resolvedServices = [];
    }
  }

  return {
    ...item,
    topServices: resolvedServices,
    topCostDriver: resolvedServices[0]?.service || item.topCostDriver || 'Account usage',
  };
}

export async function getEnrichedBudgets(
  filterProvider: string = 'all',
  targetMonth?: string
): Promise<EnrichedAccountBudget[]> {
  const [rawBudgets, usageList] = await Promise.all([
    listRawBudgets(filterProvider),
    getCloudAccountsUsage(filterProvider, targetMonth),
  ]);

  const enriched = await Promise.all(
    rawBudgets.map((b) => {
      const matched = matchAccountUsage(b, usageList);
      return resolveAccountSpecificTopServices(enrichBudgetWithUsage(b, matched, targetMonth));
    })
  );

  // Highest utilization / breached budgets first
  return enriched.sort((a, b) => b.percentUsed - a.percentUsed);
}

// ────────────────────────────────────────────────────────────────────────────
// Email Formatting & Delivery (Microsoft Graph -> Nodemailer SMTP -> Preview)
// ────────────────────────────────────────────────────────────────────────────

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCurrency(amount: number, currency: 'USD' | 'INR'): string {
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(Number.isFinite(amount) ? amount : 0);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getProviderMeta(provider: CloudProvider): { label: string; color: string; bg: string } {
  switch (provider) {
    case 'aws':
      return { label: 'AWS', color: '#b45309', bg: '#fef3c7' };
    case 'azure':
      return { label: 'Azure', color: '#0369a1', bg: '#e0f2fe' };
    case 'gcp':
      return { label: 'GCP', color: '#1d4ed8', bg: '#dbeafe' };
  }
}

function getThresholdMeta(status: AccountBudgetStatus): {
  badgeText: string;
  accentColor: string;
  softBg: string;
} {
  switch (status) {
    case 'OVER_BUDGET':
      return { badgeText: 'OVER BUDGET (>100%)', accentColor: '#b91c1c', softBg: '#fef2f2' };
    case 'AT_100':
      return { badgeText: '100% BUDGET REACHED', accentColor: '#dc2626', softBg: '#fef2f2' };
    case 'NEAR_75':
      return { badgeText: '75% THRESHOLD REACHED', accentColor: '#d97706', softBg: '#fffbeb' };
    case 'NEAR_50':
      return { badgeText: '50% THRESHOLD REACHED', accentColor: '#2563eb', softBg: '#eff6ff' };
    default:
      return { badgeText: 'HEALTHY (<50%)', accentColor: '#059669', softBg: '#ecfdf5' };
  }
}

function getProjectedMonthEnd(currentSpend: number, evaluationMonth: string): number | null {
  if (!/^\d{4}-\d{2}$/.test(evaluationMonth)) return null;
  const now = new Date();
  const currentUtcMonth = now.toISOString().slice(0, 7);
  if (evaluationMonth !== currentUtcMonth) return null;
  const [y, m] = evaluationMonth.split('-').map((n) => parseInt(n, 10));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const elapsedDays = Math.max(1, now.getUTCDate());
  return round2((currentSpend / elapsedDays) * daysInMonth);
}

export function buildAccountBudgetEmailContent(
  item: EnrichedAccountBudget,
  mode: 'threshold' | 'instant'
): { subject: string; html: string; text: string } {
  const providerMeta = getProviderMeta(item.cloudProvider);
  const thresholdMeta = getThresholdMeta(item.status);
  const hasLimit = item.monthlyBudget > 0;
  const shouldConvertAzureInr =
    item.cloudProvider === 'azure' && item.billingCurrency === 'INR';
  const currency: 'USD' | 'INR' = shouldConvertAzureInr ? 'USD' : item.billingCurrency;
  const toDisplay = (v: number) =>
    shouldConvertAzureInr ? round2(convertAzureInrToUsd(v, 'INR')) : v;

  const currentSpend = toDisplay(item.currentSpend);
  const previousSpend = toDisplay(item.previousSpend);
  const monthlyBudget = toDisplay(item.monthlyBudget);
  const remainingBudget = toDisplay(item.remainingBudget);
  const overBudgetAmount = toDisplay(item.overBudgetAmount);
  const topServices = item.topServices.map((s) => ({
    service: s.service,
    cost: toDisplay(s.cost),
  }));

  const thresholdLabel =
    item.thresholdCrossed === 'OVER_BUDGET'
      ? 'OVER BUDGET'
      : item.thresholdCrossed || `${item.percentUsed.toFixed(1)}%`;

  const subject =
    mode === 'threshold'
      ? `[BUDGET ALERT - ${thresholdLabel}] ${providerMeta.label} Account "${item.accountName}" at ${item.percentUsed.toFixed(1)}% of Monthly Budget`
      : `[USAGE DETAILS] ${providerMeta.label} Account "${item.accountName}" — Spend & Budget Report (${item.evaluationMonth})`;

  const recipientGreeting = item.contactName?.trim()
    ? `Dear ${escapeHtml(item.contactName.trim())},`
    : 'Hello,';

  const introLine =
    mode === 'threshold'
      ? `The ${providerMeta.label} account <strong>${escapeHtml(item.accountName)}</strong> has crossed the <strong>${escapeHtml(thresholdLabel)}</strong> monthly budget threshold.`
      : `Here is the latest cloud cost &amp; budget usage report for ${providerMeta.label} account <strong>${escapeHtml(item.accountName)}</strong> for billing period <strong>${escapeHtml(item.evaluationMonth)}</strong>.`;

  const projectedEom = getProjectedMonthEnd(currentSpend, item.evaluationMonth);
  const momDelta = round2(currentSpend - previousSpend);
  const momSign = item.momChangePercent > 0 ? '+' : '';
  const progressWidth = Math.min(100, Math.max(0, item.percentUsed));

  const milestones = [
    { label: '50% Alert', target: 50, reached: item.percentUsed >= 50 },
    { label: '75% Alert', target: 75, reached: item.percentUsed >= 75 },
    { label: '100% Limit', target: 100, reached: item.percentUsed >= 100 },
    { label: 'Over Budget', target: 100.01, reached: item.status === 'OVER_BUDGET' },
  ];

  const milestoneCells = milestones
    .map((ms) => {
      const bg = ms.reached ? thresholdMeta.softBg : '#f8fafc';
      const border = ms.reached ? thresholdMeta.accentColor : '#e2e8f0';
      const textColor = ms.reached ? thresholdMeta.accentColor : '#64748b';
      const mark = ms.reached ? '&#10003; Reached' : 'Pending';
      return `<td style="width:25%;padding:6px;">
        <div style="border:1px solid ${border};background:${bg};border-radius:8px;padding:8px 6px;text-align:center;">
          <div style="font-size:11px;font-weight:700;color:#0f172a;">${ms.label}</div>
          <div style="font-size:10px;font-weight:700;color:${textColor};margin-top:2px;">${mark}</div>
        </div>
      </td>`;
    })
    .join('');

  const topServicesRows =
    topServices.length > 0
      ? topServices
          .map(
            (s, i) => `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:7px 10px;color:#334155;">${i + 1}. ${escapeHtml(s.service)}</td>
            <td style="padding:7px 10px;text-align:right;font-weight:600;color:#0f172a;">${escapeHtml(formatCurrency(s.cost, currency))}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="2" style="padding:10px;color:#64748b;font-style:italic;">${
          currentSpend <= 0
            ? `No service usage recorded for this account in ${escapeHtml(item.evaluationMonth)}.`
            : `Detailed per-service cost breakdown is unavailable for this account (Primary Cost Driver: <strong>${escapeHtml(item.topCostDriver)}</strong>).`
        }</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
  <div style="max-width:680px;margin:24px auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06);">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:22px 24px;color:#ffffff;">
      <div style="margin-bottom:8px;">
        <span style="display:inline-block;background:${providerMeta.bg};color:${providerMeta.color};font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;margin-right:8px;">${providerMeta.label}</span>
        <span style="display:inline-block;background:${thresholdMeta.accentColor};color:#ffffff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;">${hasLimit ? thresholdMeta.badgeText : 'USAGE SNAPSHOT'}</span>
      </div>
      <h1 style="margin:0;font-size:20px;line-height:1.3;color:#ffffff;">${escapeHtml(item.accountName)}</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#94a3b8;">Account / Subscription ID: <code style="color:#e2e8f0;">${escapeHtml(item.accountId)}</code> &bull; Billing Period: ${escapeHtml(item.evaluationMonth)}</p>
    </div>

    <div style="padding:24px;">
      <p style="margin:0 0 10px;font-size:14px;font-weight:600;color:#0f172a;">${recipientGreeting}</p>
      <p style="margin:0 0 18px;font-size:13.5px;line-height:1.55;color:#334155;">${introLine}</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
        <tr>
          <td style="padding:14px 16px;width:50%;border-right:1px solid #e2e8f0;">
            <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;">Current Month Spend</div>
            <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">${escapeHtml(formatCurrency(currentSpend, currency))}</div>
            <div style="font-size:11px;color:#64748b;margin-top:3px;">Prior Month: ${escapeHtml(formatCurrency(previousSpend, currency))} (${momSign}${item.momChangePercent}% MoM)</div>
          </td>
          <td style="padding:14px 16px;width:50%;">
            <div style="font-size:11px;text-transform:uppercase;color:#64748b;font-weight:700;">Manual Monthly Budget</div>
            <div style="font-size:22px;font-weight:800;color:${hasLimit ? thresholdMeta.accentColor : '#475569'};margin-top:4px;">${hasLimit ? escapeHtml(formatCurrency(monthlyBudget, currency)) : 'Not Configured'}</div>
            <div style="font-size:11px;color:#64748b;margin-top:3px;">${
              hasLimit
                ? overBudgetAmount > 0
                  ? `Exceeded by <strong style="color:#b91c1c;">${escapeHtml(formatCurrency(overBudgetAmount, currency))}</strong>`
                  : `Remaining: <strong>${escapeHtml(formatCurrency(remainingBudget, currency))}</strong>`
                : 'Manual budget limit not yet assigned'
            }</div>
          </td>
        </tr>
      </table>

      ${
        hasLimit
          ? `
      <div style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:6px;">
          <span style="color:#334155;">Budget Utilization</span>
          <span style="color:${thresholdMeta.accentColor};">${item.percentUsed.toFixed(1)}%</span>
        </div>
        <div style="height:10px;width:100%;background:#e2e8f0;border-radius:999px;overflow:hidden;">
          <div style="height:10px;width:${progressWidth}%;background:${thresholdMeta.accentColor};border-radius:999px;"></div>
        </div>
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;">
        <tr>${milestoneCells}</tr>
      </table>`
          : ''
      }

      <h3 style="margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#475569;">Account Usage &amp; Cost Breakdown</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;margin-bottom:18px;">
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 10px;color:#64748b;width:45%;">Cloud Provider</td>
          <td style="padding:8px 10px;font-weight:600;">${providerMeta.label}${item.parentAccountId ? ` (${escapeHtml(item.parentAccountId)})` : ''}</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 10px;color:#64748b;">Primary Cost Driver</td>
          <td style="padding:8px 10px;font-weight:600;">${escapeHtml(item.topCostDriver)}</td>
        </tr>
        <tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 10px;color:#64748b;">Month-over-Month Change</td>
          <td style="padding:8px 10px;font-weight:600;">${momSign}${item.momChangePercent}% (${momDelta >= 0 ? '+' : ''}${escapeHtml(formatCurrency(momDelta, currency))})</td>
        </tr>
        ${
          projectedEom !== null
            ? `<tr style="border-bottom:1px solid #f1f5f9;">
          <td style="padding:8px 10px;color:#64748b;">Projected End-of-Month Spend</td>
          <td style="padding:8px 10px;font-weight:600;">${escapeHtml(formatCurrency(projectedEom, currency))}</td>
        </tr>`
            : ''
        }
        <tr>
          <td style="padding:8px 10px;color:#64748b;">Concerned Person / Alerts To</td>
          <td style="padding:8px 10px;">${escapeHtml(item.contactName ? `${item.contactName} (${item.alertEmail})` : item.alertEmail)}</td>
        </tr>
      </table>

      <h3 style="margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#475569;">Top Cost Drivers / Services</h3>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:13px;border:1px solid #e2e8f0;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Service</th>
            <th style="padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;text-align:right;">Month Spend</th>
          </tr>
        </thead>
        <tbody>${topServicesRows}</tbody>
      </table>

      <p style="margin:20px 0 0;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
        Cloud Cost Intelligence &amp; FinOps Governance Platform &bull; Automated Budget Threshold Alerting (50% / 75% / 100% / Over Budget)
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = [
    subject,
    `Account: ${item.accountName} (${item.accountId})`,
    `Cloud: ${providerMeta.label} | Billing Month: ${item.evaluationMonth}`,
    `Current Spend: ${formatCurrency(currentSpend, currency)}`,
    hasLimit ? `Monthly Budget: ${formatCurrency(monthlyBudget, currency)} (${item.percentUsed.toFixed(1)}%)` : '',
    `Prior Spend: ${formatCurrency(previousSpend, currency)} (${momSign}${item.momChangePercent}% MoM)`,
    `Primary Cost Driver: ${item.topCostDriver}`,
    `Concerned Person: ${item.contactName || 'N/A'} <${item.alertEmail}>`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

export async function deliverHtmlEmail(options: {
  recipients: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  previewFilename: string;
  dryRun?: boolean;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  auditCategory?: string;
  auditSource?: string;
}): Promise<EmailDeliveryResult> {
  const recipients = normalizeEmailList(options.recipients);
  const cc = normalizeEmailList(options.cc || []).filter((e) => !recipients.includes(e));
  if (recipients.length === 0) {
    throw new Error('At least one valid recipient email address is required.');
  }

  const auditCategory = options.auditCategory || 'budget-email';
  const auditSource = options.auditSource || 'accountBudgetService';
  const attachmentNames = options.attachments?.map((a) => a.filename);

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const previewPath = path.join(LOG_DIR, options.previewFilename);
  fs.writeFileSync(previewPath, options.html, 'utf-8');

  if (options.dryRun) {
    recordEmailAudit({
      category: auditCategory,
      source: auditSource,
      to: recipients,
      cc,
      subject: options.subject,
      transport: 'preview',
      status: 'dry-run',
      attachments: attachmentNames,
    });
    return {
      sent: false,
      previewed: true,
      transport: 'preview',
      recipients,
      subject: options.subject,
      previewPath,
    };
  }

  let lastError = '';

  // 1. Primary Transport: Microsoft Graph API
  const tenantId = process.env.AZURE_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;
  const senderEmail = process.env.SENDER_EMAIL?.trim();

  if (tenantId && clientId && clientSecret && senderEmail) {
    try {
      const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
      const { token } = await credential.getToken('https://graph.microsoft.com/.default');
      const graphMessage: Record<string, unknown> = {
        subject: options.subject,
        body: { contentType: 'HTML', content: options.html },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
      };
      if (cc.length > 0) {
        graphMessage.ccRecipients = cc.map((address) => ({ emailAddress: { address } }));
      }
      if (options.attachments && options.attachments.length > 0) {
        graphMessage.attachments = options.attachments.map((a) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.contentType || 'application/octet-stream',
          contentBytes: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, 'utf8')).toString('base64'),
        }));
      }
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: graphMessage,
            saveToSentItems: true,
          }),
        }
      );

      if (res.status === 202) {
        recordEmailAudit({
          category: auditCategory,
          source: auditSource,
          to: recipients,
          cc,
          from: senderEmail,
          subject: options.subject,
          transport: 'graph',
          status: 'sent',
          attachments: attachmentNames,
        });
        return {
          sent: true,
          previewed: true,
          transport: 'graph',
          recipients,
          subject: options.subject,
          previewPath,
        };
      }
      lastError = `Microsoft Graph returned HTTP ${res.status}: ${await res.text()}`;
      console.warn('[MailTransport] Graph sendMail failed, attempting SMTP fallback:', lastError);
    } catch (err: any) {
      lastError = err.message;
      console.warn('[MailTransport] Graph email error, attempting SMTP fallback:', lastError);
    }
  }

  // 2. Secondary Transport: Nodemailer SMTP
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const smtpUser = process.env.SMTP_USER;
  const rawPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';
  const smtpPass = rawPass.trim().replace(/\s+/g, '');
  const smtpFrom =
    process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM || smtpUser || senderEmail || 'finops@coforge.com';

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipients.join(', '),
        ...(cc.length > 0 ? { cc: cc.join(', ') } : {}),
        subject: options.subject,
        text: options.text,
        html: options.html,
        ...(options.attachments && options.attachments.length > 0
          ? {
              attachments: options.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
              })),
            }
          : {}),
      });

      recordEmailAudit({
        category: auditCategory,
        source: auditSource,
        to: recipients,
        cc,
        from: smtpFrom,
        subject: options.subject,
        transport: 'smtp',
        status: 'sent',
        attachments: attachmentNames,
        messageId: info.messageId,
      });
      return {
        sent: true,
        previewed: true,
        transport: 'smtp',
        recipients,
        subject: options.subject,
        messageId: info.messageId,
        previewPath,
      };
    } catch (err: any) {
      lastError = lastError ? `${lastError}; SMTP: ${err.message}` : `SMTP: ${err.message}`;
      console.warn('[MailTransport] SMTP sendMail failed:', err.message);
    }
  }

  const finalError = lastError || 'No external mail transport succeeded; HTML preview generated locally.';
  recordEmailAudit({
    category: auditCategory,
    source: auditSource,
    to: recipients,
    cc,
    from: senderEmail || smtpFrom,
    subject: options.subject,
    transport: 'preview',
    status: 'failed',
    attachments: attachmentNames,
    error: finalError,
  });

  // 3. Fallback: Saved HTML preview only
  return {
    sent: false,
    previewed: true,
    transport: 'preview',
    recipients,
    subject: options.subject,
    previewPath,
    error: finalError,
  };
}

export async function sendAccountUsageEmail(
  item: EnrichedAccountBudget,
  mode: 'threshold' | 'instant',
  overrideEmail?: string | string[]
): Promise<EmailDeliveryResult> {
  const overrideList = overrideEmail ? normalizeEmailList(overrideEmail) : [];
  const recipients = overrideList.length > 0 ? overrideList : normalizeEmailList(item.alertEmails?.length ? item.alertEmails : item.alertEmail);
  if (recipients.length === 0) {
    throw new Error('At least one valid recipient email address is required.');
  }

  const resolvedItem = await resolveAccountSpecificTopServices(item);
  const { subject, html, text } = buildAccountBudgetEmailContent(resolvedItem, mode);
  const safeId = item.accountId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);

  return deliverHtmlEmail({
    recipients,
    subject,
    html,
    text,
    previewFilename: `account-budget-${mode}-${item.cloudProvider}-${safeId}-${Date.now()}.html`,
    auditCategory: mode === 'threshold' ? 'budget-threshold' : 'budget-instant',
    auditSource: 'accountBudgetService',
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Batch Threshold Evaluation Across All 3 Clouds
// ────────────────────────────────────────────────────────────────────────────

export async function evaluateAndNotifyAllAccountBudgets(options?: {
  provider?: string;
  month?: string;
}): Promise<{
  evaluatedCount: number;
  breachedCount: number;
  triggeredCount: number;
  results: Array<{
    budgetId: number;
    cloudProvider: CloudProvider;
    accountId: string;
    accountName: string;
    percentUsed: number;
    thresholdCrossed: AccountBudgetThreshold | null;
    emailResult?: EmailDeliveryResult;
  }>;
}> {
  const enriched = await getEnrichedBudgets(options?.provider || 'all', options?.month);
  const active = enriched.filter((b) => b.isActive);

  let breachedCount = 0;
  let triggeredCount = 0;
  const results: Array<{
    budgetId: number;
    cloudProvider: CloudProvider;
    accountId: string;
    accountName: string;
    percentUsed: number;
    thresholdCrossed: AccountBudgetThreshold | null;
    emailResult?: EmailDeliveryResult;
  }> = [];

  for (const item of active) {
    if (item.thresholdCrossed) breachedCount++;

    if (
      shouldSendThresholdAlert(
        item.thresholdCrossed,
        item.evaluationMonth,
        item.lastNotifiedThreshold,
        item.lastNotifiedMonth
      )
    ) {
      try {
        const emailResult = await sendAccountUsageEmail(item, 'threshold');
        if (emailResult.sent && item.thresholdCrossed) {
          await markThresholdNotified(item.id, item.thresholdCrossed, item.evaluationMonth);
        }
        triggeredCount++;
        results.push({
          budgetId: item.id,
          cloudProvider: item.cloudProvider,
          accountId: item.accountId,
          accountName: item.accountName,
          percentUsed: item.percentUsed,
          thresholdCrossed: item.thresholdCrossed,
          emailResult,
        });
      } catch (err: any) {
        console.error(
          `[AccountBudgetService] Failed sending threshold email for ${item.cloudProvider}:${item.accountId}:`,
          err.message
        );
      }
    }
  }

  return {
    evaluatedCount: active.length,
    breachedCount,
    triggeredCount,
    results,
  };
}
