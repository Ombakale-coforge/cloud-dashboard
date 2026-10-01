/**
 * Azure Cost Reporting Pipeline — Type Definitions
 */

export interface UsageTransaction {
    month: string;
    cost: number;
    subscription: string;
    resourceGroup: string;
    consumedService: string;
    chargeType: string;
    meter: string;
    meterCategory: string;
    location: string;
    pricingModel: string;
    resourceName: string;
    creditEligible: string;
}

export interface MonthlyTotalsRow {
    month: string;
    totalCost: number;
}

export interface KpisByMonthRow {
    month: string;
    totalCost: number;
    topSubscription: string | null;
    topSubscriptionCost: number | null;
    topService: string | null;
    topServiceCost: number | null;
    subscriptions: number;
    resourceGroups: number;
}

export interface BySubscriptionRow {
    month: string;
    subscription: string;
    cost: number;
}

export interface ByResourceGroupRow {
    month: string;
    resourceGroup: string;
    subscription: string;
    cost: number;
}

export interface ByServiceRow {
    month: string;
    consumedService: string;
    cost: number;
}

export interface ByChargeTypeRow {
    month: string;
    chargeType: string;
    cost: number;
}

export interface ByRegionRow {
    month: string;
    region: string;
    cost: number;
}

export interface ByPricingModelRow {
    month: string;
    pricingModel: string;
    cost: number;
}

export interface CreditEligibilityRow {
    month: string;
    creditEligible: string;
    cost: number;
}

export interface TopMetersRow {
    month: string;
    meter: string;
    category: string;
    service: string;
    resourceGroup: string;
    cost: number;
}

export interface MomChangeRow {
    month: string;
    totalCost: number;
    previousMonthCost: number | null;
    momPercentChange: number | null;
}

export interface CostConcentrationParetoRow {
    service: string;
    totalCost: number;
    percentOfTotal: number;
    cumulativePercent: number;
    rank: number;
}

export interface AnomalyFlagsRow {
    month: string;
    totalCost: number;
    rollingAvg: number | null;
    differencePercent: number | null;
    thresholdPercent: number;
    isAnomaly: boolean;
}

export interface NewServicesByMonthRow {
    month: string;
    newService: string;
}

export interface ForecastNextMonthRow {
    method: string;
    forecastedTotalCost: number;
}

export interface VolatilityRow {
    service: string;
    mean: number;
    stdDev: number;
    coefficientOfVariationPercent: number;
}

export interface TopResourcesRow {
    month: string;
    resourceName: string;
    resourceGroup: string;
    service: string;
    cost: number;
}

export interface CalculatedReports {
    monthlyTotals: MonthlyTotalsRow[];
    kpisByMonth: KpisByMonthRow[];
    bySubscription: BySubscriptionRow[];
    byResourceGroup: ByResourceGroupRow[];
    byService: ByServiceRow[];
    byChargeType: ByChargeTypeRow[];
    byRegion: ByRegionRow[];
    byPricingModel: ByPricingModelRow[];
    creditEligibility: CreditEligibilityRow[];
    topMeters: TopMetersRow[];
    momChange: MomChangeRow[];
    costConcentrationPareto: CostConcentrationParetoRow[];
    anomalyFlags: AnomalyFlagsRow[];
    newServicesByMonth: NewServicesByMonthRow[];
    forecastNextMonth: ForecastNextMonthRow[];
    volatility: VolatilityRow[];
    topResources: TopResourcesRow[];
}

export interface ReportPipelineOptions {
    anomalyThresholdPercent: number;
    anomalyRollingMonths: number;
}

export interface ReportRunSummary {
    runId: number;
    runStamp: string;
    transactionCount: number;
    months: string[];
    durationMs: number;
    reportsSummary: Record<string, number>;
}
