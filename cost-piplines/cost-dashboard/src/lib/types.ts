export interface MonthTotal {
    Month: string;
    "Total Cost": number;
}
export interface MomChange {
    Month: string;
    "Total Cost": number;
    "Previous Month Cost": number | string;
    "MoM % Change": number | string;
}
export interface LinkedAccountCost {
    "Linked Account": string;
    Cost: number;
}
export interface ServiceCost {
    Service: string;
    Cost: number;
}
export interface TopService {
    Service: string;
    "Total Cost": number;
}
export interface RecurringRow {
    Service: string;
    "Months Active": number;
    "Total Months": number;
    "Active %": number;
    Classification: string;
}
export interface CategoryCost {
    Month: string;
    Category: string;
    Cost: number;
}
export interface AnomalyRow {
    Month: string;
    "Total Cost": number;
    "Rolling Avg (3mo)": number;
    "Is Anomaly": boolean;
}
export interface ForecastRow {
    Method: string;
    "Forecasted Total Cost": number;
}
export interface VolatilityRow {
    Service: string;
    Mean: number;
    "Std Dev": number;
    "Coefficient of Variation %": number;
}

// ---------------------------------------------------------------------
// Azure dashboard types - mirror the columns written by
// azure_dashboard_pipeline.js into public/data/azure/*.csv
// ---------------------------------------------------------------------
export interface AzureKpiMonth {
    Month: string;
    "Total Cost": number;
    "Top Customer": string;
    "Top Customer Cost": number;
    "Top Product": string;
    "Top Product Cost": number;
    Subscriptions: number;
    "Previous Month Cost": number | string;
    "MoM % Change": number | string;
}
export interface AzureMonthlyTotal {
    Month: string;
    "Total Cost": number;
}
export interface AzureCategoryCost {
    Month: string;
    Category: string;
    Cost: number;
}
export interface AzureProductCost {
    Month: string;
    Product: string;
    Cost: number;
}
export interface AzureCustomerCost {
    Month: string;
    Customer: string;
    Cost: number;
}
export interface AzureTopMeter {
    Month: string;
    Meter: string;
    Product: string;
    Category: string;
    Cost: number;
}
export interface AzureChargeTypeCost {
    Month: string;
    ChargeType: string;
    Cost: number;
}
