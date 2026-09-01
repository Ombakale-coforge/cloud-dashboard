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
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {/* Total Cost */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Total Cost — {displayMonth}</p>
                        <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{fmt(totalCost)}</h3>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                        <IndianRupee className="h-6 w-6" />
                    </div>
                </div>
            </Card>

            {/* Previous Month Total Cost*/}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Previous Month Total Cost — {prevDisplayMonth}</p>
                        <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{fmt(previoutTotalCost)}</h3>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                        <Calendar className="h-6 w-6" />
                    </div>
                </div>
            </Card>

            {/* MoM % Change */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className={`absolute top-0 left-0 right-0 h-[2px] ${isUp ? "bg-red-500" : "bg-emerald-500"}`} />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">MoM % Change</p>
                        <h3 className={`text-3xl font-extrabold tracking-tight flex items-center gap-1 ${isUp ? "text-red-600 dark:text-red-500" : "text-emerald-600 dark:text-emerald-500"}`}>
                            {activeRow?.["MoM % Change"] !== "" ? (
                                <>
                                    {isUp ? <ArrowUpRight className="h-6 w-6 animate-pulse" /> : <ArrowDownRight className="h-6 w-6 animate-pulse" />}
                                    {Math.abs(pctChange).toFixed(1)}%
                                </>
                            ) : (
                                "—"
                            )}
                        </h3>
                    </div>
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isUp ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"}`}>
                        <TrendingUp className="h-6 w-6" />
                    </div>
                </div>
            </Card>
        </div>
    );
}
