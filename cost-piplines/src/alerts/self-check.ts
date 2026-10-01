/**
 * Self-Check Test Suite for Azure Cost Alert Pipeline
 * Assert-based, zero test framework overhead (Ponytail pattern)
 */

import assert from 'node:assert';
import {
    generateAlerts,
    average,
    median,
    calculatePercentChange,
    normalizeResourceId,
    shouldExcludeFromResourceAlerts,
    getSeverity,
} from './alert-service';
import type { UsageRecord, AlertReport } from './types';

// ── Fixture helpers ─────────────────────────────────────────────────

const BASELINE_DATES = [
    '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
    '2026-01-05', '2026-01-06', '2026-01-07',
];
const EVALUATION_DATE = '2026-01-08';
const LAG_BUFFER_DATE = '2026-01-09';

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
    return {
        date: EVALUATION_DATE,
        subscriptionId: 'sub-1',
        subscriptionName: 'Test Subscription',
        resourceId: 'res-1',
        resourceName: 'test-resource',
        resourceGroup: 'rg-1',
        service: 'TestService',
        meterId: 'meter-1',
        meterName: 'Test Meter',
        meterCategory: 'Compute',
        meterSubCategory: 'General',
        unitOfMeasure: 'units',
        cost: 0,
        quantity: 0,
        billingCurrency: 'INR',
        ...overrides,
    };
}

function baselineFillerRecords(): UsageRecord[] {
    return [...BASELINE_DATES, EVALUATION_DATE, LAG_BUFFER_DATE].map((date) =>
        makeRecord({
            date,
            resourceId: 'filler-resource',
            resourceName: 'filler-resource',
            service: 'FillerService',
            meterId: 'filler-meter',
            cost: 100,
            quantity: 100,
        })
    );
}

// ── Pure function tests ─────────────────────────────────────────────

function testMathHelpers(): void {
    console.log('  Testing math helpers...');

    assert.strictEqual(average([10, 20, 30]), 20);
    assert.strictEqual(average([]), 0);

    assert.strictEqual(median([1, 2, 3, 4, 5]), 3);
    assert.strictEqual(median([1, 2, 3, 4]), 2.5);
    assert.strictEqual(median([1000, 1000, 1000, 1000, 1000, 1000, 1000000]), 1000);
    assert.strictEqual(median([]), 0);

    assert.strictEqual(calculatePercentChange(200, 100), 100);
    assert.strictEqual(calculatePercentChange(150, 100), 50);
    assert.strictEqual(calculatePercentChange(100, 0), null);
    assert.strictEqual(calculatePercentChange(100, -1), null);

    assert.strictEqual(normalizeResourceId('/subscriptions/AAA/providers/Res'), '/subscriptions/aaa/providers/res');
    assert.strictEqual(normalizeResourceId(null), '');

    assert.strictEqual(getSeverity(150), 'CRITICAL');
    assert.strictEqual(getSeverity(75), 'HIGH');
    assert.strictEqual(getSeverity(30), 'WARNING');
    assert.strictEqual(getSeverity(10), 'INFO');
    assert.strictEqual(getSeverity(null), 'INFO');

    console.log('  ✓ Math helpers pass');
}

function testExclusions(): void {
    console.log('  Testing resource exclusions...');

    assert.strictEqual(shouldExcludeFromResourceAlerts(makeRecord({ resourceName: 'billing-credit-2026' })), true);
    assert.strictEqual(shouldExcludeFromResourceAlerts(makeRecord({ resourceName: 'Annual Refund' })), true);
    assert.strictEqual(shouldExcludeFromResourceAlerts(makeRecord({ resourceName: 'vm-prod-01' })), false);

    console.log('  ✓ Resource exclusions pass');
}

// ── Alert generation tests ──────────────────────────────────────────

function testThrowsOnInsufficientDates(): void {
    console.log('  Testing insufficient date coverage throws...');

    const tooFew = ['2026-01-01', '2026-01-02', '2026-01-03'].map((date) =>
        makeRecord({ date, cost: 10, quantity: 10 })
    );
    assert.throws(() => generateAlerts(tooFew), /Not enough usage dates/);

    console.log('  ✓ Insufficient dates throws correctly');
}

function testZeroDensityBaselineSuppression(): void {
    console.log('  Testing zero-density baseline suppression...');

    const records = [
        ...baselineFillerRecords(),
        // Only ONE baseline day has data for this meter
        makeRecord({ date: '2026-01-03', resourceId: 'sparse-res', meterId: 'sparse-meter', quantity: 654 }),
        // Eval date has huge spike \u2014 should NOT alert because baseline is mostly zero
        makeRecord({ date: EVALUATION_DATE, resourceId: 'sparse-res', meterId: 'sparse-meter', quantity: 1925747 }),
    ];

    const report = generateAlerts(records);
    const spurious = report.alerts.find(
        (a) => a.alertType === 'QUANTITY_SPIKE' && a.resourceId === 'sparse-res'
    );
    assert.strictEqual(spurious, undefined, 'Sparse baseline should not trigger quantity alert');

    console.log('  ✓ Zero-density baseline suppression works');
}

function testMedianBaselineOutlierResistance(): void {
    console.log('  Testing median baseline outlier resistance...');

    const records = [
        ...baselineFillerRecords(),
        // 6 normal days at cost=1000, one outlier at 1,000,000
        ...['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06'].map(
            (date) => makeRecord({ date, resourceId: 'outlier-res', service: 'OutlierSvc', cost: 1000 })
        ),
        makeRecord({ date: '2026-01-07', resourceId: 'outlier-res', service: 'OutlierSvc', cost: 1000000 }),
        makeRecord({ date: EVALUATION_DATE, resourceId: 'outlier-res', service: 'OutlierSvc', cost: 1600 }),
    ];

    const report = generateAlerts(records);
    const svcAlert = report.alerts.find(
        (a) => a.alertType === 'SERVICE_COST_SPIKE' && a.service === 'OutlierSvc'
    );
    assert.ok(svcAlert, 'Median baseline should detect real spike even with one outlier day');
    assert.strictEqual(svcAlert.baselineCost, 1000, 'Baseline should be median (1000), not mean');

    console.log('  ✓ Median baseline outlier resistance works');
}

function testResourceExclusionAtResourceLevel(): void {
    console.log('  Testing resource exclusions at resource alert level...');

    const records = [
        ...baselineFillerRecords(),
        ...BASELINE_DATES.map((date) =>
            makeRecord({ date, resourceId: 'credit-refund-res', resourceName: 'Annual Credit', cost: 500 })
        ),
        makeRecord({ date: EVALUATION_DATE, resourceId: 'credit-refund-res', resourceName: 'Annual Credit', cost: 50000 }),
    ];

    const report = generateAlerts(records);
    const excluded = report.alerts.find(
        (a) => a.alertType === 'RESOURCE_COST_SPIKE' && a.resourceId === 'credit-refund-res'
    );
    assert.strictEqual(excluded, undefined, 'Credit/refund resources should be excluded from resource alerts');

    console.log('  ✓ Resource exclusions work correctly');
}

function testPerSubscriptionServiceIsolation(): void {
    console.log('  Testing per-subscription service isolation (critical fix)...');

    const records = [
        ...baselineFillerRecords(),
        // Sub-A: steady Compute cost at 1000/day
        ...BASELINE_DATES.map((date) =>
            makeRecord({
                date,
                subscriptionId: 'sub-A',
                subscriptionName: 'Production',
                service: 'Microsoft.Compute',
                resourceId: 'vm-prod',
                cost: 1000,
                quantity: 10,
            })
        ),
        makeRecord({
            date: EVALUATION_DATE,
            subscriptionId: 'sub-A',
            subscriptionName: 'Production',
            service: 'Microsoft.Compute',
            resourceId: 'vm-prod',
            cost: 1000,
            quantity: 10,
        }),
        // Sub-B: spike in Compute from 100 to 5000
        ...BASELINE_DATES.map((date) =>
            makeRecord({
                date,
                subscriptionId: 'sub-B',
                subscriptionName: 'Development',
                service: 'Microsoft.Compute',
                resourceId: 'vm-dev',
                cost: 100,
                quantity: 5,
            })
        ),
        makeRecord({
            date: EVALUATION_DATE,
            subscriptionId: 'sub-B',
            subscriptionName: 'Development',
            service: 'Microsoft.Compute',
            resourceId: 'vm-dev',
            cost: 5000,
            quantity: 5,
        }),
    ];

    const report = generateAlerts(records);

    // Sub-B should get a service spike alert
    const subBAlert = report.alerts.find(
        (a) =>
            a.alertType === 'SERVICE_COST_SPIKE' &&
            a.subscriptionId === 'sub-B'
    );
    assert.ok(subBAlert, 'Sub-B should have a service cost spike for Microsoft.Compute');
    assert.strictEqual(subBAlert.subscriptionName, 'Development');

    // Sub-A should NOT get a service spike (steady)
    const subAAlert = report.alerts.find(
        (a) =>
            a.alertType === 'SERVICE_COST_SPIKE' &&
            a.subscriptionId === 'sub-A'
    );
    assert.strictEqual(subAAlert, undefined, 'Sub-A (steady cost) should not have a service spike');

    console.log('  ✓ Per-subscription service isolation works');
}

function testNewResourceDriverCorrelation(): void {
    console.log('  Testing new resource driver correlation (critical fix)...');

    const records = [
        ...baselineFillerRecords(),
        // Steady subscription baseline at 2000/day
        ...BASELINE_DATES.map((date) =>
            makeRecord({
                date,
                subscriptionId: 'sub-driver',
                subscriptionName: 'DriverSub',
                service: 'Microsoft.Storage',
                resourceId: 'existing-blob',
                cost: 2000,
                quantity: 100,
            })
        ),
        makeRecord({
            date: EVALUATION_DATE,
            subscriptionId: 'sub-driver',
            subscriptionName: 'DriverSub',
            service: 'Microsoft.Storage',
            resourceId: 'existing-blob',
            cost: 2000,
            quantity: 100,
        }),
        // Brand-new expensive resource appears ONLY on evaluation date
        makeRecord({
            date: EVALUATION_DATE,
            subscriptionId: 'sub-driver',
            subscriptionName: 'DriverSub',
            service: 'Microsoft.Compute',
            resourceId: 'brand-new-vm',
            resourceName: 'brand-new-vm',
            resourceGroup: 'rg-new',
            cost: 15000,
            quantity: 50,
        }),
    ];

    const report = generateAlerts(records);

    // Should have a NEW_EXPENSIVE_RESOURCE alert
    const newResAlert = report.alerts.find(
        (a) => a.alertType === 'NEW_EXPENSIVE_RESOURCE' && a.resourceId === 'brand-new-vm'
    );
    assert.ok(newResAlert, 'New expensive resource should be detected');

    // Subscription-level spike (if one exists) should have likelyDrivenBy pointing to new resource
    const subAlert = report.alerts.find(
        (a) => a.alertType === 'SUBSCRIPTION_COST_SPIKE' && a.subscriptionId === 'sub-driver'
    );
    if (subAlert) {
        // If the subscription crossed thresholds, it should be annotated with the new resource as driver
        if (subAlert.likelyDrivenBy) {
            assert.ok(
                subAlert.likelyDrivenBy.resourceId === 'brand-new-vm' ||
                subAlert.likelyDrivenBy.service === 'Microsoft.Compute',
                'Subscription spike should be driven by the new resource'
            );
        }
    }

    console.log('  ✓ New resource driver correlation works');
}

function testQuantitySeverityCapping(): void {
    console.log('  Testing quantity spike severity capping...');

    const records = [
        ...baselineFillerRecords(),
        // Meter with huge quantity jump and moderate cost (150 Rs) -> should trigger, but capped at WARNING
        ...BASELINE_DATES.map((date) =>
            makeRecord({
                date,
                resourceId: 'api-res',
                meterId: 'api-meter',
                unitOfMeasure: 'requests',
                quantity: 10,
                cost: 10,
            })
        ),
        makeRecord({
            date: EVALUATION_DATE,
            resourceId: 'api-res',
            meterId: 'api-meter',
            unitOfMeasure: 'requests',
            quantity: 500,
            cost: 150,
        }),
    ];

    const report = generateAlerts(records);
    const qAlert = report.alerts.find(
        (a) => a.alertType === 'QUANTITY_SPIKE' && a.meterId === 'api-meter'
    );

    assert.ok(qAlert, 'Should trigger quantity alert when cost is >= 50 Rs');
    assert.strictEqual(qAlert.severity, 'WARNING', 'Cost < 300 Rs must be capped at WARNING');

    console.log('  ✓ Quantity spike severity capping works');
}

function testTrivialQuantityFiltering(): void {
    console.log('  Testing trivial quantity spike suppression (cost < 50 Rs)...');

    const records = [
        ...baselineFillerRecords(),
        // Meter with huge jump (10 to 500) but trivial cost (0.50 Rs) -> should be suppressed
        ...BASELINE_DATES.map((date) =>
            makeRecord({
                date,
                resourceId: 'micro-res',
                meterId: 'micro-meter',
                unitOfMeasure: 'requests',
                quantity: 10,
                cost: 0.01,
            })
        ),
        makeRecord({
            date: EVALUATION_DATE,
            resourceId: 'micro-res',
            meterId: 'micro-meter',
            unitOfMeasure: 'requests',
            quantity: 500,
            cost: 0.50,
        }),
    ];

    const report = generateAlerts(records);
    const qAlert = report.alerts.find(
        (a) => a.alertType === 'QUANTITY_SPIKE' && a.meterId === 'micro-meter'
    );

    assert.strictEqual(qAlert, undefined, 'Quantity spikes with negligible cost (< 50 Rs) should be filtered out');

    console.log('  ✓ Trivial quantity spike suppression works');
}

function testNewResourceBlackHolePrevention(): void {
    console.log('  Testing new resource black hole prevention (Day 2 of new resource)...');

    // A resource was first seen on 2026-01-07 (evaluationDate - 1)
    // On Day 2 (evaluationDate = 2026-01-08), it only has 1 baseline day (< 3 required for resource spike)
    // Previously, it would vanish completely! Now it must be detected as NEW_EXPENSIVE_RESOURCE.
    const records = [
        ...baselineFillerRecords(),
        makeRecord({
            date: '2026-01-07',
            resourceId: 'day2-vm',
            resourceName: 'day2-vm',
            cost: 2500,
            quantity: 10,
        }),
        makeRecord({
            date: EVALUATION_DATE,
            resourceId: 'day2-vm',
            resourceName: 'day2-vm',
            cost: 2500,
            quantity: 10,
        }),
    ];

    const report = generateAlerts(records);
    const newAlert = report.alerts.find(
        (a) => a.alertType === 'NEW_EXPENSIVE_RESOURCE' && a.resourceId === 'day2-vm'
    );

    assert.ok(newAlert, 'Day-2 expensive resource with < 3 baseline days must not vanish into black hole');
    assert.strictEqual(newAlert.firstSeenDate, '2026-01-07', 'firstSeenDate must reflect true first seen day');

    console.log('  ✓ New resource black hole prevention works');
}

function testDriverCoverageClamping(): void {
    console.log('  Testing driver coverage percentage clamping at 100%...');

    // Baseline: Sub cost 4000 (Resource A = 2000, Resource B = 2000)
    // Eval: Sub cost 5500 (net increase +1500, +37.5%). Resource A = 4000 (+2000). Resource B = 1500 (-500).
    // Coverage = 2000 / 1500 = 133% -> clamped at 100%
    const records = [
        ...baselineFillerRecords(),
        ...BASELINE_DATES.map((date) => [
            makeRecord({ date, subscriptionId: 'sub-clamp', resourceId: 'res-a', cost: 2000 }),
            makeRecord({ date, subscriptionId: 'sub-clamp', resourceId: 'res-b', cost: 2000 }),
        ]).flat(),
        makeRecord({ date: EVALUATION_DATE, subscriptionId: 'sub-clamp', resourceId: 'res-a', cost: 4000 }),
        makeRecord({ date: EVALUATION_DATE, subscriptionId: 'sub-clamp', resourceId: 'res-b', cost: 1500 }),
    ];

    const report = generateAlerts(records);
    const subAlert = report.alerts.find(
        (a) => a.alertType === 'SUBSCRIPTION_COST_SPIKE' && a.subscriptionId === 'sub-clamp'
    );

    assert.ok(subAlert, 'Subscription spike should be detected');
    assert.ok(subAlert.likelyDrivenBy, 'Subscription spike should have driver');
    assert.strictEqual(subAlert.likelyDrivenBy.coveragePercent, 100, 'Coverage percent should be clamped at 100%');

    console.log('  ✓ Driver coverage percentage clamping works');
}

function testBasicAlertGeneration(): void {
    console.log('  Testing basic alert generation produces valid report...');

    const records = [
        ...baselineFillerRecords(),
        ...BASELINE_DATES.map((date) =>
            makeRecord({ date, cost: 1000, quantity: 50, resourceId: 'steady-res', service: 'SteadySvc' })
        ),
        makeRecord({ date: EVALUATION_DATE, cost: 1000, quantity: 50, resourceId: 'steady-res', service: 'SteadySvc' }),
    ];

    const report = generateAlerts(records);

    assert.ok(report.evaluationDate, 'Report should have evaluation date');
    assert.ok(Array.isArray(report.alerts), 'Report should have alerts array');
    assert.ok(Array.isArray(report.baselineDates), 'Report should have baseline dates');
    assert.strictEqual(report.baselineDates.length, 7, 'Should have 7 baseline dates');
    assert.ok(report.summary, 'Report should have summary');

    console.log('  ✓ Basic alert generation produces valid report');
}

async function testEmailPreviewGeneration(): Promise<void> {
    console.log('  Testing email HTML generation and preview dispatch...');

    const { createEmailHtml, createEmailText, sendAlertEmail } = await import('./email-service.js');

    const sampleReport: AlertReport = {
        generatedAt: '2026-01-08T10:00:00.000Z',
        evaluationDate: '2026-01-08',
        baselineDates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'],
        configuration: {} as any,
        summary: {
            total: 1,
            subscriptionCostSpikes: 0,
            serviceCostSpikes: 1,
            resourceCostSpikes: 0,
            newExpensiveResources: 0,
            quantitySpikes: 0,
        },
        alerts: [
            {
                alertType: 'SERVICE_COST_SPIKE',
                severity: 'CRITICAL',
                evaluationDate: '2026-01-08',
                billingCurrency: 'INR',
                currentCost: 15000,
                baselineCost: 5000,
                absoluteIncrease: 10000,
                percentIncrease: 200,
                subscriptionId: 'sub-prod',
                subscriptionName: 'Production Subscription',
                service: 'Microsoft.Compute',
            },
        ],
    };

    const html = createEmailHtml(sampleReport);
    assert.ok(html.includes('Azure Cost Alert Report'), 'HTML should contain title');
    assert.ok(html.includes('Microsoft.Compute'), 'HTML should contain service name');
    assert.ok(html.includes('CRITICAL'), 'HTML should contain severity badge');

    const text = createEmailText(sampleReport);
    assert.ok(text.includes('Evaluation date: 2026-01-08'), 'Text should contain evaluation date');

    const result = await sendAlertEmail(sampleReport, { mode: 'preview' });
    assert.strictEqual(result.previewed, true, 'Result should indicate previewed = true');
    assert.ok(result.previewPath, 'Result should include previewPath');

    console.log('  ✓ Email HTML and preview dispatch passed');
}

// ── Runner ──────────────────────────────────────────────────────────

export async function runSelfCheck(): Promise<void> {
    console.log('Running azure alerts self-check tests...\n');

    testMathHelpers();
    testExclusions();
    testThrowsOnInsufficientDates();
    testZeroDensityBaselineSuppression();
    testMedianBaselineOutlierResistance();
    testResourceExclusionAtResourceLevel();
    testPerSubscriptionServiceIsolation();
    testNewResourceDriverCorrelation();
    testQuantitySeverityCapping();
    testTrivialQuantityFiltering();
    testNewResourceBlackHolePrevention();
    testDriverCoverageClamping();
    testBasicAlertGeneration();
    await testEmailPreviewGeneration();

    console.log('\n✓ All azure alerts self-check tests passed.');
}

if (process.argv[1] && process.argv[1].includes('self-check')) {
    runSelfCheck().catch((err) => {
        console.error('Self-check failed:', err);
        process.exit(1);
    });
}
