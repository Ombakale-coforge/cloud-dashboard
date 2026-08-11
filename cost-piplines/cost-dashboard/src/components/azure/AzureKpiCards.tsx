import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type { AzureKpiMonth } from "@/lib/types";
import { DollarSign, Users, Package, Layers } from "lucide-react";

const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
}

export function AzureKpiCards({ selectedMonth }: AzureKpiCardsProps) {
    // Pre-aggregated one-row-per-month KPI table - no client-side aggregation needed,
    // just find the row for the selected month (or the latest month if none picked).
    const { data: kpiRows } = useCsv<AzureKpiMonth>("/data/azure/azure_kpis_by_month.csv");

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
    const topCustomer = current?.["Top Customer"] ?? "";
    const topCustomerCost = current?.["Top Customer Cost"] ?? 0;
    const topProduct = current?.["Top Product"] ?? "";
    const topProductCost = current?.["Top Product Cost"] ?? 0;
    const subscriptions = current?.Subscriptions ?? 0;

    return (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Total Cost */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Total Cost — {displayMonth}</p>
                        <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{fmt(totalCost)}</h3>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                        <DollarSign className="h-6 w-6" />
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
                        <DollarSign className="h-6 w-6" />
                    </div>
                </div>
            </Card>

            {/* Top Customer */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500 via-purple-400 to-violet-500" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Top Customer</p>
                        <h3 className="text-xl font-extrabold tracking-tight text-foreground" title={topCustomer}>
                            {truncate(topCustomer, 18)}
                        </h3>
                        {topCustomer && <p className="text-xs text-muted-foreground">{fmt(topCustomerCost)} spend</p>}
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
                        <Users className="h-6 w-6" />
                    </div>
                </div>
            </Card>

            {/* Top Product */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Top Product</p>
                        <h3 className="text-xl font-extrabold tracking-tight text-foreground" title={topProduct}>
                            {truncate(topProduct, 18)}
                        </h3>
                        {topProduct && <p className="text-xs text-muted-foreground">{fmt(topProductCost)} spend</p>}
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                        <Package className="h-6 w-6" />
                    </div>
                </div>
            </Card>

            {/* Subscriptions */}
            <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400" />
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1.5">
                        <p className="text-sm font-medium text-muted-foreground">Subscriptions</p>
                        <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{subscriptions || "—"}</h3>
                        <p className="text-xs text-muted-foreground">distinct subscriptions billed</p>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                        <Layers className="h-6 w-6" />
                    </div>
                </div>
            </Card>
        </div>
    );
}
