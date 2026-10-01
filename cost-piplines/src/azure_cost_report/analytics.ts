import {
    UsageTransaction,
    CalculatedReports,
    MonthlyTotalsRow,
    KpisByMonthRow,
    BySubscriptionRow,
    ByResourceGroupRow,
    ByServiceRow,
    ByChargeTypeRow,
    ByRegionRow,
    ByPricingModelRow,
    CreditEligibilityRow,
    TopMetersRow,
    MomChangeRow,
    CostConcentrationParetoRow,
    AnomalyFlagsRow,
    NewServicesByMonthRow,
    ForecastNextMonthRow,
    VolatilityRow,
    TopResourcesRow,
    ReportPipelineOptions,
} from './types';

export function round(value: number, decimals = 2): number {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function safeDivide(numerator: number, denominator: number): number {
    return denominator ? numerator / denominator : 0;
}

export function groupBy<T extends Record<string, any>>(
    items: T[],
    dimensions: (keyof T)[]
): Array<Record<string, any> & { cost: number }> {
    const groups = new Map<string, { values: any[]; cost: number }>();

    for (const item of items) {
        const values = dimensions.map((d) => item[d]);
        const key = JSON.stringify(values);
        const current = groups.get(key);
        if (current) {
            current.cost += item.cost;
        } else {
            groups.set(key, { values, cost: item.cost });
        }
    }

    return [...groups.values()].map((group) => {
        const row: Record<string, any> & { cost: number } = { cost: group.cost };
        dimensions.forEach((dim, index) => {
            row[dim as string] = group.values[index];
        });
        return row;
    });
}

export function monthlyServicePivot(transactions: UsageTransaction[]) {
    const months = [...new Set(transactions.map((item) => item.month))].sort();
    const services = [...new Set(transactions.map((item) => item.consumedService))].sort();
    const pivot: Record<string, Record<string, number>> = Object.fromEntries(
        months.map((m) => [m, {}])
    );

    for (const item of transactions) {
        pivot[item.month][item.consumedService] =
            (pivot[item.month][item.consumedService] || 0) + item.cost;
    }

    const monthlyData = months.map((month) => {
        const serviceCosts: Record<string, number> = {};
        let totalCost = 0;
        for (const service of services) {
            const value = pivot[month][service] || 0;
            serviceCosts[service] = value;
            totalCost += value;
        }
        return { month, services: serviceCosts, totalCost };
    });

    return { monthlyData, services, months };
}

export function calculateReports(
    transactions: UsageTransaction[],
    options: ReportPipelineOptions
): CalculatedReports {
    const { monthlyData, services, months } = monthlyServicePivot(transactions);

    // 1. Monthly totals
    const monthlyTotals: MonthlyTotalsRow[] = groupBy(transactions, ['month'])
        .map((r) => ({ month: r.month, totalCost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month));

    // 2. KPIs by month
    const kpisByMonth: KpisByMonthRow[] = months.map((month) => {
        const monthRows = transactions.filter((item) => item.month === month);
        const total = monthRows.reduce((sum, item) => sum + item.cost, 0);
        const subscriptions = groupBy(monthRows, ['subscription']).sort((a, b) => b.cost - a.cost);
        const monthServices = groupBy(monthRows, ['consumedService']).sort((a, b) => b.cost - a.cost);
        return {
            month,
            totalCost: round(total),
            topSubscription: subscriptions[0]?.subscription || null,
            topSubscriptionCost: subscriptions[0] ? round(subscriptions[0].cost) : null,
            topService: monthServices[0]?.consumedService || null,
            topServiceCost: monthServices[0] ? round(monthServices[0].cost) : null,
            subscriptions: new Set(monthRows.map((item) => item.subscription)).size,
            resourceGroups: new Set(monthRows.map((item) => item.resourceGroup)).size,
        };
    });

    // 3. By subscription
    const bySubscription: BySubscriptionRow[] = groupBy(transactions, ['month', 'subscription'])
        .map((r) => ({ month: r.month, subscription: r.subscription, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 4. By resource group
    const byResourceGroup: ByResourceGroupRow[] = groupBy(transactions, ['month', 'resourceGroup', 'subscription'])
        .map((r) => ({
            month: r.month,
            resourceGroup: r.resourceGroup,
            subscription: r.subscription,
            cost: round(r.cost),
        }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 5. By service
    const byService: ByServiceRow[] = groupBy(transactions, ['month', 'consumedService'])
        .map((r) => ({ month: r.month, consumedService: r.consumedService, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 6. By charge type
    const byChargeType: ByChargeTypeRow[] = groupBy(transactions, ['month', 'chargeType'])
        .map((r) => ({ month: r.month, chargeType: r.chargeType, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 7. By region
    const byRegion: ByRegionRow[] = groupBy(transactions, ['month', 'location'])
        .map((r) => ({ month: r.month, region: r.location, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 8. By pricing model
    const byPricingModel: ByPricingModelRow[] = groupBy(transactions, ['month', 'pricingModel'])
        .map((r) => ({ month: r.month, pricingModel: r.pricingModel, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 9. Credit eligibility
    const creditEligibility: CreditEligibilityRow[] = groupBy(transactions, ['month', 'creditEligible'])
        .map((r) => ({ month: r.month, creditEligible: r.creditEligible, cost: round(r.cost) }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    // 10. Top meters
    const topMeters: TopMetersRow[] = groupBy(transactions, ['month', 'meter', 'meterCategory', 'consumedService', 'resourceGroup'])
        .map((r) => ({
            month: r.month,
            meter: r.meter,
            category: r.meterCategory,
            service: r.consumedService,
            resourceGroup: r.resourceGroup,
            cost: round(r.cost),
        }))
        .sort((a, b) => b.month.localeCompare(a.month) || b.cost - a.cost);

    // 11. MoM change
    const momChange: MomChangeRow[] = monthlyData.map((item, index) => {
        const previous = index > 0 ? monthlyData[index - 1].totalCost : null;
        return {
            month: item.month,
            totalCost: round(item.totalCost),
            previousMonthCost: previous === null ? null : round(previous),
            momPercentChange: previous ? round(((item.totalCost - previous) / previous) * 100) : null,
        };
    });

    // 12. Cost concentration Pareto
    const serviceTotals: Record<string, number> = Object.fromEntries(services.map((s) => [s, 0]));
    for (const month of monthlyData) {
        for (const s of services) serviceTotals[s] += month.services[s] || 0;
    }
    const sortedServices = services
        .map((s) => ({ service: s, total: serviceTotals[s] }))
        .sort((a, b) => b.total - a.total);
    const grandTotal = sortedServices.reduce((sum, item) => sum + item.total, 0);

    let cumulativeCost = 0;
    const costConcentrationPareto: CostConcentrationParetoRow[] = sortedServices.map((item, index) => {
        cumulativeCost += item.total;
        return {
            service: item.service,
            totalCost: round(item.total),
            percentOfTotal: grandTotal ? round((item.total / grandTotal) * 100) : 0,
            cumulativePercent: grandTotal ? round((cumulativeCost / grandTotal) * 100) : 0,
            rank: index + 1,
        };
    });

    // 13. Anomaly flags
    const anomalyFlags: AnomalyFlagsRow[] = monthlyData.map((item, index) => {
        const previousMonths = monthlyData.slice(Math.max(0, index - options.anomalyRollingMonths), index);
        const average = previousMonths.length
            ? previousMonths.reduce((sum, m) => sum + m.totalCost, 0) / previousMonths.length
            : null;
        const difference = average !== null && average > 0 ? ((item.totalCost - average) / average) * 100 : null;
        const isAnomaly =
            previousMonths.length === options.anomalyRollingMonths &&
            average !== null &&
            average > 0 &&
            item.totalCost > average * (1 + options.anomalyThresholdPercent / 100);

        return {
            month: item.month,
            totalCost: round(item.totalCost),
            rollingAvg: average === null ? null : round(average),
            differencePercent: difference === null ? null : round(difference),
            thresholdPercent: options.anomalyThresholdPercent,
            isAnomaly,
        };
    });

    // 14. New services by month
    const seenServices = new Set<string>();
    const newServicesByMonth: NewServicesByMonthRow[] = [];
    for (const month of monthlyData) {
        const activeServices = services.filter((name) => (month.services[name] || 0) > 0).sort();
        for (const s of activeServices) {
            if (!seenServices.has(s)) {
                newServicesByMonth.push({ month: month.month, newService: s });
                seenServices.add(s);
            }
        }
    }

    // 15. Forecast next month
    const recent = monthlyData.slice(-3).map((item) => item.totalCost);
    const averageForecast = recent.length ? recent.reduce((sum, v) => sum + v, 0) / recent.length : 0;
    let trendForecast = averageForecast;
    if (recent.length >= 2) {
        const xMean = (recent.length - 1) / 2;
        const yMean = averageForecast;
        let numerator = 0;
        let denominator = 0;
        recent.forEach((value, index) => {
            numerator += (index - xMean) * (value - yMean);
            denominator += (index - xMean) ** 2;
        });
        const slope = denominator ? numerator / denominator : 0;
        trendForecast = yMean + slope * (recent.length - xMean);
    }
    const forecastNextMonth: ForecastNextMonthRow[] = [
        { method: 'Average of last 3 months', forecastedTotalCost: round(Math.max(0, averageForecast)) },
        { method: 'Simple linear trend', forecastedTotalCost: round(Math.max(0, trendForecast)) },
    ];

    // 16. Volatility
    const volatility: VolatilityRow[] = services
        .map((s) => {
            const values = monthlyData.map((m) => m.services[s] || 0);
            const mean = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
            const variance = values.length
                ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
                : 0;
            const standardDeviation = Math.sqrt(variance);
            return {
                service: s,
                mean: round(mean),
                stdDev: round(standardDeviation),
                coefficientOfVariationPercent: mean
                    ? round(safeDivide(standardDeviation, Math.abs(mean)) * 100, 1)
                    : 0,
            };
        })
        .filter((item) => item.mean !== 0)
        .sort((a, b) => b.coefficientOfVariationPercent - a.coefficientOfVariationPercent);

    // 17. Top resources
    const topResources: TopResourcesRow[] = groupBy(transactions, ['month', 'resourceName', 'resourceGroup', 'consumedService'])
        .map((r) => ({
            month: r.month,
            resourceName: r.resourceName,
            resourceGroup: r.resourceGroup,
            service: r.consumedService,
            cost: round(r.cost),
        }))
        .sort((a, b) => a.month.localeCompare(b.month) || b.cost - a.cost);

    return {
        monthlyTotals,
        kpisByMonth,
        bySubscription,
        byResourceGroup,
        byService,
        byChargeType,
        byRegion,
        byPricingModel,
        creditEligibility,
        topMeters,
        momChange,
        costConcentrationPareto,
        anomalyFlags,
        newServicesByMonth,
        forecastNextMonth,
        volatility,
        topResources,
    };
}
