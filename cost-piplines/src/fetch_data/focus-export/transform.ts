import crypto from 'node:crypto';
import { VOLATILE_FIELDS, CHARGE_KEY_FIELDS } from './config';
import { FocusRawRecord, NormalizedUsageRecord } from './types';

export function sha256(input: string): string {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export function dateOnly(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
}

// Extract and cache sorted non-volatile keys once per file/schema
export function getStableKeys(sampleRow: Record<string, any>): string[] {
    return Object.keys(sampleRow)
        .filter((k) => !VOLATILE_FIELDS.includes(k))
        .sort();
}

// Compute stable row hash using pre-sorted keys
export function computeStableRowHash(raw: Record<string, any>, stableKeys: string[]): string {
    const canonical = stableKeys.map((k) => `${k}=${raw[k] ?? ''}`).join('|');
    return sha256(canonical);
}

// Compute charge key hash identifying the logical charge
export function computeChargeKeyHash(raw: Record<string, any>): string {
    const canonical = CHARGE_KEY_FIELDS.map((k) => `${k}=${raw[k] ?? ''}`).join('|');
    return sha256(canonical);
}

export function normalizeBoolean(value: any): boolean | null {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (['true', 'yes', '1'].includes(text)) return true;
        if (['false', 'no', '0'].includes(text)) return false;
    }
    return null;
}

export function toDecimalString(value: any): string | null {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : null;
}

export function parseTags(rawTags: any): { tagsJson: string | null; tagsRaw: string | null } {
    if (!rawTags || !String(rawTags).trim()) return { tagsJson: null, tagsRaw: null };
    const text = String(rawTags).trim();

    // Fast check for JSON object
    if (text.startsWith('{') && text.endsWith('}')) {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') {
                return { tagsJson: JSON.stringify(parsed), tagsRaw: null };
            }
        } catch {
            // fall through to delimiter parsing
        }
    }

    // Key:value; format
    if (text.includes(':') && text.includes(';')) {
        const tags: Record<string, string> = {};
        for (const pair of text.split(';')) {
            const idx = pair.indexOf(':');
            if (idx !== -1) {
                const k = pair.slice(0, idx).trim();
                const v = pair.slice(idx + 1).trim();
                if (k) tags[k] = v;
            }
        }
        if (Object.keys(tags).length > 0) {
            return { tagsJson: JSON.stringify(tags), tagsRaw: null };
        }
    }

    return { tagsJson: null, tagsRaw: text.slice(0, 2048) };
}

const EXCLUDE_CHARGE_TYPES = new Set(['credit', 'adjustment']);
const EXCLUDE_NAME_PATTERN = /credit|refund|exemption|adjustment/i;

export function computeIsExcludedFromAlerts(chargeType: string | null, resourceName: string | null): boolean {
    if (chargeType && EXCLUDE_CHARGE_TYPES.has(chargeType.trim().toLowerCase())) return true;
    if (resourceName && EXCLUDE_NAME_PATTERN.test(resourceName)) return true;
    return false;
}

export function normalizeRecord(
    raw: FocusRawRecord,
    stableKeys: string[]
): { row: NormalizedUsageRecord | null; reason?: string } {
    const chargePeriodStart = raw.ChargePeriodStart ? new Date(raw.ChargePeriodStart) : null;
    if (!chargePeriodStart || Number.isNaN(chargePeriodStart.getTime())) {
        return { row: null, reason: 'invalid ChargePeriodStart' };
    }

    const billedCost = toDecimalString(raw.BilledCost);
    const effectiveCost = toDecimalString(raw.EffectiveCost);
    if (billedCost === null || effectiveCost === null) {
        return { row: null, reason: 'invalid cost' };
    }

    const usageDateStr = fmtDate(chargePeriodStart);
    const usageMonth = usageDateStr.slice(0, 7);
    const resourceId = raw.ResourceId && String(raw.ResourceId).trim() ? String(raw.ResourceId).trim() : null;
    const { tagsJson, tagsRaw } = parseTags(raw.Tags);
    const chargeType = raw.ChargeCategory || null;
    const resourceName = raw.ResourceName || null;

    const row: NormalizedUsageRecord = {
        stableRowHash: computeStableRowHash(raw, stableKeys),
        chargeKeyHash: computeChargeKeyHash(raw),
        isDuplicateOfEarlierRow: false,
        isSupersededByLaterRow: false,
        usageDate: dateOnly(usageDateStr),
        usageMonth,
        chargePeriodStart: raw.ChargePeriodStart ? new Date(raw.ChargePeriodStart) : null,
        chargePeriodEnd: raw.ChargePeriodEnd ? new Date(raw.ChargePeriodEnd) : null,
        subscriptionId: (raw.SubAccountId || 'unknown').slice(0, 100),
        subscriptionName: raw.SubAccountName ? raw.SubAccountName.slice(0, 255) : null,
        resourceId: resourceId ? resourceId.slice(0, 300) : null,
        resourceIdHash: resourceId ? sha256(resourceId) : null,
        resourceName: resourceName ? resourceName.slice(0, 255) : null,
        resourceGroup: raw.x_ResourceGroupName ? raw.x_ResourceGroupName.slice(0, 255) : null,
        service: (raw.ServiceName || 'Unknown Service').slice(0, 255),
        meterId: (raw.x_SkuMeterId || raw.SkuId || null)?.slice(0, 100) || null,
        meterName: raw.x_SkuMeterName ? raw.x_SkuMeterName.slice(0, 255) : null,
        meterCategory: raw.x_SkuMeterCategory ? raw.x_SkuMeterCategory.slice(0, 255) : null,
        meterSubCategory: raw.x_SkuMeterSubcategory ? raw.x_SkuMeterSubcategory.slice(0, 255) : null,
        consumedQuantity: toDecimalString(raw.ConsumedQuantity),
        consumedUnit: raw.ConsumedUnit ? raw.ConsumedUnit.slice(0, 64) : null,
        pricingQuantity: toDecimalString(raw.PricingQuantity),
        pricingUnit: raw.PricingUnit ? raw.PricingUnit.slice(0, 64) : null,
        billedCost,
        effectiveCost,
        billingCurrency: (raw.BillingCurrency || 'INR').slice(0, 8),
        chargeType: chargeType ? chargeType.slice(0, 64) : null,
        chargeClass: raw.ChargeClass ? raw.ChargeClass.slice(0, 32) : null,
        region: (raw.RegionId || raw.RegionName || null)?.slice(0, 128) || null,
        pricingModel: raw.PricingCategory ? raw.PricingCategory.slice(0, 64) : null,
        isCreditEligible: normalizeBoolean(raw.x_SkuIsCreditEligible),
        tags: tagsJson,
        tagsRaw,
        isExcludedFromAlerts: computeIsExcludedFromAlerts(chargeType, resourceName),
    };

    return { row, reason: undefined };
}
