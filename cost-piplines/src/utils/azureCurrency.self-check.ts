import assert from 'node:assert/strict';
import {
  DEFAULT_AZURE_USD_TO_INR_RATE,
  convertAzureInrToUsd,
  formatAzureUsd,
  getAzureUsdToInrRate,
  round2,
} from './azureCurrency.ts';

const originalEnv = process.env.AZURE_USD_TO_INR_RATE;

try {
  delete process.env.AZURE_USD_TO_INR_RATE;
  assert.equal(DEFAULT_AZURE_USD_TO_INR_RATE, 84);
  assert.equal(getAzureUsdToInrRate(), 84);

  assert.equal(convertAzureInrToUsd(8400, 'INR', 84), 100);
  assert.equal(convertAzureInrToUsd(100, 'USD', 84), 100);
  assert.equal(convertAzureInrToUsd(100, 'usd', 84), 100);
  assert.equal(convertAzureInrToUsd(8400, undefined, 84), 100);
  assert.equal(convertAzureInrToUsd(8400, null, 84), 100);
  assert.equal(convertAzureInrToUsd(Number.NaN, 'INR', 84), 0);
  assert.equal(convertAzureInrToUsd('not-a-number', 'INR', 84), 0);

  assert.equal(round2(12.345), 12.35);
  assert.equal(round2(Number.NaN), 0);
  assert.equal(formatAzureUsd(8400, 'INR', 84), '$100.00');
  assert.equal(formatAzureUsd(100, 'USD', 84), '$100.00');

  process.env.AZURE_USD_TO_INR_RATE = '90';
  assert.equal(getAzureUsdToInrRate(), 90);
  assert.equal(convertAzureInrToUsd(9000, 'INR'), 100);

  process.env.AZURE_USD_TO_INR_RATE = '-5';
  assert.equal(getAzureUsdToInrRate(), 84);

  process.env.AZURE_USD_TO_INR_RATE = 'invalid';
  assert.equal(getAzureUsdToInrRate(), 84);

  console.log('✓ All azureCurrency self-check assertions passed.');
} finally {
  if (originalEnv === undefined) {
    delete process.env.AZURE_USD_TO_INR_RATE;
  } else {
    process.env.AZURE_USD_TO_INR_RATE = originalEnv;
  }
}
