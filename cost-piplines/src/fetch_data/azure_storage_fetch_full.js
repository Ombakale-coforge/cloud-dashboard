/**
 * FOCUS cost export ingestion
 * -------------------------------------------------------
 * Reads the Cost Management FOCUS export (written by Azure into blob
 * storage) and uploads the data into R2, bucketed by day, at:
 *
 *   usage-data/YYYY-MM-DD/usage-details.json
 *
 * This replaces the old live Consumption API polling approach entirely —
 * Azure now generates the data server-side on its own schedule, so this
 * script's only job is: find new/updated export runs, parse their CSVs,
 * split by day, and upload.
 *
 * Export layout expected (one folder per calendar month = "period"):
 *   <prefix>/<period>/<runId>/manifest.json
 *   <prefix>/<period>/<runId>/part_0_000N.csv.gz
 *
 * For a still-open month, Azure overwrites with a new runId each time the
 * export runs (MonthToDate), so this script always re-checks the latest
 * run per period and skips periods whose latest run hasn't changed since
 * last time (tracked via a small state marker written to R2).
 *
 * Install:
 *   npm install @azure/identity @azure/storage-blob @aws-sdk/client-s3 csv-parse dotenv winston
 *
 * .env file:
 *   AZURE_TENANT_ID=...
 *   AZURE_CLIENT_ID=...
 *   AZURE_CLIENT_SECRET=...
 *   AZURE_STORAGE_ACCOUNT_NAME=sacfgfinops
 *   AZURE_STORAGE_CONTAINER_NAME=finops
 *   AZURE_EXPORT_PREFIX=finops_dir/CFfinopexport-focus-cost/
 *   MONTHS_BACK=6                # retention window (default 6)
 *   LOG_LEVEL=info
 *   R2_AZURE_DATA_ACCOUNT_ID=...
 *   R2_AZURE_DATA_ACCESS_KEY_ID=...
 *   R2_AZURE_DATA_BUCKET_NAME=...
 *   R2_AZURE_DATA_SECRET_ACCESS_KEY=...
 *
 * Run:
 *   node ingest-focus-export.js
 */

require('dotenv').config();
const zlib = require('zlib');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const { parse } = require('csv-parse');
const { ClientSecretCredential } = require('@azure/identity');
const { BlobServiceClient } = require('@azure/storage-blob');
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_CONTAINER_NAME,
    AZURE_EXPORT_PREFIX,
    MONTHS_BACK,
    LOG_LEVEL,
    R2_AZURE_DATA_ACCOUNT_ID,
    R2_AZURE_DATA_ACCESS_KEY_ID,
    R2_AZURE_DATA_BUCKET_NAME,
    R2_AZURE_DATA_SECRET_ACCESS_KEY,
} = process.env;

const exportPrefix = AZURE_EXPORT_PREFIX || 'finops_dir/CFfinopexport-focus-cost/';
const monthsBack = parseInt(MONTHS_BACK || '6', 10);
const R2_DATA_PREFIX = 'usage-data/';
const R2_STATE_PREFIX = 'usage-data-state/';

// ---------- Logger ----------
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const logger = winston.createLogger({
    level: LOG_LEVEL || 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    defaultMeta: { service: 'ingest-focus-export' },
    transports: [
        new winston.transports.File({ filename: path.join(LOG_DIR, 'ingest-focus-export.log'), maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const extra = Object.keys(meta).filter((k) => k !== 'service').length
                        ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'service')))
                        : '';
                    return `${timestamp} [${level}] ${message}${extra}`;
                })
            ),
        }),
    ],
});

if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_STORAGE_ACCOUNT_NAME || !AZURE_STORAGE_CONTAINER_NAME) {
    logger.error('Missing required Azure Storage environment variables');
    process.exit(1);
}

// ---------- Azure Storage client ----------
const azureCredential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
const blobServiceClient = new BlobServiceClient(`https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`, azureCredential);
const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);

// ---------- R2 client ----------
const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_AZURE_DATA_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_AZURE_DATA_ACCESS_KEY_ID, secretAccessKey: R2_AZURE_DATA_SECRET_ACCESS_KEY },
});

async function uploadJsonToR2(key, data) {
    await r2Client.send(
        new PutObjectCommand({ Bucket: R2_AZURE_DATA_BUCKET_NAME, Key: key, Body: JSON.stringify(data), ContentType: 'application/json' })
    );
}

async function getJsonFromR2(key) {
    try {
        const resp = await r2Client.send(new GetObjectCommand({ Bucket: R2_AZURE_DATA_BUCKET_NAME, Key: key }));
        const body = await resp.Body.transformToString();
        return JSON.parse(body);
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
    }
}

async function listR2DateFolders() {
    const dates = [];
    let continuationToken;
    do {
        const resp = await r2Client.send(
            new ListObjectsV2Command({ Bucket: R2_AZURE_DATA_BUCKET_NAME, Prefix: R2_DATA_PREFIX, Delimiter: '/', ContinuationToken: continuationToken })
        );
        for (const cp of resp.CommonPrefixes || []) {
            const date = cp.Prefix.replace(R2_DATA_PREFIX, '').replace(/\/$/, '');
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
        }
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return dates.sort();
}

async function cleanupOldR2Data(cutoffDateStr) {
    const dates = await listR2DateFolders();
    const toDelete = dates.filter((d) => d < cutoffDateStr);
    if (!toDelete.length) {
        logger.info('No old R2 data to clean up', { cutoffDateStr });
        return;
    }
    logger.info(`Deleting ${toDelete.length} old date folder(s) from R2`, { cutoffDateStr, dates: toDelete });
    for (const date of toDelete) {
        const key = `${R2_DATA_PREFIX}${date}/usage-details.json`;
        try {
            await r2Client.send(new DeleteObjectCommand({ Bucket: R2_AZURE_DATA_BUCKET_NAME, Key: key }));
            logger.info('Deleted old R2 object', { key });
        } catch (err) {
            logger.error('Failed to delete old R2 object', { key, message: err.message });
        }
    }
}

function fmt(d) {
    return d.toISOString().slice(0, 10);
}

async function streamToBuffer(readableStream) {
    const chunks = [];
    for await (const chunk of readableStream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
}

// ---------- Discover periods and their latest run ----------
async function discoverLatestRunsPerPeriod() {
    const allBlobs = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix: exportPrefix })) {
        allBlobs.push({ name: blob.name, lastModified: blob.properties.lastModified });
    }

    const periods = new Map(); // period -> Map(runId -> blobs[])
    for (const blob of allBlobs) {
        const rest = blob.name.slice(exportPrefix.length);
        const parts = rest.split('/');
        if (parts.length < 3) continue;
        const [period, runId] = parts;
        if (!periods.has(period)) periods.set(period, new Map());
        const runs = periods.get(period);
        if (!runs.has(runId)) runs.set(runId, []);
        runs.get(runId).push(blob);
    }

    const result = [];
    for (const [period, runs] of periods.entries()) {
        let latestRunId = null;
        let latestTime = 0;
        for (const [runId, blobs] of runs.entries()) {
            const maxTime = Math.max(...blobs.map((b) => new Date(b.lastModified).getTime()));
            if (maxTime > latestTime) {
                latestTime = maxTime;
                latestRunId = runId;
            }
        }
        result.push({ period, runId: latestRunId, blobs: runs.get(latestRunId) });
    }

    return result.sort((a, b) => a.period.localeCompare(b.period));
}

// ---------- Process one run: parse its CSV(s), bucket by day ----------
async function processRun(period, runId, blobs) {
    const manifestBlob = blobs.find((b) => b.name.endsWith('manifest.json'));
    let csvBlobNames = blobs.filter((b) => b.name.endsWith('.csv.gz') || b.name.endsWith('.csv')).map((b) => b.name);

    if (manifestBlob) {
        const manifestBuf = await streamToBuffer((await containerClient.getBlobClient(manifestBlob.name).download()).readableStreamBody);
        const manifest = JSON.parse(manifestBuf.toString('utf8'));
        if (Array.isArray(manifest.blobs) && manifest.blobs.length) {
            csvBlobNames = manifest.blobs.map((b) => b.blobName);
        }
    }

    const dateBuckets = new Map();
    let totalRows = 0;

    for (const blobName of csvBlobNames) {
        logger.info(`  Parsing ${blobName}`, { period, runId });
        const blobClient = containerClient.getBlobClient(blobName);
        const downloadResp = await blobClient.download();

        let sourceStream = downloadResp.readableStreamBody;
        if (blobName.endsWith('.gz')) sourceStream = sourceStream.pipe(zlib.createGunzip());

        const parser = sourceStream.pipe(parse({ columns: true, skip_empty_lines: true }));

        for await (const record of parser) {
            const dateStr = String(record.ChargePeriodStart || '').slice(0, 10);
            if (!dateStr) continue;
            if (!dateBuckets.has(dateStr)) dateBuckets.set(dateStr, []);
            dateBuckets.get(dateStr).push(record);
            totalRows += 1;
        }
    }

    logger.info(`  Parsed ${totalRows} row(s) across ${dateBuckets.size} day(s)`, { period, runId });
    return dateBuckets;
}

// ---------- Main ----------
async function main() {
    const runStartedAt = Date.now();
    const today = new Date(`${fmt(new Date())}T00:00:00.000Z`);
    const cutoffDate = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const cutoffDateStr = fmt(cutoffDate);

    logger.info('Run started', { exportPrefix, monthsBack, cutoffDateStr });

    const periodRuns = await discoverLatestRunsPerPeriod();
    logger.info(`Found ${periodRuns.length} period(s)`, { periods: periodRuns.map((p) => p.period) });

    let periodsProcessed = 0;
    let periodsSkipped = 0;

    for (const { period, runId, blobs } of periodRuns) {
        const stateKey = `${R2_STATE_PREFIX}${period}.json`;
        const state = await getJsonFromR2(stateKey);

        if (state && state.runId === runId) {
            logger.info(`Skipping period ${period} — already ingested run ${runId}`, { period, runId });
            periodsSkipped += 1;
            continue;
        }

        logger.info(`Processing period ${period}, run ${runId}`, { period, runId, previousRunId: state?.runId || null });

        try {
            const dateBuckets = await processRun(period, runId, blobs);

            for (const [date, rows] of dateBuckets.entries()) {
                await uploadJsonToR2(`${R2_DATA_PREFIX}${date}/usage-details.json`, rows);
                logger.info(`  [${date}] Uploaded ${rows.length} row(s) to R2`);
            }

            await uploadJsonToR2(stateKey, { runId, ingestedAt: new Date().toISOString(), daysWritten: dateBuckets.size });
            periodsProcessed += 1;
        } catch (err) {
            logger.error('Failed to process period', { period, runId, message: err.message, stack: err.stack });
        }
    }

    await cleanupOldR2Data(cutoffDateStr);

    logger.info('Run complete', { periodsProcessed, periodsSkipped, durationMs: Date.now() - runStartedAt });
}

main().catch((err) => {
    logger.error('Fatal error', { message: err.message, stack: err.stack });
    process.exit(1);
});
