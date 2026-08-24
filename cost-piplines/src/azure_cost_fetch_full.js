/**
 * Azure Cost Management — full data pull for dashboards
 * -------------------------------------------------------
 * Pulls a broad set of cost data per subscription:
 *   1. Daily cost by Service + ResourceGroup
 *   2. Daily cost by Region + MeterCategory
 *   3. Daily cost by ChargeType + PricingModel
 *   4. Monthly amortized cost by Service (smooths reservation purchases)
 *   5. Resource-level usage details (most granular — can be large)
 *   6. Budgets
 *   7. Reservation / savings plan utilization (if any exist)
 *
 * Each dataset is written to its own JSON file in ./output so you can load
 * whichever ones you need into the dashboard.
 *
 * Install:
 *   npm install @azure/identity @azure/arm-subscriptions @azure/arm-costmanagement dotenv winston
 *
 * .env file:
 *   AZURE_TENANT_ID=...
 *   AZURE_CLIENT_ID=...
 *   AZURE_CLIENT_SECRET=...
 *   LOG_LEVEL=info
 *   DAYS_BACK=180               # how many days of history to pull (default 180)
 *   MONTHS_BACK=6               # how many months of history to pull (default 6)
 *   INCLUDE_USAGE_DETAILS=true  # resource-level line items — large payload, set false to skip
 *   
 *
 * Run:
 *   node azure-cost-fetch-full.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const { ClientSecretCredential } = require('@azure/identity');
const { SubscriptionClient } = require('@azure/arm-subscriptions');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const { S3Client, PutObjectCommand, BucketAlreadyOwnedByYou } = require('@aws-sdk/client-s3');

const {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    LOG_LEVEL,
    DAYS_BACK,
    MONTHS_BACK,
    INCLUDE_USAGE_DETAILS,
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_USAGE_DATA_RAW_RREFIX,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
} = process.env;

const daysBack = parseInt(DAYS_BACK || '180', 10);
const monthsBack = parseInt(MONTHS_BACK || '6', 10);
const includeUsageDetails = (INCLUDE_USAGE_DETAILS || 'true').toLowerCase() === 'true';

// ---------- Logger ----------
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const logger = winston.createLogger({
    level: LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'azure-cost-fetch-full' },
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'azure-cost-fetch-full.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const extra = Object.keys(meta).filter((k) => k !== 'service').length
                        ? ' ' + JSON.stringify(
                            Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'service'))
                        )
                        : '';
                    return `${timestamp} [${level}] ${message}${extra}`;
                })
            ),
        }),
    ],
});

if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    logger.error('Missing required environment variables', {
        AZURE_TENANT_ID: !!AZURE_TENANT_ID,
        AZURE_CLIENT_ID: !!AZURE_CLIENT_ID,
        AZURE_CLIENT_SECRET: !!AZURE_CLIENT_SECRET,
    });
    process.exit(1);
}

// ---------- Auth ----------
const credential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAt - 60_000) return cachedToken;
    const tokenResponse = await credential.getToken('https://management.azure.com/.default');
    cachedToken = tokenResponse.token;
    cachedTokenExpiresAt = tokenResponse.expiresOnTimestamp;
    logger.debug('Refreshed access token');
    return cachedToken;
}

// ----------R2 config---------------------------

const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_AZURE_DATA_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_AZURE_DATA_ACCESS_KEY_ID,
        secretAccessKey: R2_AZURE_DATA_SECRET_ACCESS_KEY,
    },
});

// ----------R2 Upload Helper---------------------- 

async function uploadJsonToR2(key, data) {
    await r2Client.send(
        new PutObjectCommand({
            Bucket: R2_AZURE_DATA_BUCKET_NAME,
            Key: key,
            Body: JSON.stringify(data),
            ContentType: 'application/json',
        })
    );

    logger.info('Uploaded to R2', {
        bucket: R2_AZURE_DATA_BUCKET_NAME,
        key,
    });
}


// ---------- Generic REST helper (with pagination + 429 retry) for endpoints
// not covered well by SDK clients (Consumption API: usageDetails, budgets,
// reservationSummaries) ----------
async function restGetAll(initialUrl, { context = {}, maxPages = 50 } = {}) {
    let url = initialUrl;
    let allItems = [];
    let page = 0;

    while (url && page < maxPages) {
        const token = await getAccessToken();
        const resp = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (resp.status === 429) {
            const retryAfter = parseInt(resp.headers.get('x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after') || '5', 10);
            logger.warn('Throttled, retrying', { ...context, retryAfterSec: retryAfter, url });
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
        }

        if (!resp.ok) {
            const text = await resp.text();
            logger.error('REST call failed', { ...context, status: resp.status, url, body: text.slice(0, 500) });
            throw new Error(`REST call failed: ${resp.status}`);
        }

        const data = await resp.json();
        const items = data.value || [];
        allItems = allItems.concat(items);
        url = data.nextLink || null;
        page += 1;
    }

    return allItems;
}

// ---------- Discover subscriptions ----------
async function listSubscriptions() {
    const client = new SubscriptionClient(credential);
    const subs = [];
    for await (const sub of client.subscriptions.list()) {
        subs.push({ subscriptionId: sub.subscriptionId, displayName: sub.displayName, state: sub.state });
    }
    return subs;
}

// ---------- Generic Cost Management query (via SDK) ----------
async function runCostQuery(subscriptionId, { fromDate, toDate, granularity, groupings, type = 'ActualCost' }) {
    const client = new CostManagementClient(credential);
    const scope = `/subscriptions/${subscriptionId}`;

    const queryDefinition = {
        type,
        timeframe: 'Custom',
        timePeriod: { from: new Date(fromDate), to: new Date(toDate) },
        dataset: {
            granularity,
            aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
            grouping: groupings,
        },
    };

    const result = await client.query.usage(scope, queryDefinition);
    const columns = result.columns.map((c) => c.name);
    const rows = result.rows || [];
    return rows.map((row) => {
        const obj = {};
        columns.forEach((col, i) => (obj[col] = row[i]));
        return obj;
    });
}

// ---------- Resource-level usage details ----------
async function getUsageDetails(subscriptionId, fromDate, toDate) {
    // const url =
    //     `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Consumption/usageDetails` +
    //     `?api-version=2023-05-01&$filter=properties/usageStart ge '${fromDate}' and properties/usageEnd le '${toDate}'`;
    const url =
        `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Consumption/usageDetails` +
        `?api-version=2023-05-01` +
        `&metric=actualCost` +
        `&$expand=meterDetails,additionalInfo` +
        `&$filter=properties/usageStart ge '${fromDate}' and properties/usageEnd le '${toDate}'`;

    const items = await restGetAll(url, { context: { subscriptionId, dataset: 'usageDetails' } });
    return items.map((item) => ({ id: item.id, name: item.name, ...item.properties }));
}

// ---------- Budgets ----------
async function getBudgets(subscriptionId) {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Consumption/budgets?api-version=2023-05-01`;
    const items = await restGetAll(url, { context: { subscriptionId, dataset: 'budgets' } });
    return items.map((item) => ({ id: item.id, name: item.name, ...item.properties }));
}

// ---------- Reservation / savings plan utilization ----------
async function getReservationSummaries(subscriptionId) {
    const url = `https://management.azure.com/providers/Microsoft.Capacity/reservationSummaries?api-version=2022-11-01&grain=daily`;
    try {
        const items = await restGetAll(url, { context: { subscriptionId, dataset: 'reservationSummaries' } });
        return items;
    } catch (err) {
        logger.warn('Reservation summaries unavailable (likely no reservations)', {
            subscriptionId,
            message: err.message,
        });
        return [];
    }
}

// ---------- Retry wrapper ----------
async function withRetry(
    fn,
    { retries = 3, baseDelayMs = 3000, context = {} } = {}
) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            console.log("STATUS", err.statusCode);
            console.log("HEADERS", err.response?.headers);

            const retryAfter = parseInt(
                err.response?.headers?.get(
                    'x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after'
                ) || '5',
                10
            );

            console.log("RETRY_AFTER_TIME", retryAfter);

            console.log("RETRY_AFTER_TIME", retryAfter);

            const status = err.statusCode || err.response?.status;
            const isLast = attempt === retries;

            if (status === 429 && !isLast) {
                const delay = retryAfter * 1000;

                logger.warn('Throttled, retrying', {
                    ...context,
                    attempt: attempt + 1,
                    delay
                });

                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            logger.error('Request failed', {
                ...context,
                attempt: attempt + 1,
                status,
                message: err.message
            });

            throw err;
        }
    }
}

function writeJson(filename, data) {
    const filePath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    logger.info('Wrote output file', { file: filename, records: Array.isArray(data) ? data.length : 1 });
}

// ---------- Main ----------
async function main() {
    const runStartedAt = Date.now();
    const today = new Date();
    // const fromDate = today.getMonth() - monthsBack;
    // const fromDate = new Date(today);
    // fromDate.setDate(fromDate.getDate() - daysBack);
    const fromDate = new Date(
        today.getFullYear(),
        today.getMonth() - monthsBack,
        1
    );

    const fmt = (d) => d.toISOString().slice(0, 10);
    const from = fmt(fromDate);
    const to = fmt(today);

    logger.info('Run started', { from, to, daysBack, includeUsageDetails });

    const subs = await listSubscriptions();
    logger.info(`Found ${subs.length} subscription(s)`, {
        subscriptions: subs.map((s) => ({ id: s.subscriptionId, name: s.displayName, state: s.state })),
    });

    const datasets = {
        costByServiceAndResourceGroup: [],
        costByRegionAndMeterCategory: [],
        costByChargeTypeAndPricingModel: [],
        amortizedCostByServiceMonthly: [],
        usageDetails: [],
        budgets: [],
        reservationSummaries: [],
    };

    let succeeded = 0;
    let failed = 0;

    for (const sub of subs) {
        if (sub.state !== 'Enabled') {
            logger.warn('Skipping disabled subscription', { subscriptionId: sub.subscriptionId, state: sub.state });
            continue;
        }

        const tag = (rows) =>
            rows.map((r) => ({ ...r, SubscriptionId: sub.subscriptionId, SubscriptionName: sub.displayName }));

        const ctx = { subscriptionId: sub.subscriptionId, displayName: sub.displayName };
        logger.info('Processing subscription', ctx);

        try {
            // logger.info('Pulling: cost by service + resource group', ctx);
            // datasets.costByServiceAndResourceGroup.push(
            //     ...tag(await withRetry(() => runCostQuery(sub.subscriptionId, {
            //         fromDate: from, toDate: to, granularity: 'Daily',
            //         groupings: [{ type: 'Dimension', name: 'ServiceName' }, { type: 'Dimension', name: 'ResourceGroup' }],
            //     }), { context: ctx }))
            // );
            //
            // logger.info('Pulling: cost by region + meter category', ctx);
            // datasets.costByRegionAndMeterCategory.push(
            //     ...tag(await withRetry(() => runCostQuery(sub.subscriptionId, {
            //         fromDate: from, toDate: to, granularity: 'Daily',
            //         groupings: [{ type: 'Dimension', name: 'ResourceLocation' }, { type: 'Dimension', name: 'MeterCategory' }],
            //     }), { context: ctx }))
            // );
            //
            // logger.info('Pulling: cost by charge type + pricing model', ctx);
            // datasets.costByChargeTypeAndPricingModel.push(
            //     ...tag(await withRetry(() => runCostQuery(sub.subscriptionId, {
            //         fromDate: from, toDate: to, granularity: 'Daily',
            //         groupings: [{ type: 'Dimension', name: 'ChargeType' }, { type: 'Dimension', name: 'PricingModel' }],
            //     }), { context: ctx }))
            // );
            //
            // logger.info('Pulling: amortized cost by service (monthly)', ctx);
            // datasets.amortizedCostByServiceMonthly.push(
            //     ...tag(await withRetry(() => runCostQuery(sub.subscriptionId, {
            //         fromDate: from, toDate: to, granularity: 'Monthly', type: 'AmortizedCost',
            //         groupings: [{ type: 'Dimension', name: 'ServiceName' }],
            //     }), { context: ctx }))
            // );
            //
            // //NOTE - the below call is commented out because the client lacks the required permissions.
            // logger.info('Pulling: budgets', ctx);
            // datasets.budgets.push(...tag(await withRetry(() => getBudgets(sub.subscriptionId), { context: ctx })));
            //
            // // NOTE - the below call is commented out because the client lacks the required permissions.
            // logger.info('Pulling: reservation summaries', ctx);
            // datasets.reservationSummaries.push(
            //     ...tag(await getReservationSummaries(sub.subscriptionId))
            // );

            if (includeUsageDetails) {
                logger.info('Pulling: resource-level usage details (this can take a while)', ctx);
                datasets.usageDetails.push(
                    ...tag(await withRetry(() => getUsageDetails(sub.subscriptionId, from, to), { context: ctx, retries: 2 }))
                );
            }

            succeeded += 1;
        } catch (err) {
            logger.error('Subscription processing failed', { ...ctx, message: err.message });
            failed += 1;
        }
    }

    // writeJson('cost-by-service-resourcegroup.json', datasets.costByServiceAndResourceGroup);
    // writeJson('cost-by-region-metercategory.json', datasets.costByRegionAndMeterCategory);
    // writeJson('cost-by-chargetype-pricingmodel.json', datasets.costByChargeTypeAndPricingModel);
    // writeJson('amortized-cost-by-service-monthly.json', datasets.amortizedCostByServiceMonthly);
    // writeJson('budgets.json', datasets.budgets);
    // writeJson('reservation-summaries.json', datasets.reservationSummaries);
    if (includeUsageDetails) {
        writeJson('usage-details.json', datasets.usageDetails);

        await uploadJsonToR2(
            'usage-data/usage-details.json',
            datasets.usageDetails
        );
    }

    const durationMs = Date.now() - runStartedAt;
    logger.info('Run complete', {
        totalSubscriptions: subs.length,
        succeeded,
        failed,
        durationMs,
        recordCounts: Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, v.length])),
    });
}

main().catch((err) => {
    logger.error('Fatal error', { message: err.message, stack: err.stack });
    process.exit(1);
});
