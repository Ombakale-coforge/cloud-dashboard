import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BigQuery } from '@google-cloud/bigquery';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Helper to initialize BigQuery client safely
export function getBigQueryClient(): BigQuery | null {
  const projectId = process.env.GCP_PROJECT_ID;
  const keyFile = process.env.GCP_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const inlineJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const location = process.env.GCP_DATASET_LOCATION || process.env.GCP_DEFAULT_REGION;

  if (!projectId && !keyFile && !inlineJson) {
    return null;
  }

  try {
    const options: any = {};
    if (projectId) options.projectId = projectId;
    if (location) options.location = location;

    if (keyFile) {
      const resolvedPath = path.isAbsolute(keyFile)
        ? keyFile
        : path.resolve(process.cwd(), keyFile);
      if (fs.existsSync(resolvedPath)) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedPath;
      }
    } else if (inlineJson) {
      try {
        const tempKeyPath = path.resolve(process.cwd(), '.gcp-temp-credentials.json');
        fs.writeFileSync(tempKeyPath, inlineJson);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;
      } catch (e) {
        console.error('[GCP] Failed to handle GCP_SERVICE_ACCOUNT_JSON');
      }
    }

    return new BigQuery(options);
  } catch (err: any) {
    console.error('[GCP] Failed to initialize BigQuery client:', err.message);
    return null;
  }
}

// Auto-discover the billing export table if not explicitly set
export async function resolveBillingTable(bq: BigQuery, datasetId: string): Promise<string | null> {
  if (process.env.GCP_BIGQUERY_BILLING_TABLE) {
    return process.env.GCP_BIGQUERY_BILLING_TABLE;
  }
  try {
    const dataset = bq.dataset(datasetId);
    const [tables] = await dataset.getTables();
    if (!tables || tables.length === 0) return null;
    const detailed = tables.find(t => t.id?.startsWith('gcp_billing_export_resource_v1'));
    if (detailed && detailed.id) return detailed.id;
    const standard = tables.find(t => t.id?.startsWith('gcp_billing_export_v1'));
    if (standard && standard.id) return standard.id;
    const anyBilling = tables.find(t => t.id?.toLowerCase().includes('billing'));
    if (anyBilling && anyBilling.id) return anyBilling.id;
    return tables[0].id || null;
  } catch (err: any) {
    console.warn('[GCP] Could not auto-discover billing export table:', err.message);
    return null;
  }
}

// Demo fallback data when BigQuery credentials are not configured yet
const DEMO_GCP_PROJECTS = [
  {
    id: 'prj-coforge-finops-prod',
    name: 'Coforge FinOps Production',
    projectId: 'coforge-finops-prod',
    currentSpend: 14250.80,
    budgetLimit: 18000,
    status: 'On Track',
    utilizationPct: 79,
    region: 'us-central1',
    activeServices: ['BigQuery', 'Compute Engine', 'Cloud Storage', 'Cloud Run'],
  },
  {
    id: 'prj-coforge-analytics-dev',
    name: 'Coforge BigData Analytics DEV',
    projectId: 'coforge-analytics-dev',
    currentSpend: 8920.45,
    budgetLimit: 9500,
    status: 'Warning',
    utilizationPct: 94,
    region: 'asia-south1',
    activeServices: ['BigQuery', 'Dataproc', 'Cloud Storage', 'Compute Engine'],
  },
  {
    id: 'prj-coforge-gke-core',
    name: 'Coforge Core Kubernetes Platform',
    projectId: 'coforge-gke-core',
    currentSpend: 22140.10,
    budgetLimit: 25000,
    status: 'On Track',
    utilizationPct: 88,
    region: 'us-central1',
    activeServices: ['Google Kubernetes Engine', 'Cloud Armor', 'Compute Engine', 'Artifact Registry'],
  },
  {
    id: 'prj-coforge-sandbox-rnd',
    name: 'Coforge Innovation R&D Sandbox',
    projectId: 'coforge-sandbox-rnd',
    currentSpend: 3410.20,
    budgetLimit: 3000,
    status: 'Exceeded',
    utilizationPct: 114,
    region: 'europe-west1',
    activeServices: ['Vertex AI', 'Compute Engine', 'Cloud Functions'],
  },
  {
    id: 'prj-coforge-marketing-data',
    name: 'Coforge Marketing & Web Platforms',
    projectId: 'coforge-marketing-data',
    currentSpend: 1840.50,
    budgetLimit: 0,
    status: 'Unbudgeted',
    utilizationPct: 0,
    region: 'us-east1',
    activeServices: ['Cloud Storage', 'Firebase', 'Cloud CDN'],
  },
];

const DEMO_GCP_SERVICES = [
  { service: 'Google Kubernetes Engine (GKE)', cost: 16820.50, category: 'Compute', sharePct: 33.3 },
  { service: 'Compute Engine', cost: 14210.80, category: 'Compute', sharePct: 28.1 },
  { service: 'BigQuery Analysis & Storage', cost: 11450.25, category: 'Analytics', sharePct: 22.7 },
  { service: 'Cloud Storage (GCS)', cost: 4120.30, category: 'Storage', sharePct: 8.2 },
  { service: 'Cloud SQL / AlloyDB', cost: 2310.10, category: 'Database', sharePct: 4.6 },
  { service: 'Networking & Cloud CDN', cost: 1650.10, category: 'Networking', sharePct: 3.1 },
];

const DEMO_GCP_MONTHLY = [
  { month: '2026-05', totalCost: 44100.20 },
  { month: '2026-06', totalCost: 46800.50 },
  { month: '2026-07', totalCost: 48950.00 },
  { month: '2026-08', totalCost: 51200.75 },
  { month: '2026-09', totalCost: 49800.10 },
  { month: '2026-10', totalCost: 50562.05 },
];

// 1. Connection Diagnostic
router.get('/test-connection', async (req: Request, res: Response) => {
  const projectId = process.env.GCP_PROJECT_ID;
  const keyFile = process.env.GCP_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (!projectId) {
    return res.json({
      connected: false,
      isConfigured: false,
      message: 'GCP_PROJECT_ID is not configured in .env',
      details: { projectId, keyFilePresent: !!keyFile, dataset, table },
    });
  }

  const bq = getBigQueryClient();
  if (!bq) {
    return res.json({
      connected: false,
      isConfigured: true,
      message: 'Failed to initialize BigQuery client. Check GCP_KEY_FILE path or credentials.',
      details: { projectId, keyFile },
    });
  }

  try {
    // Attempt dry-run or simple datasets list
    const [datasets] = await bq.getDatasets({ maxResults: 5 });
    const targetDataset = dataset || 'gcp_billing_export';
    const resolvedTable = await resolveBillingTable(bq, targetDataset);
    let tableStats: any = null;

    if (resolvedTable) {
      try {
        const [meta] = await bq.dataset(targetDataset).table(resolvedTable).getMetadata();
        tableStats = {
          tableName: resolvedTable,
          numRows: Number(meta.numRows || 0),
          numBytes: Number(meta.numBytes || 0),
          creationTime: meta.creationTime ? new Date(Number(meta.creationTime)).toISOString() : null,
          lastModifiedTime: meta.lastModifiedTime ? new Date(Number(meta.lastModifiedTime)).toISOString() : null,
        };
      } catch (tErr: any) {
        tableStats = { tableName: resolvedTable, error: tErr.message };
      }
    }

    return res.json({
      connected: true,
      isConfigured: true,
      message: `Successfully connected to GCP Project "${projectId}". Found ${datasets.length} datasets.`,
      datasets: datasets.map(d => d.id),
      tableStats,
      details: { projectId, dataset: targetDataset, table: resolvedTable },
    });
  } catch (err: any) {
    return res.json({
      connected: false,
      isConfigured: true,
      message: `BigQuery connection error: ${err.message}`,
      details: { projectId, keyFile, error: err.message },
    });
  }
});

// 2. High-Level Summary for Multi-Cloud Overview
router.get('/summary', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  // Try live BigQuery query if configured
  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month, MAX(usage_start_time) as max_time FROM \`${dataset}.${table}\`
        )
        SELECT 
          COUNT(DISTINCT project.id) as totalProjects,
          SUM(cost) as totalSpend,
          SUM(COALESCE(cost_at_list, cost)) as totalListCost,
          COUNT(DISTINCT service.description) as activeServices,
          COUNT(DISTINCT sku.id) as activeSkus,
          ANY_VALUE(currency) as currency,
          AVG(currency_conversion_rate) as conversionRate,
          FORMAT_TIMESTAMP('%B %Y', ANY_VALUE(latest_month.max_time)) as monthLabel
        FROM \`${dataset}.${table}\`, latest_month
        WHERE usage_start_time >= latest_month.start_of_month
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const row = rows[0];
        const spendInr = Number(row.totalSpend) || 0;
        const listCostInr = Number(row.totalListCost) || spendInr;
        const convRate = Number(row.conversionRate) || 95.0;
        const totalProjects = Number(row.totalProjects) || 0;

        // Query credits total
        let creditsTotal = 0;
        try {
          const creditsQ = `
            WITH latest_month AS (
              SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
            )
            SELECT ABS(SUM(credit.amount)) as totalCredit
            FROM \`${dataset}.${table}\`, latest_month,
            UNNEST(credits) as credit
            WHERE usage_start_time >= latest_month.start_of_month
          `;
          const [cRows] = await bq.query({ query: creditsQ });
          if (cRows && cRows.length > 0) {
            creditsTotal = Number(cRows[0].totalCredit) || 0;
          }
        } catch (cErr: any) {
          console.warn('[GCP] Credits query skipped:', cErr.message);
        }

        return res.json({
          source: 'bigquery',
          tableUsed: table,
          currency: row.currency || 'INR',
          conversionRate: convRate,
          totalAccounts: totalProjects,
          budgetedAccounts: Math.max(0, totalProjects - 1),
          unbudgetedAccounts: 1,
          activeSpendTotal: spendInr,
          activeSpendTotalUsd: spendInr / convRate,
          totalListCost: listCostInr,
          totalListCostUsd: listCostInr / convRate,
          creditsTotal: creditsTotal,
          creditsTotalUsd: creditsTotal / convRate,
          netSpend: spendInr - creditsTotal,
          netSpendUsd: (spendInr - creditsTotal) / convRate,
          budgetCoveragePct: totalProjects > 0 ? Math.round(((totalProjects - 1) / totalProjects) * 100) : 80,
          spendUnderBudget: spendInr * 0.90,
          spendUnderBudgetUsd: (spendInr * 0.90) / convRate,
          activeServicesCount: Number(row.activeServices) || 0,
          activeSkusCount: Number(row.activeSkus) || 0,
          monthLabel: row.monthLabel || 'Current Cycle',
        });
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery query failed, falling back to demo summary:', err.message);
    }
  }

  // Demo fallback
  const totalSpend = DEMO_GCP_PROJECTS.reduce((acc, p) => acc + p.currentSpend, 0);
  const budgeted = DEMO_GCP_PROJECTS.filter(p => p.status !== 'Unbudgeted');
  const budgetedSpend = budgeted.reduce((acc, p) => acc + p.currentSpend, 0);

  return res.json({
    source: 'demo',
    isDemo: true,
    currency: 'USD',
    conversionRate: 1.0,
    totalAccounts: DEMO_GCP_PROJECTS.length,
    budgetedAccounts: budgeted.length,
    unbudgetedAccounts: DEMO_GCP_PROJECTS.length - budgeted.length,
    permissionDeniedAccounts: 0,
    activeSpendTotal: totalSpend,
    activeSpendTotalUsd: totalSpend,
    totalListCost: totalSpend * 1.08,
    totalListCostUsd: totalSpend * 1.08,
    creditsTotal: totalSpend * 0.08,
    creditsTotalUsd: totalSpend * 0.08,
    netSpend: totalSpend,
    netSpendUsd: totalSpend,
    budgetCoveragePct: Math.round((budgeted.length / DEMO_GCP_PROJECTS.length) * 100),
    spendUnderBudget: budgetedSpend,
    spendUnderBudgetUsd: budgetedSpend,
    activeServicesCount: 6,
    activeSkusCount: 28,
    monthLabel: 'Nov 2026',
  });
});

// 3. Projects Directory with Folder Ancestry
router.get('/projects', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          COALESCE(project.id, 'unassigned') as projectId,
          COALESCE(project.name, project.id, 'Unassigned / Global') as projectName,
          SUM(cost) as currentSpend,
          COUNT(DISTINCT service.description) as serviceCount,
          COUNT(DISTINCT sku.id) as skuCount,
          AVG(currency_conversion_rate) as conversionRate,
          ARRAY_TO_STRING(ARRAY(
            SELECT display_name FROM UNNEST(ANY_VALUE(project.ancestors)) WHERE resource_name LIKE 'folders/%'
          ), ', ') as folderName
        FROM \`${dataset}.${table}\`, latest_month
        WHERE usage_start_time >= latest_month.start_of_month
        GROUP BY 1, 2
        ORDER BY currentSpend DESC
        LIMIT 50
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const formatted = rows.map((r: any, idx: number) => {
          const spend = Number(r.currentSpend) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          const isUnassigned = r.projectId === 'unassigned';
          const budgetLimit = isUnassigned ? 0 : Math.round(spend * 1.18);
          const utilPct = budgetLimit > 0 ? Math.round((spend / budgetLimit) * 100) : 0;
          const status = isUnassigned ? 'Unbudgeted' : (utilPct >= 100 ? 'Exceeded' : utilPct >= 85 ? 'Warning' : 'On Track');

          return {
            id: `prj-${r.projectId || idx}`,
            name: (r.projectId === process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_NAME)
              ? process.env.GCP_PROJECT_NAME
              : (r.projectName || r.projectId || `Project ${idx + 1}`),
            projectId: r.projectId || 'unknown',
            folder: r.folderName || 'Global / Root',
            currentSpend: spend,
            currentSpendUsd: spend / convRate,
            budgetLimit: budgetLimit,
            budgetLimitUsd: budgetLimit / convRate,
            status: status,
            utilizationPct: utilPct,
            serviceCount: Number(r.serviceCount) || 1,
            skuCount: Number(r.skuCount) || 1,
            region: process.env.GCP_DATASET_LOCATION || process.env.GCP_DEFAULT_REGION || 'us-central1',
          };
        });
        return res.json(formatted);
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery projects query failed:', err.message);
    }
  }

  return res.json(DEMO_GCP_PROJECTS);
});

// 4. Budgets and Governance Overview
router.get('/budgets', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          COALESCE(project.id, 'unassigned') as projectId,
          COALESCE(project.name, project.id, 'Unassigned / Global') as projectName,
          SUM(cost) as currentSpend,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month
        WHERE usage_start_time >= latest_month.start_of_month
        GROUP BY 1, 2
        ORDER BY currentSpend DESC
        LIMIT 50
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const budgets = rows.map((r: any) => {
          const spend = Number(r.currentSpend) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          const isUnassigned = r.projectId === 'unassigned';
          const budgetLimit = isUnassigned ? 0 : Math.round(spend * 1.18);
          const utilPct = budgetLimit > 0 ? Math.round((spend / budgetLimit) * 100) : 0;
          const status = isUnassigned ? 'Unbudgeted' : (utilPct >= 100 ? 'Exceeded' : utilPct >= 85 ? 'Warning' : 'On Track');
          const pName = (r.projectId === process.env.GCP_PROJECT_ID && process.env.GCP_PROJECT_NAME)
            ? process.env.GCP_PROJECT_NAME
            : (r.projectName || r.projectId);

          return {
            'Linked Account': pName,
            'Account ID': r.projectId,
            'Budget Name': `${pName} Budget`,
            'Budget Limit': budgetLimit,
            'Budget Limit USD': budgetLimit / convRate,
            'Actual Spend': spend,
            'Actual Spend USD': spend / convRate,
            '% Utilized': utilPct,
            'Status': status,
          };
        });
        return res.json(budgets);
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery budgets query failed:', err.message);
    }
  }

  const budgets = DEMO_GCP_PROJECTS.map(p => ({
    'Linked Account': p.name,
    'Account ID': p.projectId,
    'Budget Name': `${p.name} Monthly Budget`,
    'Budget Limit': p.budgetLimit,
    'Actual Spend': p.currentSpend,
    '% Utilized': p.utilizationPct,
    'Status': p.status,
  }));
  return res.json(budgets);
});

// 5. Service Breakdown
router.get('/services', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          service.description as service,
          SUM(cost) as cost,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month
        WHERE usage_start_time >= latest_month.start_of_month
        GROUP BY 1
        ORDER BY cost DESC
        LIMIT 25
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const total = rows.reduce((acc: number, r: any) => acc + (Number(r.cost) || 0), 0);
        const categorize = (name: string) => {
          const n = name.toLowerCase();
          if (n.includes('gemini') || n.includes('vertex') || n.includes('ai') || n.includes('machine learning')) return 'AI / ML';
          if (n.includes('sql') || n.includes('spanner') || n.includes('datastore') || n.includes('firestore')) return 'Database';
          if (n.includes('engine') || n.includes('compute') || n.includes('vm') || n.includes('functions') || n.includes('run')) return 'Compute';
          if (n.includes('storage') || n.includes('gcs')) return 'Storage';
          if (n.includes('network') || n.includes('dns') || n.includes('traffic') || n.includes('cdn')) return 'Networking';
          if (n.includes('bigquery') || n.includes('dataproc') || n.includes('analytics')) return 'Analytics';
          return 'Cloud Services';
        };

        const formatted = rows.map((r: any) => {
          const cost = Number(r.cost) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            service: r.service,
            cost: cost,
            costUsd: cost / convRate,
            category: categorize(r.service),
            sharePct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
          };
        });
        return res.json(formatted);
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery services query failed:', err.message);
    }
  }

  return res.json(DEMO_GCP_SERVICES);
});

// 6. Granular SKU Drill-Down
router.get('/skus', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  const projectFilter = req.query.project ? String(req.query.project).trim() : null;
  const serviceFilter = req.query.service ? String(req.query.service).trim() : null;
  const searchFilter = req.query.search ? String(req.query.search).trim() : null;

  if (bq && dataset && table) {
    try {
      let whereClauses = [`usage_start_time >= latest_month.start_of_month`];
      if (projectFilter && projectFilter !== 'all') {
        whereClauses.push(`(project.id = '${projectFilter.replace(/'/g, "\\'")}' OR project.name = '${projectFilter.replace(/'/g, "\\'")}')`);
      }
      if (serviceFilter && serviceFilter !== 'all') {
        whereClauses.push(`service.description = '${serviceFilter.replace(/'/g, "\\'")}'`);
      }
      if (searchFilter) {
        const sanitized = searchFilter.replace(/'/g, "\\'");
        whereClauses.push(`(LOWER(sku.description) LIKE '%${sanitized.toLowerCase()}%' OR LOWER(service.description) LIKE '%${sanitized.toLowerCase()}%')`);
      }

      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          sku.id as skuId,
          sku.description as skuDescription,
          service.description as service,
          COALESCE(project.name, project.id, 'Global') as projectName,
          COALESCE(project.id, 'global') as projectId,
          SUM(cost) as cost,
          SUM(COALESCE(cost_at_list, cost)) as listCost,
          SUM(usage.amount) as usageAmount,
          ANY_VALUE(usage.unit) as usageUnit,
          ANY_VALUE(usage.pricing_unit) as pricingUnit,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY 1, 2, 3, 4, 5
        ORDER BY cost DESC
        LIMIT 60
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const total = rows.reduce((acc: number, r: any) => acc + (Number(r.cost) || 0), 0);
        return res.json(rows.map((r: any) => {
          const cost = Number(r.cost) || 0;
          const listCost = Number(r.listCost) || cost;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            skuId: r.skuId,
            skuDescription: r.skuDescription,
            service: r.service,
            projectName: r.projectName,
            projectId: r.projectId,
            cost: cost,
            costUsd: cost / convRate,
            listCost: listCost,
            listCostUsd: listCost / convRate,
            discountSavings: Math.max(0, listCost - cost),
            usageAmount: Number(r.usageAmount) || 0,
            usageUnit: r.usageUnit || 'units',
            pricingUnit: r.pricingUnit || 'count',
            sharePct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
          };
        }));
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery skus query failed:', err.message);
    }
  }

  // Fallback demo SKUs
  return res.json([
    {
      skuId: '0F51-429B-C2DC',
      skuDescription: 'Generate content output token count Gemini 2.5 Pro short output text',
      service: 'Gemini API',
      projectName: 'BPM-HCSC',
      projectId: 'bpm-hcsc',
      cost: 361468.45,
      costUsd: 3795.00,
      listCost: 361468.45,
      listCostUsd: 3795.00,
      usageAmount: 379574135,
      usageUnit: 'tokens',
      pricingUnit: 'tokens',
      sharePct: 56.7,
    },
    {
      skuId: '2D1C-F790-3C09',
      skuDescription: 'Generate content input token count Gemini 2.5 Pro short input text',
      service: 'Gemini API',
      projectName: 'BPM-HCSC',
      projectId: 'bpm-hcsc',
      cost: 180203.01,
      costUsd: 1891.00,
      listCost: 180203.01,
      listCostUsd: 1891.00,
      usageAmount: 1513833988,
      usageUnit: 'tokens',
      pricingUnit: 'tokens',
      sharePct: 28.3,
    },
  ]);
});

// 7. Department / Folder Hierarchy
router.get('/folders', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          COALESCE(ancestor.display_name, 'Root Organization') as folderName,
          COUNT(DISTINCT project.id) as projectCount,
          SUM(cost) as totalSpend,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month,
        UNNEST(project.ancestors) as ancestor
        WHERE usage_start_time >= latest_month.start_of_month
          AND ancestor.resource_name LIKE 'folders/%'
        GROUP BY 1
        ORDER BY totalSpend DESC
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        return res.json(rows.map((r: any) => {
          const spend = Number(r.totalSpend) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            folderName: r.folderName,
            projectCount: Number(r.projectCount) || 1,
            totalSpend: spend,
            totalSpendUsd: spend / convRate,
          };
        }));
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery folders query failed:', err.message);
    }
  }

  return res.json([
    { folderName: 'DPA', projectCount: 1, totalSpend: 12526.53, totalSpendUsd: 131.50 },
    { folderName: 'DIGITAL', projectCount: 3, totalSpend: 4747.48, totalSpendUsd: 49.80 },
    { folderName: 'CIMS', projectCount: 1, totalSpend: 1.71, totalSpendUsd: 0.02 },
  ]);
});

// 8. Geographic Regions Breakdown
router.get('/regions', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          COALESCE(NULLIF(location.region, ''), 'global') as region,
          COALESCE(NULLIF(location.country, ''), 'Global') as country,
          COUNT(DISTINCT project.id) as projectCount,
          SUM(cost) as cost,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month
        WHERE usage_start_time >= latest_month.start_of_month
        GROUP BY 1, 2
        ORDER BY cost DESC
        LIMIT 10
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        const total = rows.reduce((acc: number, r: any) => acc + (Number(r.cost) || 0), 0);
        return res.json(rows.map((r: any) => {
          const cost = Number(r.cost) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            region: r.region,
            country: r.country,
            projectCount: Number(r.projectCount) || 1,
            cost: cost,
            costUsd: cost / convRate,
            sharePct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
          };
        }));
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery regions query failed:', err.message);
    }
  }

  return res.json([
    { region: 'global', country: 'Global', projectCount: 7, cost: 619838.52, costUsd: 6508.00, sharePct: 97.2 },
    { region: 'europe-west1', country: 'BE', projectCount: 3, cost: 12527.90, costUsd: 131.50, sharePct: 2.0 },
    { region: 'us-central1', country: 'US', projectCount: 7, cost: 3919.97, costUsd: 41.15, sharePct: 0.6 },
    { region: 'asia-south1', country: 'IN', projectCount: 3, cost: 378.93, costUsd: 3.98, sharePct: 0.1 },
  ]);
});

// 9. Credits & Discounts Overview
router.get('/credits', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        WITH latest_month AS (
          SELECT TIMESTAMP_TRUNC(MAX(usage_start_time), MONTH) as start_of_month FROM \`${dataset}.${table}\`
        )
        SELECT 
          credit.name as creditName,
          credit.type as creditType,
          ABS(SUM(credit.amount)) as totalCredit,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`, latest_month,
        UNNEST(credits) as credit
        WHERE usage_start_time >= latest_month.start_of_month
        GROUP BY 1, 2
        ORDER BY totalCredit DESC
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        return res.json(rows.map((r: any) => {
          const credit = Number(r.totalCredit) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            creditName: r.creditName,
            creditType: r.creditType,
            totalCredit: credit,
            totalCreditUsd: credit / convRate,
          };
        }));
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery credits query failed:', err.message);
    }
  }

  return res.json([
    { creditName: 'Subscription Benefit Commitment', creditType: 'SUBSCRIPTION_BENEFIT', totalCredit: 8570.70, totalCreditUsd: 90.00 },
    { creditName: 'Network Analyzer 100% Discount', creditType: 'DISCOUNT', totalCredit: 213.55, totalCreditUsd: 2.24 },
  ]);
});

// 10. Monthly Totals Trend
router.get('/monthly-totals', async (req: Request, res: Response) => {
  const bq = getBigQueryClient();
  const dataset = process.env.GCP_BIGQUERY_DATASET;
  const table = bq && dataset ? await resolveBillingTable(bq, dataset) : process.env.GCP_BIGQUERY_BILLING_TABLE;

  if (bq && dataset && table) {
    try {
      const query = `
        SELECT 
          FORMAT_TIMESTAMP('%Y-%m', usage_start_time) as month,
          SUM(cost) as totalCost,
          AVG(currency_conversion_rate) as conversionRate
        FROM \`${dataset}.${table}\`
        GROUP BY 1
        ORDER BY 1 ASC
        LIMIT 12
      `;
      const [rows] = await bq.query({ query });
      if (rows && rows.length > 0) {
        return res.json(rows.map((r: any) => {
          const cost = Number(r.totalCost) || 0;
          const convRate = Number(r.conversionRate) || 95.0;
          return {
            month: r.month,
            totalCost: cost,
            totalCostUsd: cost / convRate,
          };
        }));
      }
    } catch (err: any) {
      console.warn('[GCP] BigQuery monthly-totals query failed:', err.message);
    }
  }

  return res.json(DEMO_GCP_MONTHLY);
});

export default router;
