/**
 * Azure Cost Reporting Pipeline — Modular Orchestrator
 *
 * Reads active usage data directly from SQL Server (`azure_usage_records`),
 * computes 17 FinOps analytical reports, and writes all reports and run
 * tracking metadata directly into SQL Server via Prisma.
 */

import {
    validateEnvironment,
    ANOMALY_THRESHOLD_PERCENT,
    ANOMALY_ROLLING_MONTHS,
    logger,
} from './config';
import { getPrismaClient, disconnectDb } from './db';
import { loadActiveUsageRecords } from './data-loader';
import { calculateReports } from './analytics';
import {
    createReportRun,
    saveReportData,
    completeReportRun,
    failReportRun,
} from './report-service';
import { ReportRunSummary } from './types';

export async function runAzureCostReportPipeline(): Promise<ReportRunSummary> {
    const startedAt = Date.now();
    const runStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    logger.info('========================================================');
    logger.info(`Starting Azure Cost Report Pipeline [${runStamp}]`);
    logger.info('========================================================');

    validateEnvironment();

    const prisma = getPrismaClient();
    let reportRunId: number | null = null;

    try {
        // Step 1: Create tracking entry in azure_report_runs
        reportRunId = await createReportRun(runStamp, prisma);
        logger.info(`Created report run #${reportRunId} with runStamp ${runStamp}`);

        // Step 2: Load deduplicated active usage records from SQL Server
        const transactions = await loadActiveUsageRecords(prisma);

        if (!transactions.length) {
            logger.warn('No active usage records found to generate reports from.');
            const durationMs = Date.now() - startedAt;
            await completeReportRun(
                reportRunId,
                { durationMs, rowCount: 0, months: [] },
                prisma
            );
            return {
                runId: reportRunId,
                runStamp,
                transactionCount: 0,
                months: [],
                durationMs,
                reportsSummary: {},
            };
        }

        const months = [...new Set(transactions.map((t) => t.month))].sort();

        // Step 3: Compute all 17 reports
        logger.info('Calculating 17 FinOps reports in memory...');
        const reports = calculateReports(transactions, {
            anomalyThresholdPercent: ANOMALY_THRESHOLD_PERCENT,
            anomalyRollingMonths: ANOMALY_ROLLING_MONTHS,
        });

        // Step 4: Batch-insert reports into SQL Server tables
        logger.info('Persisting reports to SQL Server (azure_report_* tables)...');
        const reportsSummary = await saveReportData(reportRunId, reports, prisma);

        // Step 5: Mark run as complete
        const durationMs = Date.now() - startedAt;
        await completeReportRun(
            reportRunId,
            {
                durationMs,
                rowCount: transactions.length,
                months,
            },
            prisma
        );

        logger.info('========================================================');
        logger.info(`Azure Cost Report Pipeline completed in ${durationMs}ms`, {
            reportRunId,
            runStamp,
            transactionCount: transactions.length,
            monthsCovered: months,
            reportsSummary,
        });
        logger.info('========================================================');

        return {
            runId: reportRunId,
            runStamp,
            transactionCount: transactions.length,
            months,
            durationMs,
            reportsSummary,
        };
    } catch (error) {
        logger.error('Report pipeline execution failed', {
            reportRunId,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });

        if (reportRunId !== null) {
            try {
                await failReportRun(reportRunId, error, prisma);
            } catch (failErr) {
                logger.error('Failed to record run failure in DB', {
                    reportRunId,
                    message: failErr instanceof Error ? failErr.message : String(failErr),
                });
            }
        }
        throw error;
    } finally {
        await disconnectDb();
    }
}

// Auto-run if executed as a script
if (process.argv[1] && process.argv[1].endsWith('azure_cost_report/index.ts')) {
    runAzureCostReportPipeline().catch((err) => {
        console.error('Fatal error in Azure Cost Report Pipeline:', err);
        process.exit(1);
    });
}
