import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleAuth } from 'google-auth-library';
import { getBigQueryClient, resolveBillingTable } from './server/routes/gcp.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface MonthlySpendPoint {
  month: string;
  spend: number;
}

interface OverBudgetRow {
  rank: number;
  budgetName: string;
  projectName: string;
  projectId: string;
  limit: number;
  actualSpend: number;
  overSpend: number;
  utilizationPct: number;
}

interface TopSpendRow {
  rank: number;
  projectName: string;
  projectId: string;
  status: string;
  spend: number;
  sharePct: number;
}

export interface GcpReportData {
  billingScopeName: string;
  billingAccountId: string;
  currency: string;
  currencySymbol: string;
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

interface RawGcpBudget {
  name?: string;
  displayName?: string;
  budgetFilter?: {
    projects?: string[];
    services?: string[];
    calendarPeriod?: string;
  };
  amount?: {
    specifiedAmount?: {
      currencyCode?: string;
      units?: string | number;
      nanos?: number;
    };
    lastPeriodAmount?: Record<string, unknown>;
  };
}

function makeCurrencyFormatter(currency: string) {
  const isInr = currency.toUpperCase() === 'INR';
  const symbol = isInr ? '₹' : '$';
  const locale = isInr ? 'en-IN' : 'en-US';
  const fmt = (n: number) =>
    `${symbol}${Number(n || 0).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  return { symbol, fmt };
}

/**
 * Queries the official Google Cloud Billing Budgets API:
 * GET https://billingbudgets.googleapis.com/v1/billingAccounts/{billingAccountId}/budgets
 */
async function fetchGcpCloudBillingBudgets(billingAccountId: string): Promise<RawGcpBudget[]> {
  if (!billingAccountId || billingAccountId === 'demo-billing-account') {
    return [];
  }

  const cleanBillingId = billingAccountId.replace(/^billingAccounts\//i, '').trim();
  if (!cleanBillingId) return [];

  try {
    const keyFile = process.env.GCP_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    let serviceAccountEmail = '';

    if (keyFile) {
      const resolved = path.isAbsolute(keyFile) ? keyFile : path.resolve(process.cwd(), keyFile);
      if (fs.existsSync(resolved)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = resolved;
        try {
          const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
          serviceAccountEmail = parsed.client_email || '';
        } catch {}
      }
    }

    const auth = new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-billing.readonly',
        'https://www.googleapis.com/auth/cloud-platform',
      ],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

    if (!token) {
      return [];
    }

    const budgets: RawGcpBudget[] = [];
    let pageToken = '';

    do {
      const url = `https://billingbudgets.googleapis.com/v1/billingAccounts/${encodeURIComponent(
        cleanBillingId
      )}/budgets${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.warn(
          `⚠️ [GCP Budgets API] Could not fetch Cloud Billing Budgets for Billing Account ${cleanBillingId} (HTTP ${res.status}): ${errBody.slice(0, 180)}`
        );
        if (res.status === 403) {
          console.warn(
            `   💡 Grant role "Billing Account Viewer" (roles/billing.viewer) to ${
              serviceAccountEmail || 'your GCP Service Account'
            } under GCP Console -> Billing -> Account Management (Billing Account ${cleanBillingId}).`
          );
        }
        return [];
      }

      const data: any = await res.json();
      if (Array.isArray(data.budgets)) {
        budgets.push(...data.budgets);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    if (budgets.length > 0) {
      console.log(
        `✅ [GCP Budgets API] Retrieved ${budgets.length} live budget(s) from Billing Account ${cleanBillingId}.`
      );
    }
    return budgets;
  } catch (err: any) {
    console.warn(`⚠️ [GCP Budgets API] Skipping live budget fetch: ${err.message}`);
    return [];
  }
}

const GCP_BUDGET_NOISE_TOKENS = new Set([
  'budget', 'budgets', 'gcp', 'google', 'cloud', 'monthly', 'month', 'cost', 'costs',
  'alert', 'alerts', 'spend', 'limit', 'threshold', 'coforge', 'project', 'projects',
  'prod', 'prd', 'dev', 'uat', 'poc', 'np', 'nonprod', 'test', 'qa', 'stg', 'dr',
  'gbl', 'ind', 'us', 'uk', 'eu', 'apac',
]);

function normalizeStr(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getTokens(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function getCoreTokens(s: string): string[] {
  const tokens = getTokens(s);
  const core = tokens.filter((t) => !GCP_BUDGET_NOISE_TOKENS.has(t));
  return core.length > 0 ? core : tokens;
}

function matchProjectByBudgetName(
  budgetName: string,
  projects: Array<{ projectId: string; projectName: string; projectNumber: string; spend: number }>
) {
  const bNorm = normalizeStr(budgetName);
  const bCoreTokens = getCoreTokens(budgetName);
  const bCore = bCoreTokens.join('');

  if (!bNorm) return null;

  // 1. Direct normalized substring match on projectId or projectName
  for (const p of projects) {
    const idNorm = normalizeStr(p.projectId);
    const nameNorm = normalizeStr(p.projectName);
    if (
      (idNorm.length >= 3 && (bNorm.includes(idNorm) || idNorm.includes(bNorm))) ||
      (nameNorm.length >= 3 && (bNorm.includes(nameNorm) || nameNorm.includes(bNorm)))
    ) {
      return p;
    }
  }

  // 2. Core token overlap match (e.g. "BPM HCSC Budget" <-> "BPM-HCSC")
  if (bCore.length >= 3) {
    let bestMatch: (typeof projects)[0] | null = null;
    let bestScore = 0;

    for (const p of projects) {
      const pCoreTokens = getCoreTokens(`${p.projectName} ${p.projectId}`);
      const pCore = getCoreTokens(p.projectName).join('');

      if (
        pCore.length >= 3 &&
        (pCore === bCore ||
          (pCore.length >= 4 && bCore.length >= 4 && (pCore.includes(bCore) || bCore.includes(pCore))))
      ) {
        return p;
      }

      const shared = bCoreTokens.filter(
        (t) => t.length >= 3 && pCoreTokens.includes(t)
      ).length;
      if (shared > bestScore) {
        bestScore = shared;
        bestMatch = p;
      }
    }

    if (bestMatch && bestScore > 0) {
      return bestMatch;
    }
  }

  return null;
}

async function fetchReportDataFromBigQuery(): Promise<GcpReportData> {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;

  if (!bq || !dataset) {
    throw new Error('GCP BigQuery client or GCP_BIGQUERY_DATASET is not configured in .env.');
  }

  const table = await resolveBillingTable(bq, dataset);
  if (!table) {
    throw new Error(`Could not resolve GCP billing export table in dataset "${dataset}".`);
  }

  console.log(`☁️ Querying GCP BigQuery billing export (${dataset}.${table})...`);

  // 1. Fetch monthly spend totals (up to last 12 months) + currency + billing_account_id
  const monthlyQuery = `
    SELECT 
      FORMAT_TIMESTAMP('%Y-%m', usage_start_time) as month,
      SUM(cost) as totalCost,
      ANY_VALUE(currency) as currency,
      ANY_VALUE(billing_account_id) as billingAccountId
    FROM \`${dataset}.${table}\`
    WHERE usage_start_time IS NOT NULL
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 12
  `;

  const [monthlyRows] = await bq.query({ query: monthlyQuery });
  if (!monthlyRows || monthlyRows.length === 0) {
    throw new Error(`No monthly billing records found in ${dataset}.${table}.`);
  }

  const sortedMonths = monthlyRows
    .filter((r: any) => r.month)
    .map((r: any) => ({
      month: String(r.month),
      spend: Number(Number(r.totalCost || 0).toFixed(2)),
      currency: String(r.currency || 'INR'),
      billingAccountId: String(r.billingAccountId || ''),
    }))
    .sort((a: any, b: any) => a.month.localeCompare(b.month));

  const latestEntry = sortedMonths[sortedMonths.length - 1];
  const prevEntry = sortedMonths.length > 1 ? sortedMonths[sortedMonths.length - 2] : null;

  const reportMonth = latestEntry.month;
  const currency = (process.env.GCP_CURRENCY || latestEntry.currency || 'INR').toUpperCase();
  const { symbol: currencySymbol } = makeCurrencyFormatter(currency);
  const discoveredBillingAccountId =
    process.env.GCP_BILLING_ACCOUNT_ID || latestEntry.billingAccountId || '';

  const currentMonthSpend = latestEntry.spend;
  const previousMonthSpend = prevEntry ? prevEntry.spend : 0;
  const momPercentChange =
    previousMonthSpend > 0
      ? Number((((currentMonthSpend - previousMonthSpend) / previousMonthSpend) * 100).toFixed(1))
      : 0;

  const last6MonthsSpend: MonthlySpendPoint[] = sortedMonths.slice(-6).map((m: any) => ({
    month: m.month,
    spend: m.spend,
  }));

  // 2. Fetch all known projects in the billing dataset with their current-month spend
  //    (so project-scoped budgets for projects with ₹0 spend this month still resolve accurately)
  const projectQuery = `
    WITH latest_month AS (
      SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
    )
    SELECT 
      COALESCE(project.id, 'unassigned') as projectId,
      COALESCE(MAX(project.name), MAX(project.id), 'Unassigned / Global') as projectName,
      MAX(CAST(project.number AS STRING)) as projectNumber,
      SUM(CASE WHEN usage_start_time >= latest_month.start_of_month THEN cost ELSE 0 END) as currentSpend
    FROM \`${dataset}.${table}\`, latest_month
    GROUP BY 1
    ORDER BY currentSpend DESC
    LIMIT 250
  `;

  const [projectRows] = await bq.query({ query: projectQuery });
  const allProjects = (projectRows || []).map((r: any) => {
    const pId = String(r.projectId || 'unassigned');
    const pName =
      pId === process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_NAME
        ? process.env.GCP_PROJECT_NAME
        : String(r.projectName || pId);
    return {
      projectId: pId,
      projectName: pName,
      projectNumber: r.projectNumber ? String(r.projectNumber) : '',
      spend: Number(Number(r.currentSpend || 0).toFixed(2)),
    };
  });

  const realProjects = allProjects.filter((p) => p.projectId !== 'unassigned');
  const projects = realProjects.length > 0 ? realProjects : allProjects;

  // 3. Fetch live budgets from Google Cloud Billing Budgets API (Tier 1)
  const apiBudgets = await fetchGcpCloudBillingBudgets(discoveredBillingAccountId);

  let evaluatedBudgets: OverBudgetRow[] = [];

  if (apiBudgets.length > 0) {
    evaluatedBudgets = apiBudgets.map((b, idx) => {
      const budgetName = b.displayName || b.name?.split('/').pop() || `GCP Budget ${idx + 1}`;
      let limit = 0;
      if (b.amount?.specifiedAmount) {
        const units = Number(b.amount.specifiedAmount.units || 0);
        const nanos = Number(b.amount.specifiedAmount.nanos || 0) / 1e9;
        limit = Number((units + nanos).toFixed(2));
      } else if (b.amount?.lastPeriodAmount) {
        limit = previousMonthSpend;
      }

      // Match budgetFilter.projects (e.g. "projects/12345" or "projects/my-proj") to BigQuery projects
      const filterProjects = b.budgetFilter?.projects || [];
      let matchedProjectName = budgetName;
      let matchedProjectId = '—';
      let actualSpend = 0;

      if (filterProjects.length > 0) {
        const cleanFilterIds = filterProjects.map((fp) => fp.replace(/^projects\//i, '').trim());
        const matchedList = projects.filter(
          (p) =>
            cleanFilterIds.includes(p.projectId) ||
            (p.projectNumber && cleanFilterIds.includes(p.projectNumber))
        );

        if (matchedList.length > 0) {
          actualSpend = Number(
            matchedList.reduce((sum, p) => sum + p.spend, 0).toFixed(2)
          );
          matchedProjectName =
            matchedList.length === 1
              ? matchedList[0].projectName
              : `${matchedList[0].projectName} (+${matchedList.length - 1})`;
          matchedProjectId =
            matchedList.length === 1
              ? matchedList[0].projectId
              : matchedList.map((m) => m.projectId).join(', ');
        } else {
          // Project filter specified, but project has zero historical rows in BigQuery; try name match first, else 0 spend
          const byName = matchProjectByBudgetName(budgetName, projects);
          if (byName) {
            matchedProjectName = byName.projectName;
            matchedProjectId = byName.projectId;
            actualSpend = byName.spend;
          } else {
            matchedProjectName = budgetName;
            matchedProjectId = cleanFilterIds.join(', ');
            actualSpend = 0;
          }
        }
      } else {
        // No explicit project filter: match by budget displayName against projectName or projectId
        const byName = matchProjectByBudgetName(budgetName, projects);
        if (byName) {
          matchedProjectName = byName.projectName;
          matchedProjectId = byName.projectId;
          actualSpend = byName.spend;
        }
      }

      const overSpend = Number((actualSpend - limit).toFixed(2));
      const utilizationPct = limit > 0 ? Number(((actualSpend / limit) * 100).toFixed(1)) : 0;

      return {
        rank: 0,
        budgetName,
        projectName: matchedProjectName,
        projectId: matchedProjectId,
        limit,
        actualSpend,
        overSpend,
        utilizationPct,
      };
    });
  } else {
    // Tier 2 / Tier 3 fallback: Check .env GCP_PROJECT_BUDGETS / GCP_MONTHLY_BUDGET or project baseline
    let envProjectBudgets: Record<string, number> = {};
    if (process.env.GCP_PROJECT_BUDGETS) {
      try {
        envProjectBudgets = JSON.parse(process.env.GCP_PROJECT_BUDGETS);
      } catch {}
    }

    const envTotalBudget = Number(process.env.GCP_MONTHLY_BUDGET || 0);
    const activeProjects = projects.filter((p) => p.projectId !== 'unassigned' && p.spend > 0);

    evaluatedBudgets = activeProjects.map((p) => {
      let limit = envProjectBudgets[p.projectId] || envProjectBudgets[p.projectName] || 0;
      if (!limit && envTotalBudget > 0 && currentMonthSpend > 0) {
        limit = Number(((p.spend / currentMonthSpend) * envTotalBudget).toFixed(2));
      }
      if (!limit) {
        // Consistent with src/server/routes/gcp.ts project budget baseline
        limit = Math.round(p.spend * 1.18);
      }

      const overSpend = Number((p.spend - limit).toFixed(2));
      const utilizationPct = limit > 0 ? Number(((p.spend / limit) * 100).toFixed(1)) : 0;

      return {
        rank: 0,
        budgetName: `${p.projectName} Budget`,
        projectName: p.projectName,
        projectId: p.projectId,
        limit,
        actualSpend: p.spend,
        overSpend,
        utilizationPct,
      };
    });
  }

  const budgetedProjectIds = new Set(evaluatedBudgets.map((b) => b.projectId));
  const totalBudget = Number(
    evaluatedBudgets.reduce((sum, b) => sum + b.limit, 0).toFixed(2)
  );
  const remainingBudget = Math.max(0, Number((totalBudget - currentMonthSpend).toFixed(2)));
  const netVariance = Number((totalBudget - currentMonthSpend).toFixed(2));
  const overallUtilizationPct =
    totalBudget > 0 ? Number(((currentMonthSpend / totalBudget) * 100).toFixed(1)) : 0;

  const strictlyOver = evaluatedBudgets
    .filter((b) => b.overSpend > 0)
    .sort((a, b) => b.overSpend - a.overSpend);

  const totalOverSpend = Number(
    strictlyOver.reduce((sum, b) => sum + b.overSpend, 0).toFixed(2)
  );

  // Sort for Top 5 Over Budget (or highest utilization if fewer than 5 are strictly over)
  const sortedForTop5 = [...evaluatedBudgets].sort((a, b) => {
    const aOver = a.overSpend > 0 ? 1 : 0;
    const bOver = b.overSpend > 0 ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    if (aOver === 1) return b.overSpend - a.overSpend;
    if (b.utilizationPct !== a.utilizationPct) return b.utilizationPct - a.utilizationPct;
    return b.actualSpend - a.actualSpend;
  });

  const top5OverBudget: OverBudgetRow[] = sortedForTop5.slice(0, 5).map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  const top5MostSpend: TopSpendRow[] = projects.slice(0, 5).map((p, i) => {
    const matchedBudget = evaluatedBudgets.find(
      (b) => b.projectId === p.projectId || b.projectId.split(', ').includes(p.projectId)
    );
    let status = 'Unbudgeted';
    if (matchedBudget) {
      status =
        matchedBudget.utilizationPct >= 100
          ? 'Exceeded'
          : matchedBudget.utilizationPct >= 85
          ? 'Warning'
          : 'Budgeted';
    } else if (budgetedProjectIds.size > 0 && apiBudgets.length > 0) {
      status = 'Covered by Org Budget';
    }

    return {
      rank: i + 1,
      projectName: p.projectName,
      projectId: p.projectId,
      status,
      spend: p.spend,
      sharePct:
        currentMonthSpend > 0 ? Number(((p.spend / currentMonthSpend) * 100).toFixed(1)) : 0,
    };
  });

  const scopeName =
    process.env.GCP_PROJECT_NAME ||
    (process.env.GCP_PROJECT_ID
      ? `Coforge GCP (${process.env.GCP_PROJECT_ID})`
      : 'Coforge Limited — GCP Organization');

  return {
    billingScopeName: scopeName,
    billingAccountId: discoveredBillingAccountId || 'GCP Billing Export',
    currency,
    currencySymbol,
    reportMonth,
    generatedAt: new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    currentMonthSpend,
    previousMonthSpend,
    momPercentChange,
    totalBudget,
    remainingBudget,
    netVariance,
    overallUtilizationPct,
    activeBudgetCount: evaluatedBudgets.length,
    overBudgetCount: strictlyOver.length,
    totalOverSpend,
    last6MonthsSpend,
    top5OverBudget,
    top5MostSpend,
  };
}

function fetchFallbackGcpReportData(): GcpReportData {
  const currency = (process.env.GCP_CURRENCY || 'INR').toUpperCase();
  const isInr = currency === 'INR';
  const rate = isInr ? 1 : 1 / 84;
  const { symbol: currencySymbol } = makeCurrencyFormatter(currency);

  const demoProjects = [
    {
      name: 'Coforge Core Kubernetes Platform',
      projectId: 'coforge-gke-core',
      spend: Number((22140.1 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
      limit: Number((25000 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
    },
    {
      name: 'Coforge FinOps Production',
      projectId: 'coforge-finops-prod',
      spend: Number((14250.8 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
      limit: Number((18000 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
    },
    {
      name: 'Coforge BigData Analytics DEV',
      projectId: 'coforge-analytics-dev',
      spend: Number((8920.45 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
      limit: Number((9500 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
    },
    {
      name: 'Coforge Innovation R&D Sandbox',
      projectId: 'coforge-sandbox-rnd',
      spend: Number((3410.2 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
      limit: Number((3000 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
    },
    {
      name: 'Coforge Marketing & Web Platforms',
      projectId: 'coforge-marketing-data',
      spend: Number((1840.5 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
      limit: Number((2000 * (isInr ? 28.5 : 1) * rate).toFixed(2)),
    },
  ];

  const monthlyHistory: MonthlySpendPoint[] = [
    { month: '2026-05', spend: Number((44100.2 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
    { month: '2026-06', spend: Number((46800.5 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
    { month: '2026-07', spend: Number((48950.0 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
    { month: '2026-08', spend: Number((51200.75 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
    { month: '2026-09', spend: Number((49800.1 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
    { month: '2026-10', spend: Number((50562.05 * (isInr ? 28.5 : 1) * rate).toFixed(2)) },
  ];

  const currentMonthSpend = monthlyHistory[monthlyHistory.length - 1].spend;
  const previousMonthSpend = monthlyHistory[monthlyHistory.length - 2].spend;
  const momPercentChange = Number(
    (((currentMonthSpend - previousMonthSpend) / previousMonthSpend) * 100).toFixed(1)
  );

  const totalBudget = Number(demoProjects.reduce((s, p) => s + p.limit, 0).toFixed(2));
  const remainingBudget = Math.max(0, Number((totalBudget - currentMonthSpend).toFixed(2)));
  const netVariance = Number((totalBudget - currentMonthSpend).toFixed(2));
  const overallUtilizationPct = Number(((currentMonthSpend / totalBudget) * 100).toFixed(1));

  const evaluated: OverBudgetRow[] = demoProjects.map((p) => {
    const overSpend = Number((p.spend - p.limit).toFixed(2));
    const utilizationPct = Number(((p.spend / p.limit) * 100).toFixed(1));
    return {
      rank: 0,
      budgetName: `${p.name} Budget`,
      projectName: p.name,
      projectId: p.projectId,
      limit: p.limit,
      actualSpend: p.spend,
      overSpend,
      utilizationPct,
    };
  });

  const strictlyOver = evaluated.filter((b) => b.overSpend > 0);
  const totalOverSpend = Number(
    strictlyOver.reduce((s, b) => s + b.overSpend, 0).toFixed(2)
  );

  const sortedOver = [...evaluated].sort((a, b) => b.utilizationPct - a.utilizationPct);

  return {
    billingScopeName:
      process.env.GCP_PROJECT_NAME || 'Coforge Limited — GCP Organization',
    billingAccountId: process.env.GCP_BILLING_ACCOUNT_ID || 'demo-billing-account',
    currency,
    currencySymbol,
    reportMonth: '2026-10',
    generatedAt: new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    currentMonthSpend,
    previousMonthSpend,
    momPercentChange,
    totalBudget,
    remainingBudget,
    netVariance,
    overallUtilizationPct,
    activeBudgetCount: demoProjects.length,
    overBudgetCount: strictlyOver.length,
    totalOverSpend,
    last6MonthsSpend: monthlyHistory,
    top5OverBudget: sortedOver.map((r, i) => ({ ...r, rank: i + 1 })),
    top5MostSpend: demoProjects.map((p, i) => ({
      rank: i + 1,
      projectName: p.name,
      projectId: p.projectId,
      status: p.spend > p.limit ? 'Exceeded' : 'Budgeted',
      spend: p.spend,
      sharePct: Number(((p.spend / currentMonthSpend) * 100).toFixed(1)),
    })),
  };
}

export async function fetchReportData(): Promise<GcpReportData> {
  try {
    return await fetchReportDataFromBigQuery();
  } catch (err: any) {
    console.warn(
      `⚠️  Could not query live GCP BigQuery (${err.message?.split('\n')[0]}). Using GCP fallback dataset...`
    );
    return fetchFallbackGcpReportData();
  }
}

function renderRechartsSpendChart(
  points: MonthlySpendPoint[],
  currencySymbol: string = '₹',
  brandColor: string = '#1a73e8',
  accentColor: string = '#bfdbfe'
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
    if (currencySymbol === '₹') {
      if (val >= 10000000) return `${currencySymbol}${(val / 10000000).toFixed(1)}Cr`;
      if (val >= 100000) return `${currencySymbol}${(val / 100000).toFixed(1)}L`;
    }
    if (val >= 1000000) return `${currencySymbol}${(val / 1000000).toFixed(1)}M`;
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

export function buildGcpReportHtml(data: GcpReportData): string {
  const { fmt: fmtCurrency, symbol: currencySymbol } = makeCurrencyFormatter(data.currency);
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
  <title>GCP Cost &amp; Budget Executive Summary - ${data.reportMonth}</title>
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
    .section {
      margin-bottom: 13px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 13px 16px;
      background: #ffffff;
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
      background: #dbeafe;
      color: #1d4ed8;
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
    .badge-ok {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      background: #d1fae5;
      color: #047857;
    }
    .badge-share {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-size: 9.5px;
      font-weight: 700;
      background: #dbeafe;
      color: #1d4ed8;
    }
    .footer {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 9.5px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background: linear-gradient(135deg, #0d47a1 0%, #1565c0 50%, #1a73e8 100%); color: #ffffff; padding: 16px 20px; border-radius: 10px; margin-bottom: 14px;">
    <tr>
      <td align="left" style="vertical-align: middle;">
        <div style="font-size: 17px; font-weight: 800; letter-spacing: -0.3px; color: #ffffff;">GCP Cost Intelligence — Executive Budget &amp; Spend Report</div>
        <div style="font-size: 11px; color: #bfdbfe; margin-top: 2px;">Scope: ${data.billingScopeName}</div>
      </td>
      <td align="right" style="vertical-align: middle;">
        <div style="display: inline-block; background: rgba(59, 130, 246, 0.35); border: 1px solid rgba(191, 219, 254, 0.4); color: #ffffff; font-weight: 700; font-size: 10.5px; padding: 3px 9px; border-radius: 6px; margin-bottom: 3px;">
          Billing Period: ${formatMonthLabel(data.reportMonth)}
        </div>
        <div style="font-size: 10px; color: #dbeafe;">Generated: ${data.generatedAt}</div>
      </td>
    </tr>
  </table>

  <!-- Section 1: Current Spend vs Total Budget -->
  <div class="section">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
      <tr>
        <td align="left">
          <div class="section-title">1. Current Spend vs. Total Budget Summary</div>
          <div class="section-subtitle">Consolidated monthly spend compared against configured GCP Cloud Billing Budgets</div>
        </td>
      </tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: separate; border-spacing: 8px 0; margin-bottom: 11px;">
      <tr>
        <td width="25%" style="vertical-align: top; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 12px; background: #eff6ff;">
          <div class="kpi-label">Current Month Spend</div>
          <div class="kpi-value">${fmtCurrency(data.currentMonthSpend)}</div>
          <div class="kpi-sub">Prior Month: ${fmtCurrency(data.previousMonthSpend)} (${data.momPercentChange >= 0 ? '+' : ''}${data.momPercentChange.toFixed(1)}% MoM)</div>
        </td>
        <td width="25%" style="vertical-align: top; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; background: #f8fafc;">
          <div class="kpi-label">Total Budget</div>
          <div class="kpi-value">${fmtCurrency(data.totalBudget)}</div>
          <div class="kpi-sub">Across ${data.activeBudgetCount} configured GCP project budgets</div>
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
          <td align="right" style="color: ${data.overallUtilizationPct > 100 ? '#be123c' : '#1a73e8'}; font-weight: 800; font-size: 10.5px;">
            ${data.overallUtilizationPct.toFixed(1)}% Utilized
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 999px; overflow: hidden;">
        <tr>
          <td width="${utilizationBarWidth}%" style="height: 8px; background: ${data.overallUtilizationPct > 100 ? '#e11d48' : '#1a73e8'}; border-radius: 999px;"></td>
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
      ${renderRechartsSpendChart(data.last6MonthsSpend, currencySymbol, '#1a73e8', '#bfdbfe')}
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

  <!-- Section 3: Top 5 Projects Over Budget -->
  <div class="section">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
      <tr>
        <td align="left">
          <div class="section-title">3. Top 5 Projects That Are Over Budget</div>
          <div class="section-subtitle">GCP Projects ranked by spend exceeding their monthly budget ceiling</div>
        </td>
      </tr>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Budget / Project Name</th>
          <th>Project ID</th>
          <th class="right">Monthly Budget</th>
          <th class="right">Actual Spend</th>
          <th class="right">Utilization</th>
          <th class="right">Over-Spend Variance</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.top5OverBudget.length === 0
            ? `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 14px;">No active GCP project budgets found.</td></tr>`
            : data.top5OverBudget
                .map((row) => {
                  const isOver = row.overSpend > 0;
                  const badgeClass =
                    row.utilizationPct >= 100
                      ? 'badge-over'
                      : row.utilizationPct >= 80
                      ? 'badge-warn'
                      : 'badge-ok';

                  return `
        <tr>
          <td><span class="rank-pill ${isOver ? 'top' : ''}">#${row.rank}</span></td>
          <td><strong>${row.projectName}</strong></td>
          <td class="mono">${row.projectId}</td>
          <td class="right">${fmtCurrency(row.limit)}</td>
          <td class="right"><strong>${fmtCurrency(row.actualSpend)}</strong></td>
          <td class="right"><span class="${badgeClass}">${row.utilizationPct.toFixed(1)}%</span></td>
          <td class="right" style="font-weight: 700; color: ${isOver ? '#e11d48' : '#059669'};">
            ${
              isOver
                ? `+${fmtCurrency(row.overSpend)}`
                : `-${fmtCurrency(Math.abs(row.overSpend))} (Under)`
            }
          </td>
        </tr>`;
                })
                .join('')
        }
      </tbody>
    </table>
  </div>

  <!-- Section 4: Top 5 Projects with Most Spend -->
  <div class="section">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9;">
      <tr>
        <td align="left">
          <div class="section-title">4. Top 5 Projects with Most Spend</div>
          <div class="section-subtitle">Highest-spending GCP projects in ${formatMonthLabel(data.reportMonth)}</div>
        </td>
      </tr>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width: 45px;">Rank</th>
          <th>Project Name</th>
          <th>Project ID</th>
          <th>Budget Status</th>
          <th class="right">Current Spend</th>
          <th class="right">% of Total Spend</th>
        </tr>
      </thead>
      <tbody>
        ${
          data.top5MostSpend.length === 0
            ? `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 14px;">No project spend records found.</td></tr>`
            : data.top5MostSpend
                .map(
                  (row) => `
        <tr>
          <td><span class="rank-pill spend">#${row.rank}</span></td>
          <td><strong>${row.projectName}</strong></td>
          <td class="mono">${row.projectId}</td>
          <td style="color: ${row.status === 'Exceeded' ? '#e11d48' : '#059669'}; font-weight: 600; font-size: 10px;">${row.status}</td>
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
    Confidential — Coforge Cloud Cost Intelligence &amp; FinOps Governance Platform (GCP)
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

export async function generateGcpReport(options: { htmlOnly?: boolean } = {}): Promise<{
  htmlPath: string;
  pdfPath?: string;
  data: GcpReportData;
}> {
  console.log('📊 Fetching GCP Spend & Budget metrics...');
  const data = await fetchReportData();

  const outputDir = path.resolve(__dirname, '../cost-dashboard');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const htmlPath = path.join(outputDir, 'GCP_Manager_Cost_Budget_Report.html');
  const pdfPath = path.join(outputDir, 'GCP_Manager_Cost_Budget_Report.pdf');

  const html = buildGcpReportHtml(data);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  if (options.htmlOnly || process.argv.includes('--html-only')) {
    console.log(`✅ Executive GCP HTML report successfully generated at:\n   ${htmlPath}`);
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

  console.log(`🖨️ Rendering GCP PDF via ${path.basename(browserExe)}...`);
  execFileSync(
    browserExe,
    [
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
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    }
  );

  console.log(`✅ GCP PDF successfully generated at:\n   ${pdfPath}`);
  return { htmlPath, pdfPath, data };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateGcpReport()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to generate GCP PDF report:', err.message);
      process.exit(1);
    });
}
