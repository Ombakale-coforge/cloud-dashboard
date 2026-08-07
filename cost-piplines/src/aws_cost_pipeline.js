/**
 * src/aws_cost_pipeline.js
 *
 * Node.js AWS cost reporting pipeline.
 * Part of the "aws-cost-pipeline" project - see README.md for setup.
 *
 * What it does, in one run:
 *   1. Loads AWS credentials and settings strictly from .env (via dotenv).
 *      No fallback to ~/.aws/credentials or IAM instance roles for now -
 *      this makes local testing predictable and avoids silently picking up
 *      the wrong credentials from some other source on your machine.
 *   2. Pulls Cost Explorer data for the last N months, broken down by service,
 *      and cost broken down by linked account - in parallel.
 *   3. Runs insight calculations (MoM % change, Pareto, anomalies,
 *      recurring vs one-time, category grouping, forecast, volatility),
 *      each isolated so one bad calculation can't take down the whole run.
 *   4. Writes everything as clean CSV files into a DATED subfolder under
 *      AWSReports/runs/, plus AWSReports/latest/ which always mirrors the
 *      newest run - point Power BI at "latest/". A run_log.txt captures
 *      what happened, for debugging unattended/scheduled runs.
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

// ==========================================================
// Settings and credentials - read strictly from .env for now.
// ==========================================================

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

const PROJECT_ROOT = path.join(__dirname, "..");
const BASE_OUTPUT_FOLDER =
  process.env.AWS_COST_OUTPUT_FOLDER || path.join(PROJECT_ROOT, "AWSReports");
const MONTHS_OF_HISTORY = parseInt(
  process.env.AWS_COST_MONTHS_HISTORY || "6",
  10,
);

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error(
    "Missing AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY.\n" +
      "Create a .env file in the project root (copy .env.example) and fill both in.",
  );
  process.exit(1);
}

// Explicit credentials object - built only from .env, not from any other
// source (no ~/.aws/credentials, no IAM role fallback) while testing.
const AWS_CREDENTIALS = {
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
};

// Timestamped run folder so history is preserved for Power BI trend analysis,
// plus a stable "latest" folder that always has the newest files.
const RUN_STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const RUN_FOLDER = path.join(BASE_OUTPUT_FOLDER, "runs", RUN_STAMP);
const LATEST_FOLDER = path.join(BASE_OUTPUT_FOLDER, "latest");

const runLog = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  runLog.push(line);
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

// ==========================================================
// Date helpers - LOCAL calendar dates, no UTC drift.
// ==========================================================

function toDateStr(year, monthIndexZeroBased, day) {
  const mm = String(monthIndexZeroBased + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function firstOfMonthStr(date, monthOffset = 0) {
  const d = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1);
  return toDateStr(d.getFullYear(), d.getMonth(), 1);
}

// ==========================================================
// Small CSV writer helper (no external dependency needed)
// ==========================================================

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

function writeCsv(filename, rows, columns) {
  const content = toCsv(rows, columns);
  fs.writeFileSync(path.join(RUN_FOLDER, filename), content);
  fs.writeFileSync(path.join(LATEST_FOLDER, filename), content);
  log(`Wrote ${filename} (${rows.length} rows)`);
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

function runStep(name, fn) {
  try {
    fn();
  } catch (e) {
    log(`ERROR in ${name}: ${e.message}`);
  }
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
      log(
        `Throttled (${e.name}), retrying in ${delay}ms (attempt ${attempt}/${retries})...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ==========================================================
// Step 1: Fetch cost by service, last N months -> pivoted structure
// ==========================================================

async function fetchCostByService(ceClient, monthsBack) {
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

// ==========================================================
// Step 2: Fetch cost by linked account (previous full month)
// ==========================================================

async function fetchCostByLinkedAccount(ceClient, orgClient) {
  const today = new Date();
  const startStr = firstOfMonthStr(today, -2);
  const endStr = firstOfMonthStr(today, 0);

  log(`Fetching 2-month cost by linked account from ${startStr} to ${endStr} ...`);

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
  const prevMonth = months[0];
  const currMonth = months[1];

  const varianceRows = [];
  const singleMonthRows = [];

  log(`Months found for account MoM: Prev=${prevMonth}, Curr=${currMonth}`);

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
  }

  varianceRows.sort((a, b) => Math.abs(b.Difference) - Math.abs(a.Difference));
  singleMonthRows.sort((a, b) => b.Cost - a.Cost);

  writeCsv("account_cost_variance.csv", varianceRows, [
    "Linked Account",
    "Prev Month Cost",
    "Curr Month Cost",
    "Difference",
    "Percentage Change",
  ]);

  return singleMonthRows;
}

// ==========================================================
// Step 3: Insight builders
// ==========================================================

function buildCurrentAndTrend(monthlyData) {
  const trend = monthlyData.map((m) => ({
    Month: m.month,
    "Total Cost": round(m.totalCost),
  }));
  writeCsv("cost_trend_all_periods.csv", trend, ["Month", "Total Cost"]);
  writeCsv("monthly_totals_last_6_months.csv", trend.slice(-6), [
    "Month",
    "Total Cost",
  ]);
  writeCsv("current_month_total.csv", trend.slice(-1), ["Month", "Total Cost"]);
}

function buildTop10AndLatest(monthlyData, serviceCols) {
  const totals = {};
  for (const s of serviceCols) totals[s] = 0;
  for (const m of monthlyData) {
    for (const s of serviceCols) totals[s] += m.services[s] || 0;
  }

  const sortedServices = serviceCols
    .map((s) => ({ Service: s, "Total Cost": round(totals[s]) }))
    .sort((a, b) => b["Total Cost"] - a["Total Cost"]);

  writeCsv("top_10_services.csv", sortedServices.slice(0, 10), [
    "Service",
    "Total Cost",
  ]);

  const latestMonth = monthlyData[monthlyData.length - 1];
  const latestRows = serviceCols
    .map((s) => ({ Service: s, Cost: round(latestMonth.services[s] || 0) }))
    .filter((r) => r.Cost > 0)
    .sort((a, b) => b.Cost - a.Cost);

  writeCsv("latest_month_services.csv", latestRows, ["Service", "Cost"]);
}

function buildMomChange(monthlyData) {
  const rows = monthlyData.map((m, i) => {
    const prev = i > 0 ? monthlyData[i - 1].totalCost : null;
    const pctChange = prev
      ? round(safeDivide(m.totalCost - prev, prev) * 100)
      : "";
    return {
      Month: m.month,
      "Total Cost": round(m.totalCost),
      "Previous Month Cost": prev !== null ? round(prev) : "",
      "MoM % Change": pctChange,
    };
  });
  writeCsv("mom_change.csv", rows, [
    "Month",
    "Total Cost",
    "Previous Month Cost",
    "MoM % Change",
  ]);
}

function buildPareto(monthlyData, serviceCols) {
  const totals = {};
  for (const s of serviceCols) totals[s] = 0;
  for (const m of monthlyData) {
    for (const s of serviceCols) totals[s] += m.services[s] || 0;
  }

  const sorted = serviceCols
    .map((s) => ({ Service: s, "Total Cost": totals[s] }))
    .sort((a, b) => b["Total Cost"] - a["Total Cost"]);

  const grandTotal = sorted.reduce((sum, r) => sum + r["Total Cost"], 0);
  let cumulative = 0;

  const rows = sorted.map((r, i) => {
    const pctOfTotal =
      grandTotal > 0 ? round(safeDivide(r["Total Cost"], grandTotal) * 100) : 0;
    cumulative += pctOfTotal;
    return {
      Service: r.Service,
      "Total Cost": round(r["Total Cost"]),
      "% of Total": pctOfTotal,
      "Cumulative %": round(cumulative),
      Rank: i + 1,
    };
  });

  writeCsv("cost_concentration_pareto.csv", rows, [
    "Service",
    "Total Cost",
    "% of Total",
    "Cumulative %",
    "Rank",
  ]);
}

function buildAnomalyFlags(monthlyData) {
  const rows = monthlyData.map((m, i) => {
    const window = monthlyData.slice(Math.max(0, i - 2), i + 1);
    const rollingAvg =
      window.reduce((s, w) => s + w.totalCost, 0) / window.length;
    return {
      Month: m.month,
      "Total Cost": round(m.totalCost),
      "Rolling Avg (3mo)": round(rollingAvg),
      "Is Anomaly": rollingAvg > 0 && m.totalCost > rollingAvg * 2,
    };
  });
  writeCsv("anomaly_flags.csv", rows, [
    "Month",
    "Total Cost",
    "Rolling Avg (3mo)",
    "Is Anomaly",
  ]);
}

function buildRecurringVsOnetime(monthlyData, serviceCols) {
  const totalMonths = monthlyData.length;
  const rows = serviceCols
    .map((s) => {
      const monthsActive = monthlyData.filter(
        (m) => (m.services[s] || 0) > 0,
      ).length;
      const activePct =
        totalMonths > 0
          ? round(safeDivide(monthsActive, totalMonths) * 100, 1)
          : 0;
      let classification;
      if (activePct >= 75) classification = "Recurring";
      else if (activePct <= 25) classification = "One-time / Sporadic";
      else classification = "Occasional";
      return {
        Service: s,
        "Months Active": monthsActive,
        "Total Months": totalMonths,
        "Active %": activePct,
        Classification: classification,
      };
    })
    .sort((a, b) => b["Months Active"] - a["Months Active"]);

  writeCsv("recurring_vs_onetime.csv", rows, [
    "Service",
    "Months Active",
    "Total Months",
    "Active %",
    "Classification",
  ]);
}

function buildNewServices(monthlyData, serviceCols) {
  const rows = [];
  let prevActive = new Set();

  for (const m of monthlyData) {
    const activeNow = new Set(
      serviceCols.filter((s) => (m.services[s] || 0) > 0),
    );
    const newServices = [...activeNow].filter((s) => !prevActive.has(s)).sort();
    for (const s of newServices) {
      rows.push({ Month: m.month, "New Service": s });
    }
    prevActive = activeNow;
  }

  writeCsv("new_services_by_month.csv", rows, ["Month", "New Service"]);
}

function buildCategoryCosts(monthlyData, serviceCols) {
  const categoryMap = {};
  for (const s of serviceCols) categoryMap[s] = categorizeService(s);

  const rows = [];
  for (const m of monthlyData) {
    const monthCosts = {};
    for (const s of serviceCols) {
      const cat = categoryMap[s];
      monthCosts[cat] = (monthCosts[cat] || 0) + (m.services[s] || 0);
    }
    for (const [cat, cost] of Object.entries(monthCosts)) {
      rows.push({ Month: m.month, Category: cat, Cost: round(cost) });
    }
  }

  writeCsv("category_monthly_costs.csv", rows, ["Month", "Category", "Cost"]);
}

function buildForecast(monthlyData) {
  const recent = monthlyData.slice(-3).map((m) => m.totalCost);
  const avgForecast = recent.length
    ? recent.reduce((s, v) => s + v, 0) / recent.length
    : 0;

  let trendForecast = avgForecast;
  if (recent.length >= 2) {
    const n = recent.length;
    const xVals = recent.map((_, i) => i);
    const xMean = xVals.reduce((s, v) => s + v, 0) / n;
    const yMean = recent.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xVals[i] - xMean) * (recent[i] - yMean);
      den += (xVals[i] - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;
    trendForecast = slope * n + intercept;
  }

  const rows = [
    {
      Method: "Average of last 3 months",
      "Forecasted Total Cost": round(avgForecast),
    },
    {
      Method: "Simple linear trend",
      "Forecasted Total Cost": round(trendForecast),
    },
  ];
  writeCsv("forecast_next_month.csv", rows, [
    "Method",
    "Forecasted Total Cost",
  ]);
}

function buildVolatility(monthlyData, serviceCols) {
  const rows = serviceCols
    .map((s) => {
      const values = monthlyData.map((m) => m.services[s] || 0);
      const mean = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : 0;
      const variance = values.length
        ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
        : 0;
      const std = Math.sqrt(variance);
      const cv = mean !== 0 ? round(safeDivide(std, mean) * 100, 1) : 0;
      return {
        Service: s,
        Mean: round(mean),
        "Std Dev": round(std),
        "Coefficient of Variation %": cv,
      };
    })
    .filter((r) => r.Mean > 0)
    .sort(
      (a, b) =>
        b["Coefficient of Variation %"] - a["Coefficient of Variation %"],
    );

  writeCsv("cost_volatility.csv", rows, [
    "Service",
    "Mean",
    "Std Dev",
    "Coefficient of Variation %",
  ]);
}

function buildCostByServiceWide(monthlyData, serviceCols) {
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

// ==========================================================
// Main
// ==========================================================

async function main() {
  fs.mkdirSync(RUN_FOLDER, { recursive: true });
  fs.mkdirSync(LATEST_FOLDER, { recursive: true });

  // Credentials passed explicitly, built only from .env values above.
  const ceClient = new CostExplorerClient({
    region: AWS_REGION,
    credentials: AWS_CREDENTIALS,
  });
  const orgClient = new OrganizationsClient({
    region: AWS_REGION,
    credentials: AWS_CREDENTIALS,
  });

  log(`Run folder: ${RUN_FOLDER}`);
  log(`Months of history: ${MONTHS_OF_HISTORY}`);

  const [serviceResult, accountResult] = await Promise.allSettled([
    fetchCostByService(ceClient, MONTHS_OF_HISTORY),
    fetchCostByLinkedAccount(ceClient, orgClient),
  ]);

  if (serviceResult.status === "rejected") {
    log(`FATAL: cost-by-service fetch failed: ${serviceResult.reason.message}`);
    finalizeRunLog(false);
    process.exit(1);
  }

  const { monthlyData, serviceCols } = serviceResult.value;

  if (monthlyData.length === 0) {
    log("No cost data returned - check date range / permissions.");
    finalizeRunLog(false);
    process.exit(1);
  }

  log(
    `Got ${monthlyData.length} month(s) of data across ${serviceCols.length} services.`,
  );

  runStep("buildCostByServiceWide", () =>
    buildCostByServiceWide(monthlyData, serviceCols),
  );

  if (accountResult.status === "fulfilled") {
    runStep("Cost_By_Linked_Account", () =>
      writeCsv("Cost_By_Linked_Account.csv", accountResult.value, [
        "Linked Account",
        "Cost",
      ]),
    );
  } else {
    log(
      `Skipped linked account export (likely missing Organizations permission): ${accountResult.reason.message}`,
    );
  }

  runStep("buildCurrentAndTrend", () => buildCurrentAndTrend(monthlyData));
  runStep("buildTop10AndLatest", () =>
    buildTop10AndLatest(monthlyData, serviceCols),
  );
  runStep("buildMomChange", () => buildMomChange(monthlyData));
  runStep("buildPareto", () => buildPareto(monthlyData, serviceCols));
  runStep("buildAnomalyFlags", () => buildAnomalyFlags(monthlyData));
  runStep("buildRecurringVsOnetime", () =>
    buildRecurringVsOnetime(monthlyData, serviceCols),
  );
  runStep("buildNewServices", () => buildNewServices(monthlyData, serviceCols));
  runStep("buildCategoryCosts", () =>
    buildCategoryCosts(monthlyData, serviceCols),
  );
  runStep("buildForecast", () => buildForecast(monthlyData));
  runStep("buildVolatility", () => buildVolatility(monthlyData, serviceCols));

  log("=========================================");
  log("AWS Cost Pipeline Completed");
  log("=========================================");
  log(`Run files: ${RUN_FOLDER}`);
  log(`Latest files (for Power BI): ${LATEST_FOLDER}`);

  finalizeRunLog(true);
}

function finalizeRunLog(success) {
  runLog.push(
    `[${new Date().toISOString()}] RUN ${success ? "SUCCEEDED" : "FAILED"}`,
  );
  try {
    fs.writeFileSync(path.join(RUN_FOLDER, "run_log.txt"), runLog.join("\n"));
    fs.writeFileSync(
      path.join(LATEST_FOLDER, "run_log.txt"),
      runLog.join("\n"),
    );
  } catch (e) {
    console.error("Could not write run log:", e.message);
  }
}

main().catch((err) => {
  log(`Pipeline failed: ${err.message}`);
  finalizeRunLog(false);
  process.exit(1);
});
