export interface UsageRecord {
    date: string;              // YYYY-MM-DD
    subscriptionId: string;
    subscriptionName: string;
    resourceId: string | null;
    resourceName: string;
    resourceGroup: string;
    service: string;
    meterId: string | null;
    meterName: string;
    meterCategory: string;
    meterSubCategory: string;
    unitOfMeasure: string;
    cost: number;
    quantity: number;
    billingCurrency: string;
}

export type AlertType =
    | 'SUBSCRIPTION_COST_SPIKE'
    | 'SERVICE_COST_SPIKE'
    | 'RESOURCE_COST_SPIKE'
    | 'NEW_EXPENSIVE_RESOURCE'
    | 'QUANTITY_SPIKE';

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';

export interface DriverAnnotation {
    alertType: AlertType;
    resourceId?: string | null;
    resourceName?: string;
    service?: string;
    absoluteIncrease: number;
    coveragePercent: number;
}

export interface Alert {
    alertType: AlertType;
    severity: AlertSeverity;
    evaluationDate: string;
    billingCurrency: string;

    // Cost fields (cost spikes + new resource)
    currentCost: number;
    baselineCost?: number;
    absoluteIncrease: number;
    percentIncrease?: number | null;
    nonZeroBaselineDays?: number;

    // Identity
    subscriptionId: string;
    subscriptionName: string;
    resourceId?: string | null;
    resourceName?: string;
    resourceGroup?: string;
    service?: string;

    // New resource specific
    firstSeenDate?: string;

    // Quantity spike specific
    currentQuantity?: number;
    baselineQuantity?: number;
    meterId?: string;
    meterName?: string;
    meterCategory?: string;
    meterSubCategory?: string;
    unitOfMeasure?: string;

    // Cross-level driver annotation
    likelyDrivenBy?: DriverAnnotation;
}

export interface AlertSummary {
    total: number;
    subscriptionCostSpikes: number;
    serviceCostSpikes: number;
    resourceCostSpikes: number;
    newExpensiveResources: number;
    quantitySpikes: number;
}

export interface ThresholdConfig {
    minimumPercentIncrease: number;
    minimumAbsoluteIncrease: number;
    minimumBaselineDaysWithData: number;
}

export interface QuantityThresholdConfig extends ThresholdConfig {
    minimumBaselineQuantity: number;
    minimumAssociatedCost?: number;
}

export interface NewResourceConfig {
    minimumDailyCost: number;
    lookbackDays: number;
}

export interface CorrelationConfig {
    driverCoverageThreshold: number;
}

export interface AlertConfiguration {
    baselineDays: number;
    dataLagDays: number;
    subscription: ThresholdConfig;
    service: ThresholdConfig;
    resource: ThresholdConfig;
    quantity: QuantityThresholdConfig;
    newResource: NewResourceConfig;
    correlation: CorrelationConfig;
}

export interface AlertReport {
    generatedAt: string;
    evaluationDate: string;
    baselineDates: string[];
    configuration: AlertConfiguration;
    summary: AlertSummary;
    alerts: Alert[];
}

export interface BaselineStats {
    dailyValues: number[];
    mean: number;
    median: number;
    nonZeroDays: number;
    totalDays: number;
}

export interface EmailResult {
    sent: boolean;
    previewed?: boolean;
    previewPath?: string;
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    reason?: string;
}
