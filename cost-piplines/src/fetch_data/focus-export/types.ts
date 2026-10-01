export interface FocusRawRecord {
    [key: string]: string | undefined;
    ChargePeriodStart?: string;
    ChargePeriodEnd?: string;
    BilledCost?: string;
    EffectiveCost?: string;
    ResourceId?: string;
    ResourceName?: string;
    SubAccountId?: string;
    SubAccountName?: string;
    ServiceName?: string;
    SkuId?: string;
    SkuPriceId?: string;
    ChargeCategory?: string;
    ChargeClass?: string;
    ChargeDescription?: string;
    ConsumedQuantity?: string;
    ConsumedUnit?: string;
    PricingQuantity?: string;
    PricingUnit?: string;
    PricingCategory?: string;
    BillingCurrency?: string;
    RegionId?: string;
    RegionName?: string;
    Tags?: string;
    x_SkuMeterId?: string;
    x_SkuMeterName?: string;
    x_SkuMeterCategory?: string;
    x_SkuMeterSubcategory?: string;
    x_ResourceGroupName?: string;
    x_SkuIsCreditEligible?: string;
    x_SkuDetails?: string;
}

export interface NormalizedUsageRecord {
    stableRowHash: string;
    chargeKeyHash: string;
    isDuplicateOfEarlierRow: boolean;
    isSupersededByLaterRow: boolean;
    usageDate: Date;
    usageMonth: string;
    chargePeriodStart: Date | null;
    chargePeriodEnd: Date | null;
    subscriptionId: string;
    subscriptionName: string | null;
    resourceId: string | null;
    resourceIdHash: string | null;
    resourceName: string | null;
    resourceGroup: string | null;
    service: string;
    meterId: string | null;
    meterName: string | null;
    meterCategory: string | null;
    meterSubCategory: string | null;
    consumedQuantity: string | null;
    consumedUnit: string | null;
    pricingQuantity: string | null;
    pricingUnit: string | null;
    billedCost: string;
    effectiveCost: string;
    billingCurrency: string;
    chargeType: string | null;
    chargeClass: string | null;
    region: string | null;
    pricingModel: string | null;
    isCreditEligible: boolean | null;
    tags: string | null;
    tagsRaw: string | null;
    isExcludedFromAlerts: boolean;
    ingestionRunId?: bigint;
}

export interface BlobItemSummary {
    name: string;
    lastModified: Date;
}

export interface PeriodRunDescriptor {
    exportPeriod: string;
    exportRunId: string;
    blobs: BlobItemSummary[];
}

export interface IngestionCounters {
    rowsParsed: number;
    rowsWritten: number;
    duplicatesDropped: number;
    invalidRows: number;
}
