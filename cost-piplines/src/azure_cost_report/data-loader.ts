import { getPrismaClient } from './db';
import { logger } from './config';
import { UsageTransaction } from './types';

export function normalizeTransaction(record: {
    usageMonth: string;
    effectiveCost: any;
    billedCost: any;
    subscriptionName: string | null;
    subscriptionId: string;
    resourceGroup: string | null;
    service: string;
    chargeType: string | null;
    meterName: string | null;
    meterId: string | null;
    meterCategory: string | null;
    region: string | null;
    pricingModel: string | null;
    resourceName: string | null;
    isCreditEligible: boolean | null;
}): UsageTransaction {
    const rawCost = record.effectiveCost !== null && record.effectiveCost !== undefined
        ? Number(record.effectiveCost)
        : Number(record.billedCost ?? 0);

    const cost = Number.isFinite(rawCost) ? rawCost : 0;
    const creditEligible = record.isCreditEligible === true
        ? 'Yes'
        : record.isCreditEligible === false
            ? 'No'
            : 'Unknown';

    return {
        month: record.usageMonth.trim(),
        cost,
        subscription: (record.subscriptionName || record.subscriptionId || 'Unknown Subscription').trim().slice(0, 255),
        resourceGroup: (record.resourceGroup || 'Unassigned').trim().slice(0, 255),
        consumedService: (record.service || 'Unknown Service').trim().slice(0, 255),
        chargeType: (record.chargeType || 'Unknown').trim().slice(0, 64),
        meter: (record.meterName || record.meterId || 'Unknown Meter').trim().slice(0, 255),
        meterCategory: (record.meterCategory || 'Uncategorized').trim().slice(0, 255),
        location: (record.region || 'Unknown').trim().slice(0, 128),
        pricingModel: (record.pricingModel || 'Unknown').trim().slice(0, 64),
        resourceName: (record.resourceName || 'Unassigned').trim().slice(0, 255),
        creditEligible,
    };
}

export async function loadActiveUsageRecords(prisma = getPrismaClient()): Promise<UsageTransaction[]> {
    logger.info('Querying active usage records from database (azure_usage_records)...');

    const records = await prisma.azureUsageRecord.findMany({
        where: {
            isDuplicateOfEarlierRow: false,
            isSupersededByLaterRow: false,
        },
        select: {
            usageMonth: true,
            effectiveCost: true,
            billedCost: true,
            subscriptionName: true,
            subscriptionId: true,
            resourceGroup: true,
            service: true,
            chargeType: true,
            meterName: true,
            meterId: true,
            meterCategory: true,
            region: true,
            pricingModel: true,
            resourceName: true,
            isCreditEligible: true,
        },
        orderBy: {
            usageMonth: 'asc',
        },
    });

    if (!records.length) {
        logger.warn('No active usage records found in azure_usage_records.');
        return [];
    }

    const transactions: UsageTransaction[] = new Array(records.length);
    for (let i = 0; i < records.length; i++) {
        transactions[i] = normalizeTransaction(records[i]);
    }

    const months = [...new Set(transactions.map((t) => t.month))].sort();
    logger.info(`Loaded ${transactions.length} active usage record(s) spanning ${months.length} month(s)`, {
        months,
        count: transactions.length,
    });

    return transactions;
}
