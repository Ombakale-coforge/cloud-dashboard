import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type { MomChange } from "@/lib/types";
import { ArrowUpRight, ArrowDownRight, DollarSign, Calendar, TrendingUp } from "lucide-react";

const fmt = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface KpiCardsProps {
  selectedMonth: string;
  basePath?: string;
}

export function KpiCards({ selectedMonth, basePath = "/data" }: KpiCardsProps) {
  const { data: mom } = useCsv<MomChange>(`${basePath}/mom_change.csv`);

    const activeRow = useMemo(() => {
        if (!mom || mom.length === 0) return null;
        if (!selectedMonth) return mom[mom.length - 1];
        return mom.find((x) => x && x.Month === selectedMonth) || mom[mom.length - 1];
    }, [mom, selectedMonth]);

    const currentTotal = Number(activeRow?.["Total Cost"]) || 0;
    const prevTotal = Number(activeRow?.["Previous Month Cost"]) || 0;
    const pctChange = Number(activeRow?.["MoM % Change"]) || 0;
    const isUp = pctChange >= 0;

    // Format month name for display
    const formatMonthName = (mStr: string) => {
        if (!mStr || typeof mStr !== "string") return "";
        const parts = mStr.split("-");
        if (parts.length < 2) return mStr;
        const [year, month] = parts;
        const date = new Date(Number(year), Number(month) - 1, 1);
        if (isNaN(date.getTime())) return mStr;
        return date.toLocaleString("default", { month: "long" });
    };

    return (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {/* Current Month Cost */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            ALLOCATION FOR PERIOD ({activeRow && activeRow.Month ? formatMonthName(activeRow.Month) : "Current Month"})
                        </p>
                        <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{fmt(currentTotal)}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Total AWS spend, pro-rated</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                        <DollarSign className="h-5 w-5" />
                    </div>
                </div>
            </Card>

            {/* Previous Month Cost */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
                <div className="flex items-center justify-between">
                    <div className="space-y-1">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">PREVIOUS PERIOD SPEND</p>
                        <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">{prevTotal ? fmt(prevTotal) : "—"}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Prior month total</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
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
                            {activeRow && activeRow["MoM % Change"] !== undefined && activeRow["MoM % Change"] !== null && activeRow["MoM % Change"] !== "" ? (
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
