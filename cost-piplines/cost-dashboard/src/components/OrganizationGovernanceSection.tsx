import { useState, useEffect } from "react";
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
import type {
  GovernanceSummary,
  UnbudgetedAccountRow,
  BudgetOverviewRow,
} from "@/lib/types";
import {
  ShieldCheck,
  Building2,
  PieChart,
  AlertTriangle,
  Wallet,
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface OrganizationGovernanceSectionProps {
  selectedMonth: string;
  basePath?: string;
}

export function OrganizationGovernanceSection({
  selectedMonth,
  basePath = "/data",
}: OrganizationGovernanceSectionProps) {
  // 1. Fetch Summary JSON metadata
  const [summary, setSummary] = useState<GovernanceSummary | null>(null);

  useEffect(() => {
    fetch(`${basePath}/governance_summary.json`)
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => {
        setSummary(null);
      });
  }, [basePath]);

  // 2. Fetch Unbudgeted Accounts CSV
  const { data: unbudgetedAccounts } = useCsv<UnbudgetedAccountRow>(
    `${basePath}/unbudgeted_accounts.csv`
  );

  // 3. Fetch Budgets Overview CSV
  const { data: budgetsOverview } = useCsv<BudgetOverviewRow>(
    `${basePath}/budgets_overview.csv`
  );

  // Search & Pagination for Unbudgeted Accounts
  const [searchUnbudgeted, setSearchUnbudgeted] = useState("");
  const [pageUnbudgeted, setPageUnbudgeted] = useState(1);
  const ITEMS_PER_PAGE = 6;

  // Search & Pagination for Budgets Overview
  const [searchBudgets, setSearchBudgets] = useState("");
  const [pageBudgets, setPageBudgets] = useState(1);

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

  // Filter Budgets Overview
  const filteredBudgets = (budgetsOverview || []).filter((b) => {
    if (!b || !b["Budget Name"]) return false;
    const term = searchBudgets.toLowerCase();
    return (
      b["Budget Name"].toLowerCase().includes(term) ||
      (b["Threshold Status"] && String(b["Threshold Status"]).toLowerCase().includes(term))
    );
  });
  const totalPagesBudgets = Math.max(1, Math.ceil(filteredBudgets.length / ITEMS_PER_PAGE));
  const paginatedBudgets = filteredBudgets.slice(
    (pageBudgets - 1) * ITEMS_PER_PAGE,
    pageBudgets * ITEMS_PER_PAGE
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
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-muted/30 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              AWS Organization & Budget Governance
            </h2>
            <p className="text-xs text-muted-foreground">
              Account inventory, budget enforcement, and unbudgeted financial exposure
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1 bg-background/50">
            Reporting Period: {monthLabel}
          </Badge>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {/* Card 1: Accounts in Organisation */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Org Accounts
              </span>
              <Building2 className="h-4 w-4 text-indigo-500" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              {summary ? summary.totalAccounts : unbudgetedAccounts.length || "--"}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs border-t border-muted/30 pt-2 text-muted-foreground">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {summary ? `${summary.activeAccounts} active` : "Active accounts"}
              </span>
              <span className="text-slate-500">
                {summary ? `${summary.suspendedAccounts} closed` : ""}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Accounts with a Budget */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Budget Coverage
              </span>
              <PieChart className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {summary ? `${summary.budgetCoveragePct}%` : "--%"}
              </span>
              <span className="text-xs text-muted-foreground font-medium">
                {summary ? `${summary.accountsWithBudget}/${summary.activeAccounts}` : "covered"}
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs border-t border-muted/30 pt-2">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {summary ? `${summary.accountsWithBudget} with budget` : "Under budget"}
              </span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {summary ? `${summary.accountsWithNoBudget} no budget` : "No budget"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Spend Under Management */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                {monthLabel} Active Spend
              </span>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              ${summary ? summary.activeSpendTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "--"}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs border-t border-muted/30 pt-2">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                ${summary ? summary.spendUnderBudget.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"} under
              </span>
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                ${summary ? summary.spendWithNoBudget.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"} unbudgeted
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Sum of Budget Limits in Force */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Budget Limits In Force
              </span>
              <Wallet className="h-4 w-4 text-purple-500" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">
              ${summary ? summary.sumBudgetLimits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--"}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs border-t border-muted/30 pt-2">
              <span className="text-muted-foreground">
                Uncovered Share:
              </span>
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                {summary ? `${summary.shareSpendUncoveredPct}%` : "--%"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 5: Suspended Accounts Still Charging */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Suspended Accounts Leakage
              </span>
              <AlertTriangle className={`h-4 w-4 ${summary && summary.suspendedAccountsChargingCount > 0 ? "text-amber-500" : "text-slate-400"}`} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${summary && summary.suspendedAccountsChargingCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                {summary ? summary.suspendedAccountsChargingCount : 0}
              </span>
              <span className="text-xs text-muted-foreground font-medium">
                still charging
              </span>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-xs border-t border-muted/30 pt-2">
              <span className="text-muted-foreground">
                {summary?.suspendedPeriodLabel || "Jun-Sep Total"}:
              </span>
              <span className="font-bold text-rose-600 dark:text-rose-400">
                ${summary ? summary.suspendedAccountsSpendTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Governance Data Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Table 1: Largest Accounts with No Budget */}
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
                    <TableHead className="max-w-[180px]">Account</TableHead>
                    <TableHead className="w-[100px] hidden sm:table-cell">Top Driver</TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[90px]">
                      {monthLabel} Spend
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedUnbudgeted.length > 0 ? (
                    paginatedUnbudgeted.map((a, i) => (
                      <TableRow key={i} className="hover:bg-muted/30">
                        <TableCell className="py-2.5 max-w-[180px]">
                          <div className="font-semibold text-xs truncate" title={a["Account Name"]}>
                            {a["Account Name"]}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {a["Account ID"]}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 w-[100px] hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground truncate block max-w-[120px]" title={a["Top Cost Driver"]}>
                            {a["Top Cost Driver"] || "Various"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold whitespace-nowrap w-[90px] py-2.5 text-xs text-rose-600 dark:text-rose-400">
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

        {/* Table 2: AWS Budgets Overview & Health */}
        <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  AWS Budgets Overview
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live budget limits, actual consumption, and forecasted alerts
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-semibold text-indigo-600 border-indigo-300 dark:border-indigo-800">
                {filteredBudgets.length} budgets
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col flex-1 pb-4">
            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search budgets..."
                value={searchBudgets}
                onChange={(e) => {
                  setSearchBudgets(e.target.value);
                  setPageBudgets(1);
                }}
                className="w-full bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
              />
            </div>

            {/* Table */}
            <div className="flex-1 min-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="max-w-[150px]">Budget Name</TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[70px]">Limit</TableHead>
                    <TableHead className="text-right whitespace-nowrap w-[70px]">Used</TableHead>
                    <TableHead className="w-[110px]">Utilization</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedBudgets.length > 0 ? (
                    paginatedBudgets.map((b, i) => {
                      const limit = Number(b.Limit || 0);
                      const used = Number(b["Current Used"] || 0);
                      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
                      const isExceeded = b["Threshold Status"]?.toLowerCase().includes("exceeded") || pct >= 100;

                      return (
                        <TableRow key={i} className="hover:bg-muted/30">
                          <TableCell className="py-2.5 max-w-[150px]">
                            <div className="font-semibold text-xs truncate" title={b["Budget Name"]}>
                              {b["Budget Name"]}
                            </div>
                            <div className="mt-0.5">
                              <Badge
                                variant="secondary"
                                className={`text-[10px] px-1.5 py-0 border ${
                                  isExceeded
                                    ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                                }`}
                              >
                                {b["Threshold Status"] || (isExceeded ? "Exceeded" : "OK")}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium whitespace-nowrap w-[70px] py-2.5 text-xs">
                            ${limit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </TableCell>
                          <TableCell className="text-right font-semibold whitespace-nowrap w-[70px] py-2.5 text-xs text-foreground">
                            ${used.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="w-[110px] py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    pct >= 100
                                      ? "bg-rose-500"
                                      : pct >= 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${Math.min(pct, 100)}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-mono font-medium text-muted-foreground min-w-[28px] text-right">
                                {pct}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No budgets found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
              <div className="text-xs text-muted-foreground">
                {filteredBudgets.length > 0
                  ? `Showing ${(pageBudgets - 1) * ITEMS_PER_PAGE + 1}-${Math.min(
                      pageBudgets * ITEMS_PER_PAGE,
                      filteredBudgets.length
                    )} of ${filteredBudgets.length}`
                  : "0-0 of 0"}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPageBudgets((p) => Math.max(1, p - 1))}
                  disabled={pageBudgets === 1}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-medium min-w-[32px] text-center">
                  {pageBudgets} / {totalPagesBudgets || 1}
                </span>
                <button
                  onClick={() => setPageBudgets((p) => Math.min(totalPagesBudgets, p + 1))}
                  disabled={pageBudgets === totalPagesBudgets || totalPagesBudgets === 0}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
