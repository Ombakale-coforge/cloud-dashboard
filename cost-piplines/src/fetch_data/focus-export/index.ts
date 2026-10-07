import fs from 'node:fs';
import zlib from 'node:zlib';
import { parse } from 'csv-parse';
import {
    exportPrefix,
    monthsBack,
    DAY_FLUSH_THRESHOLD,
    logger,
    validateEnvironment,
} from './config';
import {
    discoverLatestRunsPerPeriod,
    downloadBlobToTempFile,
    getManifestCsvBlobNames,
    getContainerClient,
} from './azure-storage';
import {
    fmtDate,
    getStableKeys,
    normalizeRecord,
} from './transform';
import {
    getLatestSuccessfulExportRunId,
    upsertIngestionRun,
    insertRecordBatches,
    retireOldRunsForPeriod,
    completeIngestionRun,
    failIngestionRun,
    cleanupRetention,
    disconnectDb,
} from './ingestion-service';
import { IngestionCounters, NormalizedUsageRecord } from './types';

async function processPeriodRun(
    exportPeriod: string,
    exportRunId: string,
    blobs: Array<{ name: string; lastModified: Date }>,
    ingestionRunId: bigint
): Promise<IngestionCounters> {
    const containerClient = getContainerClient();

    // Check for manifest.json
    const manifestBlob = blobs.find((b) => b.name.endsWith('manifest.json'));
    let csvBlobNames = blobs
        .filter((b) => b.name.endsWith('.csv.gz') || b.name.endsWith('.csv'))
        .map((b) => b.name);

    if (manifestBlob) {
        const manifestCsvList = await getManifestCsvBlobNames(manifestBlob.name, containerClient);
        if (manifestCsvList && manifestCsvList.length > 0) {
            csvBlobNames = manifestCsvList;
        }
    }

    const counters: IngestionCounters = {
        rowsParsed: 0,
        rowsWritten: 0,
        duplicatesDropped: 0,
        invalidRows: 0,
    };

    // Tracks seen hashes across part files to drop duplicates differing only in volatile metadata
    const seenRowHashes = new Set<string>();
    const dateBuffers = new Map<string, NormalizedUsageRecord[]>();
    const datesSeen = new Set<string>();

    async function flushDateBuffer(dateStr: string) {
        const buffer = dateBuffers.get(dateStr);
        if (!buffer || buffer.length === 0) return;

        const count = await insertRecordBatches(buffer, ingestionRunId);
        counters.rowsWritten += count;
        dateBuffers.set(dateStr, []);

        logger.info(`  [${dateStr}] Wrote ${count} row(s) to DB`, {
            exportPeriod,
            exportRunId,
            duplicatesDropped: counters.duplicatesDropped,
        });
    }

    let stableKeys: string[] | null = null;

    for (const blobName of csvBlobNames) {
        logger.info(`  Downloading ${blobName}...`, { exportPeriod, exportRunId });
        const { filePath: tempPath, cleanup } = await downloadBlobToTempFile(blobName, containerClient);

        try {
            logger.info(`  Parsing ${blobName}...`, { exportPeriod, exportRunId });
            let stream: NodeJS.ReadableStream = fs.createReadStream(tempPath);
            if (blobName.endsWith('.gz')) {
                stream = stream.pipe(zlib.createGunzip());
            }

            const parser = stream.pipe(parse({ columns: true, skip_empty_lines: true, bom: true }));

            for await (const record of parser) {
                counters.rowsParsed++;

                // Cache sorted keys from the first valid record
                if (!stableKeys) {
                    stableKeys = getStableKeys(record);
                }

                const { row, reason } = normalizeRecord(record, stableKeys);
                if (!row) {
                    counters.invalidRows++;
                    if (counters.invalidRows <= 3) {
                        logger.warn('Skipping invalid row', {
                            reason,
                            ChargePeriodStart: record.ChargePeriodStart,
                            BilledCost: record.BilledCost,
                        });
                    }
                    continue;
                }

                // Ingest all valid rows from official export; retireOldRunsForPeriod handles run-level deduplication
                seenRowHashes.add(row.stableRowHash);

                const dateStr = fmtDate(row.usageDate);
                datesSeen.add(dateStr);

                if (!dateBuffers.has(dateStr)) dateBuffers.set(dateStr, []);
                const buffer = dateBuffers.get(dateStr)!;
                buffer.push(row);

                if (buffer.length >= DAY_FLUSH_THRESHOLD) {
                    await flushDateBuffer(dateStr);
                }
            }
        } finally {
            cleanup();
        }
    }

    // Flush remaining buffered records
    for (const dateStr of dateBuffers.keys()) {
        await flushDateBuffer(dateStr);
    }

    logger.info(`  Processed ${counters.rowsParsed} row(s) across ${datesSeen.size} day(s)`, {
        exportPeriod,
        exportRunId,
        written: counters.rowsWritten,
        duplicatesDropped: counters.duplicatesDropped,
        invalid: counters.invalidRows,
    });

    return counters;
}

export async function runIngestionPipeline(): Promise<void> {
    const runStartedAt = Date.now();
    validateEnvironment();

    const today = new Date();
    const cutoffDate = new Date(today.getFullYear(), today.getMonth() - monthsBack, 1);
    const cutoffDateStr = fmtDate(cutoffDate);

    logger.info('Starting Azure FOCUS cost export ingestion', {
        exportPrefix,
        monthsBack,
        cutoffDateStr,
    });

    const periodRuns = await discoverLatestRunsPerPeriod();
    logger.info(`Found ${periodRuns.length} period(s)`, {
        periods: periodRuns.map((p) => p.exportPeriod),
    });

    let periodsProcessed = 0;
    let periodsSkipped = 0;

    for (const { exportPeriod, exportRunId, blobs } of periodRuns) {
        const latestSuccessfulExportRunId = await getLatestSuccessfulExportRunId(exportPeriod);

        const isForce = process.argv.includes('--force');
        const targetPeriod = process.argv.find(a => a.startsWith('--period='))?.split('=')[1];
        if (targetPeriod && exportPeriod !== targetPeriod) {
            continue;
        }
        if (latestSuccessfulExportRunId === exportRunId && !isForce) {
            logger.info(`Skipping period ${exportPeriod} — run ${exportRunId} already ingested`, {
                exportPeriod,
                exportRunId,
            });
            periodsSkipped += 1;
            continue;
        }

        logger.info(`Processing period ${exportPeriod}, run ${exportRunId}`, {
            exportPeriod,
            exportRunId,
            previousSuccessfulExportRunId: latestSuccessfulExportRunId,
        });

        let ingestionRunId: bigint | null = null;

        try {
            ingestionRunId = await upsertIngestionRun(exportPeriod, exportRunId);

            const counters = await processPeriodRun(exportPeriod, exportRunId, blobs, ingestionRunId);

            await completeIngestionRun(ingestionRunId, counters);

            try {
                await retireOldRunsForPeriod(exportPeriod, ingestionRunId);
            } catch (retireErr: any) {
                logger.warn('Non-fatal warning while retiring older runs for period', {
                    exportPeriod,
                    message: retireErr.message,
                });
            }

            periodsProcessed += 1;
        } catch (err: any) {
            logger.error('Failed to process period run', {
                exportPeriod,
                exportRunId,
                message: err.message,
                stack: err.stack,
            });

            if (ingestionRunId) {
                try {
                    await failIngestionRun(ingestionRunId, err.message || String(err));
                } catch (updateErr: any) {
                    logger.error('Failed to mark ingestion run as failed', {
                        exportPeriod,
                        exportRunId,
                        message: updateErr.message,
                    });
                }
            }
        }
    }

    try {
        const deletedCount = await cleanupRetention(cutoffDateStr);
        logger.info('Retention cleanup completed', { cutoffDateStr, deletedRecords: deletedCount });
    } catch (retentionErr: any) {
        logger.error('Retention cleanup failed', { message: retentionErr.message });
    }

    logger.info('Ingestion pipeline completed', {
        periodsProcessed,
        periodsSkipped,
        durationMs: Date.now() - runStartedAt,
    });

    await disconnectDb();
}

// Direct execution entrypoint
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('focus-export/index.ts')) {
    runIngestionPipeline().catch(async (err) => {
        logger.error('Fatal error in pipeline runner', { message: err.message, stack: err.stack });
        try {
            await disconnectDb();
        } catch {
            // ignore
        }
        process.exit(1);
    });
}
