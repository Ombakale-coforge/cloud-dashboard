/**
 * src/azure_usage_pipeline.js
 *
 * Reads local JSON exports pulled from the Azure Cost Management
 * "Usage Details" API and aggregates them into CSVs the dashboard reads.
 *
 * INPUT
 *   By default reads every *.json file in ./data/azure-usage/
 *   Each file can be either:
 *     - a raw array of usage-detail records: [ {...}, {...} ]
 *     - a raw API response shape:            { "value": [ {...}, {...} ], "nextLink": ... }
 *   (Cost Management API responses paginate via "nextLink" - just drop each
 *   page's JSON body into the folder as its own file; the pipeline merges them.)
 *
 * OUTPUT (in AzureUsageReports/latest/)
 *   azure_usage_monthly_totals.csv   Month, Total Cost                          -> trend chart
 *   azure_usage_kpis_by_month.csv    Month, KPI fields                          -> KPI cards
 *   azure_usage_by_subscription.csv  Month, Subscription, Cost                  -> subscription breakdown
 *   azure_usage_by_resource_group.csv Month, ResourceGroup, Subscription, Cost  -> resource group breakdown
 *   azure_usage_by_service.csv       Month, ConsumedService, Cost               -> service/product breakdown
 *   azure_usage_by_charge_type.csv   Month, ChargeType, Cost                    -> charge type donut
 *   azure_usage_top_meters.csv       Month, Meter, Category, Service, ResourceGroup, Cost -> meter detail table
 *   azure_usage_mom_change.csv               Month, Total Cost, Previous Month Cost, MoM % Change
 *   azure_usage_cost_concentration_pareto.csv Service, Total Cost, % of Total, Cumulative %, Rank
 *   azure_usage_anomaly_flags.csv            Month, Total Cost, Rolling Avg (3mo), Is Anomaly
 *   azure_usage_new_services_by_month.csv    Month, New Service
 *   azure_usage_forecast_next_month.csv      Method, Forecasted Total Cost
 *   azure_usage_volatility.csv               Service, Mean, Std Dev, Coefficient of Variation %
 *   azure_usage_by_region.csv                Month, Region, Cost
 *   azure_usage_by_pricing_model.csv         Month, PricingModel, Cost
 *   azure_usage_top_resources.csv            ResourceName, ResourceGroup, Service, Cost (top 50, all-time)
 *   azure_usage_credit_eligibility.csv       Month, CreditEligible, Cost
 *
 * Run: node src/azure_usage_pipeline.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const INPUT_FOLDER =
    process.env.AZURE_USAGE_INPUT_FOLDER || path.join(PROJECT_ROOT, "data", "azure");
const BASE_OUTPUT_FOLDER =
    process.env.AZURE_USAGE_OUTPUT_FOLDER || path.join(PROJECT_ROOT, "AzureUsageReports");

// Field mapping - source JSON field -> what we read it as.
// "cost" is the standard Usage Details field; some tenants/exports use
// costInBillingCurrency instead, so we fall back to that automatically.
const DATE_FIELD = "date";
const COST_FIELD = "cost";
const COST_FIELD_FALLBACK = "costInBillingCurrency";
const SUBSCRIPTION_FIELD = "subscriptionName";
const SUBSCRIPTION_ID_FIELD = "subscriptionId";
const RESOURCE_GROUP_FIELD = "resourceGroup";
const CONSUMED_SERVICE_FIELD = "consumedService";
const PRODUCT_FIELD = "product";
const CHARGE_TYPE_FIELD = "chargeType";
const METER_FIELD = "meterId";
// meterDetails is usually a nested object ({ meterName, meterCategory, ... })
// rather than a flat string - handled in normalizeMeterName below.
const METER_DETAILS_FIELD = "meterDetails";
const RESOURCE_LOCATION_FIELD = "resourceLocation";
const PRICING_MODEL_FIELD = "pricingModel";
const RESOURCE_NAME_FIELD = "resourceName";
const CREDIT_ELIGIBLE_FIELD = "isAzureCreditEligible";

if (!fs.existsSync(INPUT_FOLDER)) {
    console.error(`Input folder not found: ${INPUT_FOLDER}`);
    console.error(`Create it and drop your Cost Management API JSON export(s) there, e.g.:`);
    console.error(`  ${INPUT_FOLDER}/usage-2026-07.json`);
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
// CSV write helpers
// ---------------------------------------------------------------------
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
// Load + normalize records from local JSON files
// ---------------------------------------------------------------------
function normalizeMeterName(record) {
    const details = record[METER_DETAILS_FIELD];
    if (details && typeof details === "object") {
        return (details.meterName || details.MeterName || "Unknown Meter").trim();
    }
    return (record[METER_FIELD] || "Unknown Meter").toString().trim();
}

// meterCategory (e.g. "Storage", "Virtual Machines") is the human-readable
// portal-style grouping - only present inside meterDetails, no top-level
// fallback exists, so unlike meter name there's nothing to fall back to.
function normalizeMeterCategory(record) {
    const details = record[METER_DETAILS_FIELD];
    if (details && typeof details === "object") {
        return (details.meterCategory || details.MeterCategory || "Uncategorized").trim();
    }
    return "Uncategorized";
}

function loadRecordsFromFile(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.value)) return parsed.value;
    throw new Error(`Unrecognized JSON shape in ${filePath} (expected an array or { value: [...] })`);
}

function fetchTransactionsFromJson() {
    const files = fs
        .readdirSync(INPUT_FOLDER)
        .filter((f) => f.toLowerCase().endsWith(".json"))
        .map((f) => path.join(INPUT_FOLDER, f));
    if (files.length === 0) throw new Error(`No .json files found in ${INPUT_FOLDER}`);

    const transactions = [];
    let skipped = 0;
    for (const file of files) {
        const records = loadRecordsFromFile(file);
        for (const r of records) {
            const props = r.properties || r; // some API shapes nest fields under "properties"
            const dateVal = props[DATE_FIELD];
            const date = dateVal ? new Date(dateVal) : null;
            if (!date || Number.isNaN(date.getTime())) {
                skipped++;
                continue;
            }
            const rawCost = props[COST_FIELD] !== undefined ? props[COST_FIELD] : props[COST_FIELD_FALLBACK];
            const cost = parseFloat(rawCost);
            if (!Number.isFinite(cost)) {
                skipped++;
                continue;
            }
            const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
            transactions.push({
                month,
                cost,
                subscription: (props[SUBSCRIPTION_FIELD] || props[SUBSCRIPTION_ID_FIELD] || "Unknown Subscription").toString().trim(),
                resourceGroup: (props[RESOURCE_GROUP_FIELD] || "Unassigned").toString().trim(),
                consumedService: (props[CONSUMED_SERVICE_FIELD] || props[PRODUCT_FIELD] || "Unknown Service").toString().trim(),
                chargeType: (props[CHARGE_TYPE_FIELD] || "Unknown").toString().trim(),
                meter: normalizeMeterName(props),
                meterCategory: normalizeMeterCategory(props),
                location: (props[RESOURCE_LOCATION_FIELD] || "Unknown").toString().trim(),
                pricingModel: (props[PRICING_MODEL_FIELD] || "Unknown").toString().trim(),
                resourceName: (props[RESOURCE_NAME_FIELD] || "Unassigned").toString().trim(),
                creditEligible: props[CREDIT_ELIGIBLE_FIELD] === true || props[CREDIT_ELIGIBLE_FIELD] === "true" ? "Yes" : "No",
            });
        }
        log(`Read ${path.basename(file)}`);
    }
    log(`Parsed ${transactions.length} usage records from ${files.length} file(s) (${skipped} rows skipped: bad date/cost).`);
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
// Output builders
// ---------------------------------------------------------------------
function buildMonthlyTotals(transactions) {
    const rows = groupBy(transactions, ["month"])
        .map((r) => ({ Month: r.month, "Total Cost": round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month));
    writeCsv("azure_usage_monthly_totals.csv", rows, ["Month", "Total Cost"]);
}

function buildKpisByMonth(transactions) {
    const months = [...new Set(transactions.map((t) => t.month))].sort();
    const rows = months.map((month) => {
        const monthTx = transactions.filter((t) => t.month === month);
        const totalCost = monthTx.reduce((s, t) => s + t.cost, 0);
        const bySubscription = groupBy(monthTx, ["subscription"]).sort((a, b) => b.cost - a.cost);
        const byService = groupBy(monthTx, ["consumedService"]).sort((a, b) => b.cost - a.cost);
        const subscriptionCount = new Set(monthTx.map((t) => t.subscription)).size;
        const resourceGroupCount = new Set(monthTx.map((t) => t.resourceGroup)).size;
        return {
            Month: month,
            "Total Cost": round(totalCost),
            "Top Subscription": bySubscription[0] ? bySubscription[0].subscription : "",
            "Top Subscription Cost": bySubscription[0] ? round(bySubscription[0].cost) : 0,
            "Top Service": byService[0] ? byService[0].consumedService : "",
            "Top Service Cost": byService[0] ? round(byService[0].cost) : 0,
            Subscriptions: subscriptionCount,
            "Resource Groups": resourceGroupCount,
        };
    });
    writeCsv("azure_usage_kpis_by_month.csv", rows, [
        "Month",
        "Total Cost",
        "Top Subscription",
        "Top Subscription Cost",
        "Top Service",
        "Top Service Cost",
        "Subscriptions",
        "Resource Groups",
    ]);
}

function buildCostBySubscription(transactions) {
    const rows = groupBy(transactions, ["month", "subscription"])
        .map((r) => ({ Month: r.month, Subscription: r.subscription, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_subscription.csv", rows, ["Month", "Subscription", "Cost"]);
}

function buildCostByResourceGroup(transactions) {
    const rows = groupBy(transactions, ["month", "resourceGroup", "subscription"])
        .map((r) => ({
            Month: r.month,
            ResourceGroup: r.resourceGroup,
            Subscription: r.subscription,
            Cost: round(r.cost),
        }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_resource_group.csv", rows, ["Month", "ResourceGroup", "Subscription", "Cost"]);
}

function buildCostByService(transactions) {
    const rows = groupBy(transactions, ["month", "consumedService"])
        .map((r) => ({ Month: r.month, ConsumedService: r.consumedService, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_service.csv", rows, ["Month", "ConsumedService", "Cost"]);
}

function buildCostByChargeType(transactions) {
    const rows = groupBy(transactions, ["month", "chargeType"])
        .map((r) => ({ Month: r.month, ChargeType: r.chargeType, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_charge_type.csv", rows, ["Month", "ChargeType", "Cost"]);
}

// ---------------------------------------------------------------------
// Monthly x Service pivot - shared by Pareto / anomaly / new-services /
// volatility below (mirrors the AWS pipeline's monthlyData shape so the
// same math applies).
// ---------------------------------------------------------------------
function buildMonthlyServicePivot(transactions) {
    const months = [...new Set(transactions.map((t) => t.month))].sort();
    const services = [...new Set(transactions.map((t) => t.consumedService))];
    const pivot = {};
    for (const m of months) pivot[m] = {};
    for (const t of transactions) {
        pivot[t.month][t.consumedService] = (pivot[t.month][t.consumedService] || 0) + t.cost;
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

function safeDivide(numerator, denominator) {
    if (!denominator) return 0;
    return numerator / denominator;
}

// Month-over-month total cost change.
function buildMomChange(monthlyData) {
    const rows = monthlyData.map((m, i) => {
        const prev = i > 0 ? monthlyData[i - 1].totalCost : null;
        const pctChange = prev ? round(safeDivide(m.totalCost - prev, prev) * 100) : "";
        return {
            Month: m.month,
            "Total Cost": round(m.totalCost),
            "Previous Month Cost": prev !== null ? round(prev) : "",
            "MoM % Change": pctChange,
        };
    });
    writeCsv("azure_usage_mom_change.csv", rows, [
        "Month",
        "Total Cost",
        "Previous Month Cost",
        "MoM % Change",
    ]);
}

// Cost concentration: which services make up 80% of spend.
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
        const pctOfTotal = grandTotal > 0 ? round(safeDivide(r["Total Cost"], grandTotal) * 100) : 0;
        cumulative += pctOfTotal;
        return {
            Service: r.Service,
            "Total Cost": round(r["Total Cost"]),
            "% of Total": pctOfTotal,
            "Cumulative %": round(cumulative),
            Rank: i + 1,
        };
    });
    writeCsv("azure_usage_cost_concentration_pareto.csv", rows, [
        "Service",
        "Total Cost",
        "% of Total",
        "Cumulative %",
        "Rank",
    ]);
}

// Flags months where total cost blew past 2x the trailing 3-month average.
function buildAnomalyFlags(monthlyData) {
    const rows = monthlyData.map((m, i) => {
        const window = monthlyData.slice(Math.max(0, i - 2), i + 1);
        const rollingAvg = window.reduce((s, w) => s + w.totalCost, 0) / window.length;
        return {
            Month: m.month,
            "Total Cost": round(m.totalCost),
            "Rolling Avg (3mo)": round(rollingAvg),
            "Is Anomaly": rollingAvg > 0 && m.totalCost > rollingAvg * 2,
        };
    });
    writeCsv("azure_usage_anomaly_flags.csv", rows, [
        "Month",
        "Total Cost",
        "Rolling Avg (3mo)",
        "Is Anomaly",
    ]);
}

// First month each service shows up with nonzero cost.
function buildNewServices(monthlyData, serviceCols) {
    const rows = [];
    let prevActive = new Set();
    for (const m of monthlyData) {
        const activeNow = new Set(serviceCols.filter((s) => (m.services[s] || 0) > 0));
        const newServices = [...activeNow].filter((s) => !prevActive.has(s)).sort();
        for (const s of newServices) rows.push({ Month: m.month, "New Service": s });
        prevActive = activeNow;
    }
    writeCsv("azure_usage_new_services_by_month.csv", rows, ["Month", "New Service"]);
}

// Naive next-month forecast: average of last 3 months + simple linear trend.
function buildForecast(monthlyData) {
    const recent = monthlyData.slice(-3).map((m) => m.totalCost);
    const avgForecast = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
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
        { Method: "Average of last 3 months", "Forecasted Total Cost": round(avgForecast) },
        { Method: "Simple linear trend", "Forecasted Total Cost": round(trendForecast) },
    ];
    writeCsv("azure_usage_forecast_next_month.csv", rows, ["Method", "Forecasted Total Cost"]);
}

// Coefficient of variation per service - flags what's unpredictable vs stable.
function buildVolatility(monthlyData, serviceCols) {
    const rows = serviceCols
        .map((s) => {
            const values = monthlyData.map((m) => m.services[s] || 0);
            const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
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
        .sort((a, b) => b["Coefficient of Variation %"] - a["Coefficient of Variation %"]);
    writeCsv("azure_usage_volatility.csv", rows, [
        "Service",
        "Mean",
        "Std Dev",
        "Coefficient of Variation %",
    ]);
}

// --- Azure-specific insights (no AWS equivalent) ---------------------

function buildCostByRegion(transactions) {
    const rows = groupBy(transactions, ["month", "location"])
        .map((r) => ({ Month: r.month, Region: r.location, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_region.csv", rows, ["Month", "Region", "Cost"]);
}

function buildCostByPricingModel(transactions) {
    const rows = groupBy(transactions, ["month", "pricingModel"])
        .map((r) => ({ Month: r.month, PricingModel: r.pricingModel, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_by_pricing_model.csv", rows, ["Month", "PricingModel", "Cost"]);
}

function buildTopResources(transactions) {
    const rows = groupBy(transactions, [
        "month",
        "resourceName",
        "resourceGroup",
        "consumedService",
    ])
        .map((r) => ({
            Month: r.month,
            ResourceName: r.resourceName,
            ResourceGroup: r.resourceGroup,
            Service: r.consumedService,
            Cost: round(r.cost),
        }))
        .sort(
            (a, b) =>
                a.Month.localeCompare(b.Month) ||
                b.Cost - a.Cost
        );

    writeCsv(
        "azure_usage_top_resources.csv",
        rows,
        [
            "Month",
            "ResourceName",
            "ResourceGroup",
            "Service",
            "Cost",
        ]
    );
}

// function buildTopResources(transactions) {
//     const rows = groupBy(transactions, ["resourceName", "resourceGroup", "consumedService"])
//         .map((r) => ({
//             ResourceName: r.resourceName,
//             ResourceGroup: r.resourceGroup,
//             Service: r.consumedService,
//             Cost: round(r.cost),
//         }))
//         .sort((a, b) => b.Cost - a.Cost)
//         .slice(0, 50);
//     writeCsv("azure_usage_top_resources.csv", rows, [
//         "ResourceName",
//         "ResourceGroup",
//         "Service",
//         "Cost",
//     ]);
// }

function buildCreditEligibility(transactions) {
    const rows = groupBy(transactions, ["month", "creditEligible"])
        .map((r) => ({ Month: r.month, CreditEligible: r.creditEligible, Cost: round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_credit_eligibility.csv", rows, ["Month", "CreditEligible", "Cost"]);
}

function buildTopMeters(transactions) {
    const rows = groupBy(transactions, ["month", "meter", "meterCategory", "consumedService", "resourceGroup"])
        .map((r) => ({
            Month: r.month,
            Meter: r.meter,
            Category: r.meterCategory,
            Service: r.consumedService,
            ResourceGroup: r.resourceGroup,
            Cost: round(r.cost),
        }))
        .sort((a, b) => b.Month.localeCompare(a.Month) || b.Cost - a.Cost);
    writeCsv("azure_usage_top_meters.csv", rows, ["Month", "Meter", "Category", "Service", "ResourceGroup", "Cost"]);
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
function main() {
    fs.mkdirSync(RUN_FOLDER, { recursive: true });
    fs.mkdirSync(LATEST_FOLDER, { recursive: true });
    log(`Input folder: ${INPUT_FOLDER}`);
    log(`Run folder: ${RUN_FOLDER}`);
    const transactions = fetchTransactionsFromJson();

    buildMonthlyTotals(transactions);
    buildKpisByMonth(transactions);
    buildCostBySubscription(transactions);
    buildCostByResourceGroup(transactions);
    buildCostByService(transactions);
    buildCostByChargeType(transactions);
    buildTopMeters(transactions);

    // Trend/statistical insights - all derived from the same month x service pivot.
    const { monthlyData, serviceCols } = buildMonthlyServicePivot(transactions);
    buildMomChange(monthlyData);
    buildPareto(monthlyData, serviceCols);
    buildAnomalyFlags(monthlyData);
    buildNewServices(monthlyData, serviceCols);
    buildForecast(monthlyData);
    buildVolatility(monthlyData, serviceCols);

    // Azure-specific insights.
    buildCostByRegion(transactions);
    buildCostByPricingModel(transactions);
    buildTopResources(transactions);
    buildCreditEligibility(transactions);

    log("Completed Azure Usage Pipeline.");
    fs.writeFileSync(path.join(LATEST_FOLDER, "run_log.txt"), runLog.join("\n"));
}

try {
    main();
} catch (e) {
    console.error("FATAL ERROR", e);
    process.exit(1);
}
