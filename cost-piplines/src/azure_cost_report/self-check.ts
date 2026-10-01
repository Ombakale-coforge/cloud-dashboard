/**
 * Self-Check Test Suite for Azure Cost Reporting Pipeline
 * Assert-based, zero test framework overhead (Ponytail pattern)
 */

import assert from 'node:assert';
import { normalizeTransaction } from './data-loader';
import { calculateReports, round, safeDivide } from './analytics';
import { computeInsertChunkSize, chunk } from './report-service';
import { UsageTransaction } from './types';

export function runSelfCheck(): void {
    console.log('Running azure_cost_report self-check tests...');

    // 1. Test normalizeTransaction
    const rawSample = {
        usageMonth: '2026-08',
        effectiveCost: '150.750000',
        billedCost: '160.000000',
        subscriptionName: null,
        subscriptionId: 'sub-guid-1234',
        resourceGroup: 'rg-prod',
        service: 'Virtual Machines',
        chargeType: 'Usage',
        meterName: 'Standard_D2s_v3',
        meterId: 'meter-guid-5678',
        meterCategory: 'Compute',
        region: 'eastus',
        pricingModel: 'OnDemand',
        resourceName: 'vm-app-01',
        isCreditEligible: true,
    };

    const tx = normalizeTransaction(rawSample);
    assert.strictEqual(tx.month, '2026-08');
    assert.strictEqual(tx.cost, 150.75);
    assert.strictEqual(tx.subscription, 'sub-guid-1234', 'Falls back to subscriptionId when name is null');
    assert.strictEqual(tx.creditEligible, 'Yes');
    assert.strictEqual(tx.consumedService, 'Virtual Machines');

    // 2. Test computeInsertChunkSize and chunking against SQL Server parameter limit
    const chunk3 = computeInsertChunkSize(3);
    assert.strictEqual(chunk3, 666, '3 columns should chunk at 666 rows (<= 2000 params)');

    const chunk9 = computeInsertChunkSize(9);
    assert.strictEqual(chunk9, 222, '9 columns should chunk at 222 rows (<= 2000 params)');

    const testArray = [1, 2, 3, 4, 5];
    const chunked = chunk(testArray, 2);
    assert.deepStrictEqual(chunked, [[1, 2], [3, 4], [5]]);

    // 3. Test mathematical helpers
    assert.strictEqual(round(10.556, 2), 10.56);
    assert.strictEqual(round(10.554, 2), 10.55);
    assert.strictEqual(safeDivide(10, 2), 5);
    assert.strictEqual(safeDivide(10, 0), 0);

    // 4. Test calculateReports with multi-month data
    const sampleTransactions: UsageTransaction[] = [
        // Month 1: 2026-06
        {
            month: '2026-06',
            cost: 100,
            subscription: 'Prod Sub',
            resourceGroup: 'rg-1',
            consumedService: 'Storage',
            chargeType: 'Usage',
            meter: 'Blob Storage',
            meterCategory: 'Storage',
            location: 'eastus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'blob01',
            creditEligible: 'Yes',
        },
        // Month 2: 2026-07
        {
            month: '2026-07',
            cost: 200,
            subscription: 'Prod Sub',
            resourceGroup: 'rg-1',
            consumedService: 'Storage',
            chargeType: 'Usage',
            meter: 'Blob Storage',
            meterCategory: 'Storage',
            location: 'eastus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'blob01',
            creditEligible: 'Yes',
        },
        {
            month: '2026-07',
            cost: 100,
            subscription: 'Dev Sub',
            resourceGroup: 'rg-2',
            consumedService: 'Compute',
            chargeType: 'Usage',
            meter: 'VM D2s',
            meterCategory: 'Compute',
            location: 'westus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'vm01',
            creditEligible: 'No',
        },
        // Month 3: 2026-08
        {
            month: '2026-08',
            cost: 300,
            subscription: 'Prod Sub',
            resourceGroup: 'rg-1',
            consumedService: 'Storage',
            chargeType: 'Usage',
            meter: 'Blob Storage',
            meterCategory: 'Storage',
            location: 'eastus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'blob01',
            creditEligible: 'Yes',
        },
        {
            month: '2026-08',
            cost: 150,
            subscription: 'Dev Sub',
            resourceGroup: 'rg-2',
            consumedService: 'Compute',
            chargeType: 'Usage',
            meter: 'VM D2s',
            meterCategory: 'Compute',
            location: 'westus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'vm01',
            creditEligible: 'No',
        },
        // Month 4: 2026-09 (High spike to trigger anomaly)
        {
            month: '2026-09',
            cost: 1000,
            subscription: 'Prod Sub',
            resourceGroup: 'rg-1',
            consumedService: 'Storage',
            chargeType: 'Usage',
            meter: 'Blob Storage',
            meterCategory: 'Storage',
            location: 'eastus',
            pricingModel: 'PayAsYouGo',
            resourceName: 'blob01',
            creditEligible: 'Yes',
        },
    ];

    const reports = calculateReports(sampleTransactions, {
        anomalyThresholdPercent: 15,
        anomalyRollingMonths: 3,
    });

    // Check all 17 datasets exist
    assert.strictEqual(reports.monthlyTotals.length, 4);
    assert.strictEqual(reports.monthlyTotals[0].month, '2026-06');
    assert.strictEqual(reports.monthlyTotals[0].totalCost, 100);

    assert.strictEqual(reports.kpisByMonth.length, 4);
    assert.strictEqual(reports.kpisByMonth[0].topSubscription, 'Prod Sub');

    assert.ok(reports.bySubscription.length > 0);
    assert.ok(reports.byResourceGroup.length > 0);
    assert.ok(reports.byService.length > 0);
    assert.ok(reports.byChargeType.length > 0);
    assert.ok(reports.byRegion.length > 0);
    assert.ok(reports.byPricingModel.length > 0);
    assert.ok(reports.creditEligibility.length > 0);
    assert.ok(reports.topMeters.length > 0);
    assert.ok(reports.topResources.length > 0);

    // MoM change check
    assert.strictEqual(reports.momChange[0].previousMonthCost, null);
    assert.strictEqual(reports.momChange[1].previousMonthCost, 100);
    assert.strictEqual(reports.momChange[1].momPercentChange, 200); // 100 to 300 = +200%

    // Pareto check
    assert.strictEqual(reports.costConcentrationPareto[0].rank, 1);
    assert.strictEqual(reports.costConcentrationPareto[reports.costConcentrationPareto.length - 1].cumulativePercent, 100);

    // Anomaly flags check (Month 4 rolling avg: (100+300+450)/3 = 283.33, cost: 1000 => Anomaly)
    assert.strictEqual(reports.anomalyFlags[3].isAnomaly, true, 'Month 4 cost (1000) should be flagged as anomaly');

    // New services check
    assert.strictEqual(reports.newServicesByMonth.length, 2, 'Storage in month 1, Compute in month 2');

    // Forecast check
    assert.strictEqual(reports.forecastNextMonth.length, 2);

    // Volatility check
    assert.strictEqual(reports.volatility.length, 2);

    console.log('✓ All 17 report calculations and assertions passed successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('self-check.ts')) {
    runSelfCheck();
}
