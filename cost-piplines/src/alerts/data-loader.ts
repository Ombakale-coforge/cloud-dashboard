import { getPrismaClient } from './db';
import { logger } from './config';
import type { UsageRecord } from './types';

// ── Date helpers ────────────────────────────────────────────────────

export function getPreviousDates(dateString: string, numberOfDays: number): string[] {
    const d = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateString}`);
    const dates: string[] = [];
    for (let back = numberOfDays; back >= 1; back--) {
        const h = new Date(d);
        h.setUTCDate(h.getUTCDate() - back);
        dates.push(h.toISOString().slice(0, 10));
    }
    return dates;
}

export function getDateDaysBefore(dateString: string, numberOfDays: number): string {
    const d = new Date(`${dateString}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${dateString}`);
    d.setUTCDate(d.getUTCDate() - numberOfDays);
    return d.toISOString().slice(0, 10);
}

export function todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
}

// ── Normalization ───────────────────────────────────────────────────

function normalizeRecord(raw: {
    usageDate: Date;
    subscriptionId: string;
    subscriptionName: string | null;
    resourceId: string | null;
    resourceName: string | null;
    resourceGroup: string | null;
    service: string;
    meterId: string | null;
    meterName: string | null;
    meterCategory: string | null;
    meterSubCategory: string | null;
    consumedQuantity: any;
    consumedUnit: string | null;
    effectiveCost: any;
    billedCost: any;
    billingCurrency: string;
}): UsageRecord {
    const rawCost =
        raw.effectiveCost !== null && raw.effectiveCost !== undefined
            ? Number(raw.effectiveCost)
            : Number(raw.billedCost ?? 0);

    return {
        date: raw.usageDate.toISOString().slice(0, 10),
        subscriptionId: raw.subscriptionId,
        subscriptionName: (raw.subscriptionName || raw.subscriptionId || 'Unknown').trim(),
        resourceId: raw.resourceId || null,
        resourceName: (raw.resourceName || '').trim(),
        resourceGroup: (raw.resourceGroup || '').trim(),
        service: (raw.service || 'Unknown Service').trim(),
        meterId: raw.meterId || null,
        meterName: (raw.meterName || '').trim(),
        meterCategory: (raw.meterCategory || '').trim(),
        meterSubCategory: (raw.meterSubCategory || '').trim(),
        unitOfMeasure: (raw.consumedUnit || 'Unknown').trim().toLowerCase(),
        cost: Number.isFinite(rawCost) ? rawCost : 0,
        quantity: Number(raw.consumedQuantity ?? 0) || 0,
        billingCurrency: raw.billingCurrency || 'INR',
    };
}

// ── SQL Server loader ───────────────────────────────────────────────

export async function loadActiveUsageRecords(
    startDate: string,
    endDate: string,
    prisma = getPrismaClient()
): Promise<UsageRecord[]> {
    logger.info(`Querying active usage records from azure_usage_records (${startDate} to ${endDate})...`);

    const records = await prisma.azureUsageRecord.findMany({
        where: {
            isDuplicateOfEarlierRow: false,
            isSupersededByLaterRow: false,
            isExcludedFromAlerts: false,
            usageDate: {
                gte: new Date(`${startDate}T00:00:00Z`),
                lte: new Date(`${endDate}T00:00:00Z`),
            },
        },
        select: {
            usageDate: true,
            subscriptionId: true,
            subscriptionName: true,
            resourceId: true,
            resourceName: true,
            resourceGroup: true,
            service: true,
            meterId: true,
            meterName: true,
            meterCategory: true,
            meterSubCategory: true,
            consumedQuantity: true,
            consumedUnit: true,
            effectiveCost: true,
            billedCost: true,
            billingCurrency: true,
        },
        orderBy: { usageDate: 'asc' },
    });

    if (!records.length) {
        logger.warn('No active usage records found for the requested date range.');
        return [];
    }

    const normalized: UsageRecord[] = new Array(records.length);
    for (let i = 0; i < records.length; i++) {
        normalized[i] = normalizeRecord(records[i]);
    }

    const dates = [...new Set(normalized.map((r) => r.date))].sort();
    logger.info(`Loaded ${normalized.length} record(s) spanning ${dates.length} day(s)`, {
        range: `${dates[0]} to ${dates[dates.length - 1]}`,
    });

    return normalized;
}
