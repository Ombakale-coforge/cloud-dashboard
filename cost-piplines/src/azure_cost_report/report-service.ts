import { getPrismaClient } from './db';
import {
    SQLSERVER_MAX_PARAMS,
    SQLSERVER_MAX_ROWS_PER_INSERT,
    PARAM_SAFETY_MARGIN,
    ANOMALY_THRESHOLD_PERCENT,
    ANOMALY_ROLLING_MONTHS,
    logger,
} from './config';
import { CalculatedReports } from './types';

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

async function insertChunked<T extends Record<string, any>>(
    items: T[],
    columnsCount: number,
    insertFn: (batch: T[]) => Promise<{ count: number }>
): Promise<number> {
    if (!items.length) return 0;
    const chunkSize = computeInsertChunkSize(columnsCount);
    const chunks = chunk(items, chunkSize);
    let total = 0;
    for (const batch of chunks) {
        const res = await insertFn(batch);
        total += res.count;
    }
    return total;
}

export async function createReportRun(
    runStamp: string,
    prisma = getPrismaClient()
): Promise<number> {
    const run = await prisma.azureReportRun.create({
        data: {
            runStamp,
            status: 'started',
            anomalyThresholdPercent: ANOMALY_THRESHOLD_PERCENT.toFixed(2),
            anomalyRollingMonths: ANOMALY_ROLLING_MONTHS,
        },
    });
    return run.id;
}

export async function saveReportData(
    reportRunId: number,
    reports: CalculatedReports,
    prisma = getPrismaClient()
): Promise<Record<string, number>> {
    const summary: Record<string, number> = {};

    // 1. Monthly totals (3 cols)
    summary.monthlyTotals = await insertChunked(
        reports.monthlyTotals.map((r) => ({
            reportRunId,
            month: r.month,
            totalCost: r.totalCost.toFixed(2),
        })),
        3,
        (batch) => prisma.azureReportMonthlyTotals.createMany({ data: batch })
    );

    // 2. KPIs by month (9 cols)
    summary.kpisByMonth = await insertChunked(
        reports.kpisByMonth.map((r) => ({
            reportRunId,
            month: r.month,
            totalCost: r.totalCost.toFixed(2),
            topSubscription: r.topSubscription,
            topSubscriptionCost: r.topSubscriptionCost !== null ? r.topSubscriptionCost.toFixed(2) : null,
            topService: r.topService,
            topServiceCost: r.topServiceCost !== null ? r.topServiceCost.toFixed(2) : null,
            subscriptions: r.subscriptions,
            resourceGroups: r.resourceGroups,
        })),
        9,
        (batch) => prisma.azureReportKpisByMonth.createMany({ data: batch })
    );

    // 3. By subscription (4 cols)
    summary.bySubscription = await insertChunked(
        reports.bySubscription.map((r) => ({
            reportRunId,
            month: r.month,
            subscription: r.subscription,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportBySubscription.createMany({ data: batch })
    );

    // 4. By resource group (5 cols)
    summary.byResourceGroup = await insertChunked(
        reports.byResourceGroup.map((r) => ({
            reportRunId,
            month: r.month,
            resourceGroup: r.resourceGroup,
            subscription: r.subscription,
            cost: r.cost.toFixed(2),
        })),
        5,
        (batch) => prisma.azureReportByResourceGroup.createMany({ data: batch })
    );

    // 5. By service (4 cols)
    summary.byService = await insertChunked(
        reports.byService.map((r) => ({
            reportRunId,
            month: r.month,
            consumedService: r.consumedService,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportByService.createMany({ data: batch })
    );

    // 6. By charge type (4 cols)
    summary.byChargeType = await insertChunked(
        reports.byChargeType.map((r) => ({
            reportRunId,
            month: r.month,
            chargeType: r.chargeType,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportByChargeType.createMany({ data: batch })
    );

    // 7. By region (4 cols)
    summary.byRegion = await insertChunked(
        reports.byRegion.map((r) => ({
            reportRunId,
            month: r.month,
            region: r.region,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportByRegion.createMany({ data: batch })
    );

    // 8. By pricing model (4 cols)
    summary.byPricingModel = await insertChunked(
        reports.byPricingModel.map((r) => ({
            reportRunId,
            month: r.month,
            pricingModel: r.pricingModel,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportByPricingModel.createMany({ data: batch })
    );

    // 9. Credit eligibility (4 cols)
    summary.creditEligibility = await insertChunked(
        reports.creditEligibility.map((r) => ({
            reportRunId,
            month: r.month,
            creditEligible: r.creditEligible,
            cost: r.cost.toFixed(2),
        })),
        4,
        (batch) => prisma.azureReportCreditEligibility.createMany({ data: batch })
    );

    // 10. Top meters (7 cols)
    summary.topMeters = await insertChunked(
        reports.topMeters.map((r) => ({
            reportRunId,
            month: r.month,
            meter: r.meter,
            category: r.category,
            service: r.service,
            resourceGroup: r.resourceGroup,
            cost: r.cost.toFixed(2),
        })),
        7,
        (batch) => prisma.azureReportTopMeters.createMany({ data: batch })
    );

    // 11. MoM change (5 cols)
    summary.momChange = await insertChunked(
        reports.momChange.map((r) => ({
            reportRunId,
            month: r.month,
            totalCost: r.totalCost.toFixed(2),
            previousMonthCost: r.previousMonthCost !== null ? r.previousMonthCost.toFixed(2) : null,
            momPercentChange: r.momPercentChange !== null ? r.momPercentChange.toFixed(2) : null,
        })),
        5,
        (batch) => prisma.azureReportMomChange.createMany({ data: batch })
    );

    // 12. Cost concentration Pareto (6 cols)
    summary.costConcentrationPareto = await insertChunked(
        reports.costConcentrationPareto.map((r) => ({
            reportRunId,
            service: r.service,
            totalCost: r.totalCost.toFixed(2),
            percentOfTotal: r.percentOfTotal.toFixed(2),
            cumulativePercent: r.cumulativePercent.toFixed(2),
            rank: r.rank,
        })),
        6,
        (batch) => prisma.azureReportCostConcentrationPareto.createMany({ data: batch })
    );

    // 13. Anomaly flags (7 cols)
    summary.anomalyFlags = await insertChunked(
        reports.anomalyFlags.map((r) => ({
            reportRunId,
            month: r.month,
            totalCost: r.totalCost.toFixed(2),
            rollingAvg: r.rollingAvg !== null ? r.rollingAvg.toFixed(2) : null,
            differencePercent: r.differencePercent !== null ? r.differencePercent.toFixed(2) : null,
            thresholdPercent: r.thresholdPercent.toFixed(2),
            isAnomaly: r.isAnomaly,
        })),
        7,
        (batch) => prisma.azureReportAnomalyFlags.createMany({ data: batch })
    );

    // 14. New services by month (3 cols)
    summary.newServicesByMonth = await insertChunked(
        reports.newServicesByMonth.map((r) => ({
            reportRunId,
            month: r.month,
            newService: r.newService,
        })),
        3,
        (batch) => prisma.azureReportNewServicesByMonth.createMany({ data: batch })
    );

    // 15. Forecast next month (3 cols)
    summary.forecastNextMonth = await insertChunked(
        reports.forecastNextMonth.map((r) => ({
            reportRunId,
            method: r.method,
            forecastedTotalCost: r.forecastedTotalCost.toFixed(2),
        })),
        3,
        (batch) => prisma.azureReportForecastNextMonth.createMany({ data: batch })
    );

    // 16. Volatility (5 cols)
    summary.volatility = await insertChunked(
        reports.volatility.map((r) => ({
            reportRunId,
            service: r.service,
            mean: r.mean.toFixed(2),
            stdDev: r.stdDev.toFixed(2),
            coefficientOfVariationPercent: r.coefficientOfVariationPercent.toFixed(1),
        })),
        5,
        (batch) => prisma.azureReportVolatility.createMany({ data: batch })
    );

    // 17. Top resources (6 cols)
    summary.topResources = await insertChunked(
        reports.topResources.map((r) => ({
            reportRunId,
            month: r.month,
            resourceName: r.resourceName,
            resourceGroup: r.resourceGroup,
            service: r.service,
            cost: r.cost.toFixed(2),
        })),
        6,
        (batch) => prisma.azureReportTopResources.createMany({ data: batch })
    );

    return summary;
}

export async function completeReportRun(
    reportRunId: number,
    meta: {
        durationMs: number;
        rowCount: number;
        months: string[];
        logText?: string;
    },
    prisma = getPrismaClient()
): Promise<void> {
    await prisma.azureReportRun.update({
        where: { id: reportRunId },
        data: {
            status: 'success',
            completedAt: new Date(),
            durationMs: meta.durationMs,
            dedupedRowCount: BigInt(meta.rowCount),
            monthsCovered: JSON.stringify(meta.months),
            logText: meta.logText ? meta.logText.slice(0, 100000) : null,
        },
    });
}

export async function failReportRun(
    reportRunId: number,
    error: unknown,
    prisma = getPrismaClient()
): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.azureReportRun.update({
        where: { id: reportRunId },
        data: {
            status: 'failed',
            completedAt: new Date(),
            errorMessage: message.slice(0, 1024),
        },
    });
}
