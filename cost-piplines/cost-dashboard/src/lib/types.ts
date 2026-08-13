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
export interface LinkedAccountCostWide {
  "Linked Account": string;
  [month: string]: string | number;
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
