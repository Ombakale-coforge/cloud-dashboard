import type { BudgetOverviewRow } from "./types";

const COMMON_META_TOKENS = new Set([
  "csa",
  "dap",
  "gbl",
  "ind",
  "us",
  "uk",
  "eu",
  "apac",
  "bfs",
  "ins",
  "tvl",
  "oth",
  "hc",
  "hls",
  "prod",
  "prd",
  "dev",
  "uat",
  "poc",
  "np",
  "nonprod",
  "non",
  "test",
  "tst",
  "qa",
  "stg",
  "stage",
  "staging",
  "dr",
  "sandbox",
  "sbx",
  "aws",
  "account",
  "budget",
]);

export interface AccountSpendInfo {
  id: string;
  name: string;
  status?: string;
  currentSpend: number;
  previousSpend?: number;
  momChangePercent?: number;
  hasBudget?: boolean;
  topCostDriver?: string;
  latestSpend?: number;
}

function getTokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function getCoreWorkload(s: string): string {
  const tokens = getTokens(s);
  const coreTokens = tokens.filter((t) => !COMMON_META_TOKENS.has(t));
  if (coreTokens.length > 0) {
    return coreTokens.join("");
  }
  return tokens.join("");
}

export function matchBudgetToAccount(
  budgetName: string,
  budgetRecordedSpend: number,
  accounts: AccountSpendInfo[]
): AccountSpendInfo | undefined {
  if (!budgetName || !accounts || accounts.length === 0) return undefined;

  const normFull = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const bNorm = normFull(budgetName);
  const bTokens = getTokens(budgetName);
  const bSortedKey = [...bTokens].sort().join("|");
  const bCore = getCoreWorkload(budgetName);

  // 1. Direct normalized match or 12-digit Account ID match
  let matched = accounts.find((a) => {
    const aNorm = normFull(a.name);
    return (
      (a.id && bNorm.includes(a.id)) ||
      (aNorm.length > 0 && (aNorm === bNorm || aNorm.includes(bNorm) || bNorm.includes(aNorm)))
    );
  });
  if (matched) return matched;

  // 2. Exact same tokens in any order (e.g., "CSA-Backup-PROD" <-> "Backup-PROD-CSA")
  matched = accounts.find((a) => {
    const aTokens = getTokens(a.name);
    return aTokens.length > 0 && [...aTokens].sort().join("|") === bSortedKey;
  });
  if (matched) return matched;

  // 3. Core workload match (e.g. "CSA - MobileKotlin1-PoC" <-> "MobileKotlin1-PoC-CSA")
  if (bCore.length >= 3) {
    const candidates = accounts.filter((a) => {
      const aCore = getCoreWorkload(a.name);
      return (
        aCore.length >= 3 &&
        (aCore === bCore ||
          (aCore.length >= 4 && bCore.length >= 4 && (aCore.includes(bCore) || bCore.includes(aCore))))
      );
    });

    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      // Pick candidate with most shared tokens (like env/IBU)
      let best = candidates[0];
      let bestShared = -1;
      for (const c of candidates) {
        const cTokens = getTokens(c.name);
        const sharedCount = bTokens.filter((t) => cTokens.includes(t)).length;
        if (sharedCount > bestShared) {
          bestShared = sharedCount;
          best = c;
        }
      }
      return best;
    }
  }

  // 4. Token overlap score
  let bestScore = 0;
  let bestAcc: AccountSpendInfo | undefined;
  for (const a of accounts) {
    const aTokens = getTokens(a.name);
    if (aTokens.length === 0 || bTokens.length === 0) continue;
    const shared = bTokens.filter((t) => aTokens.includes(t));
    const sharedWeight = shared.reduce((sum, t) => sum + t.length, 0);
    const maxWeight = Math.max(
      bTokens.reduce((sum, t) => sum + t.length, 0),
      aTokens.reduce((sum, t) => sum + t.length, 0)
    );
    const score = maxWeight > 0 ? sharedWeight / maxWeight : 0;
    if (shared.length >= 2 && score > bestScore && score >= 0.55) {
      bestScore = score;
      bestAcc = a;
    }
  }
  if (bestAcc) return bestAcc;

  // 5. Fallback: exact recorded latest-month spend match if > 0
  if (budgetRecordedSpend > 0) {
    matched = accounts.find((a) => {
      const refSpend = a.latestSpend !== undefined ? a.latestSpend : a.currentSpend;
      return refSpend > 0 && Math.abs(refSpend - budgetRecordedSpend) < 0.05;
    });
    if (matched) return matched;
  }

  return undefined;
}

export function resolveBudgetsForMonth(
  budgets: BudgetOverviewRow[],
  accountsForMonth: AccountSpendInfo[],
  monthScaleRatio = 1,
  isLatestMonth = false
): BudgetOverviewRow[] {
  if (!budgets || budgets.length === 0) return [];

  const resolved = budgets.map((b) => {
    const budgetName = b["Budget Name"] || "";
    const limit = Number(b.Limit ?? b["Budget Limit"] ?? 0);
    const recordedUsed = Number(b["Current Used"] ?? b["Current Spend"] ?? 0);

    const matchedAcc = matchBudgetToAccount(budgetName, recordedUsed, accountsForMonth);

    let used = recordedUsed;
    if (matchedAcc) {
      used = matchedAcc.currentSpend;
    } else if (!isLatestMonth) {
      used = Number((recordedUsed * monthScaleRatio).toFixed(2));
    }

    used = Number(used.toFixed(2));
    const pct = limit > 0 ? Number(((used / limit) * 100).toFixed(1)) : 0;
    const isExceeded = pct >= 100;
    const thresholdStatus = isExceeded ? "Exceeded (1)" : pct >= 80 ? "Warning" : "OK";
    const healthStatus = isExceeded ? "Alert" : "Healthy";

    return {
      ...b,
      "Budget Name": budgetName,
      Limit: limit,
      "Budget Limit": limit,
      "Current Used": used,
      "Current Spend": used,
      "Current vs Budget %": pct,
      "Threshold Status": thresholdStatus,
      "Health Status": healthStatus,
    };
  });

  // Sort by Current Used descending (then Limit descending) so active spending budgets appear first
  resolved.sort((a, b) => {
    const usedDiff =
      Number(b["Current Used"] ?? b["Current Spend"] ?? 0) -
      Number(a["Current Used"] ?? a["Current Spend"] ?? 0);
    if (Math.abs(usedDiff) > 0.001) return usedDiff;
    return Number(b.Limit ?? b["Budget Limit"] ?? 0) - Number(a.Limit ?? a["Budget Limit"] ?? 0);
  });

  return resolved;
}
