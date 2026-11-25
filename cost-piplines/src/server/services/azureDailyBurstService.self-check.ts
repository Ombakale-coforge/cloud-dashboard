import assert from 'node:assert/strict';
import {
  buildDailyBurstEmailContent,
  detectDailyBursts,
  getPreviousMonthInfo,
  resolveBurstRecipients,
  type ServiceUsageRow,
} from './azureDailyBurstService.ts';
import type { StoredAccountBudget } from './accountBudgetService.ts';

const EVAL_DATE = '2026-11-21';
const PREV_MONTH = '2026-10'; // 31 days

// 0. Previous month rollover & day count
{
  assert.deepEqual(getPreviousMonthInfo('2026-11-21'), { previousMonth: '2026-10', daysInPreviousMonth: 31 });
  assert.deepEqual(getPreviousMonthInfo('2026-01-05'), { previousMonth: '2025-12', daysInPreviousMonth: 31 });
  assert.deepEqual(getPreviousMonthInfo('2026-03-02'), { previousMonth: '2026-02', daysInPreviousMonth: 28 });
}

// 1. Exact 10% of previous month boundary & minimum cost floor filtering
{
  const prevMonthRows: ServiceUsageRow[] = [
    // Sub A: Prev month = 300,000 INR (VM 248,000 -> 8,000/day avg; Storage 52,000 -> ~1,677.42/day avg)
    { subscriptionId: 'sub-a', subscriptionName: 'Prod Core', service: 'Virtual Machines', cost: 248000, billingCurrency: 'INR' },
    { subscriptionId: 'sub-a', subscriptionName: 'Prod Core', service: 'Storage', cost: 52000, billingCurrency: 'INR' },

    // Sub B: Prev month = 300,000 INR; eval day = 29,900 (9.97%) -> should NOT trigger
    { subscriptionId: 'sub-b', subscriptionName: 'Staging', service: 'SQL Database', cost: 300000, billingCurrency: 'INR' },

    // Sub C: Prev month = 1,000 INR; eval day = 150 (15%) -> should NOT trigger (below 500 INR floor)
    { subscriptionId: 'sub-c', subscriptionName: 'Tiny Sandbox', service: 'Storage', cost: 1000, billingCurrency: 'INR' },

    // Sub E (USD): Prev month = $100 USD; eval day = $15 (15%) -> SHOULD trigger (>=10% and >=$10 floor)
    { subscriptionId: 'sub-e', subscriptionName: 'US Prod', service: 'Cosmos DB', cost: 100, billingCurrency: 'USD' },
  ];

  const dayRows: ServiceUsageRow[] = [
    // Sub A: Eval day = 30,000 INR (exact 10.0% of 300,000) -> SHOULD trigger
    // Storage jumped from ~1,677/day to 20,000 (+18,322.58); VM jumped from 8,000/day to 10,000 (+2,000)
    { subscriptionId: 'sub-a', subscriptionName: 'Prod Core', service: 'Virtual Machines', cost: 10000, billingCurrency: 'INR' },
    { subscriptionId: 'sub-a', subscriptionName: 'Prod Core', service: 'Storage', cost: 20000, billingCurrency: 'INR' },

    // Sub B: 29,900 INR (9.97%)
    { subscriptionId: 'sub-b', subscriptionName: 'Staging', service: 'SQL Database', cost: 29900, billingCurrency: 'INR' },

    // Sub C: 150 INR (15%, below 500 floor)
    { subscriptionId: 'sub-c', subscriptionName: 'Tiny Sandbox', service: 'Storage', cost: 150, billingCurrency: 'INR' },

    // Sub D: 0 previous month -> should NOT trigger (no baseline)
    { subscriptionId: 'sub-d', subscriptionName: 'Brand New Sub', service: 'AKS', cost: 15000, billingCurrency: 'INR' },

    // Sub E (USD): $15 (15% of $100, >= $10 floor)
    { subscriptionId: 'sub-e', subscriptionName: 'US Prod', service: 'Cosmos DB', cost: 15, billingCurrency: 'USD' },
  ];

  const { subscriptionsEvaluated, bursts } = detectDailyBursts(dayRows, prevMonthRows, {
    evaluationDate: EVAL_DATE,
    previousMonth: PREV_MONTH,
    daysInPreviousMonth: 31,
    thresholdPercent: 10,
    minCostFloorInr: 500,
    minCostFloorUsd: 10,
  });

  assert.equal(subscriptionsEvaluated, 5, 'Should count all 5 subscriptions');
  assert.equal(bursts.length, 2, 'Only Sub A and Sub E should trigger');

  assert.equal(bursts[0].subscriptionId, 'sub-a');
  assert.equal(bursts[0].percentOfPrevMonth, 10);
  assert.equal(bursts[0].currentDayCost, 30000);
  assert.equal(bursts[0].previousMonthCost, 300000);
  assert.equal(bursts[0].thresholdAmount, 30000);
  assert.equal(bursts[0].topDrivers[0].service, 'Storage');
  assert.equal(bursts[0].topDrivers[1].service, 'Virtual Machines');

  assert.equal(bursts[1].subscriptionId, 'sub-e');
  assert.equal(bursts[1].billingCurrency, 'USD');
  assert.equal(bursts[1].percentOfPrevMonth, 15);
}

// 2. Owner resolution & fallback email routing
{
  const budgets: StoredAccountBudget[] = [
    {
      id: 1,
      cloudProvider: 'azure',
      accountId: '/subscriptions/SUB-A',
      accountName: 'Prod Core',
      parentAccountId: null,
      monthlyBudget: 100000,
      billingCurrency: 'INR',
      alertEmail: 'owner1@company.com, owner2@company.com',
      alertEmails: ['owner1@company.com', 'owner2@company.com'],
      contactName: 'Alice',
      isActive: true,
      lastNotifiedThreshold: null,
      lastNotifiedMonth: null,
      lastNotifiedAt: null,
      lastManualEmailAt: null,
      createdAt: '',
      updatedAt: '',
    },
  ];

  const mapped = resolveBurstRecipients('sub-a', 'Prod Core', budgets, ['fallback@company.com']);
  assert.equal(mapped.usedFallback, false);
  assert.deepEqual(mapped.recipients, ['owner1@company.com', 'owner2@company.com']);
  assert.equal(mapped.contactName, 'Alice');

  const unmapped = resolveBurstRecipients('sub-unknown', 'Mystery Sub', budgets, ['fallback@company.com']);
  assert.equal(unmapped.usedFallback, true);
  assert.deepEqual(unmapped.recipients, ['fallback@company.com']);
}

// 3. Email rendering sanity check
{
  const { bursts } = detectDailyBursts(
    [{ subscriptionId: 'sub-x', subscriptionName: 'AI Lab', service: 'OpenAI', cost: 25000, billingCurrency: 'INR' }],
    [{ subscriptionId: 'sub-x', subscriptionName: 'AI Lab', service: 'OpenAI', cost: 100000, billingCurrency: 'INR' }],
    { evaluationDate: EVAL_DATE, previousMonth: PREV_MONTH, daysInPreviousMonth: 31 }
  );
  const { subject, html, text } = buildDailyBurstEmailContent(bursts[0], {
    recipients: ['fallback@company.com'],
    contactName: null,
    usedFallback: true,
  });
  assert.ok(subject.includes('AI Lab') && subject.includes('25.0%') && subject.includes(PREV_MONTH));
  assert.ok(subject.includes('$') && !subject.includes('₹'), 'Burst email subject must render USD without ₹');
  assert.ok(html.includes('Fallback Routing') && html.includes('OpenAI') && html.includes('Share of Prev Month'));
  assert.ok(html.includes('$') && !html.includes('₹'), 'Burst email HTML must render USD without ₹');
  assert.ok(text.includes('OpenAI') && text.includes('25.0% of 2026-10'));
  assert.ok(text.includes('$') && !text.includes('₹'), 'Burst email text must render USD without ₹');
}

console.log('✅ azureDailyBurstService self-check passed all assertions.');
