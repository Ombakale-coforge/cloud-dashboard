require("dotenv").config();

const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
} = require("@aws-sdk/client-s3");

const {
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
} = process.env;

const requiredEnv = {
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
};

const missingEnv = Object.entries(requiredEnv)
    .filter(([, value]) => !value)
    .map(([name]) => name);

if (missingEnv.length) {
    console.error(`Missing environment variables: ${missingEnv.join(", ")}`);
    process.exit(1);
}

function normalizePrefix(value, fallback) {
    const prefix = String(value || fallback).trim().replace(/^\/+/, "");
    return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

const INPUT_PREFIX = normalizePrefix(process.env.R2_USAGE_DATA_PREFIX, "usage-data/");
const REPORT_PREFIX = normalizePrefix(process.env.R2_USAGE_REPORT_PREFIX, "usage-data-reports/");
const ANOMALY_THRESHOLD_PERCENT = Number.parseFloat(process.env.ANOMALY_THRESHOLD_PERCENT || "15");
const ANOMALY_ROLLING_MONTHS = Number.parseInt(process.env.ANOMALY_ROLLING_MONTHS || "3", 10);

if (!Number.isFinite(ANOMALY_THRESHOLD_PERCENT) || ANOMALY_THRESHOLD_PERCENT < 0) {
    console.error("ANOMALY_THRESHOLD_PERCENT must be a non-negative number.");
    process.exit(1);
}

if (!Number.isInteger(ANOMALY_ROLLING_MONTHS) || ANOMALY_ROLLING_MONTHS < 1) {
    console.error("ANOMALY_ROLLING_MONTHS must be a positive integer.");
    process.exit(1);
}

const startedAt = new Date();
const runStamp = startedAt.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const runPrefix = `${REPORT_PREFIX}runs/${runStamp}/`;
const latestPrefix = `${REPORT_PREFIX}latest/`;

const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_AZURE_DATA_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_AZURE_DATA_ACCESS_KEY_ID,
        secretAccessKey: R2_AZURE_DATA_SECRET_ACCESS_KEY,
    },
});

const runLog = [];

function log(message, metadata) {
    const suffix = metadata === undefined ? "" : ` ${JSON.stringify(metadata)}`;
    const line = `[${new Date().toISOString()}] ${message}${suffix}`;
    console.log(line);
    runLog.push(line);
}

function round(value, decimals = 2) {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function safeDivide(numerator, denominator) {
    return denominator ? numerator / denominator : 0;
}

function normalizeText(value, fallback) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text || fallback;
}

function normalizeBoolean(value) {
    if (value === true || value === false) return value;
    if (value === 1) return true;
    if (value === 0) return false;
    if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (["true", "yes", "1"].includes(text)) return true;
        if (["false", "no", "0"].includes(text)) return false;
    }
    return null;
}

function toCsv(rows, columns) {
    const escapeValue = (value) => {
        if (value === undefined || value === null) return "";
        const text = String(value);
        if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
        return text;
    };

    const lines = [
        columns.map(escapeValue).join(","),
        ...rows.map((row) => columns.map((column) => escapeValue(row[column])).join(",")),
    ];

    return `\uFEFF${lines.join("\n")}`;
}

function report(filename, rows, columns) {
    return {
        filename,
        rowCount: rows.length,
        content: toCsv(rows, columns),
    };
}

async function putText(key, body, contentType) {
    await r2.send(new PutObjectCommand({
        Bucket: R2_AZURE_DATA_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
    }));
}

async function getJson(key) {
    const response = await r2.send(new GetObjectCommand({
        Bucket: R2_AZURE_DATA_BUCKET_NAME,
        Key: key,
    }));

    if (!response.Body) throw new Error(`Empty R2 response for ${key}`);
    const text = await response.Body.transformToString("utf-8");
    if (!text.trim()) throw new Error(`Empty R2 object: ${key}`);

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in ${key}: ${error.message}`);
    }
}

function isUsageObject(key) {
    const escapedPrefix = INPUT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escapedPrefix}\\d{4}-\\d{2}-\\d{2}/usage-details\\.json$`).test(key || "");
}

async function listUsageObjects() {
    const objects = [];
    let continuationToken;

    do {
        const response = await r2.send(new ListObjectsV2Command({
            Bucket: R2_AZURE_DATA_BUCKET_NAME,
            Prefix: INPUT_PREFIX,
            ContinuationToken: continuationToken,
        }));

        for (const object of response.Contents || []) {
            if (isUsageObject(object.Key)) {
                objects.push({
                    key: object.Key,
                    size: object.Size || 0,
                    etag: object.ETag || null,
                    lastModified: object.LastModified || null,
                });
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return objects.sort((a, b) => a.key.localeCompare(b.key));
}

function extractRecords(parsed, key) {
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.value)) return parsed.value;
    throw new Error(`Unexpected JSON shape in ${key}. Expected an array or { value: [] }.`);
}

function meterName(record) {
    const details = record.meterDetails;
    if (details && typeof details === "object") {
        return normalizeText(
            details.meterName || details.MeterName || record.x_SkuMeterName || record.ChargeDescription,
            "Unknown Meter"
        );
    }
    return normalizeText(record.meterId || record.x_SkuMeterName || record.ChargeDescription, "Unknown Meter");
}

function meterCategory(record) {
    const details = record.meterDetails;
    if (details && typeof details === "object") {
        return normalizeText(details.meterCategory || details.MeterCategory || record.x_SkuMeterCategory, "Uncategorized");
    }
    return normalizeText(record.x_SkuMeterCategory, "Uncategorized");
}

function normalizeRecord(raw) {
    const record = raw && raw.properties ? raw.properties : raw;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        return { transaction: null, reason: "invalid record" };
    }

    const rawDate = record.date || record.ChargePeriodStart || record.chargePeriodStart;
    const date = rawDate ? new Date(rawDate) : null;
    if (!date || Number.isNaN(date.getTime())) {
        return { transaction: null, reason: "invalid date" };
    }

    let rawCost;
    if (record.cost !== undefined) rawCost = record.cost;
    else if (record.costInBillingCurrency !== undefined) rawCost = record.costInBillingCurrency;
    else rawCost = record.EffectiveCost;

    const cost = Number(rawCost);
    if (!Number.isFinite(cost)) return { transaction: null, reason: "invalid cost" };

    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const creditValue = normalizeBoolean(
        record.isAzureCreditEligible !== undefined
            ? record.isAzureCreditEligible
            : record.x_SkuIsCreditEligible
    );

    return {
        transaction: {
            month,
            cost,
            subscription: normalizeText(
                record.subscriptionName || record.subscriptionId || record.SubscriptionName ||
                record.SubscriptionId || record.SubAccountName || record.SubAccountId,
                "Unknown Subscription"
            ),
            resourceGroup: normalizeText(record.resourceGroup || record.x_ResourceGroupName, "Unassigned"),
            consumedService: normalizeText(record.consumedService || record.product || record.ServiceName, "Unknown Service"),
            chargeType: normalizeText(record.chargeType || record.ChargeCategory, "Unknown"),
            meter: meterName(record),
            meterCategory: meterCategory(record),
            location: normalizeText(record.resourceLocation || record.RegionId || record.RegionName, "Unknown"),
            pricingModel: normalizeText(record.pricingModel || record.PricingCategory, "Unknown"),
            resourceName: normalizeText(record.resourceName || record.ResourceName, "Unassigned"),
            creditEligible: creditValue === true ? "Yes" : creditValue === false ? "No" : "Unknown",
        },
        reason: null,
    };
}

async function loadTransactions() {
    const objects = await listUsageObjects();
    if (!objects.length) throw new Error(`No usage files found under ${INPUT_PREFIX}`);

    const transactions = [];
    const stats = {
        objectsFound: objects.length,
        objectsRead: 0,
        rowsFound: 0,
        rowsAccepted: 0,
        rowsSkipped: 0,
        invalidDateRows: 0,
        invalidCostRows: 0,
        invalidRecordRows: 0,
    };

    for (const object of objects) {
        const parsed = await getJson(object.key);
        const records = extractRecords(parsed, object.key);
        let accepted = 0;
        let skipped = 0;

        stats.objectsRead += 1;
        stats.rowsFound += records.length;

        for (const raw of records) {
            const result = normalizeRecord(raw);
            if (!result.transaction) {
                skipped += 1;
                stats.rowsSkipped += 1;
                if (result.reason === "invalid date") stats.invalidDateRows += 1;
                else if (result.reason === "invalid cost") stats.invalidCostRows += 1;
                else stats.invalidRecordRows += 1;
                continue;
            }
            transactions.push(result.transaction);
            accepted += 1;
            stats.rowsAccepted += 1;
        }

        log(`Read ${object.key}`, { records: records.length, accepted, skipped });
    }

    if (!transactions.length) throw new Error("No valid usage records were found.");
    return { transactions, objects, stats };
}

function groupBy(transactions, dimensions) {
    const groups = new Map();

    for (const transaction of transactions) {
        const values = dimensions.map((dimension) => transaction[dimension]);
        const key = JSON.stringify(values);
        const current = groups.get(key);
        if (current) current.cost += transaction.cost;
        else groups.set(key, { values, cost: transaction.cost });
    }

    return [...groups.values()].map((group) => {
        const row = { cost: group.cost };
        dimensions.forEach((dimension, index) => {
            row[dimension] = group.values[index];
        });
        return row;
    });
}

function monthlyServicePivot(transactions) {
    const months = [...new Set(transactions.map((item) => item.month))].sort();
    const services = [...new Set(transactions.map((item) => item.consumedService))].sort();
    const pivot = Object.fromEntries(months.map((month) => [month, {}]));

    for (const item of transactions) {
        pivot[item.month][item.consumedService] =
            (pivot[item.month][item.consumedService] || 0) + item.cost;
    }

    const monthlyData = months.map((month) => {
        const serviceCosts = {};
        let totalCost = 0;
        for (const service of services) {
            const value = pivot[month][service] || 0;
            serviceCosts[service] = value;
            totalCost += value;
        }
        return { month, services: serviceCosts, totalCost };
    });

    return { monthlyData, services };
}

function buildReports(transactions) {
    const reports = [];
    const { monthlyData, services } = monthlyServicePivot(transactions);

    let rows = groupBy(transactions, ["month"])
        .map((r) => ({ Month: r.month, "Total Cost": round(r.cost) }))
        .sort((a, b) => a.Month.localeCompare(b.Month));
    reports.push(report("azure_usage_monthly_totals.csv", rows, ["Month", "Total Cost"]));

    const months = [...new Set(transactions.map((item) => item.month))].sort();
    rows = months.map((month) => {
        const monthRows = transactions.filter((item) => item.month === month);
        const total = monthRows.reduce((sum, item) => sum + item.cost, 0);
        const subscriptions = groupBy(monthRows, ["subscription"]).sort((a, b) => b.cost - a.cost);
        const monthServices = groupBy(monthRows, ["consumedService"]).sort((a, b) => b.cost - a.cost);
        return {
            Month: month,
            "Total Cost": round(total),
            "Top Subscription": subscriptions[0]?.subscription || "",
            "Top Subscription Cost": subscriptions[0] ? round(subscriptions[0].cost) : 0,
            "Top Service": monthServices[0]?.consumedService || "",
            "Top Service Cost": monthServices[0] ? round(monthServices[0].cost) : 0,
            Subscriptions: new Set(monthRows.map((item) => item.subscription)).size,
            "Resource Groups": new Set(monthRows.map((item) => item.resourceGroup)).size,
        };
    });
    reports.push(report("azure_usage_kpis_by_month.csv", rows, [
        "Month", "Total Cost", "Top Subscription", "Top Subscription Cost",
        "Top Service", "Top Service Cost", "Subscriptions", "Resource Groups",
    ]));

    const groupedReports = [
        {
            filename: "azure_usage_by_subscription.csv",
            dimensions: ["month", "subscription"],
            map: (r) => ({ Month: r.month, Subscription: r.subscription, Cost: round(r.cost) }),
            columns: ["Month", "Subscription", "Cost"],
        },
        {
            filename: "azure_usage_by_resource_group.csv",
            dimensions: ["month", "resourceGroup", "subscription"],
            map: (r) => ({ Month: r.month, ResourceGroup: r.resourceGroup, Subscription: r.subscription, Cost: round(r.cost) }),
            columns: ["Month", "ResourceGroup", "Subscription", "Cost"],
        },
        {
            filename: "azure_usage_by_service.csv",
            dimensions: ["month", "consumedService"],
            map: (r) => ({ Month: r.month, ConsumedService: r.consumedService, Cost: round(r.cost) }),
            columns: ["Month", "ConsumedService", "Cost"],
        },
        {
            filename: "azure_usage_by_charge_type.csv",
            dimensions: ["month", "chargeType"],
            map: (r) => ({ Month: r.month, ChargeType: r.chargeType, Cost: round(r.cost) }),
            columns: ["Month", "ChargeType", "Cost"],
        },
        {
            filename: "azure_usage_by_region.csv",
            dimensions: ["month", "location"],
            map: (r) => ({ Month: r.month, Region: r.location, Cost: round(r.cost) }),
            columns: ["Month", "Region", "Cost"],
        },
        {
            filename: "azure_usage_by_pricing_model.csv",
            dimensions: ["month", "pricingModel"],
            map: (r) => ({ Month: r.month, PricingModel: r.pricingModel, Cost: round(r.cost) }),
            columns: ["Month", "PricingModel", "Cost"],
        },
        {
            filename: "azure_usage_credit_eligibility.csv",
            dimensions: ["month", "creditEligible"],
            map: (r) => ({ Month: r.month, CreditEligible: r.creditEligible, Cost: round(r.cost) }),
            columns: ["Month", "CreditEligible", "Cost"],
        },
    ];

    for (const item of groupedReports) {
        const data = groupBy(transactions, item.dimensions)
            .map(item.map)
            .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
        reports.push(report(item.filename, data, item.columns));
    }

    rows = groupBy(transactions, ["month", "meter", "meterCategory", "consumedService", "resourceGroup"])
        .map((r) => ({
            Month: r.month,
            Meter: r.meter,
            Category: r.meterCategory,
            Service: r.consumedService,
            ResourceGroup: r.resourceGroup,
            Cost: round(r.cost),
        }))
        .sort((a, b) => b.Month.localeCompare(a.Month) || b.Cost - a.Cost);
    reports.push(report("azure_usage_top_meters.csv", rows, ["Month", "Meter", "Category", "Service", "ResourceGroup", "Cost"]));

    rows = monthlyData.map((item, index) => {
        const previous = index > 0 ? monthlyData[index - 1].totalCost : null;
        return {
            Month: item.month,
            "Total Cost": round(item.totalCost),
            "Previous Month Cost": previous === null ? "" : round(previous),
            "MoM % Change": previous ? round(((item.totalCost - previous) / previous) * 100) : "",
        };
    });
    reports.push(report("azure_usage_mom_change.csv", rows, ["Month", "Total Cost", "Previous Month Cost", "MoM % Change"]));

    const serviceTotals = Object.fromEntries(services.map((service) => [service, 0]));
    for (const month of monthlyData) {
        for (const service of services) serviceTotals[service] += month.services[service] || 0;
    }
    const sortedServices = services
        .map((service) => ({ Service: service, total: serviceTotals[service] }))
        .sort((a, b) => b.total - a.total);
    const grandTotal = sortedServices.reduce((sum, item) => sum + item.total, 0);
    let cumulativeCost = 0;
    rows = sortedServices.map((item, index) => {
        cumulativeCost += item.total;
        return {
            Service: item.Service,
            "Total Cost": round(item.total),
            "% of Total": grandTotal ? round((item.total / grandTotal) * 100) : 0,
            "Cumulative %": grandTotal ? round((cumulativeCost / grandTotal) * 100) : 0,
            Rank: index + 1,
        };
    });
    reports.push(report("azure_usage_cost_concentration_pareto.csv", rows, ["Service", "Total Cost", "% of Total", "Cumulative %", "Rank"]));

    const rollingColumn = `Rolling Avg (${ANOMALY_ROLLING_MONTHS}mo)`;
    rows = monthlyData.map((item, index) => {
        const previousMonths = monthlyData.slice(Math.max(0, index - ANOMALY_ROLLING_MONTHS), index);
        const average = previousMonths.length
            ? previousMonths.reduce((sum, month) => sum + month.totalCost, 0) / previousMonths.length
            : null;
        const difference = average ? ((item.totalCost - average) / average) * 100 : null;
        const isAnomaly = previousMonths.length === ANOMALY_ROLLING_MONTHS &&
            average > 0 && item.totalCost > average * (1 + ANOMALY_THRESHOLD_PERCENT / 100);
        return {
            Month: item.month,
            "Total Cost": round(item.totalCost),
            [rollingColumn]: average === null ? "" : round(average),
            "Difference %": difference === null ? "" : round(difference),
            "Threshold %": ANOMALY_THRESHOLD_PERCENT,
            "Is Anomaly": isAnomaly,
        };
    });
    reports.push(report("azure_usage_anomaly_flags.csv", rows, ["Month", "Total Cost", rollingColumn, "Difference %", "Threshold %", "Is Anomaly"]));

    const seenServices = new Set();
    rows = [];
    for (const month of monthlyData) {
        for (const service of services.filter((name) => (month.services[name] || 0) > 0).sort()) {
            if (!seenServices.has(service)) {
                rows.push({ Month: month.month, "New Service": service });
                seenServices.add(service);
            }
        }
    }
    reports.push(report("azure_usage_new_services_by_month.csv", rows, ["Month", "New Service"]));

    const recent = monthlyData.slice(-3).map((item) => item.totalCost);
    const averageForecast = recent.length ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
    let trendForecast = averageForecast;
    if (recent.length >= 2) {
        const xMean = (recent.length - 1) / 2;
        const yMean = averageForecast;
        let numerator = 0;
        let denominator = 0;
        recent.forEach((value, index) => {
            numerator += (index - xMean) * (value - yMean);
            denominator += (index - xMean) ** 2;
        });
        const slope = denominator ? numerator / denominator : 0;
        trendForecast = yMean + slope * (recent.length - xMean);
    }
    rows = [
        { Method: "Average of last 3 months", "Forecasted Total Cost": round(Math.max(0, averageForecast)) },
        { Method: "Simple linear trend", "Forecasted Total Cost": round(Math.max(0, trendForecast)) },
    ];
    reports.push(report("azure_usage_forecast_next_month.csv", rows, ["Method", "Forecasted Total Cost"]));

    rows = services.map((service) => {
        const values = monthlyData.map((month) => month.services[service] || 0);
        const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
        const variance = values.length ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length : 0;
        const standardDeviation = Math.sqrt(variance);
        return {
            Service: service,
            Mean: round(mean),
            "Std Dev": round(standardDeviation),
            "Coefficient of Variation %": mean ? round(safeDivide(standardDeviation, Math.abs(mean)) * 100, 1) : 0,
        };
    }).filter((item) => item.Mean !== 0)
        .sort((a, b) => b["Coefficient of Variation %"] - a["Coefficient of Variation %"]);
    reports.push(report("azure_usage_volatility.csv", rows, ["Service", "Mean", "Std Dev", "Coefficient of Variation %"]));

    rows = groupBy(transactions, ["month", "resourceName", "resourceGroup", "consumedService"])
        .map((r) => ({
            Month: r.month,
            ResourceName: r.resourceName,
            ResourceGroup: r.resourceGroup,
            Service: r.consumedService,
            Cost: round(r.cost),
        }))
        .sort((a, b) => a.Month.localeCompare(b.Month) || b.Cost - a.Cost);
    reports.push(report("azure_usage_top_resources.csv", rows, ["Month", "ResourceName", "ResourceGroup", "Service", "Cost"]));

    return reports;
}

async function uploadReports(reports, prefix) {
    for (const item of reports) {
        const key = `${prefix}${item.filename}`;
        await putText(key, item.content, "text/csv; charset=utf-8");
        log(`Uploaded ${item.filename}`, { key, rows: item.rowCount });
    }
}

function objectMetadata(objects) {
    return objects.map((object) => ({
        key: object.key,
        size: object.size,
        etag: object.etag,
        lastModified: object.lastModified ? new Date(object.lastModified).toISOString() : null,
    }));
}

async function uploadSuccessMetadata(objects, stats, transactions, reports) {
    const completedAt = new Date();
    const manifest = {
        status: "success",
        runStamp,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        bucket: R2_AZURE_DATA_BUCKET_NAME,
        inputPrefix: INPUT_PREFIX,
        runPrefix,
        latestPrefix,
        anomalyThresholdPercent: ANOMALY_THRESHOLD_PERCENT,
        anomalyRollingMonths: ANOMALY_ROLLING_MONTHS,
        inputStats: stats,
        transactionCount: transactions.length,
        months: [...new Set(transactions.map((item) => item.month))].sort(),
        inputObjects: objectMetadata(objects),
        reports: reports.map((item) => ({
            filename: item.filename,
            rows: item.rowCount,
            runKey: `${runPrefix}${item.filename}`,
            latestKey: `${latestPrefix}${item.filename}`,
        })),
    };

    const json = JSON.stringify(manifest, null, 2);
    await putText(`${runPrefix}report_manifest.json`, json, "application/json; charset=utf-8");
    await putText(`${latestPrefix}report_manifest.json`, json, "application/json; charset=utf-8");
}

async function uploadLogs(success) {
    const text = runLog.join("\n");
    await putText(`${runPrefix}run_log.txt`, text, "text/plain; charset=utf-8");
    if (success) await putText(`${latestPrefix}run_log.txt`, text, "text/plain; charset=utf-8");
}

async function main() {
    log("Starting Azure usage report pipeline", {
        bucket: R2_AZURE_DATA_BUCKET_NAME,
        inputPrefix: INPUT_PREFIX,
        runPrefix,
        latestPrefix,
    });

    const { transactions, objects, stats } = await loadTransactions();
    log("Input processing completed", stats);

    const reports = buildReports(transactions);
    log("Reports generated in memory", { reports: reports.length });

    await uploadReports(reports, runPrefix);
    await uploadReports(reports, latestPrefix);

    await uploadSuccessMetadata(objects, stats, transactions, reports);
    log("Pipeline completed", {
        transactions: transactions.length,
        reports: reports.length,
        durationMs: Date.now() - startedAt.getTime(),
    });
    await uploadLogs(true);
}

main().catch(async (error) => {
    log("Pipeline failed", { message: error.message, stack: error.stack });
    try {
        await uploadLogs(false);
    } catch (logError) {
        console.error("Could not upload failure log:", logError.message);
    }
    console.error("FATAL ERROR", error);
    process.exit(1);
});

