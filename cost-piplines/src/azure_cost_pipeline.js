/**
 * src/azure_dashboard_pipeline.js
 *
 * Input:
 *   CSV files matching AZURE_COST_INPUT_PATTERN, pulled from a Cloudflare R2
 *   bucket (S3-compatible API) instead of a local folder.
 *
 * Output files (in AzureDashboardReports/latest/):
 *   azure_monthly_totals.csv     Month, Total Cost                 -> trend chart (all months)
 *   azure_kpis_by_month.csv      Month, KPI fields                 -> KPI cards
 *   azure_cost_by_category.csv   Month, Category, Cost             -> category pie chart
 *   azure_cost_by_product.csv    Month, Product, Cost              -> top products bar chart
 *   azure_cost_by_customer.csv   Month, Customer, Cost             -> top customers bar chart
 *   azure_top_meters.csv         Month, Meter, Product, Category, Cost -> meter detail table
 *   azure_cost_by_charge_type.csv Month, ChargeType, Cost          -> charge type donut chart
 *
 * Required env vars (e.g. in .env):
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 API token access key id
 *   R2_SECRET_ACCESS_KEY   R2 API token secret access key
 *   R2_BUCKET_NAME         Bucket that holds the reconciliation CSVs
 *   AZURE_COST_R2_PREFIX   (optional) key prefix / "folder" inside the bucket, e.g. "azure-recon/"
 *   AZURE_COST_INPUT_PATTERN (optional) regex to match object keys, defaults to BilledInvoiceRecon*.csv
 *
 * Requires: npm install @aws-sdk/client-s3 dotenv
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");
const PROJECT_ROOT = path.join(__dirname, "..");
// ---------------------------------------------------------------------
// R2 configuration
// ---------------------------------------------------------------------
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PREFIX = process.env.AZURE_COST_R2_PREFIX || "";
const INPUT_PATTERN = new RegExp(
    process.env.AZURE_COST_INPUT_PATTERN || "BilledInvoiceRecon.*\\.csv$",
    "i"
);
const missing = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"].filter(
    (k) => !process.env[k]
);
if (missing.length > 0) {
    console.error(`Missing required R2 env var(s): ${missing.join(", ")}`);
    process.exit(1);
}
const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});
const BASE_OUTPUT_FOLDER =
    process.env.AZURE_DASHBOARD_OUTPUT_FOLDER ||
    path.join(PROJECT_ROOT, "AzureDashboardReports");
const DATE_FIELD = "ChargeStartDate";
const COST_FIELD = "Total";
const CUSTOMER_FIELD = "CustomerName";
const PRODUCT_FIELD = "ProductName";
const SUBSCRIPTION_FIELD = "SubscriptionId";
const CHARGE_TYPE_FIELD = "ChargeType";
const CATEGORY_FIELD = "ProductCategory";
const METER_FIELD = "MeterDescription";
const SKU_FIELD = "SkuName";
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
// ---------------------------------------------------------------------
// R2 helpers
// ---------------------------------------------------------------------
async function streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}
// Lists all objects under R2_PREFIX (paginated) and returns keys matching
// INPUT_PATTERN.
async function listMatchingKeys() {
    const keys = [];
    let ContinuationToken;
    do {
        const resp = await s3.send(
            new ListObjectsV2Command({
                Bucket: R2_BUCKET_NAME,
                Prefix: R2_PREFIX,
                ContinuationToken,
            })
        );
        for (const obj of resp.Contents || []) {
            const basename = obj.Key.split("/").pop();
            if (INPUT_PATTERN.test(basename)) keys.push(obj.Key);
        }
        ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return keys;
}
async function fetchObjectText(key) {
    const resp = await s3.send(
        new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
    );
    return streamToString(resp.Body);
}
// ---------------------------------------------------------------------
// Load + normalize transactions (now sourced from R2 instead of disk)
// ---------------------------------------------------------------------
async function fetchTransactionsFromR2() {
    const keys = await listMatchingKeys();
    if (keys.length === 0) {
        throw new Error(
            `No objects matching ${INPUT_PATTERN} found in bucket "${R2_BUCKET_NAME}" (prefix "${R2_PREFIX}").`
        );
    }
    log(`Found ${keys.length} matching object(s) in R2 bucket "${R2_BUCKET_NAME}".`);
    const transactions = [];
    let skipped = 0;
    for (const key of keys) {
        log(`Fetching ${key} ...`);
        const text = await fetchObjectText(key);
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
                // Empty string, not a fallback label - rows without a SubscriptionId
                // (plain per-usage Azure consumption) shouldn't count as one shared
                // "Unknown" subscription when we tally distinct IDs below.
                subscription: (r[SUBSCRIPTION_FIELD] || "").trim(),
                chargeType: (r[CHARGE_TYPE_FIELD] || "Unknown").trim(),
                category: (r[CATEGORY_FIELD] || "Uncategorized").trim(),
                meter: (r[METER_FIELD] || r[SKU_FIELD] || "Unknown Meter").trim(),
            });
        }
    }
    log(`Parsed ${transactions.length} transactions from ${keys.length} file(s) (${skipped} rows skipped: bad date/cost).`);
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

    // Total cost per month, computed once up front so MoM % change can look
    // back at the previous month regardless of iteration order.
    const totalByMonth = {};
    for (const month of months) {
        totalByMonth[month] = transactions
            .filter((t) => t.month === month)
            .reduce((s, t) => s + t.cost, 0);
    }

    const rows = months.map((month, i) => {
        const monthTx = transactions.filter((t) => t.month === month);
        const totalCost = totalByMonth[month];
        const byCustomer = groupBy(monthTx, ["customer"]).sort((a, b) => b.cost - a.cost);
        const byProduct = groupBy(monthTx, ["product"]).sort((a, b) => b.cost - a.cost);
        const subscriptionCount = new Set(monthTx.map((t) => t.subscription).filter(Boolean)).size;

        // No previous month for the first month in the dataset - leave blank
        // rather than showing a misleading 0% or divide-by-zero result.
        const prevMonth = i > 0 ? months[i - 1] : null;
        const prevCost = prevMonth ? totalByMonth[prevMonth] : null;
        const pctChange = prevCost ? round(((totalCost - prevCost) / prevCost) * 100, 1) : "";

        return {
            Month: month,
            "Total Cost": round(totalCost),
            "Top Customer": byCustomer[0] ? byCustomer[0].customer : "",
            "Top Customer Cost": byCustomer[0] ? round(byCustomer[0].cost) : 0,
            "Top Product": byProduct[0] ? byProduct[0].product : "",
            "Top Product Cost": byProduct[0] ? round(byProduct[0].cost) : 0,
            Subscriptions: subscriptionCount,
            "Previous Month Cost": prevCost !== null ? round(prevCost) : "",
            "MoM % Change": pctChange,
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
        "Previous Month Cost",
        "MoM % Change",
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
    writeCsv("azure_top_meters.csv", rows, ["Month", "Meter", "Product", "Category", "Cost"]);
}
// Optional chart: Charge Type donut (per selected month)
function buildCostByChargeType(transactions) {
    const rows = groupBy(transactions, ["month", "chargeType"])
        .map((r) => ({ Month: r.month, ChargeType: r.chargeType, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_cost_by_charge_type.csv", rows, ["Month", "ChargeType", "Cost"]);
}
// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
    fs.mkdirSync(RUN_FOLDER, { recursive: true });
    fs.mkdirSync(LATEST_FOLDER, { recursive: true });
    log(`R2 bucket: ${R2_BUCKET_NAME} (prefix: "${R2_PREFIX}")`);
    log(`Run folder: ${RUN_FOLDER}`);
    const transactions = await fetchTransactionsFromR2();
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
main().catch((e) => {
    console.error("FATAL ERROR", e);
    process.exit(1);
});
