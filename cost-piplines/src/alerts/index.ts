/**
 * Azure Cost Alert Pipeline — CLI Orchestrator
 *
 * Usage:
 *   tsx src/alerts/index.ts                       # default: preview mode, today - lag
 *   tsx src/alerts/index.ts --preview             # write HTML preview to logs/
 *   tsx src/alerts/index.ts --send                # send via SMTP
 *   tsx src/alerts/index.ts --date 2026-09-28     # override evaluation date
 *   tsx src/alerts/index.ts --days 45             # lookback window (default 38)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    validateEnvironment,
    ALERT_CONFIG,
    EMAIL_MODE,
    LOG_DIR_PATH,
    logger,
} from './config';
import { getPrismaClient, disconnectDb } from './db';
import { loadActiveUsageRecords, getDateDaysBefore, todayUTC } from './data-loader';
import { generateAlerts, evaluateMeterBudgets } from './alert-service';
import { sendAlertEmail, sendBudgetAlertEmail } from './email-service';
import { ensureAlertTablesExist } from '../server/db-alert-tables';
import type { AlertReport, UsageRecord, MeterBudget } from './types';

function parseArgs(): { mode: 'preview' | 'send'; endDate: string; lookbackDays: number } {
    const args = process.argv.slice(2);
    let mode: 'preview' | 'send' = EMAIL_MODE;
    let endDate = '';
    let lookbackDays = ALERT_CONFIG.baselineDays + ALERT_CONFIG.dataLagDays + 30; // 38

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--preview') mode = 'preview';
        else if (args[i] === '--send') mode = 'send';
        else if (args[i] === '--date' && args[i + 1]) { endDate = args[++i]; }
        else if (args[i] === '--days' && args[i + 1]) { lookbackDays = Number(args[++i]); }
    }

    if (!endDate) endDate = todayUTC();
    return { mode, endDate, lookbackDays };
}

async function persistAlertsToDb(prisma: any, alertReport: AlertReport): Promise<void> {
    if (!prisma) return;
    try {
        await ensureAlertTablesExist(prisma);

        // Remove existing alerts for this evaluationDate to keep it clean and idempotent
        await prisma.azureCostAlert.deleteMany({
            where: { evaluationDate: alertReport.evaluationDate },
        });

        const data = alertReport.alerts.map((a) => ({
            evaluationDate: alertReport.evaluationDate,
            alertType: a.alertType,
            severity: a.severity,
            billingCurrency: a.billingCurrency || 'INR',
            currentCost: Number(a.currentCost || 0).toFixed(2),
            baselineCost: a.baselineCost !== undefined ? Number(a.baselineCost).toFixed(2) : null,
            absoluteIncrease: Number(a.absoluteIncrease || 0).toFixed(2),
            percentIncrease: a.percentIncrease !== null && a.percentIncrease !== undefined ? Number(a.percentIncrease).toFixed(2) : null,
            nonZeroBaselineDays: a.nonZeroBaselineDays || null,
            subscriptionId: a.subscriptionId || 'unknown',
            subscriptionName: a.subscriptionName || null,
            resourceId: a.resourceId || null,
            resourceName: a.resourceName || null,
            resourceGroup: a.resourceGroup || null,
            service: a.service || null,
            firstSeenDate: a.firstSeenDate || null,
            currentQuantity: a.currentQuantity !== undefined ? Number(a.currentQuantity).toFixed(6) : null,
            baselineQuantity: a.baselineQuantity !== undefined ? Number(a.baselineQuantity).toFixed(6) : null,
            meterId: a.meterId || null,
            meterName: a.meterName || null,
            meterCategory: a.meterCategory || null,
            meterSubCategory: a.meterSubCategory || null,
            unitOfMeasure: a.unitOfMeasure || null,
            driverAnnotationJson: a.likelyDrivenBy ? JSON.stringify(a.likelyDrivenBy) : null,
        }));

        const chunkSize = 100;
        for (let i = 0; i < data.length; i += chunkSize) {
            await prisma.azureCostAlert.createMany({
                data: data.slice(i, i + chunkSize),
            });
        }
        logger.info(`Persisted ${data.length} alerts to azure_cost_alerts database table.`);
    } catch (dbErr: any) {
        logger.error('Failed to persist alerts to database:', { error: dbErr.message });
    }
}

async function processMeterBudgets(prisma: any, records: UsageRecord[], evaluationDate: string, mode: 'preview' | 'send'): Promise<void> {
    if (!prisma) return;
    try {
        await ensureAlertTablesExist(prisma);
        const rawBudgets = await prisma.azureMeterBudget.findMany({
            where: { isActive: true },
        });

        if (!rawBudgets || rawBudgets.length === 0) {
            logger.info('No active meter budgets found.');
            return;
        }

        const budgets: MeterBudget[] = rawBudgets.map((b: any) => ({
            id: b.id,
            meterName: b.meterName,
            meterCategory: b.meterCategory,
            service: b.service,
            monthlyBudget: Number(b.monthlyBudget),
            billingCurrency: b.billingCurrency || 'INR',
            alertEmail: b.alertEmail,
            isActive: Boolean(b.isActive),
            lastNotifiedThreshold: b.lastNotifiedThreshold,
            lastNotifiedDate: b.lastNotifiedDate,
        }));

        const { statuses, alertsToNotify } = evaluateMeterBudgets(records, budgets, evaluationDate);
        logger.info(`Evaluated ${statuses.length} meter budgets. Triggered alerts: ${alertsToNotify.length}`);

        if (alertsToNotify.length > 0) {
            const emailResult = await sendBudgetAlertEmail(alertsToNotify, { mode });
            if (emailResult.sent || emailResult.previewed) {
                for (const item of alertsToNotify) {
                    await prisma.azureMeterBudget.update({
                        where: { id: item.budget.id },
                        data: {
                            lastNotifiedThreshold: item.thresholdCrossed,
                            lastNotifiedDate: evaluationDate,
                            updatedAt: new Date(),
                        },
                    });
                }
                logger.info(`Updated notification tracking for ${alertsToNotify.length} meter budget(s).`);
            }
        }
    } catch (err: any) {
        logger.error('Error evaluating meter budgets in pipeline:', { error: err.message });
    }
}

export async function runAlertPipeline(options?: {
    mode?: 'preview' | 'send';
    endDate?: string;
    lookbackDays?: number;
    records?: UsageRecord[];
}) {
    const startedAt = Date.now();
    const cliArgs = parseArgs();
    const mode = options?.mode || cliArgs.mode;
    const endDate = options?.endDate || cliArgs.endDate;
    const lookbackDays = options?.lookbackDays || cliArgs.lookbackDays;

    logger.info('========================================================');
    logger.info('Starting Azure Cost Alert Pipeline');
    logger.info('========================================================');

    try {
        const prisma = getPrismaClient();

        // Step 1: Load usage records
        let records = options?.records;
        if (!records) {
            validateEnvironment(true);
            const startDate = getDateDaysBefore(endDate, lookbackDays);
            records = await loadActiveUsageRecords(startDate, endDate, prisma);
        }

        if (!records.length) {
            logger.warn('No usage records found. Pipeline completed with no alerts.');
            return;
        }

        // Step 2: Generate alerts
        logger.info('Generating alerts...');
        const alertReport = generateAlerts(records);

        logger.info('Alert generation completed.', {
            evaluationDate: alertReport.evaluationDate,
            totalAlerts: alertReport.summary.total,
            summary: alertReport.summary,
        });

        // Step 3: Persist alerts to DB and JSON log
        await persistAlertsToDb(prisma, alertReport);
        try {
            const reportPath = path.join(LOG_DIR_PATH, `alert-report-${alertReport.evaluationDate}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(alertReport, null, 2), 'utf8');
        } catch (jsonErr: any) {
            logger.warn('Failed to write backup alert report JSON:', { error: jsonErr.message });
        }

        // Step 4: Evaluate manual meter budgets and trigger daily pings
        await processMeterBudgets(prisma, records, alertReport.evaluationDate, mode);

        // Step 5: Email / preview spike & anomaly report
        logger.info(`Processing alert notification (mode: ${mode})...`);
        const emailResult = await sendAlertEmail(alertReport, { mode });

        if (emailResult.previewed) {
            logger.info(`Email preview generated: ${emailResult.previewPath}`);
        } else if (emailResult.sent) {
            logger.info(`Alert email sent. Message ID: ${emailResult.messageId}`);
        } else if (emailResult.reason === 'NO_ALERTS') {
            logger.info('No alerts generated, no email sent.');
        }

        const durationMs = Date.now() - startedAt;
        logger.info('========================================================');
        logger.info(`Azure Cost Alert Pipeline completed in ${durationMs}ms`);
        logger.info('========================================================');
    } catch (error) {
        const durationMs = Date.now() - startedAt;
        logger.error(`Pipeline failed after ${durationMs}ms`, {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
    } finally {
        await disconnectDb();
    }
}

// Auto-run if executed as a script
if (process.argv[1] && process.argv[1].includes('alerts/index')) {
    runAlertPipeline().catch((err) => {
        console.error('Fatal error in Azure Cost Alert Pipeline:', err);
        process.exit(1);
    });
}
