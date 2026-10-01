import { ALERT_CONFIG, RESOURCE_ALERT_EXCLUSIONS, logger } from './config';
import { getPreviousDates, getDateDaysBefore } from './data-loader';
import type { Alert, AlertReport, AlertSeverity, UsageRecord, BaselineStats } from './types';

// ── Exported Functions ───────────────────────────────────────────────────────

export function average(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}

export function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

export function calculatePercentChange(current: number, baseline: number): number | null {
    if (baseline <= 0) return null;
    return ((current - baseline) / baseline) * 100;
}

export function normalizeResourceId(resourceId: string | null): string {
    return String(resourceId || '').trim().toLowerCase();
}

export function shouldExcludeFromResourceAlerts(record: UsageRecord): boolean {
    const name = record.resourceName.toLowerCase();
    return RESOURCE_ALERT_EXCLUSIONS.some(term => name.includes(term));
}

export function getSeverity(percentIncrease: number | null): AlertSeverity {
    if (percentIncrease == null) return 'INFO';
    if (percentIncrease >= 100) return 'CRITICAL';
    if (percentIncrease >= 50) return 'HIGH';
    if (percentIncrease >= 25) return 'WARNING';
    return 'INFO';
}

export { ALERT_CONFIG };

// ── Internal Helper Functions ────────────────────────────────────────────────

function groupRecords(records: UsageRecord[], keySelector: (r: UsageRecord) => string | null): Map<string, UsageRecord[]> {
    const map = new Map<string, UsageRecord[]>();
    for (const r of records) {
        const key = keySelector(r);
        if (!key) continue;
        const arr = map.get(key) || [];
        arr.push(r);
        map.set(key, arr);
    }
    return map;
}

function sumsByDate(records: UsageRecord[], field: 'cost' | 'quantity'): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of records) {
        m.set(r.date, (m.get(r.date) || 0) + Number((r as any)[field] || 0));
    }
    return m;
}

function calculateRollingBaselineStats(dateSums: Map<string, number>, baselineDates: string[]): BaselineStats {
    const dailyValues = baselineDates.map(d => dateSums.get(d) || 0);
    const nonZeroDays = dailyValues.filter(v => v > 0).length;
    return {
        dailyValues,
        mean: average(dailyValues),
        median: median(dailyValues),
        nonZeroDays,
        totalDays: baselineDates.length
    };
}

function passesIncreaseThreshold({ currentValue, baselineValue, minimumPercentIncrease, minimumAbsoluteIncrease }: { currentValue: number, baselineValue: number, minimumPercentIncrease: number, minimumAbsoluteIncrease: number }): boolean {
    if (baselineValue <= 0) return false;
    const absoluteIncrease = currentValue - baselineValue;
    const percentIncrease = calculatePercentChange(currentValue, baselineValue);
    
    if (absoluteIncrease < minimumAbsoluteIncrease) return false;
    if (percentIncrease === null || percentIncrease < minimumPercentIncrease) return false;
    
    return true;
}

function createCostSpikeAlert({ alertType, evaluationDate, currentCost, baselineCost, billingCurrency, nonZeroBaselineDays, metadata }: any): Alert {
    const absoluteIncrease = currentCost - baselineCost;
    const percentIncrease = calculatePercentChange(currentCost, baselineCost);
    const severity = getSeverity(percentIncrease);

    return {
        alertType,
        severity,
        evaluationDate,
        billingCurrency,
        currentCost,
        baselineCost,
        absoluteIncrease,
        percentIncrease,
        nonZeroBaselineDays,
        ...metadata
    };
}

// ── Alert Generators ─────────────────────────────────────────────────────────

function generateSubscriptionCostAlerts({ records, evaluationDate, baselineDates }: { records: UsageRecord[], evaluationDate: string, baselineDates: string[] }): Alert[] {
    const alerts: Alert[] = [];
    const grouped = groupRecords(records, r => r.subscriptionId);
    
    for (const [subId, subRecords] of grouped.entries()) {
        const dateSums = sumsByDate(subRecords, 'cost');
        const currentCost = dateSums.get(evaluationDate) || 0;
        const baselineStats = calculateRollingBaselineStats(dateSums, baselineDates);
        
        if (baselineStats.nonZeroDays < ALERT_CONFIG.subscription.minimumBaselineDaysWithData) continue;
        
        if (!passesIncreaseThreshold({
            currentValue: currentCost,
            baselineValue: baselineStats.median,
            minimumPercentIncrease: ALERT_CONFIG.subscription.minimumPercentIncrease,
            minimumAbsoluteIncrease: ALERT_CONFIG.subscription.minimumAbsoluteIncrease
        })) {
            continue;
        }

        alerts.push(createCostSpikeAlert({
            alertType: 'SUBSCRIPTION_COST_SPIKE',
            evaluationDate,
            currentCost,
            baselineCost: baselineStats.median,
            billingCurrency: subRecords[0].billingCurrency,
            nonZeroBaselineDays: baselineStats.nonZeroDays,
            metadata: {
                subscriptionId: subId,
                subscriptionName: subRecords[0].subscriptionName
            }
        }));
    }
    
    return alerts;
}

function generateServiceCostAlerts({ records, evaluationDate, baselineDates }: { records: UsageRecord[], evaluationDate: string, baselineDates: string[] }): Alert[] {
    const alerts: Alert[] = [];
    const grouped = groupRecords(records, r => `${r.subscriptionId}|${String(r.service || 'unknown_service').trim().toLowerCase()}`);
    
    for (const [key, groupRecords] of grouped.entries()) {
        const dateSums = sumsByDate(groupRecords, 'cost');
        const currentCost = dateSums.get(evaluationDate) || 0;
        const baselineStats = calculateRollingBaselineStats(dateSums, baselineDates);
        
        if (baselineStats.nonZeroDays < ALERT_CONFIG.service.minimumBaselineDaysWithData) continue;
        
        if (!passesIncreaseThreshold({
            currentValue: currentCost,
            baselineValue: baselineStats.median,
            minimumPercentIncrease: ALERT_CONFIG.service.minimumPercentIncrease,
            minimumAbsoluteIncrease: ALERT_CONFIG.service.minimumAbsoluteIncrease
        })) {
            continue;
        }

        alerts.push(createCostSpikeAlert({
            alertType: 'SERVICE_COST_SPIKE',
            evaluationDate,
            currentCost,
            baselineCost: baselineStats.median,
            billingCurrency: groupRecords[0].billingCurrency,
            nonZeroBaselineDays: baselineStats.nonZeroDays,
            metadata: {
                subscriptionId: groupRecords[0].subscriptionId,
                subscriptionName: groupRecords[0].subscriptionName,
                service: groupRecords[0].service
            }
        }));
    }
    
    return alerts;
}

function generateResourceCostAlerts({ records, evaluationDate, baselineDates }: { records: UsageRecord[], evaluationDate: string, baselineDates: string[] }): Alert[] {
    const alerts: Alert[] = [];
    const eligible = records.filter(r => r.resourceId != null && !shouldExcludeFromResourceAlerts(r));
    const grouped = groupRecords(eligible, r => `${r.subscriptionId}|${normalizeResourceId(r.resourceId)}`);
    
    for (const [key, groupRecords] of grouped.entries()) {
        const dateSums = sumsByDate(groupRecords, 'cost');
        const currentCost = dateSums.get(evaluationDate) || 0;
        const baselineStats = calculateRollingBaselineStats(dateSums, baselineDates);
        
        if (baselineStats.nonZeroDays < ALERT_CONFIG.resource.minimumBaselineDaysWithData) continue;
        
        if (!passesIncreaseThreshold({
            currentValue: currentCost,
            baselineValue: baselineStats.median,
            minimumPercentIncrease: ALERT_CONFIG.resource.minimumPercentIncrease,
            minimumAbsoluteIncrease: ALERT_CONFIG.resource.minimumAbsoluteIncrease
        })) {
            continue;
        }

        alerts.push(createCostSpikeAlert({
            alertType: 'RESOURCE_COST_SPIKE',
            evaluationDate,
            currentCost,
            baselineCost: baselineStats.median,
            billingCurrency: groupRecords[0].billingCurrency,
            nonZeroBaselineDays: baselineStats.nonZeroDays,
            metadata: {
                subscriptionId: groupRecords[0].subscriptionId,
                subscriptionName: groupRecords[0].subscriptionName,
                resourceId: groupRecords[0].resourceId,
                resourceName: groupRecords[0].resourceName,
                resourceGroup: groupRecords[0].resourceGroup,
                service: groupRecords[0].service
            }
        }));
    }
    
    return alerts;
}

function generateNewResourceAlerts({ records, evaluationDate, baselineDates = [] }: { records: UsageRecord[], evaluationDate: string, baselineDates?: string[] }): Alert[] {
    const alerts: Alert[] = [];
    const lookbackStartDate = getDateDaysBefore(evaluationDate, ALERT_CONFIG.newResource.lookbackDays);
    
    const eligible = records.filter(r => 
        r.resourceId != null && 
        !shouldExcludeFromResourceAlerts(r) && 
        r.date >= lookbackStartDate && 
        r.date <= evaluationDate
    );
    
    const grouped = groupRecords(eligible, r => `${r.subscriptionId}|${normalizeResourceId(r.resourceId)}`);
    
    for (const [key, groupRecords] of grouped.entries()) {
        const sortedUniqueDates = [...new Set(groupRecords.map(r => r.date))].sort();
        const firstSeenDate = sortedUniqueDates[0];
        
        // Prevent the "New Resource Black Hole": A resource is new if first seen on evaluationDate,
        // OR first seen within the recent baseline window where it does not yet have enough
        // baseline days to qualify for standard resource cost spike alerts, but burns high spend.
        const baselineDaysWithData = baselineDates.filter(d => sortedUniqueDates.includes(d)).length;
        const isEligibleForBaseline = baselineDaysWithData >= ALERT_CONFIG.resource.minimumBaselineDaysWithData;
        
        const isFirstDay = firstSeenDate === evaluationDate;
        const recentWindowStart = getDateDaysBefore(evaluationDate, ALERT_CONFIG.resource.minimumBaselineDaysWithData);
        const isRecentTransitional = !isEligibleForBaseline && firstSeenDate >= recentWindowStart;

        if (!isFirstDay && !isRecentTransitional) continue;
        
        const currentCost = groupRecords.filter(r => r.date === evaluationDate).reduce((sum, r) => sum + r.cost, 0);
        if (currentCost < ALERT_CONFIG.newResource.minimumDailyCost) continue;
        
        let severity: AlertSeverity = 'WARNING';
        if (currentCost >= 10000) severity = 'CRITICAL';
        else if (currentCost >= 3000) severity = 'HIGH';
        
        alerts.push({
            alertType: 'NEW_EXPENSIVE_RESOURCE',
            severity,
            evaluationDate,
            billingCurrency: groupRecords[0].billingCurrency,
            currentCost,
            absoluteIncrease: currentCost,
            subscriptionId: groupRecords[0].subscriptionId,
            subscriptionName: groupRecords[0].subscriptionName,
            resourceId: groupRecords[0].resourceId,
            resourceName: groupRecords[0].resourceName,
            resourceGroup: groupRecords[0].resourceGroup,
            service: groupRecords[0].service,
            firstSeenDate
        });
    }
    
    return alerts;
}

function generateQuantityAlerts({ records, evaluationDate, baselineDates }: { records: UsageRecord[], evaluationDate: string, baselineDates: string[] }): Alert[] {
    const alerts: Alert[] = [];
    const eligible = records.filter(r => 
        r.resourceId != null && 
        r.meterId != null &&
        Number.isFinite(r.quantity) &&
        !shouldExcludeFromResourceAlerts(r)
    );
    
    const grouped = groupRecords(eligible, r => `${r.subscriptionId}|${normalizeResourceId(r.resourceId)}|${r.meterId}|${String(r.unitOfMeasure || 'unknown').trim().toLowerCase()}`);
    
    for (const [key, groupRecords] of grouped.entries()) {
        const dateSums = sumsByDate(groupRecords, 'quantity');
        const currentQuantity = dateSums.get(evaluationDate) || 0;
        const baselineStats = calculateRollingBaselineStats(dateSums, baselineDates);
        
        if (baselineStats.median < ALERT_CONFIG.quantity.minimumBaselineQuantity) continue;
        if (baselineStats.nonZeroDays < ALERT_CONFIG.quantity.minimumBaselineDaysWithData) continue;
        
        const absoluteIncrease = currentQuantity - baselineStats.median;
        const percentIncrease = calculatePercentChange(currentQuantity, baselineStats.median);
        
        if (absoluteIncrease < ALERT_CONFIG.quantity.minimumAbsoluteIncrease) continue;
        if (percentIncrease === null || percentIncrease < ALERT_CONFIG.quantity.minimumPercentIncrease) continue;
        
        const costOnEvalDate = groupRecords.filter(r => r.date === evaluationDate).reduce((s, r) => s + r.cost, 0);
        
        // Filter out trivial quantity spikes with negligible rupee spend (prevents alert fatigue)
        const minCost = ALERT_CONFIG.quantity.minimumAssociatedCost ?? 50;
        if (costOnEvalDate < minCost) {
            continue;
        }

        let severity = getSeverity(percentIncrease);
        if (costOnEvalDate < 300 && (severity === 'CRITICAL' || severity === 'HIGH')) {
            severity = 'WARNING';
        }
        
        alerts.push({
            alertType: 'QUANTITY_SPIKE',
            severity,
            evaluationDate,
            billingCurrency: groupRecords[0].billingCurrency,
            currentCost: costOnEvalDate,
            absoluteIncrease,
            percentIncrease,
            currentQuantity,
            baselineQuantity: baselineStats.median,
            nonZeroBaselineDays: baselineStats.nonZeroDays,
            subscriptionId: groupRecords[0].subscriptionId,
            subscriptionName: groupRecords[0].subscriptionName,
            resourceId: groupRecords[0].resourceId,
            resourceName: groupRecords[0].resourceName,
            resourceGroup: groupRecords[0].resourceGroup,
            service: groupRecords[0].service,
            meterId: groupRecords[0].meterId!,
            meterName: groupRecords[0].meterName,
            meterCategory: groupRecords[0].meterCategory,
            meterSubCategory: groupRecords[0].meterSubCategory,
            unitOfMeasure: groupRecords[0].unitOfMeasure
        });
    }
    
    return alerts;
}

// ── Cross-Level Driver Correlation ───────────────────────────────────────────

function annotateDrivers(higherAlerts: Alert[], lowerAlerts: Alert[], matchFn: (h: Alert, l: Alert) => boolean) {
    for (const higherAlert of higherAlerts) {
        if (higherAlert.absoluteIncrease <= 0) continue;
        
        const candidates = lowerAlerts.filter(l => matchFn(higherAlert, l) && l.absoluteIncrease > 0);
        if (candidates.length === 0) continue;
        
        candidates.sort((a, b) => b.absoluteIncrease - a.absoluteIncrease);
        const topCandidate = candidates[0];
        
        const coverage = topCandidate.absoluteIncrease / higherAlert.absoluteIncrease;
        if (coverage >= ALERT_CONFIG.correlation.driverCoverageThreshold) {
            higherAlert.likelyDrivenBy = {
                alertType: topCandidate.alertType,
                resourceId: topCandidate.resourceId,
                resourceName: topCandidate.resourceName,
                service: topCandidate.service,
                absoluteIncrease: topCandidate.absoluteIncrease,
                coveragePercent: Math.min(100, Math.round(coverage * 1000) / 10)
            };
        }
    }
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

export function generateAlerts(records: UsageRecord[]): AlertReport {
    const validRecords = records.filter(r => 
        r.date && r.date.length === 10 && 
        Number.isFinite(r.cost) && 
        Number.isFinite(r.quantity)
    );
    
    const availableDates = [...new Set(validRecords.map(r => r.date))].sort();
    const minRequiredDates = ALERT_CONFIG.baselineDays + ALERT_CONFIG.dataLagDays + 1;
    
    if (availableDates.length < minRequiredDates) {
        throw new Error(
            `Not enough usage dates. Required at least ${minRequiredDates}, but found ${availableDates.length}.`
        );
    }
    
    const evaluationDate = availableDates[availableDates.length - 1 - ALERT_CONFIG.dataLagDays];
    const baselineDates = getPreviousDates(evaluationDate, ALERT_CONFIG.baselineDays);
    
    logger.info(`Evaluating alerts for ${evaluationDate} using baselines ${baselineDates.join(', ')}`);
    
    const subscriptionAlerts = generateSubscriptionCostAlerts({ records: validRecords, evaluationDate, baselineDates });
    const serviceAlerts = generateServiceCostAlerts({ records: validRecords, evaluationDate, baselineDates });
    const resourceAlerts = generateResourceCostAlerts({ records: validRecords, evaluationDate, baselineDates });
    const newResourceAlerts = generateNewResourceAlerts({ records: validRecords, evaluationDate, baselineDates });
    const quantityAlerts = generateQuantityAlerts({ records: validRecords, evaluationDate, baselineDates });
    
    const driverCandidates = [...resourceAlerts, ...newResourceAlerts];
    
    annotateDrivers(serviceAlerts, driverCandidates, (h, l) => 
        h.subscriptionId === l.subscriptionId && 
        String(h.service || '').toLowerCase() === String(l.service || '').toLowerCase()
    );
    annotateDrivers(subscriptionAlerts, driverCandidates, (h, l) => h.subscriptionId === l.subscriptionId);
    annotateDrivers(subscriptionAlerts, serviceAlerts, (h, l) => h.subscriptionId === l.subscriptionId);
    
    const allAlerts = [
        ...subscriptionAlerts,
        ...serviceAlerts,
        ...resourceAlerts,
        ...newResourceAlerts,
        ...quantityAlerts
    ];
    
    const severityMap: Record<AlertSeverity, number> = { 'CRITICAL': 4, 'HIGH': 3, 'WARNING': 2, 'INFO': 1 };
    
    allAlerts.sort((a, b) => {
        if (severityMap[a.severity] !== severityMap[b.severity]) return severityMap[b.severity] - severityMap[a.severity];
        const aInc = a.percentIncrease ?? 0;
        const bInc = b.percentIncrease ?? 0;
        if (bInc !== aInc) return bInc - aInc;
        return b.absoluteIncrease - a.absoluteIncrease;
    });
    
    logger.info(`Generated ${allAlerts.length} total alerts.`);
    
    return {
        generatedAt: new Date().toISOString(),
        evaluationDate,
        baselineDates,
        configuration: ALERT_CONFIG,
        summary: {
            total: allAlerts.length,
            subscriptionCostSpikes: subscriptionAlerts.length,
            serviceCostSpikes: serviceAlerts.length,
            resourceCostSpikes: resourceAlerts.length,
            newExpensiveResources: newResourceAlerts.length,
            quantitySpikes: quantityAlerts.length
        },
        alerts: allAlerts
    };
}
