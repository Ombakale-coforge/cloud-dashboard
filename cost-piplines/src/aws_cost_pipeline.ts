/**
 * src/aws_cost_pipeline.ts
 *
 * TypeScript AWS cost reporting pipeline (Multi-Account Supported).
 * Pulls AWS Cost Explorer data, computes FinOps insights, and persists directly into SQL Server.
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import { fileURLToPath } from "url";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  OrganizationsClient,
  paginateListAccounts,
} from "@aws-sdk/client-organizations";
import {
  BudgetsClient,
  DescribeBudgetsCommand,
} from "@aws-sdk/client-budgets";
import {
  saveAwsReportRunToDb,
  AwsAccountConfig,
  MonthlyDataRecord,
  LinkedAccountData,
} from "./aws_db_writer.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, "..");
const MONTHS_OF_HISTORY = parseInt(
  process.env.AWS_COST_MONTHS_HISTORY || "6",
  10,
);

// ---------------------------------------------------------------------------
// Discover configured AWS accounts from .env
// ---------------------------------------------------------------------------
export function getAwsAccountConfigs(): AwsAccountConfig[] {
  const accounts: AwsAccountConfig[] = [];

  // Account 1 (Primary / Default)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    accounts.push({
      id: "account-1",
      name:
        process.env.AWS_ACCOUNT_NAME ||
        process.env.AWS_ACCOUNT_1_NAME ||
        "AWS Account 1 (5076-7238-5186)",
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || "us-east-1",
      isPrimary: true,
    });
  }

  // Account 2
  if (
    process.env.AWS_ACCOUNT_2_ACCESS_KEY_ID &&
    process.env.AWS_ACCOUNT_2_SECRET_ACCESS_KEY
  ) {
    accounts.push({
      id: "account-2",
      name:
        process.env.AWS_ACCOUNT_2_NAME ||
        "AWS Account 2 (5131-6780-3309)",
      accessKeyId: process.env.AWS_ACCOUNT_2_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_ACCOUNT_2_SECRET_ACCESS_KEY,
      region:
        process.env.AWS_ACCOUNT_2_REGION ||
        process.env.AWS_REGION ||
        "us-east-1",
      isPrimary: false,
    });
  }

  // Scan for any further accounts (AWS_ACCOUNT_3, AWS_ACCOUNT_4, etc.)
  for (let i = 3; i <= 10; i++) {
    const key = process.env[`AWS_ACCOUNT_${i}_ACCESS_KEY_ID`];
    const secret = process.env[`AWS_ACCOUNT_${i}_SECRET_ACCESS_KEY`];
    if (key && secret) {
      accounts.push({
        id: `account-${i}`,
        name: process.env[`AWS_ACCOUNT_${i}_NAME`] || `AWS Account ${i}`,
        accessKeyId: key,
        secretAccessKey: secret,
        region:
          process.env[`AWS_ACCOUNT_${i}_REGION`] ||
          process.env.AWS_REGION ||
          "us-east-1",
        isPrimary: false,
      });
    }
  }

  return accounts;
}

// ---------------------------------------------------------------------------
// Category rules for grouping services. Order matters - first match wins.
// ---------------------------------------------------------------------------
const CATEGORY_RULES: Array<[string, string[]]> = [
  ["AI/ML - Bedrock", ["bedrock", "claude"]],
  [
    "AI/ML - Other",
    [
      "sagemaker",
      "comprehend",
      "textract",
      "polly",
      "transcribe",
      "lex",
      "rekognition",
    ],
  ],
  [
    "Compute",
    ["ec2", "lightsail", "app runner", "lambda", "elastic container", "batch"],
  ],
  ["Storage", ["s3", "glacier", "efs", "elastic file system", "backup"]],
  [
    "Database",
    [
      "rds",
      "relational database",
      "dynamodb",
      "documentdb",
      "elasticache",
      "redshift",
    ],
  ],
  [
    "Networking",
    [
      "vpc",
      "route 53",
      "cloudfront",
      "elastic load balancing",
      "direct connect",
      "data transfer",
    ],
  ],
  [
    "Security & Governance",
    [
      "guardduty",
      "security hub",
      "waf",
      "kms",
      "key management",
      "secrets manager",
      "cognito",
      "config",
      "audit manager",
      "certificate manager",
      "iam",
    ],
  ],
  ["Monitoring & Logging", ["cloudwatch", "cloudtrail", "x-ray"]],
  [
    "Serverless/Integration",
    ["step functions", "sqs", "sns", "eventbridge", "api gateway", "appsync"],
  ],
  [
    "Analytics",
    [
      "athena",
      "glue",
      "quicksight",
      "kinesis",
      "data pipeline",
      "opensearch",
      "managed streaming",
    ],
  ],
  ["Tax", ["tax"]],
  ["Support", ["support"]],
];

function categorizeService(serviceName: string): string {
  const name = serviceName.toLowerCase();
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((kw) => name.includes(kw))) return category;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Date helpers - LOCAL calendar dates, no UTC drift.
// ---------------------------------------------------------------------------
function toDateStr(year: number, monthIndexZeroBased: number, day: number): string {
  const mm = String(monthIndexZeroBased + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function firstOfMonthStr(date: Date, monthOffset = 0): string {
  const d = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
  return toDateStr(d.getFullYear(), d.getMonth(), 1);
}

function round(n: number, decimals = 2): number {
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 5, baseDelayMs = 500 } = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const retriable =
        e.name === "ThrottlingException" ||
        e.name === "LimitExceededException" ||
        e.name === "TooManyRequestsException" ||
        e.$metadata?.httpStatusCode === 429;
      attempt += 1;
      if (!retriable || attempt > retries) throw e;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.log(
        `Throttled (${e.name}), retrying in ${delay}ms (attempt ${attempt}/${retries})...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1: Fetch cost by service, last N months -> pivoted structure
// ---------------------------------------------------------------------------
async function fetchCostByService(
  ceClient: CostExplorerClient,
  monthsBack: number,
  log: (msg: string) => void,
): Promise<{ monthlyData: MonthlyDataRecord[]; serviceCols: string[] }> {
  const today = new Date();
  const startStr = firstOfMonthStr(today, -monthsBack);
  const endStr = firstOfMonthStr(today, 1);

  log(`Fetching cost-by-service from ${startStr} to ${endStr} ...`);

  const records: Array<{ month: string; service: string; cost: number }> = [];
  let nextToken: string | undefined;

  do {
    const command: GetCostAndUsageCommand = new GetCostAndUsageCommand({
      TimePeriod: { Start: startStr, End: endStr },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      NextPageToken: nextToken,
    });

    const response = await withRetry(() => ceClient.send(command));

    for (const result of response.ResultsByTime || []) {
      const month = (result.TimePeriod?.Start || "").slice(0, 7);
      for (const group of result.Groups || []) {
        const service = (group.Keys && group.Keys[0]) || "Unknown Service";
        const raw = group.Metrics?.UnblendedCost?.Amount;
        const cost = parseFloat(raw || "0");
        if (Number.isNaN(cost)) {
          log(
            `WARNING: could not parse cost for ${service} in ${month} (raw="${raw}") - treating as 0`,
          );
        }
        records.push({ month, service, cost: Number.isNaN(cost) ? 0 : cost });
      }
    }

    nextToken = response.NextPageToken;
  } while (nextToken);

  const months = [...new Set(records.map((r) => r.month))].sort();
  const services = [...new Set(records.map((r) => r.service))];

  const pivot: Record<string, Record<string, number>> = {};
  for (const m of months) pivot[m] = {};
  for (const r of records) {
    pivot[r.month][r.service] = (pivot[r.month][r.service] || 0) + r.cost;
  }

  const monthlyData: MonthlyDataRecord[] = months.map((m) => {
    const serviceCosts: Record<string, number> = {};
    let total = 0;
    for (const s of services) {
      const val = pivot[m][s] || 0;
      serviceCosts[s] = val;
      total += val;
    }
    return { month: m, services: serviceCosts, totalCost: total };
  });

  return { monthlyData, serviceCols: services };
}

// ---------------------------------------------------------------------------
// Step 2: Fetch cost by linked account (last N months)
// ---------------------------------------------------------------------------
async function fetchCostByLinkedAccount(
  ceClient: CostExplorerClient,
  orgClient: OrganizationsClient,
  monthsBack: number,
  log: (msg: string) => void,
): Promise<LinkedAccountData & { accountMap: Record<string, string> }> {
  const today = new Date();
  const startStr = firstOfMonthStr(today, -monthsBack);
  const endStr = firstOfMonthStr(today, 1);

  log(
    `Fetching cost by linked account from ${startStr} to ${endStr} (${monthsBack + 1} months) ...`,
  );

  const accountMap: Record<string, string> = {};
  const fullAccountDetails: Array<{
    Id: string;
    Name?: string;
    Status?: string;
    Arn?: string;
    Email?: string;
  }> = [];
  try {
    for await (const page of paginateListAccounts({ client: orgClient }, {})) {
      for (const account of page.Accounts || []) {
        if (account.Id) {
          accountMap[account.Id] = account.Name || account.Id;
          fullAccountDetails.push({
            Id: account.Id,
            Name: account.Name,
            Status: account.Status,
            Arn: account.Arn,
            Email: account.Email,
          });
        }
      }
    }
    log(`Found ${fullAccountDetails.length} linked accounts.`);
  } catch (e: any) {
    log(
      `Could not fetch account names from Organizations API (${e.message}). Falling back to raw account IDs.`,
    );
  }

  const command = new GetCostAndUsageCommand({
    TimePeriod: { Start: startStr, End: endStr },
    Granularity: "MONTHLY",
    Metrics: ["UnblendedCost"],
    GroupBy: [{ Type: "DIMENSION", Key: "LINKED_ACCOUNT" }],
  });

  const response = await withRetry(() => ceClient.send(command));

  const pivot: Record<string, Record<string, number>> = {};
  const months: string[] = [];

  for (const result of response.ResultsByTime || []) {
    const month = (result.TimePeriod?.Start || "").slice(0, 7);
    if (!months.includes(month)) months.push(month);
    for (const group of result.Groups || []) {
      const accountId = (group.Keys && group.Keys[0]) || "Unknown Account";
      const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount || "0") || 0;
      if (!pivot[accountId]) pivot[accountId] = {};
      pivot[accountId][month] = round(cost);
    }
  }

  months.sort();
  const currMonth = months[months.length - 1];

  const singleMonthRows: Array<{ "Linked Account": string; Cost: number }> = [];

  log(`Months found for linked accounts: ${months.join(", ")}`);

  for (const [accountId, costs] of Object.entries(pivot)) {
    const accountName = accountMap[accountId] || accountId;
    const currCost = costs[currMonth] || 0;

    singleMonthRows.push({
      "Linked Account": accountName,
      Cost: currCost,
    });
  }

  singleMonthRows.sort((a, b) => b.Cost - a.Cost);

  return { singleMonthRows, accountMap, widePivot: pivot, fullAccountDetails };
}

// ---------------------------------------------------------------------------
// Step 3: Fetch AWS Budgets
// ---------------------------------------------------------------------------
async function fetchBudgets(
  budgetsClient: BudgetsClient,
  accountId: string | null,
  log: (msg: string) => void,
): Promise<any[]> {
  log(`Fetching AWS Budgets for account ${accountId} ...`);
  const budgets: any[] = [];
  try {
    const cleanId = String(accountId || "").replace(/[^0-9]/g, "");
    if (!cleanId) {
      log("Warning: No valid numeric AccountId for AWS Budgets.");
      return [];
    }
    let nextToken: string | undefined;
    do {
      const command: DescribeBudgetsCommand = new DescribeBudgetsCommand({
        AccountId: cleanId,
        NextToken: nextToken,
      });
      const response = await withRetry(() => budgetsClient.send(command));
      if (response.Budgets) {
        budgets.push(...response.Budgets);
      }
      nextToken = response.NextToken;
    } while (nextToken);
    log(`Found ${budgets.length} budget(s).`);
  } catch (e: any) {
    log(`Could not fetch AWS Budgets (${e.message}).`);
  }
  return budgets;
}

// ---------------------------------------------------------------------------
// Step 4: Organization & Budget Governance Insights
// ---------------------------------------------------------------------------
function buildOrganizationGovernance({
  fullAccountDetails,
  budgets,
  monthlyData,
  wideAccountPivot,
  log,
}: {
  fullAccountDetails?: Array<{ Id: string; Name?: string; Status?: string }>;
  budgets: any[];
  monthlyData: MonthlyDataRecord[];
  wideAccountPivot: Record<string, Record<string, number>>;
  log: (msg: string) => void;
}) {
  const months = monthlyData.map((m) => m.month).sort();
  const latestMonth = months[months.length - 1] || "";
  const prevMonth = months.length > 1 ? months[months.length - 2] : "";

  const accounts =
    fullAccountDetails && fullAccountDetails.length > 0
      ? fullAccountDetails
      : Object.keys(wideAccountPivot).map((id) => ({
          Id: id,
          Name: id,
          Status: "ACTIVE",
        }));

  const totalAccounts = accounts.length;
  const activeList = accounts.filter(
    (a) => !a.Status || a.Status === "ACTIVE",
  );
  const activeAccountsCount = activeList.length;
  const suspendedList = accounts.filter(
    (a) => a.Status === "SUSPENDED" || a.Status === "PENDING_CLOSURE",
  );
  const suspendedAccountsCount = suspendedList.length;

  const budgetOverviewRows: any[] = [];
  let sumBudgetLimits = 0;
  const budgetedAccountIds = new Set<string>();
  const budgetedAccountNames = new Set<string>();

  for (const b of budgets) {
    const name = b.BudgetName || "Unnamed Budget";
    const limit = parseFloat(b.BudgetLimit?.Amount) || 0;
    const used = parseFloat(b.CalculatedSpend?.ActualSpend?.Amount) || 0;
    const forecast = parseFloat(b.CalculatedSpend?.ForecastedSpend?.Amount) || 0;
    const pct = limit > 0 ? round((used / limit) * 100, 1) : 0;
    const isExceeded = pct >= 100;
    const thresholdStatus = isExceeded ? "Exceeded (1)" : pct >= 80 ? "Warning" : "OK";

    sumBudgetLimits += limit;

    if (b.CostFilters?.LinkedAccount) {
      b.CostFilters.LinkedAccount.forEach((id: string) => budgetedAccountIds.add(id));
    }
    budgetedAccountNames.add(name.toLowerCase().trim());

    budgetOverviewRows.push({
      "Budget Name": name,
      Limit: round(limit),
      "Current Used": round(used),
      "Forecasted Spend": round(forecast),
      "Current vs Budget %": pct,
      "Threshold Status": thresholdStatus,
      "Health Status": isExceeded ? "Alert" : "Healthy",
    });
  }

  let accountsWithBudgetCount = 0;
  let activeSpendTotal = 0;
  let spendUnderBudget = 0;
  let spendWithNoBudget = 0;
  const unbudgetedAccountRows: any[] = [];

  for (const acc of activeList) {
    const accId = acc.Id;
    const costs = wideAccountPivot[accId] || {};
    const currCost = costs[latestMonth] || 0;
    const prevCost = costs[prevMonth] || 0;
    const diff = currCost - prevCost;
    const momChange = prevCost > 0 ? round((diff / prevCost) * 100, 1) : 0;

    activeSpendTotal += currCost;

    const isBudgeted =
      budgetedAccountIds.has(accId) ||
      Array.from(budgetedAccountNames).some(
        (bName) =>
          (acc.Name || "").toLowerCase().includes(bName) || bName.includes((acc.Name || "").toLowerCase()),
      );

    if (isBudgeted) {
      accountsWithBudgetCount += 1;
      spendUnderBudget += currCost;
    } else {
      spendWithNoBudget += currCost;
      if (currCost > 0 || prevCost > 0) {
        unbudgetedAccountRows.push({
          "Account Name": acc.Name || accId,
          "Account ID": accId,
          Status: acc.Status || "ACTIVE",
          "Current Month Spend": round(currCost),
          "Previous Month Spend": round(prevCost),
          "MoM Change %": momChange,
          "Top Cost Driver": "Cloud Services",
        });
      }
    }
  }

  if (accountsWithBudgetCount === 0 && budgets.length > 0) {
    accountsWithBudgetCount = Math.min(budgets.length, activeAccountsCount);
    const totalBudgetUsed = budgetOverviewRows.reduce((acc, b) => acc + (b["Current Used"] || 0), 0);
    spendUnderBudget = Math.min(activeSpendTotal, totalBudgetUsed);
    spendWithNoBudget = Math.max(0, activeSpendTotal - spendUnderBudget);
  }

  const accountsWithNoBudgetCount = Math.max(0, activeAccountsCount - accountsWithBudgetCount);
  const budgetCoveragePct =
    activeAccountsCount > 0
      ? round((accountsWithBudgetCount / activeAccountsCount) * 100, 1)
      : 0;
  const shareSpendUncoveredPct =
    activeSpendTotal > 0
      ? round((spendWithNoBudget / activeSpendTotal) * 100, 1)
      : 0;

  unbudgetedAccountRows.sort((a, b) => b["Current Month Spend"] - a["Current Month Spend"]);

  let suspendedAccountsChargingCount = 0;
  let suspendedAccountsSpendTotal = 0;

  for (const acc of suspendedList) {
    const costs = wideAccountPivot[acc.Id] || {};
    let totalSuspendedSpend = 0;
    for (const m of months) {
      totalSuspendedSpend += costs[m] || 0;
    }
    if (totalSuspendedSpend > 0) {
      suspendedAccountsChargingCount += 1;
      suspendedAccountsSpendTotal += totalSuspendedSpend;
    }
  }

  const suspendedPeriodLabel =
    months.length > 0
      ? `${months[0]} to ${months[months.length - 1]} Total`
      : "Period Total";

  const governanceSummary = {
    totalAccounts,
    activeAccounts: activeAccountsCount,
    suspendedAccounts: suspendedAccountsCount,
    accountsWithBudget: accountsWithBudgetCount,
    accountsWithNoBudget: accountsWithNoBudgetCount,
    budgetCoveragePct,
    selectedMonth: latestMonth,
    activeSpendTotal: round(activeSpendTotal),
    spendUnderBudget: round(spendUnderBudget),
    spendWithNoBudget: round(spendWithNoBudget),
    shareSpendUncoveredPct,
    sumBudgetLimits: round(sumBudgetLimits),
    suspendedAccountsChargingCount,
    suspendedAccountsSpendTotal: round(suspendedAccountsSpendTotal),
    suspendedPeriodLabel,
  };

  return { governanceSummary, unbudgetedAccountRows, budgetOverviewRows };
}

// ---------------------------------------------------------------------------
// Run Pipeline for a Single AWS Account
// ---------------------------------------------------------------------------
async function processAccount(accountConfig: AwsAccountConfig): Promise<boolean> {
  const { id, name, accessKeyId, secretAccessKey, region } = accountConfig;

  console.log(`\n==========================================================`);
  console.log(`🚀 Running AWS Cost Pipeline for: ${name} (${id})`);
  console.log(`   Region: ${region || "us-east-1"}`);
  console.log(`==========================================================`);

  const RUN_STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const runLog: string[] = [];
  function log(msg: string) {
    const line = `[${new Date().toISOString()}] [${id}] ${msg}`;
    console.log(line);
    runLog.push(line);
  }

  if (!accessKeyId || !secretAccessKey) {
    log(`❌ Missing credentials for account ${name}`);
    return false;
  }

  const ceClient = new CostExplorerClient({
    region: region || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
  });
  const orgClient = new OrganizationsClient({
    region: region || "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
  });
  const budgetsClient = new BudgetsClient({
    region: "us-east-1",
    credentials: { accessKeyId, secretAccessKey },
  });

  const numericAccountIdMatch = name.match(/\d{4}-?\d{4}-?\d{4}/) || name.match(/\d{12}/);
  const cleanAccountId = numericAccountIdMatch ? numericAccountIdMatch[0].replace(/[^0-9]/g, "") : null;

  try {
    const [serviceResult, accountResult, budgetsResult] = await Promise.allSettled([
      fetchCostByService(ceClient, MONTHS_OF_HISTORY, log),
      fetchCostByLinkedAccount(ceClient, orgClient, MONTHS_OF_HISTORY, log),
      fetchBudgets(budgetsClient, cleanAccountId, log),
    ]);

    if (serviceResult.status === "rejected") {
      log(`FATAL: cost-by-service fetch failed: ${serviceResult.reason.message}`);
      return false;
    }

    const { monthlyData, serviceCols } = serviceResult.value;

    if (monthlyData.length === 0) {
      log("No cost data returned - check date range / permissions.");
      return false;
    }

    log(`Got ${monthlyData.length} month(s) of data across ${serviceCols.length} services.`);

    let governanceData: any = null;
    let linkedAccountData: LinkedAccountData | null = null;
    let budgetsList: any[] = [];

    if (accountResult.status === "fulfilled") {
      const { singleMonthRows, widePivot, fullAccountDetails } = accountResult.value;
      linkedAccountData = { singleMonthRows, widePivot, fullAccountDetails };

      budgetsList = budgetsResult.status === "fulfilled" ? budgetsResult.value : [];
      governanceData = buildOrganizationGovernance({
        fullAccountDetails,
        budgets: budgetsList,
        monthlyData,
        wideAccountPivot: widePivot,
        log,
      });
    } else {
      log(
        `Skipped linked account export (likely missing Organizations permission): ${accountResult.reason.message}`,
      );
    }

    // Save directly to SQL Server via Prisma
    try {
      await saveAwsReportRunToDb({
        accountConfig,
        runStamp: RUN_STAMP,
        monthsHistory: MONTHS_OF_HISTORY,
        monthlyData,
        serviceCols,
        linkedAccountData,
        budgetsData: budgetsList,
        unbudgetedAccounts: governanceData?.unbudgetedAccountRows || [],
        governanceSummary: governanceData?.governanceSummary || null,
        runLog,
      });
      log(`🗄️ Successfully persisted ${name} data to SQL Server.`);
    } catch (dbError: any) {
      log(`⚠️ Database save error: ${dbError.message}`);
    }

    log(`✅ Account ${name} processing completed successfully.`);
    return true;
  } catch (err: any) {
    log(`❌ Error processing account ${name}: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------
export async function main(): Promise<void> {
  const accounts = getAwsAccountConfigs();

  if (accounts.length === 0) {
    console.error(
      "❌ No AWS account credentials found in .env.\n" +
        "Please set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY (and optionally AWS_ACCOUNT_2_*).",
    );
    process.exit(1);
  }

  console.log(`Found ${accounts.length} configured AWS account(s):`);
  accounts.forEach((a, idx) => console.log(`  ${idx + 1}. [${a.id}] ${a.name} (${a.region || "us-east-1"})`));

  for (const acc of accounts) {
    await processAccount(acc);
  }

  console.log(`\n==========================================================`);
  console.log(`🎉 Multi-Account AWS Cost Pipeline Finished!`);
  console.log(`==========================================================\n`);
}

main().catch((err) => {
  console.error("Pipeline run failed:", err);
  process.exit(1);
});
