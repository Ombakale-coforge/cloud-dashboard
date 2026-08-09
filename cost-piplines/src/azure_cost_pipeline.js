/**
 * src/azure_dashboard_pipeline.js
 *
 * Output files (in AzureDashboardReports/latest/):
 *   azure_monthly_totals.csv     Month, Total Cost                 -> trend chart (all months)
 *   azure_kpis_by_month.csv      Month, KPI fields                 -> KPI cards
 *   azure_cost_by_category.csv   Month, Category, Cost             -> category pie chart
 *   azure_cost_by_product.csv    Month, Product, Cost              -> top products bar chart
 *   azure_cost_by_customer.csv   Month, Customer, Cost             -> top customers bar chart
 *   azure_top_meters.csv         Month, Meter, Product, Category, Cost -> meter detail table
 *   azure_cost_by_charge_type.csv Month, ChargeType, Cost          -> charge type donut chart
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const INPUT_FOLDER =
  process.env.AZURE_COST_INPUT_FOLDER ||
  path.join(PROJECT_ROOT, "data", "azure");
const INPUT_PATTERN = new RegExp(
  process.env.AZURE_COST_INPUT_PATTERN || "BilledInvoiceRecon.*\\.csv$",
  "i",
);
// NOTE: point this at wherever the React app reads its data from
// (e.g. dashboard/public/data) once that's wired up - see chat notes.
const BASE_OUTPUT_FOLDER =
  process.env.AZURE_DASHBOARD_OUTPUT_FOLDER ||
  path.join(PROJECT_ROOT, "AzureDashboardReports");

// Field mapping - source CSV column -> what we read it as.
// ChargeStartDate (not OrderDate/filename) drives the Month bucket: it's
// the date the charge actually applies to, is 100% populated in the source
// files, and is more accurate than assuming one month per invoice file.
const DATE_FIELD = "ChargeStartDate";
const COST_FIELD = "Total";
const CUSTOMER_FIELD = "CustomerName";
const PRODUCT_FIELD = "ProductName";
const SUBSCRIPTION_FIELD = "SubscriptionDescription";
const CHARGE_TYPE_FIELD = "ChargeType";
const CATEGORY_FIELD = "ProductCategory";
const METER_FIELD = "MeterDescription";

if (!fs.existsSync(INPUT_FOLDER)) {
  console.error(`Input folder not found: ${INPUT_FOLDER}`);
  process.exit(1);
}

const RUN_STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const RUN_FOLDER = path.join(BASE_OUTPUT_FOLDER, "runs", RUN_STAMP);
const LATEST_FOLDER = path.join(BASE_OUTPUT_FOLDER, "latest");

const runLog = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  runLog.push(line);
}

// ---------------------------------------------------------------------
// CSV parse / write (same approach as azure_native_pipeline.js)
// ---------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length === header.length && r.some((v) => v !== ""))
    .map((r) => {
      const obj = {};
      header.forEach((h, idx) => {
        obj[h] = r[idx];
      });
      return obj;
    });
}

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

// Normalize raw subscription values: some are readable names, others are
// resource-path IDs like /providers/Microsoft.Capacity/reservationOrders/xxx
// - pull the readable type segment out of those instead of a raw GUID.
function normalizeSubscription(raw) {
  if (!raw || !raw.trim()) return "Unknown Subscription";
  const val = raw.trim();
  if (val.startsWith("/providers/")) {
    const parts = val.split("/").filter(Boolean);
    const guidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const typePart = parts.find(
      (p) =>
        !guidRe.test(p) &&
        p !== "providers" &&
        p !== "Microsoft.Capacity" &&
        p !== "Microsoft.BillingBenefits",
    );
    return typePart || val;
  }
  return val;
}

// ---------------------------------------------------------------------
// Load + normalize transactions
// ---------------------------------------------------------------------

function fetchTransactionsFromCsv() {
  const all = fs.readdirSync(INPUT_FOLDER);
  const files = all
    .filter((f) => INPUT_PATTERN.test(f))
    .map((f) => path.join(INPUT_FOLDER, f));
  if (files.length === 0) throw new Error("No input files found.");

  const transactions = [];
  let skipped = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const records = parseCsv(text);
    for (const r of records) {
      const date = r[DATE_FIELD] ? new Date(r[DATE_FIELD]) : null;
      if (!date || Number.isNaN(date.getTime())) {
        skipped++;
        continue;
      }
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const cost = parseFloat(r[COST_FIELD]);
      if (!Number.isFinite(cost)) {
        skipped++;
        continue;
      }

      transactions.push({
        month,
        cost,
        customer: (r[CUSTOMER_FIELD] || "Unknown Customer").trim(),
        product: (r[PRODUCT_FIELD] || "Unknown Product").trim(),
        subscription: normalizeSubscription(r[SUBSCRIPTION_FIELD]),
        chargeType: (r[CHARGE_TYPE_FIELD] || "Unknown").trim(),
        category: (r[CATEGORY_FIELD] || "Uncategorized").trim(),
        meter: (r[METER_FIELD] || "Unknown Meter").trim(),
      });
    }
  }

  log(
    `Parsed ${transactions.length} transactions from ${files.length} file(s) (${skipped} rows skipped: bad date/cost).`,
  );
  return transactions;
}

// ---------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------

function groupBy(transactions, dimensions) {
  const pivot = {};
  for (const t of transactions) {
    const key = dimensions.map((d) => t[d]).join("||");
    pivot[key] = (pivot[key] || 0) + t.cost;
  }
  return Object.entries(pivot).map(([key, cost]) => {
    const parts = key.split("||");
    const row = {};
    dimensions.forEach((d, i) => (row[d] = parts[i]));
    row.cost = cost;
    return row;
  });
}

// ---------------------------------------------------------------------
// Output builders - one per dashboard section
// ---------------------------------------------------------------------

// Row 2 left: Monthly Cost Trend (area chart, spans every month)
function buildMonthlyTotals(transactions) {
  const rows = groupBy(transactions, ["month"])
    .map((r) => ({ Month: r.month, "Total Cost": round(r.cost) }))
    .sort((a, b) => a.Month.localeCompare(b.Month));
  writeCsv("azure_monthly_totals.csv", rows, ["Month", "Total Cost"]);
}

// Row 1: KPI cards, one row per month - dashboard just reads the row for
// whichever month is selected.
function buildKpisByMonth(transactions) {
  const months = [...new Set(transactions.map((t) => t.month))].sort();
  const rows = months.map((month) => {
    const monthTx = transactions.filter((t) => t.month === month);
    const totalCost = monthTx.reduce((s, t) => s + t.cost, 0);

    const byCustomer = groupBy(monthTx, ["customer"]).sort(
      (a, b) => b.cost - a.cost,
    );
    const byProduct = groupBy(monthTx, ["product"]).sort(
      (a, b) => b.cost - a.cost,
    );
    const subscriptionCount = new Set(monthTx.map((t) => t.subscription)).size;

    return {
      Month: month,
      "Total Cost": round(totalCost),
      "Top Customer": byCustomer[0] ? byCustomer[0].customer : "",
      "Top Customer Cost": byCustomer[0] ? round(byCustomer[0].cost) : 0,
      "Top Product": byProduct[0] ? byProduct[0].product : "",
      "Top Product Cost": byProduct[0] ? round(byProduct[0].cost) : 0,
      Subscriptions: subscriptionCount,
    };
  });
  writeCsv("azure_kpis_by_month.csv", rows, [
    "Month",
    "Total Cost",
    "Top Customer",
    "Top Customer Cost",
    "Top Product",
    "Top Product Cost",
    "Subscriptions",
  ]);
}

// Row 2 right: Cost by Product Category (pie chart, per selected month)
function buildCostByCategory(transactions) {
  const rows = groupBy(transactions, ["month", "category"])
    .map((r) => ({ Month: r.month, Category: r.category, Cost: round(r.cost) }))
    .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
  writeCsv("azure_cost_by_category.csv", rows, ["Month", "Category", "Cost"]);
}

// Row 3 left: Top 10 Products (bar chart, per selected month)
function buildCostByProduct(transactions) {
  const rows = groupBy(transactions, ["month", "product"])
    .map((r) => ({ Month: r.month, Product: r.product, Cost: round(r.cost) }))
    .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
  writeCsv("azure_cost_by_product.csv", rows, ["Month", "Product", "Cost"]);
}

// Row 3 right: Top Customers (bar chart, per selected month)
function buildCostByCustomer(transactions) {
  const rows = groupBy(transactions, ["month", "customer"])
    .map((r) => ({ Month: r.month, Customer: r.customer, Cost: round(r.cost) }))
    .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
  writeCsv("azure_cost_by_customer.csv", rows, ["Month", "Customer", "Cost"]);
}

// Row 4: Top Meter Details table (Meter, Product, Cost + search/sort in UI)
function buildTopMeters(transactions) {
  const rows = groupBy(transactions, ["month", "meter", "product", "category"])
    .map((r) => ({
      Month: r.month,
      Meter: r.meter,
      Product: r.product,
      Category: r.category,
      Cost: round(r.cost),
    }))
    .sort((a, b) => b.Month.localeCompare(a.Month) || b.Cost - a.Cost);
  writeCsv("azure_top_meters.csv", rows, [
    "Month",
    "Meter",
    "Product",
    "Category",
    "Cost",
  ]);
}

// Optional chart: Charge Type donut (per selected month)
function buildCostByChargeType(transactions) {
  const rows = groupBy(transactions, ["month", "chargeType"])
    .map((r) => ({
      Month: r.month,
      ChargeType: r.chargeType,
      Cost: round(r.cost),
    }))
    .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
  writeCsv("azure_cost_by_charge_type.csv", rows, [
    "Month",
    "ChargeType",
    "Cost",
  ]);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

function main() {
  fs.mkdirSync(RUN_FOLDER, { recursive: true });
  fs.mkdirSync(LATEST_FOLDER, { recursive: true });
  log(`Input folder: ${INPUT_FOLDER}`);
  log(`Run folder: ${RUN_FOLDER}`);

  const transactions = fetchTransactionsFromCsv();

  buildMonthlyTotals(transactions);
  buildKpisByMonth(transactions);
  buildCostByCategory(transactions);
  buildCostByProduct(transactions);
  buildCostByCustomer(transactions);
  buildTopMeters(transactions);
  buildCostByChargeType(transactions);

  log("Completed Azure Dashboard Pipeline.");
  fs.writeFileSync(path.join(LATEST_FOLDER, "run_log.txt"), runLog.join("\n"));
}

try {
  main();
} catch (e) {
  console.error("FATAL ERROR", e);
  process.exit(1);
}
