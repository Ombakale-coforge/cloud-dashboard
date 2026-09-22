import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type { AzureKpiMonth, AzureMomChange } from "@/lib/types";
import { Users, Package, Layers, ArrowUpRight, ArrowDownRight, IndianRupee, Calendar, TrendingUp } from "lucide-react";

const fmt = (n: number) =>
    `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current Month";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
};

const formatPrevMonthName = (mStr: string) => {
    if (!mStr) return "Previous Month";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 2, 1);
    return date.toLocaleDateString("default", { month: "long", year: "numeric" });
}

const getPreviousMonth = (monthStr: string): string => {
    const [year, month] = monthStr.split("-").map(Number);
    const date = new Date(year, month - 2, 1);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const truncate = (s: string, max: number) =>
    s && s.length > max ? s.slice(0, max) + "…" : s || "—";

interface AzureKpiCardsProps {
    selectedMonth: string;
    basePath?: string;
}

export function AzureKpiCards({ selectedMonth, basePath = "/data/azure" }: AzureKpiCardsProps) {
    // Pre-aggregated one-row-per-month KPI table - no client-side aggregation needed,
    // just find the row for the selected month (or the latest month if none picked).
    const { data: kpiRows } = useCsv<AzureKpiMonth>(`${basePath}/azure_usage_kpis_by_month.csv`);

    const { data: mom } = useCsv<AzureMomChange>(`${basePath}/azure_usage_mom_change.csv`);
    console.log(mom);

    const activeRow = useMemo(() => {
        if (mom.length === 0) return null;
        if (!selectedMonth) return mom[mom.length - 1];
        return mom.find((x) => x.Month === selectedMonth) || mom[mom.length - 1];
    }, [mom, selectedMonth]);

    const pctChange = Number(activeRow?.["MoM % Change"]) || 0;
    const isUp = pctChange >= 0;


    const months = useMemo(() => [...new Set(kpiRows.map((d) => d.Month))].sort(), [kpiRows]);
    const effectiveMonth = selectedMonth || months[months.length - 1] || "";
    const previousMonth = getPreviousMonth(effectiveMonth);
    console.log(previousMonth);
    const current = useMemo(
        () => kpiRows.find((d) => d.Month === effectiveMonth),
        [kpiRows, effectiveMonth]
    );
    const previous = useMemo(
        () => kpiRows.find((d) => d.Month === previousMonth),
        [kpiRows, effectiveMonth]
    )

    const displayMonth = formatMonthName(effectiveMonth);
    const prevDisplayMonth = formatPrevMonthName(effectiveMonth);
    const totalCost = current?.["Total Cost"] ?? 0;
    const previoutTotalCost = previous?.["Total Cost"] ?? 0;
    // const topCustomer = current?.["Top Customer"] ?? "";
    // const topCustomerCost = current?.["Top Customer Cost"] ?? 0;
    // const topProduct = current?.["Top Product"] ?? "";
    // const topProductCost = current?.["Top Product Cost"] ?? 0;
    // const subscriptions = current?.Subscriptions ?? 0;

    return (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* Total Cost */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            ALLOCATION FOR PERIOD ({displayMonth})
                        </p>
                        <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{fmt(totalCost)}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total Azure spend, pro-rated</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                        <IndianRupee className="h-5 w-5" />
                    </div>
                </div>
            </Card>

            {/* Previous Month Total Cost*/}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">PREVIOUS PERIOD SPEND ({prevDisplayMonth})</p>
                        <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{fmt(previoutTotalCost)}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Prior month total</p>
                    </div>
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        <Calendar className="h-5 w-5" />
                    </div>
                </div>
            </Card>

            {/* MoM % Change */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">MOM VARIANCE</p>
                        <h3 className={`text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-1 ${isUp ? "text-rose-600 dark:text-rose-500" : "text-emerald-600 dark:text-emerald-500"}`}>
                            {activeRow?.["MoM % Change"] !== "" ? (
                                <>
                                    {isUp ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownRight className="h-5 w-5" />}
                                    {Math.abs(pctChange).toFixed(1)}%
                                </>
                            ) : (
                                "—"
                            )}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{isUp ? "Increased vs prior month" : "Decreased vs prior month"}</p>
                    </div>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isUp ? "bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"}`}>
                        <TrendingUp className="h-5 w-5" />
                    </div>
                </div>
            </Card>
        </div>
    );
}
