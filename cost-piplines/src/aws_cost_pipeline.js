/**
 * src/aws_cost_pipeline.js
 *
 * Node.js AWS cost reporting pipeline (Multi-Account Supported).
 * Part of the "aws-cost-pipeline" project - see README.md for setup.
 *
 * What it does:
 *   1. Detects all configured AWS accounts in .env:
 *      - Account 1: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_ACCOUNT_NAME
 *      - Account 2: AWS_ACCOUNT_2_ACCESS_KEY_ID, AWS_ACCOUNT_2_SECRET_ACCESS_KEY, AWS_ACCOUNT_2_REGION, AWS_ACCOUNT_2_NAME
 *      - Supports additional accounts dynamically (AWS_ACCOUNT_3_*, etc.)
 *   2. For each account:
 *      - Pulls Cost Explorer data for the last N months by service and linked accounts.
 *      - Runs insight calculations (MoM % change, Pareto, anomalies, recurring vs one-time, category grouping, forecast, volatility).
 *      - Writes clean CSV files to AWSReports/accounts/<account-id>/latest/ and timestamped run folders.
 *      - Mirrors Account 1 into AWSReports/latest/ for backward compatibility.
 *   3. Emits accounts.json metadata so the frontend dashboard can populate account switcher dropdowns.
 *
 * RUN:
 *   npm start
 *   (or: node src/aws_cost_pipeline.js)
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  CostExplorerClient,
  GetCostAndUsageCommand,
} = require("@aws-sdk/client-cost-explorer");
const {
  OrganizationsClient,
  paginateListAccounts,
} = require("@aws-sdk/client-organizations");

const PROJECT_ROOT = path.join(__dirname, "..");
const BASE_OUTPUT_FOLDER =
  process.env.AWS_COST_OUTPUT_FOLDER || path.join(PROJECT_ROOT, "AWSReports");
const MONTHS_OF_HISTORY = parseInt(
  process.env.AWS_COST_MONTHS_HISTORY || "6",
  10,
);

// ---------------------------------------------------------------------------
// Discover configured AWS accounts from .env
// ---------------------------------------------------------------------------
function getAwsAccountConfigs() {
  const accounts = [];

  // Account 1 (Primary / Default)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    accounts.push({
      id: "account-1",
      name: process.env.AWS_ACCOUNT_NAME || process.env.AWS_ACCOUNT_1_NAME || "AWS Account 1 (Primary)",
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
      name: process.env.AWS_ACCOUNT_2_NAME || "AWS Account 2",
      accessKeyId: process.env.AWS_ACCOUNT_2_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_ACCOUNT_2_SECRET_ACCESS_KEY,
      region: process.env.AWS_ACCOUNT_2_REGION || process.env.AWS_REGION || "us-east-1",
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
        region: process.env[`AWS_ACCOUNT_${i}_REGION`] || process.env.AWS_REGION || "us-east-1",
        isPrimary: false,
      });
    }
  }

  return accounts;
}

// ---------------------------------------------------------------------------
// Category rules for grouping services. Order matters - first match wins.
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
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

function categorizeService(serviceName) {
  const name = serviceName.toLowerCase();
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some((kw) => name.includes(kw))) return category;
  }
  return "Other";
}

// ---------------------------------------------------------------------------
// Date helpers - LOCAL calendar dates, no UTC drift.
// ---------------------------------------------------------------------------
function toDateStr(year, monthIndexZeroBased, day) {
  const mm = String(monthIndexZeroBased + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function firstOfMonthStr(date, monthOffset = 0) {
  const d = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
  return toDateStr(d.getFullYear(), d.getMonth(), 1);
}

// ---------------------------------------------------------------------------
// Small CSV writer helper
// ---------------------------------------------------------------------------
function toCsv(rows, columns) {
  const escape = (val) => {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((c) => escape(row[c])).join(","));
  return [header, ...lines].join("\n");
}

function round(n, decimals = 2) {
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isFinite(n)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

async function withRetry(fn, { retries = 5, baseDelayMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
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
async function fetchCostByService(ceClient, monthsBack, log) {
  const today = new Date();
  const startStr = firstOfMonthStr(today, -monthsBack);
  const endStr = firstOfMonthStr(today, 1);

  log(`Fetching cost-by-service from ${startStr} to ${endStr} ...`);

  const records = [];
  let nextToken;

  do {
    const command = new GetCostAndUsageCommand({
      TimePeriod: { Start: startStr, End: endStr },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      NextPageToken: nextToken,
    });

    const response = await withRetry(() => ceClient.send(command));

    for (const result of response.ResultsByTime || []) {
      const month = result.TimePeriod.Start.slice(0, 7);
      for (const group of result.Groups || []) {
        const service = group.Keys[0];
        const raw = group.Metrics?.UnblendedCost?.Amount;
        const cost = parseFloat(raw);
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

  const pivot = {};
  for (const m of months) pivot[m] = {};
  for (const r of records) {
    pivot[r.month][r.service] = (pivot[r.month][r.service] || 0) + r.cost;
  }

  const monthlyData = months.map((m) => {
    const serviceCosts = {};
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
async function fetchCostByLinkedAccount(ceClient, orgClient, monthsBack, log, writeCsv) {
  const today = new Date();
  const startStr = firstOfMonthStr(today, -monthsBack);
  const endStr = firstOfMonthStr(today, 1);

  log(
    `Fetching cost by linked account from ${startStr} to ${endStr} (${monthsBack + 1} months) ...`,
  );

  const accountMap = {};
  try {
    for await (const page of paginateListAccounts({ client: orgClient }, {})) {
      for (const account of page.Accounts) {
        accountMap[account.Id] = account.Name;
      }
    }
    log(`Found ${Object.keys(accountMap).length} linked accounts.`);
  } catch (e) {
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

  const pivot = {};
  const months = [];

  for (const result of response.ResultsByTime || []) {
    const month = result.TimePeriod.Start.slice(0, 7);
    if (!months.includes(month)) months.push(month);
    for (const group of result.Groups || []) {
      const accountId = group.Keys[0];
      const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount) || 0;
      if (!pivot[accountId]) pivot[accountId] = {};
      pivot[accountId][month] = round(cost);
    }
  }

  months.sort();
  const prevMonth = months[months.length - 2];
  const currMonth = months[months.length - 1];

  const varianceRows = [];
  const singleMonthRows = [];
  const wideRows = [];

  log(`Months found for linked accounts: ${months.join(", ")}`);

  for (const [accountId, costs] of Object.entries(pivot)) {
    const accountName = accountMap[accountId] || accountId;
    const prevCost = costs[prevMonth] || 0;
    const currCost = costs[currMonth] || 0;
    const diff = round(currCost - prevCost);
    const pctChange = prevCost > 0 ? round((diff / prevCost) * 100, 1) : 0;

    varianceRows.push({
      "Linked Account": accountName,
      "Prev Month Cost": prevCost,
      "Curr Month Cost": currCost,
      "Difference": diff,
      "Percentage Change": pctChange,
    });

    singleMonthRows.push({
      "Linked Account": accountName,
      Cost: currCost,
    });

    const wideRow = { "Linked Account": accountName };
    for (const m of months) wideRow[m] = costs[m] || 0;
    wideRows.push(wideRow);
  }

  varianceRows.sort((a, b) => b["Curr Month Cost"] - a["Curr Month Cost"]);
  singleMonthRows.sort((a, b) => b.Cost - a.Cost);
  wideRows.sort((a, b) => (b[currMonth] || 0) - (a[currMonth] || 0));

  writeCsv("account_cost_variance.csv", varianceRows, [
    "Linked Account",
    "Prev Month Cost",
    "Curr Month Cost",
    "Difference",
    "Percentage Change",
  ]);

  writeCsv("cost_by_linked_account_wide.csv", wideRows, [
    "Linked Account",
    ...months,
  ]);

  return singleMonthRows;
}

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------
function buildCurrentAndTrend(monthlyData, writeCsv) {
  const currentMonth = monthlyData[monthlyData.length - 1];
  writeCsv("current_month_total.csv", [{ "Total Cost": round(currentMonth.totalCost) }], ["Total Cost"]);

  const trendRows = monthlyData.map((m) => ({
    Month: m.month,
    "Total Cost": round(m.totalCost),
  }));
  writeCsv("monthly_totals_last_6_months.csv", trendRows, ["Month", "Total Cost"]);
}

function buildTop10AndLatest(monthlyData, serviceCols, writeCsv) {
  const latestMonth = monthlyData[monthlyData.length - 1];
  const allServices = serviceCols
    .map((s) => ({ Service: s, Cost: round(latestMonth.services[s] || 0) }))
    .filter((s) => s.Cost > 0)
    .sort((a, b) => b.Cost - a.Cost);

  writeCsv("latest_month_services.csv", allServices, ["Service", "Cost"]);
  const top10 = allServices.slice(0, 10);
  writeCsv("top_10_services.csv", top10, ["Service", "Cost"]);
}

function buildMomChange(monthlyData, writeCsv) {
  const rows = [];
  for (let i = 0; i < monthlyData.length; i++) {
    const curr = monthlyData[i];
    const prev = i > 0 ? monthlyData[i - 1] : null;
    const prevCost = prev ? prev.totalCost : null;
    const diff = prev ? curr.totalCost - prev.totalCost : null;
    const pct = prev && prev.totalCost > 0 ? (diff / prev.totalCost) * 100 : null;

    rows.push({
      Month: curr.month,
      "Total Cost": round(curr.totalCost),
      "Previous Month Cost": prevCost !== null ? round(prevCost) : "",
      "Difference": diff !== null ? round(diff) : "",
      "MoM % Change": pct !== null ? round(pct, 1) : "",
    });
  }
  writeCsv("mom_change.csv", rows, [
    "Month",
    "Total Cost",
    "Previous Month Cost",
    "Difference",
    "MoM % Change",
  ]);
}

function buildPareto(monthlyData, serviceCols, writeCsv) {
  const latestMonth = monthlyData[monthlyData.length - 1];
  const total = latestMonth.totalCost || 1;

  const items = serviceCols
    .map((s) => ({ Service: s, Cost: round(latestMonth.services[s] || 0) }))
    .filter((s) => s.Cost > 0)
    .sort((a, b) => b.Cost - a.Cost);

  let running = 0;
  const rows = items.map((item) => {
    running += item.Cost;
    const cumPct = round((running / total) * 100, 1);
    return {
      Service: item.Service,
      Cost: item.Cost,
      "Cumulative Cost": round(running),
      "Cumulative %": cumPct,
      "Pareto Class": cumPct <= 80 ? "Top 80%" : "Remaining 20%",
    };
  });

  writeCsv("pareto_analysis.csv", rows, [
    "Service",
    "Cost",
    "Cumulative Cost",
    "Cumulative %",
    "Pareto Class",
  ]);
}

function buildAnomalyFlags(monthlyData, writeCsv) {
  const rows = [];
  for (let i = 0; i < monthlyData.length; i++) {
    const curr = monthlyData[i];
    if (i < 2) {
      rows.push({
        Month: curr.month,
        "Total Cost": round(curr.totalCost),
        "3M Rolling Avg": "",
        "3M Rolling Std": "",
        "Anomaly Flag": "Normal (insufficient history)",
      });
      continue;
    }
    const prior3 = monthlyData.slice(Math.max(0, i - 3), i).map((m) => m.totalCost);
    const mean = prior3.reduce((a, b) => a + b, 0) / prior3.length;
    const variance = prior3.reduce((a, b) => a + (b - mean) ** 2, 0) / prior3.length;
    const std = Math.sqrt(variance);

    let flag = "Normal";
    if (std > 0 && curr.totalCost > mean + 2 * std) flag = "HIGH ANOMALY";
    else if (std > 0 && curr.totalCost < mean - 2 * std) flag = "LOW ANOMALY";

    rows.push({
      Month: curr.month,
      "Total Cost": round(curr.totalCost),
      "3M Rolling Avg": round(mean),
      "3M Rolling Std": round(std),
      "Anomaly Flag": flag,
    });
  }
  writeCsv("anomaly_flags.csv", rows, [
    "Month",
    "Total Cost",
    "3M Rolling Avg",
    "3M Rolling Std",
    "Anomaly Flag",
  ]);
}

function buildRecurringVsOnetime(monthlyData, serviceCols, writeCsv) {
  const totalMonths = monthlyData.length;
  const rows = serviceCols.map((s) => {
    const activeMonths = monthlyData.filter((m) => (m.services[s] || 0) > 0).length;
    const totalCost = monthlyData.reduce((acc, m) => acc + (m.services[s] || 0), 0);
    const activePct = round((activeMonths / totalMonths) * 100, 1);
    const type = activeMonths >= totalMonths * 0.8 ? "Recurring" : activeMonths <= 2 ? "One-time / Intermittent" : "Variable";

    return {
      Service: s,
      "Active Months": activeMonths,
      "Total Months in Run": totalMonths,
      "Active %": activePct,
      "Total Cost Over Period": round(totalCost),
      Classification: type,
    };
  });

  rows.sort((a, b) => b["Total Cost Over Period"] - a["Total Cost Over Period"]);
  writeCsv("recurring_vs_onetime.csv", rows, [
    "Service",
    "Active Months",
    "Total Months in Run",
    "Active %",
    "Total Cost Over Period",
    "Classification",
  ]);
}

function buildNewServices(monthlyData, serviceCols, writeCsv) {
  if (monthlyData.length < 2) {
    writeCsv("new_services_flag.csv", [], ["Service", "Cost in Latest Month", "First Seen Month", "Note"]);
    return;
  }
  const latestMonth = monthlyData[monthlyData.length - 1];
  const priorMonths = monthlyData.slice(0, monthlyData.length - 1);

  const rows = [];
  for (const s of serviceCols) {
    const costLatest = latestMonth.services[s] || 0;
    if (costLatest <= 0) continue;
    const hadPriorCost = priorMonths.some((m) => (m.services[s] || 0) > 0);
    if (!hadPriorCost) {
      rows.push({
        Service: s,
        "Cost in Latest Month": round(costLatest),
        "First Seen Month": latestMonth.month,
        Note: "First time billed in the reporting window",
      });
    }
  }
  rows.sort((a, b) => b["Cost in Latest Month"] - a["Cost in Latest Month"]);
  writeCsv("new_services_flag.csv", rows, ["Service", "Cost in Latest Month", "First Seen Month", "Note"]);
}

function buildCategoryCosts(monthlyData, serviceCols, writeCsv) {
  const rows = [];
  for (const m of monthlyData) {
    const catTotals = {};
    for (const s of serviceCols) {
      const cat = categorizeService(s);
      catTotals[cat] = (catTotals[cat] || 0) + (m.services[s] || 0);
    }
    for (const [cat, cost] of Object.entries(catTotals)) {
      if (cost > 0) {
        rows.push({
          Month: m.month,
          Category: cat,
          Cost: round(cost),
          "Share %": round(safeDivide(cost, m.totalCost) * 100, 1),
        });
      }
    }
  }
  rows.sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
  writeCsv("category_monthly_costs.csv", rows, ["Month", "Category", "Cost", "Share %"]);
}

function buildForecast(monthlyData, writeCsv) {
  const completeMonths = monthlyData.slice(0, monthlyData.length - 1);
  if (completeMonths.length < 2) {
    writeCsv("forecast_simple.csv", [], ["Forecast Month", "Projected Cost", "Method"]);
    return;
  }
  const n = completeMonths.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = completeMonths[i].totalCost;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const today = new Date();
  const nextMonthStr = firstOfMonthStr(today, 1).slice(0, 7);
  const nextPlusOneStr = firstOfMonthStr(today, 2).slice(0, 7);

  const forecastNext = Math.max(0, slope * n + intercept);
  const forecastNextPlus1 = Math.max(0, slope * (n + 1) + intercept);

  const rows = [
    {
      "Forecast Month": nextMonthStr,
      "Projected Cost": round(forecastNext),
      Method: "Linear trend on completed months",
    },
    {
      "Forecast Month": nextPlusOneStr,
      "Projected Cost": round(forecastNextPlus1),
      Method: "Linear trend on completed months",
    },
  ];
  writeCsv("forecast_simple.csv", rows, ["Forecast Month", "Projected Cost", "Method"]);
}

function buildVolatility(monthlyData, serviceCols, writeCsv) {
  const rows = [];
  const n = monthlyData.length;
  if (n < 2) {
    writeCsv("service_volatility.csv", [], ["Service", "Mean", "Std Dev", "Coefficient of Variation %"]);
    return;
  }
  for (const s of serviceCols) {
    const values = monthlyData.map((m) => m.services[s] || 0);
    const total = values.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const mean = total / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    const cv = mean > 0 ? (std / mean) * 100 : 0;

    rows.push({
      Service: s,
      Mean: round(mean),
      "Std Dev": round(std),
      "Coefficient of Variation %": round(cv, 1),
    });
  }
  rows.sort((a, b) => b["Std Dev"] - a["Std Dev"]);
  writeCsv("service_volatility.csv", rows, ["Service", "Mean", "Std Dev", "Coefficient of Variation %"]);
}

function buildCostByServiceWide(monthlyData, serviceCols, writeCsv) {
  const rows = monthlyData.map((m) => {
    const row = { Month: m.month };
    for (const s of serviceCols) row[s] = round(m.services[s] || 0);
    row["Total Cost"] = round(m.totalCost);
    return row;
  });
  writeCsv("cost_by_service_wide.csv", rows, [
    "Month",
    ...serviceCols,
    "Total Cost",
  ]);
}

// ---------------------------------------------------------------------------
// Run Pipeline for a Single AWS Account
// ---------------------------------------------------------------------------
async function processAccount(accountConfig) {
  const { id, name, accessKeyId, secretAccessKey, region, isPrimary } = accountConfig;

  console.log(`\n==========================================================`);
  console.log(`🚀 Running AWS Cost Pipeline for: ${name} (${id})`);
  console.log(`   Region: ${region}`);
  console.log(`==========================================================`);

  const RUN_STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  
  // Specific account folders
  const accountRunsFolder = path.join(BASE_OUTPUT_FOLDER, "accounts", id, "runs", RUN_STAMP);
  const accountLatestFolder = path.join(BASE_OUTPUT_FOLDER, "accounts", id, "latest");
  
  // Legacy root folders (for primary account)
  const rootRunsFolder = path.join(BASE_OUTPUT_FOLDER, "runs", RUN_STAMP);
  const rootLatestFolder = path.join(BASE_OUTPUT_FOLDER, "latest");

  fs.mkdirSync(accountRunsFolder, { recursive: true });
  fs.mkdirSync(accountLatestFolder, { recursive: true });

  if (isPrimary) {
    fs.mkdirSync(rootRunsFolder, { recursive: true });
    fs.mkdirSync(rootLatestFolder, { recursive: true });
  }

  const runLog = [];
  function log(msg) {
    const line = `[${new Date().toISOString()}] [${id}] ${msg}`;
    console.log(line);
    runLog.push(line);
  }

  function writeCsv(filename, rows, columns) {
    const content = toCsv(rows, columns);
    fs.writeFileSync(path.join(accountRunsFolder, filename), content);
    fs.writeFileSync(path.join(accountLatestFolder, filename), content);

    // If primary account, also mirror to root latest folder
    if (isPrimary) {
      fs.writeFileSync(path.join(rootRunsFolder, filename), content);
      fs.writeFileSync(path.join(rootLatestFolder, filename), content);
    }
    log(`Wrote ${filename} (${rows.length} rows)`);
  }

  function runStep(stepName, fn) {
    try {
      fn();
    } catch (e) {
      log(`ERROR in ${stepName}: ${e.message}`);
    }
  }

  const ceClient = new CostExplorerClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  const orgClient = new OrganizationsClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    const [serviceResult, accountResult] = await Promise.allSettled([
      fetchCostByService(ceClient, MONTHS_OF_HISTORY, log),
      fetchCostByLinkedAccount(ceClient, orgClient, MONTHS_OF_HISTORY, log, writeCsv),
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

    runStep("buildCostByServiceWide", () => buildCostByServiceWide(monthlyData, serviceCols, writeCsv));

    if (accountResult.status === "fulfilled") {
      runStep("Cost_By_Linked_Account", () =>
        writeCsv("Cost_By_Linked_Account.csv", accountResult.value, ["Linked Account", "Cost"])
      );
    } else {
      log(`Skipped linked account export (likely missing Organizations permission): ${accountResult.reason.message}`);
    }

    runStep("buildCurrentAndTrend", () => buildCurrentAndTrend(monthlyData, writeCsv));
    runStep("buildTop10AndLatest", () => buildTop10AndLatest(monthlyData, serviceCols, writeCsv));
    runStep("buildMomChange", () => buildMomChange(monthlyData, writeCsv));
    runStep("buildPareto", () => buildPareto(monthlyData, serviceCols, writeCsv));
    runStep("buildAnomalyFlags", () => buildAnomalyFlags(monthlyData, writeCsv));
    runStep("buildRecurringVsOnetime", () => buildRecurringVsOnetime(monthlyData, serviceCols, writeCsv));
    runStep("buildNewServices", () => buildNewServices(monthlyData, serviceCols, writeCsv));
    runStep("buildCategoryCosts", () => buildCategoryCosts(monthlyData, serviceCols, writeCsv));
    runStep("buildForecast", () => buildForecast(monthlyData, writeCsv));
    runStep("buildVolatility", () => buildVolatility(monthlyData, serviceCols, writeCsv));

    log(`✅ Account ${name} processing completed successfully.`);
    return true;
  } catch (err) {
    log(`❌ Error processing account ${name}: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------
async function main() {
  const accounts = getAwsAccountConfigs();

  if (accounts.length === 0) {
    console.error(
      "❌ No AWS account credentials found in .env.\n" +
        "Please set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY (and optionally AWS_ACCOUNT_2_*).",
    );
    process.exit(1);
  }

  console.log(`Found ${accounts.length} configured AWS account(s):`);
  accounts.forEach((a, idx) => console.log(`  ${idx + 1}. [${a.id}] ${a.name} (${a.region})`));

  const metadata = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    path: a.isPrimary ? "/data" : `/data/accounts/${a.id}`,
  }));

  // Write accounts.json metadata
  const accountsMetaFolder = path.join(BASE_OUTPUT_FOLDER, "accounts");
  fs.mkdirSync(accountsMetaFolder, { recursive: true });
  fs.mkdirSync(path.join(BASE_OUTPUT_FOLDER, "latest"), { recursive: true });

  fs.writeFileSync(
    path.join(accountsMetaFolder, "accounts.json"),
    JSON.stringify(metadata, null, 2),
  );
  fs.writeFileSync(
    path.join(BASE_OUTPUT_FOLDER, "latest", "accounts.json"),
    JSON.stringify(metadata, null, 2),
  );

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
