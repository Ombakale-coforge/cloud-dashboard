import assert from 'node:assert';
import {
    getStableKeys,
    computeStableRowHash,
    computeChargeKeyHash,
    parseTags,
    normalizeRecord,
    fmtDate,
} from './transform';
import { FocusRawRecord } from './types';

export function runSelfCheck(): void {
    console.log('Running focus-export self-check tests...');

    const sampleRowA: FocusRawRecord = {
        ChargePeriodStart: '2026-08-15T00:00:00.000Z',
        ChargePeriodEnd: '2026-08-16T00:00:00.000Z',
        BilledCost: '12.345678',
        EffectiveCost: '12.000000',
        ResourceId: '/subscriptions/sub-123/resourceGroups/rg-test/providers/Microsoft.Compute/virtualMachines/vm-1',
        ResourceName: 'vm-1',
        SubAccountId: 'sub-123',
        ServiceName: 'Virtual Machines',
        SkuPriceId: 'sku-price-1',
        x_SkuMeterId: 'meter-guid-abc',
        ChargeCategory: 'Usage',
        PricingCategory: 'OnDemand',
        x_SkuDetails: 'batch-meta-version-1',
        Tags: '{"env":"prod","app":"billing"}',
    };

    const sampleRowB: FocusRawRecord = {
        ...sampleRowA,
        x_SkuDetails: 'batch-meta-version-2-different', // volatile field altered
    };

    const sampleRowC: FocusRawRecord = {
        ...sampleRowA,
        BilledCost: '99.990000', // cost altered
    };

    const stableKeys = getStableKeys(sampleRowA);

    // 1. Stable keys should exclude x_SkuDetails
    assert.strictEqual(stableKeys.includes('x_SkuDetails'), false, 'x_SkuDetails must be excluded from stable keys');

    // 2. Stable row hash should be IDENTICAL despite different x_SkuDetails
    const hashA = computeStableRowHash(sampleRowA, stableKeys);
    const hashB = computeStableRowHash(sampleRowB, stableKeys);
    assert.strictEqual(hashA, hashB, 'Stable row hash must match when only x_SkuDetails differs');

    // 3. Stable row hash should DIFFER when cost changes
    const hashC = computeStableRowHash(sampleRowC, stableKeys);
    assert.notStrictEqual(hashA, hashC, 'Stable row hash must differ when BilledCost changes');

    // 4. Charge key hash must MATCH even when cost changes
    const chargeKeyA = computeChargeKeyHash(sampleRowA);
    const chargeKeyC = computeChargeKeyHash(sampleRowC);
    assert.strictEqual(chargeKeyA, chargeKeyC, 'Charge key hash must match across revised amounts for the same charge');

    // 5. Tag parsing
    const jsonTags = parseTags('{"team":"devops"}');
    assert.strictEqual(jsonTags.tagsJson, '{"team":"devops"}');
    assert.strictEqual(jsonTags.tagsRaw, null);

    const semiTags = parseTags('costCenter:123;owner:alice');
    assert.strictEqual(semiTags.tagsJson, '{"costCenter":"123","owner":"alice"}');

    const emptyTags = parseTags('');
    assert.strictEqual(emptyTags.tagsJson, null);

    // 6. Normalization
    const norm = normalizeRecord(sampleRowA, stableKeys);
    assert.ok(norm.row, 'Normalized row must be produced');
    assert.strictEqual(fmtDate(norm.row!.usageDate), '2026-08-15');
    assert.strictEqual(norm.row!.subscriptionId, 'sub-123');
    assert.strictEqual(norm.row!.billedCost, '12.345678');
    assert.strictEqual(norm.row!.service, 'Virtual Machines');
    assert.strictEqual(norm.row!.isDuplicateOfEarlierRow, false);
    assert.strictEqual(norm.row!.isSupersededByLaterRow, false);

    // 7. Invalid row handling
    const invalidDate = normalizeRecord({ ...sampleRowA, ChargePeriodStart: 'invalid-date' }, stableKeys);
    assert.strictEqual(invalidDate.row, null);

    const invalidCost = normalizeRecord({ ...sampleRowA, BilledCost: 'not-a-number' }, stableKeys);
    assert.strictEqual(invalidCost.row, null);

    console.log('✓ All self-check assertions passed successfully.');
}

if (require.main === module || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('self-check.ts'))) {
    runSelfCheck();
}
