import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useCsv } from "@/lib/useCsv";
import { ManualBudgetAlertsSection } from "@/components/ManualBudgetAlertsSection";
import type {
  GovernanceSummary,
  UnbudgetedAccountRow,
  BudgetOverviewRow,
  MonthlyTotal,
} from "@/lib/types";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertCircle,
} from "lucide-react";

interface AccountSpendInfo {
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

interface OrganizationGovernanceSectionProps {
  selectedMonth: string;
  basePath?: string;
}

export function OrganizationGovernanceSection({
  selectedMonth,
  basePath = "/data",
}: OrganizationGovernanceSectionProps) {
  // 1. Fetch Summary JSON metadata (via API first, with fallback)
  const [summary, setSummary] = useState<GovernanceSummary | null>(null);
  const [accountsForMonth, setAccountsForMonth] = useState<AccountSpendInfo[]>([]);

  useEffect(() => {
    let active = true;
    let account = "account-1";
    const accountMatch = basePath.match(/accounts\/([^/]+)/);
    if (accountMatch) {
      account = accountMatch[1];
    }

    const monthParam = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : "";
    const apiUrl = `/api/aws/dataset/governance_summary?account=${encodeURIComponent(account)}${monthParam}`;

    fetch(apiUrl)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error(`API error ${res.status}`);
      })
      .then((data) => {
        if (!active) return;
        if (data) {
          const item = Array.isArray(data) ? data[0] : data;
          setSummary(item);
        }
      })
      .catch(() => {
        fetch(`${basePath}/governance_summary.json`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (active && data) setSummary(data);
          })
          .catch(() => {
            if (active) setSummary(null);
          });
      });

    // Fetch linked accounts spend for selectedMonth + latest month reference for budget matching
    Promise.all([
      fetch(`/api/aws/linked-accounts?account=${encodeURIComponent(account)}${monthParam}`).then((r) =>
        r.ok ? r.json() : null
      ),
      selectedMonth
        ? fetch(`/api/aws/linked-accounts?account=${encodeURIComponent(account)}`).then((r) =>
            r.ok ? r.json() : null
          )
        : Promise.resolve(null),
    ])
      .then(([monthRes, latestRes]) => {
        if (!active || !monthRes?.accounts) return;
        const refRes = latestRes?.accounts ? latestRes : monthRes;
        const latestMap = new Map<string, number>();
        for (const a of refRes.accounts || []) {
          latestMap.set(a.linkedAccountId, Number(a.currentSpend || 0));
        }
        const mapped: AccountSpendInfo[] = (monthRes.accounts || []).map((a: any) => ({
          id: String(a.linkedAccountId || ""),
          name: String(a.accountName || a.linkedAccountId || ""),
          status: a.status,
          currentSpend: Number(a.currentSpend || 0),
          previousSpend: Number(a.previousSpend || 0),
          momChangePercent: Number(a.momChangePercent || 0),
          hasBudget: Boolean(a.hasBudget),
          topCostDriver: String(a.topCostDriver || "Cloud Services"),
          latestSpend: latestMap.get(a.linkedAccountId) ?? Number(a.currentSpend || 0),
        }));
        setAccountsForMonth(mapped);
      })
      .catch(() => {
        if (active) setAccountsForMonth([]);
      });

    return () => {
      active = false;
    };
  }, [basePath, selectedMonth]);

  // 2. Fetch Unbudgeted Accounts CSV (dynamic for selectedMonth)
  const unbudgetedPath = selectedMonth
    ? `${basePath}/unbudgeted_accounts.csv?month=${encodeURIComponent(selectedMonth)}`
    : `${basePath}/unbudgeted_accounts.csv`;
  const { data: unbudgetedAccounts } = useCsv<UnbudgetedAccountRow>(unbudgetedPath);

  // 3. Fetch Budgets Overview CSV & Monthly Totals
  const budgetsPath = selectedMonth
    ? `${basePath}/budgets_overview.csv?month=${encodeURIComponent(selectedMonth)}`
    : `${basePath}/budgets_overview.csv`;
  const { data: rawBudgetsOverview } = useCsv<BudgetOverviewRow>(budgetsPath);

  // 4. Compute Top 5 Spends (Top 5 Linked Accounts by spend for selectedMonth)
  const top5Spends = useMemo(() => {
    const unbudgetedIds = new Set(
      (unbudgetedAccounts || []).map((u) => String(u["Account ID"] || ""))
    );
    const hasAnyBudgets = (rawBudgetsOverview || []).length > 0;

    const source: AccountSpendInfo[] =
      accountsForMonth.length > 0
        ? accountsForMonth
        : (unbudgetedAccounts || []).map((u) => ({
            id: String(u["Account ID"] || ""),
            name: String(u["Account Name"] || u["Account ID"] || ""),
            status: u.Status,
            currentSpend: Number(u["Current Month Spend"] || 0),
            previousSpend: Number(u["Previous Month Spend"] || 0),
            momChangePercent:
              typeof u["MoM Change %"] === "number"
                ? u["MoM Change %"]
                : parseFloat(String(u["MoM Change %"] || 0)),
            hasBudget: hasAnyBudgets ? !unbudgetedIds.has(String(u["Account ID"] || "")) : false,
            topCostDriver: u["Top Cost Driver"] || "AWS Services",
          }));

    const sorted = [...source]
      .filter((a) => a.currentSpend > 0)
      .sort((a, b) => b.currentSpend - a.currentSpend);

    return sorted.slice(0, 5);
  }, [accountsForMonth, unbudgetedAccounts, rawBudgetsOverview]);

  const totalOrgMonthSpend = useMemo(() => {
    if (summary && typeof summary.activeSpendTotal === "number" && summary.activeSpendTotal > 0) {
      return summary.activeSpendTotal;
    }
    if (accountsForMonth.length > 0) {
      return accountsForMonth.reduce((sum, a) => sum + a.currentSpend, 0);
    }
    return top5Spends.reduce((sum, a) => sum + a.currentSpend, 0);
  }, [summary, accountsForMonth, top5Spends]);

  const top5TotalSpend = useMemo(
    () => top5Spends.reduce((sum, a) => sum + a.currentSpend, 0),
    [top5Spends]
  );

  const top5SharePct = useMemo(
    () =>
      totalOrgMonthSpend > 0
        ? Math.min(100, Number(((top5TotalSpend / totalOrgMonthSpend) * 100).toFixed(1)))
        : 0,
    [top5TotalSpend, totalOrgMonthSpend]
  );

  // Search & Pagination for Unbudgeted Accounts
  const [searchUnbudgeted, setSearchUnbudgeted] = useState("");
  const [pageUnbudgeted, setPageUnbudgeted] = useState(1);
  const ITEMS_PER_PAGE = 6;

  // Filter Unbudgeted Accounts
  const filteredUnbudgeted = (unbudgetedAccounts || []).filter((a) => {
    if (!a || !a["Account Name"]) return false;
    const term = searchUnbudgeted.toLowerCase();
    return (
      a["Account Name"].toLowerCase().includes(term) ||
      (a["Account ID"] && String(a["Account ID"]).toLowerCase().includes(term)) ||
      (a["Top Cost Driver"] && String(a["Top Cost Driver"]).toLowerCase().includes(term))
    );
  });
  const totalPagesUnbudgeted = Math.max(1, Math.ceil(filteredUnbudgeted.length / ITEMS_PER_PAGE));
  const paginatedUnbudgeted = filteredUnbudgeted.slice(
    (pageUnbudgeted - 1) * ITEMS_PER_PAGE,
    pageUnbudgeted * ITEMS_PER_PAGE
  );

  // Month Formatter
  const formatMonthName = (mStr: string) => {
    if (!mStr || typeof mStr !== "string") return "Current Month";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const [year, month] = parts;
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long" });
  };

  const monthLabel = selectedMonth ? formatMonthName(selectedMonth) : "Latest";

  return (
    <div className="space-y-6 pt-2">
      {/* Side-by-side Governance Tables: Top 5 Spends | Largest Accounts with No Budget */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Table 1: Top 5 Spends */}
        <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  Top 5 Spends
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Highest-spending member accounts in {monthLabel}
                </p>
              </div>
              <Badge
                variant="outline"
                className="text-xs font-semibold text-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 shrink-0"
              >
                {top5SharePct}% of org spend
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 pb-4">
            {/* Summary Strip */}
            <div className="mb-3 flex items-center justify-between rounded-md border border-input/70 bg-background/70 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground font-medium">
                Top 5 Combined ({monthLabel}):
              </span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                ${top5TotalSpend.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>

            {/* Table */}
            <div className="flex-1 min-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[32px] text-center">#</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="w-[110px]">Share of Org</TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[100px]">
                      {monthLabel} Spend
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top5Spends.length > 0 ? (
                    top5Spends.map((acc, idx) => {
                      const sharePct =
                        totalOrgMonthSpend > 0
                          ? Number(((acc.currentSpend / totalOrgMonthSpend) * 100).toFixed(1))
                          : 0;
                      const mom =
                        typeof acc.momChangePercent === "number"
                          ? Number(acc.momChangePercent.toFixed(1))
                          : 0;

                      return (
                        <TableRow key={acc.id || idx} className="hover:bg-muted/30">
                          <TableCell className="w-[32px] text-center font-bold text-xs text-muted-foreground py-2.5">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="font-semibold text-xs truncate max-w-[220px]" title={acc.name}>
                              {acc.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {acc.id}
                              </span>
                              <Badge
                                variant="secondary"
                                className={`text-[9px] px-1 py-0 border ${
                                  acc.hasBudget
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300"
                                }`}
                              >
                                {acc.hasBudget ? "Budgeted" : "No Budget"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 w-[110px]">
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="h-full bg-indigo-500 rounded-full transition-all"
                                  style={{ width: `${Math.min(100, sharePct)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono font-medium text-muted-foreground min-w-[32px] text-right">
                                {sharePct}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap w-[100px] py-2.5">
                            <div className="font-semibold text-xs text-foreground">
                              ${acc.currentSpend.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </div>
                            {acc.previousSpend && acc.previousSpend > 0 ? (
                              <div
                                className={`text-[10px] font-medium ${
                                  mom > 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : mom < 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {mom > 0 ? `+${mom}%` : `${mom}%`} MoM
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No account spend data found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Footer Info */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30 text-xs text-muted-foreground">
              <span>Top {top5Spends.length} of {accountsForMonth.length || top5Spends.length} accounts</span>
              <span className="font-medium text-foreground">
                Org Total: ${totalOrgMonthSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Table 2: Largest Accounts with No Budget */}
        <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Largest Accounts with No Budget
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  High-spend active accounts without budget limits in force
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-semibold text-amber-600 border-amber-300 dark:border-amber-800">
                {filteredUnbudgeted.length} accounts
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 pb-4">
            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search unbudgeted accounts..."
                value={searchUnbudgeted}
                onChange={(e) => {
                  setSearchUnbudgeted(e.target.value);
                  setPageUnbudgeted(1);
                }}
                className="w-full bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
              />
            </div>

            {/* Table */}
            <div className="flex-1 min-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="w-[120px] hidden sm:table-cell">Top Driver</TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[100px]">
                      {monthLabel} Spend
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedUnbudgeted.length > 0 ? (
                    paginatedUnbudgeted.map((a, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="py-2.5">
                          <div className="font-semibold text-xs truncate max-w-[220px]" title={a["Account Name"]}>
                            {a["Account Name"]}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {a["Account ID"]}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 w-[120px] hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground truncate block max-w-[130px]" title={a["Top Cost Driver"]}>
                            {a["Top Cost Driver"] || "Various"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap w-[100px] py-2.5 text-xs text-rose-600 dark:text-rose-400">
                          ${Number(a["Current Month Spend"] || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        No unbudgeted accounts found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
              <div className="text-xs text-muted-foreground">
                {filteredUnbudgeted.length > 0
                  ? `Showing ${(pageUnbudgeted - 1) * ITEMS_PER_PAGE + 1}-${Math.min(
                      pageUnbudgeted * ITEMS_PER_PAGE,
                      filteredUnbudgeted.length
                    )} of ${filteredUnbudgeted.length}`
                  : "0-0 of 0"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPageUnbudgeted((p) => Math.max(1, p - 1))}
                  disabled={pageUnbudgeted === 1}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-medium min-w-[32px] text-center">
                  {pageUnbudgeted} / {totalPagesUnbudgeted || 1}
                </span>
                <button
                  onClick={() => setPageUnbudgeted((p) => Math.min(totalPagesUnbudgeted, p + 1))}
                  disabled={pageUnbudgeted === totalPagesUnbudgeted || totalPagesUnbudgeted === 0}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ManualBudgetAlertsSection
        defaultProvider="aws"
        lockProvider
        selectedMonth={selectedMonth}
      />
    </div>
  );
}
