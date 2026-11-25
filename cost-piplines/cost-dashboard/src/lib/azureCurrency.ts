const rawRate = Number(import.meta.env.VITE_AZURE_USD_TO_INR_RATE);

export const AZURE_USD_TO_INR_RATE =
  Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 84;

/**
 * Converts an Azure amount from INR to USD at display time.
 * Passes 'USD' values through unchanged to guarantee zero double-conversion.
 */
export function azureInrToUsd(
  amount: unknown,
  sourceCurrency?: string | null
): number {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  if (String(sourceCurrency || "INR").trim().toUpperCase() === "USD") {
    return num;
  }
  return num / AZURE_USD_TO_INR_RATE;
}

/**
 * Converts a USD input amount back to INR (e.g. for backend INR comparisons).
 */
export function azureUsdToInr(amount: unknown): number {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  return num * AZURE_USD_TO_INR_RATE;
}

/**
 * Formats an already-USD amount in en-US currency without dividing again.
 */
export function formatUsd(
  amount: unknown,
  options?: Intl.NumberFormatOptions
): string {
  const num = Number(amount ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  const maxFrac =
    options?.maximumFractionDigits ??
    Math.max(2, options?.minimumFractionDigits ?? 2);
  const minFrac = Math.min(options?.minimumFractionDigits ?? 2, maxFrac);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...options,
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  }).format(safe);
}

/**
 * Formats an already-USD amount compactly ($1.2M, $12.3K, $123).
 */
export function formatUsdCompact(amount: unknown): string {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return "$0";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Converts an Azure amount (if INR) to USD and formats it as en-US currency.
 */
export function formatAzureUsd(
  amount: unknown,
  sourceCurrency?: string | null,
  options?: Intl.NumberFormatOptions
): string {
  return formatUsd(azureInrToUsd(amount, sourceCurrency), options);
}

/**
 * Converts an Azure amount (if INR) to USD and formats it compactly ($M / $K / $).
 */
export function formatAzureUsdCompact(
  amount: unknown,
  sourceCurrency?: string | null
): string {
  return formatUsdCompact(azureInrToUsd(amount, sourceCurrency));
}
