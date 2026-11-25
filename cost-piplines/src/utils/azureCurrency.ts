export const DEFAULT_AZURE_USD_TO_INR_RATE = 84;

/**
 * Returns the configured INR-per-USD conversion rate for Azure display conversion.
 * Falls back to 84 if AZURE_USD_TO_INR_RATE is unset or invalid.
 */
export function getAzureUsdToInrRate(): number {
  const parsed = Number(process.env.AZURE_USD_TO_INR_RATE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AZURE_USD_TO_INR_RATE;
}

/**
 * Rounds a number to 2 decimal places safely.
 */
export function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/**
 * Converts an Azure amount to USD. Passes 'USD' values through unchanged to avoid double conversion.
 */
export function convertAzureInrToUsd(
  amount: unknown,
  sourceCurrency?: string | null,
  rate = getAzureUsdToInrRate()
): number {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  if (String(sourceCurrency || 'INR').trim().toUpperCase() === 'USD') {
    return num;
  }
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_AZURE_USD_TO_INR_RATE;
  return num / safeRate;
}

/**
 * Converts an Azure amount to USD (if INR) and formats it in en-US USD currency.
 */
export function formatAzureUsd(
  amount: unknown,
  sourceCurrency?: string | null,
  rate = getAzureUsdToInrRate()
): string {
  const usd = convertAzureInrToUsd(amount, sourceCurrency, rate);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}
