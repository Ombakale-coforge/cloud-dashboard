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

import {
    validateEnvironment,
    ALERT_CONFIG,
    EMAIL_MODE,
    logger,
} from './config';
import { getPrismaClient, disconnectDb } from './db';
import { loadActiveUsageRecords, getDateDaysBefore, todayUTC } from './data-loader';
import { generateAlerts } from './alert-service';
import { sendAlertEmail } from './email-service';

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

export async function runAlertPipeline(options?: {
    mode?: 'preview' | 'send';
    endDate?: string;
    lookbackDays?: number;
    records?: import('./types').UsageRecord[];
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
        // Step 1: Load usage records
        let records = options?.records;
        if (!records) {
            validateEnvironment(true);
            const startDate = getDateDaysBefore(endDate, lookbackDays);
            records = await loadActiveUsageRecords(startDate, endDate, getPrismaClient());
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

        // Step 3: Email / preview
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
