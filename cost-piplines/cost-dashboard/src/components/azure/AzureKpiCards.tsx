import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCsv } from "@/lib/useCsv";
import type { AzureKpiMonth, AzureMomChange } from "@/lib/types";
import {
    ShieldCheck,
    RefreshCw,
    PieChart,
    Wallet,
    Lock,
    ArrowUpRight,
    ArrowDownRight,
    DollarSign,
    Calendar,
    TrendingUp,
} from "lucide-react";
import { formatAzureUsd } from "@/lib/azureCurrency";

interface AzureGovernanceSummary {
    rootAccount?: {
        id: string;
        name: string;
        accountId: string;
    };
    selectedMonth?: string;
    totalAccounts?: number;
    budgetedAccounts?: number;
    unbudgetedAccounts?: number;
    permissionDeniedAccounts?: number;
    totalBudgetedSpend?: number;
    activeSpend?: number;
    currency?: string;
}

const fmt = (n: number) => formatAzureUsd(n, "INR");

const fmtInt = (n: number) =>
    formatAzureUsd(n, "INR", { maximumFractionDigits: 0, minimumFractionDigits: 0 });

const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current Month";
    const parts = mStr.split("-");
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return date.toLocaleString("default", { month: "long" });
};

const getPreviousMonth = (monthStr: string): string => {
    if (!monthStr) return "";
    const [year, month] = monthStr.split("-").map(Number);
    const date = new Date(year, month - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

interface AzureKpiCardsProps {
    selectedMonth: string;
    basePath?: string;
}

export function AzureKpiCards({ selectedMonth, basePath = "/data/azure" }: AzureKpiCardsProps) {
    const { data: kpiRows } = useCsv<AzureKpiMonth>(`${basePath}/azure_usage_kpis_by_month.csv`);
    const { data: mom } = useCsv<AzureMomChange>(`${basePath}/azure_usage_mom_change.csv`);

    const [summary, setSummary] = useState<AzureGovernanceSummary | null>(null);
    const [syncing, setSyncing] = useState(false);

    const months = useMemo(() => [...new Set(kpiRows.map((d) => d.Month))].sort(), [kpiRows]);
    const effectiveMonth = selectedMonth || months[months.length - 1] || "";
    const previousMonth = getPreviousMonth(effectiveMonth);

    const loadGovernanceData = () => {
        const monthParam = effectiveMonth ? `?month=${encodeURIComponent(effectiveMonth)}` : "";
        fetch(`/api/azure/dataset/governance_summary${monthParam}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data) setSummary(data);
            })
            .catch((err) => console.error("Error loading Azure governance data:", err));
    };

    useEffect(() => {
        loadGovernanceData();
    }, [effectiveMonth]);

    const handleSyncBudgets = async () => {
        setSyncing(true);
        try {
            const res = await fetch("/api/azure/budgets/sync", { method: "POST" });
            if (res.ok) {
                loadGovernanceData();
            }
        } catch (e) {
            console.error("Sync error:", e);
        } finally {
            setSyncing(false);
        }
    };

    const activeRow = useMemo(() => {
        if (mom.length === 0) return null;
        if (!effectiveMonth) return mom[mom.length - 1];
        return mom.find((x) => x.Month === effectiveMonth) || mom[mom.length - 1];
    }, [mom, effectiveMonth]);

    const pctChange = Number(activeRow?.["MoM % Change"]) || 0;
    const isUp = pctChange >= 0;

    const current = useMemo(
        () => kpiRows.find((d) => d.Month === effectiveMonth),
        [kpiRows, effectiveMonth]
    );
    const previous = useMemo(
        () => kpiRows.find((d) => d.Month === previousMonth),
        [kpiRows, previousMonth]
    );

    const displayMonth = formatMonthName(effectiveMonth);
    const totalCost = summary?.activeSpend ?? (current?.["Total Cost"] ?? 0);
    const previousTotalCost = previous?.["Total Cost"] ?? 0;

    const totalAccounts = summary?.totalAccounts || 0;
    const budgetedAccounts = summary?.budgetedAccounts || 0;
    const permissionDeniedCount = summary?.permissionDeniedAccounts || 0;
    const coveragePct = totalAccounts > 0 ? Math.round((budgetedAccounts / totalAccounts) * 100) : 0;
    const totalBudget = summary?.totalBudgetedSpend || 0;

    return (
        <div className="space-y-4">
            {/* Header and Refresh Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-muted/30 pb-3">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-blue-600" />
                        <span>Azure Budgets & Governance</span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                            Coforge Limited (EnterpriseMaster-PROD-GBL)
                        </span>
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Management-configured Azure budgets, spending thresholds, and RBAC permission checks
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSyncBudgets}
                        disabled={syncing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin text-blue-600" : ""}`} />
                        {syncing ? "Syncing ARM..." : "Sync Azure Budgets"}
                    </button>
                    <Badge variant="outline" className="text-xs font-semibold px-2.5 py-1 bg-background/50">
                        Reporting Period: {displayMonth}
                    </Badge>
                </div>
            </div>

            {/* Unified 6-Card Metric Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* 1. Active Spend */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate" title={`${displayMonth.toUpperCase()} SPEND`}>
                                {displayMonth.toUpperCase()} SPEND
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                                <DollarSign className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {fmt(totalCost)}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>Total Azure spend</span>
                    </div>
                </Card>

                {/* 2. Total Budget Allocated */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Total Budget
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                                <Wallet className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {fmtInt(totalBudget)}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>Allocated in Portal</span>
                    </div>
                </Card>

                {/* 3. Budget Coverage */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                Budget Coverage
                            </p>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                                <PieChart className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                            {coveragePct}%
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>{budgetedAccounts} of {totalAccounts} subs</span>
                    </div>
                </Card>

                {/* 4. Previous Period Spend */}
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
                            {previousTotalCost ? fmt(previousTotalCost) : "—"}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>Prior month total</span>
                    </div>
                </Card>

                {/* 5. MoM Variance */}
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
                            {activeRow?.["MoM % Change"] !== "" ? (
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

                {/* 6. Permission Restricted */}
                <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate" title="PERMISSION RESTRICTED">
                                RESTRICTED
                            </p>
                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${permissionDeniedCount > 0 ? "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                                <Lock className="h-4 w-4" />
                            </div>
                        </div>
                        <h3 className={`mt-2 text-2xl font-extrabold tracking-tight ${permissionDeniedCount > 0 ? "text-purple-600 dark:text-purple-400" : "text-slate-900 dark:text-white"}`}>
                            {permissionDeniedCount}
                        </h3>
                    </div>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-slate-500 dark:text-slate-400">
                        <span>subs missing RBAC</span>
                    </div>
                </Card>
            </div>
        </div>
    );
}
