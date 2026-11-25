import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCsv } from "@/lib/useCsv";
import type { MomChange, BudgetOverviewRow, GovernanceSummary, UnbudgetedAccountRow } from "@/lib/types";
import {
    ArrowUpRight,
    ArrowDownRight,
    DollarSign,
    Calendar,
    TrendingUp,
    Wallet,
    ShieldCheck,
    Building2,
    PieChart,
    AlertTriangle,
} from "lucide-react";

const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (n: number) =>
    `$${Math.round(n).toLocaleString()}`;

const formatMonthName = (mStr: string) => {
    if (!mStr || typeof mStr !== "string") return "Current Month";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const [year, month] = parts;
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long" });
};

interface KpiCardsProps {
    selectedMonth: string;
    basePath?: string;
}

export function KpiCards({ selectedMonth, basePath = "/data" }: KpiCardsProps) {
    const { data: mom } = useCsv<MomChange>(`${basePath}/mom_change.csv`);
    const { data: budgets } = useCsv<BudgetOverviewRow>(`${basePath}/budgets_overview.csv`);
    const { data: unbudgetedAccounts } = useCsv<UnbudgetedAccountRow>(
        selectedMonth
            ? `${basePath}/unbudgeted_accounts.csv?month=${encodeURIComponent(selectedMonth)}`
            : `${basePath}/unbudgeted_accounts.csv`
    );

    const [summary, setSummary] = useState<GovernanceSummary | null>(null);

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

        return () => {
            active = false;
        };
    }, [basePath, selectedMonth]);

    const activeRow = useMemo(() => {
        if (!mom || mom.length === 0) return null;
        if (!selectedMonth) return mom[mom.length - 1];
        return mom.find((x) => x && x.Month === selectedMonth) || mom[mom.length - 1];
    }, [mom, selectedMonth]);

    const totalBudget = useMemo(() => {
        if (summary?.sumBudgetLimits) return summary.sumBudgetLimits;
        if (!budgets || budgets.length === 0) return 0;
        return budgets.reduce(
            (sum, b) => sum + Number(b?.Limit ?? b?.["Budget Limit"] ?? 0),
            0
        );
    }, [budgets, summary]);

    const currentTotal = summary?.activeSpendTotal ?? (Number(activeRow?.["Total Cost"]) || 0);
    const prevTotal = Number(activeRow?.["Previous Month Cost"]) || 0;
    const pctChange = Number(activeRow?.["MoM % Change"]) || 0;
    const isUp = pctChange >= 0;

    const monthLabel = selectedMonth ? formatMonthName(selectedMonth) : "Current Month";

    // Summary calculations
    const totalAccounts = summary ? summary.totalAccounts : unbudgetedAccounts.length || 0;
    const activeAccounts = summary ? summary.activeAccounts : totalAccounts;
    const suspendedAccounts = summary ? summary.suspendedAccounts : 0;
    const coveragePct = summary ? summary.budgetCoveragePct : 0;
    const accountsWithBudget = summary ? summary.accountsWithBudget : 0;
    const accountsWithNoBudget = summary ? summary.accountsWithNoBudget : 0;
    const activeBudgetsCount = budgets ? budgets.length : 0;
    const shareUncovered = summary ? summary.shareSpendUncoveredPct : 0;
    const suspendedChargingCount = summary ? summary.suspendedAccountsChargingCount : 0;
    const suspendedSpendTotal = summary ? summary.suspendedAccountsSpendTotal : 0;
    const suspendedPeriodLabel = summary?.suspendedPeriodLabel || "Historical Total";

    return (
        <div className="space-y-4">
            {/* AWS Organization & Budget Governance Top Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-muted/30 pb-3">
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

            {/* Merged Unified Top Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
                {/* 1. Org Accounts */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Org Accounts
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                                <Building2 className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {totalAccounts || "—"}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {activeAccounts} active
                        </span>
                        <span className="text-slate-500">
                            {suspendedAccounts} closed
                        </span>
                    </div>
                </Card>

                {/* 2. Budget Coverage */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Budget Coverage
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                                <PieChart className="h-4 w-4" />
                            </div>
                        </div>
                        <div className="mt-2 flex items-baseline gap-1.5">
                            <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                                {coveragePct}%
                            </h3>
                            <span className="text-[11px] text-muted-foreground font-medium">
                                {accountsWithBudget}/{activeAccounts}
                            </span>
                        </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {accountsWithBudget} with budget
                        </span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                            {accountsWithNoBudget} no budget
                        </span>
                    </div>
                </Card>

                {/* 3. Current Month Spend */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate" title={`${monthLabel.toUpperCase()} SPEND`}>
                                {monthLabel.toUpperCase()} SPEND
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                                <DollarSign className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {fmt(currentTotal)}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2">
                        {summary ? (
                            <>
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                    {fmtInt(summary.spendUnderBudget)} under
                                </span>
                                <span className="text-rose-600 dark:text-rose-400 font-medium">
                                    {fmtInt(summary.spendWithNoBudget)} unbudg.
                                </span>
                            </>
                        ) : (
                            <span className="text-slate-500 dark:text-slate-400">Total AWS pro-rated</span>
                        )}
                    </div>
                </Card>

                {/* 4. Total Budget */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total Budget
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
                                <Wallet className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {fmt(totalBudget)}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2">
                        <span className="text-slate-500 dark:text-slate-400 truncate">
                            {activeBudgetsCount ? `${activeBudgetsCount} active` : "Limits in force"}
                        </span>
                        <span className="text-rose-600 dark:text-rose-400 font-semibold shrink-0">
                            Uncov: {shareUncovered}%
                        </span>
                    </div>
                </Card>

                {/* 5. Previous Period Spend */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate" title="PREVIOUS PERIOD">
                                PREVIOUS PERIOD
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                <Calendar className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {prevTotal ? fmt(prevTotal) : "—"}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>Prior month total</span>
                    </div>
                </Card>

                {/* 6. MoM Variance */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                MOM VARIANCE
                            </p>
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isUp ? "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"}`}>
                                <TrendingUp className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className={`mt-2 text-2xl font-extrabold tracking-tight flex items-center gap-1 ${isUp ? "text-rose-600 dark:text-rose-500" : "text-emerald-600 dark:text-emerald-500"}`}>
                            {activeRow && activeRow["MoM % Change"] !== undefined && activeRow["MoM % Change"] !== null && activeRow["MoM % Change"] !== "" ? (
                                <>
                                    {isUp ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                                    {Math.abs(pctChange).toFixed(1)}%
                                </>
                            ) : (
                                "—"
                            )}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>{isUp ? "Increased vs prior" : "Decreased vs prior"}</span>
                    </div>
                </Card>

                {/* 7. Suspended Accounts Leakage */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate" title="SUSPENDED LEAKAGE">
                                SUSPENDED LEAKAGE
                            </p>
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${suspendedChargingCount > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                                <AlertTriangle className="h-4 w-4" />
                            </div>
                        </div>
                        <div className="mt-2 flex items-baseline gap-1.5">
                            <h3 className={`text-2xl font-extrabold tracking-tight ${suspendedChargingCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-white"}`}>
                                {suspendedChargingCount}
                            </h3>
                            <span className="text-[11px] text-muted-foreground font-medium">
                                still charging
                            </span>
                        </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
                        <span className="truncate">{suspendedPeriodLabel}:</span>
                        <span className="font-bold text-rose-600 dark:text-rose-400 shrink-0">
                            {fmt(suspendedSpendTotal)}
                        </span>
                    </div>
                </Card>
            </div>
        </div>
    );
}
