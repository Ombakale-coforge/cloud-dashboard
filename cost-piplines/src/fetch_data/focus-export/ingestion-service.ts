import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from '@prisma/client';
import {
    DATABASE_URL,
    REQUEST_TIMEOUT_MS,
    CONNECTION_TIMEOUT_MS,
    SQLSERVER_MAX_PARAMS,
    SQLSERVER_MAX_ROWS_PER_INSERT,
    PARAM_SAFETY_MARGIN,
    INSERT_CONCURRENCY,
    parseSqlServerUrl,
    logger,
} from './config';
import { dateOnly } from './transform';
import { IngestionCounters, NormalizedUsageRecord } from './types';

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
    if (!prismaInstance) {
        const adapter = new PrismaMssql({
            ...parseSqlServerUrl(DATABASE_URL),
            requestTimeout: REQUEST_TIMEOUT_MS,
            connectionTimeout: CONNECTION_TIMEOUT_MS,
        });
        prismaInstance = new PrismaClient({ adapter });
    }
    return prismaInstance;
}

export function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export function computeInsertChunkSize(columnsPerRow: number): number {
    const byParamLimit = Math.floor((SQLSERVER_MAX_PARAMS - PARAM_SAFETY_MARGIN) / columnsPerRow);
    return Math.max(1, Math.min(byParamLimit, SQLSERVER_MAX_ROWS_PER_INSERT));
}

// Concurrent worker executing tasks with concurrency limit
async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    const executing: Promise<void>[] = [];

    for (const item of items) {
        const p = fn(item).then((res) => {
            results.push(res);
        });
        executing.push(p);

        if (executing.length >= limit) {
            await Promise.race(executing);
            // Remove completed promises
            for (let i = executing.length - 1; i >= 0; i--) {
                // @ts-ignore
                if (executing[i].status === 'fulfilled' || (await Promise.allSettled([executing[i]])) [0].status === 'fulfilled') {
                    executing.splice(i, 1);
                }
            }
        }
    }
    await Promise.all(executing);
    return results;
}

export async function getLatestSuccessfulExportRunId(
    exportPeriod: string,
    prisma = getPrismaClient()
): Promise<string | null> {
    const run = await prisma.azureIngestionRun.findFirst({
        where: { exportPeriod, status: 'success' },
        orderBy: { id: 'desc' },
        select: { exportRunId: true },
    });
    return run?.exportRunId || null;
}

export async function upsertIngestionRun(
    exportPeriod: string,
    exportRunId: string,
    prisma = getPrismaClient()
): Promise<bigint> {
    const run = await prisma.azureIngestionRun.upsert({
        where: { exportPeriod_exportRunId: { exportPeriod, exportRunId } },
        create: { exportPeriod, exportRunId },
        update: {
            status: 'started',
            errorMessage: null,
            rowsParsed: 0,
            rowsWritten: 0,
            duplicatesFlagged: 0,
            supersedesFlagged: 0,
        },
    });
    // Purge any existing records for this run before writing to guarantee clean idempotency on re-ingest
    while (true) {
        const deleted = await prisma.$executeRawUnsafe(
            `DELETE TOP (5000) FROM azure_usage_records WHERE ingestion_run_id = ${run.id}`
        );
        if (deleted === 0) break;
    }

    return run.id;
}

export async function insertRecordBatches(
    records: NormalizedUsageRecord[],
    ingestionRunId: bigint,
    prisma = getPrismaClient()
): Promise<number> {
    if (records.length === 0) return 0;

    const columnsPerRow = Object.keys(records[0]).length + 1; // +1 for ingestionRunId
    const chunkSize = computeInsertChunkSize(columnsPerRow);
    const batches = chunk(records, chunkSize);

    const rowsWithRunId = batches.map((batch) =>
        batch.map((row) => ({
            ...row,
            ingestionRunId,
        }))
    );

    let writtenTotal = 0;

    // Execute batches with controlled concurrency
    const queue = [...rowsWithRunId];
    const workers = Array.from({ length: Math.min(INSERT_CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
            const batch = queue.shift();
            if (!batch) break;
            const res = await prisma.azureUsageRecord.createMany({
                data: batch as any,
            });
            writtenTotal += res.count;
        }
    });

    await Promise.all(workers);
    return writtenTotal;
}

export async function retireOldRunsForPeriod(
    exportPeriod: string,
    currentRunId: bigint,
    prisma = getPrismaClient()
): Promise<number> {
    const oldRuns = await prisma.azureIngestionRun.findMany({
        where: {
            exportPeriod,
            id: { not: currentRunId },
        },
        select: { id: true },
    });

    if (oldRuns.length === 0) return 0;

    const oldRunIds = oldRuns.map((r) => r.id);
    const idListStr = oldRunIds.map((id) => id.toString()).join(',');

    // Delete usage records in safe 5,000-row chunks to prevent transaction log bloat, table locks, and timeouts
    let totalDeleted = 0;
    while (true) {
        const deleted = await prisma.$executeRawUnsafe(
            `DELETE TOP (5000) FROM azure_usage_records WHERE ingestion_run_id IN (${idListStr})`
        );
        totalDeleted += deleted;
        if (deleted === 0) break;
    }

    logger.info(`Retired old runs for period ${exportPeriod}`, {
        deletedRecords: totalDeleted,
        retiredRunCount: oldRunIds.length,
    });

    return totalDeleted;
}

export async function completeIngestionRun(
    ingestionRunId: bigint,
    counters: IngestionCounters,
    prisma = getPrismaClient()
): Promise<void> {
    await prisma.azureIngestionRun.update({
        where: { id: ingestionRunId },
        data: {
            rowsParsed: counters.rowsParsed,
            rowsWritten: counters.rowsWritten,
            duplicatesFlagged: counters.duplicatesDropped,
            supersedesFlagged: 0,
            status: 'success',
        },
    });
}

export async function failIngestionRun(
    ingestionRunId: bigint,
    errorMessage: string,
    prisma = getPrismaClient()
): Promise<void> {
    await prisma.azureIngestionRun.update({
        where: { id: ingestionRunId },
        data: {
            status: 'failed',
            errorMessage: errorMessage.slice(0, 1024),
        },
    });
}

export async function cleanupRetention(
    cutoffDateStr: string,
    prisma = getPrismaClient()
): Promise<number> {
    let totalDeleted = 0;
    while (true) {
        const deleted = await prisma.$executeRawUnsafe(
            `DELETE TOP (5000) FROM azure_usage_records WHERE usage_date < '${cutoffDateStr}'`
        );
        totalDeleted += deleted;
        if (deleted === 0) break;
    }
    return totalDeleted;
}

export async function disconnectDb(): Promise<void> {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}
