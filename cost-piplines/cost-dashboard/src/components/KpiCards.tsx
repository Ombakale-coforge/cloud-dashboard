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
    if (mom.length === 0) return null;
    if (!selectedMonth) return mom[mom.length - 1];
    return mom.find((x) => x.Month === selectedMonth) || mom[mom.length - 1];
  }, [mom, selectedMonth]);

  const currentTotal = Number(activeRow?.["Total Cost"]) || 0;
  const prevTotal = Number(activeRow?.["Previous Month Cost"]) || 0;
  const pctChange = Number(activeRow?.["MoM % Change"]) || 0;
  const isUp = pctChange >= 0;

  // Format month name for display
  const formatMonthName = (mStr: string) => {
    if (!mStr) return "";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long" });
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* Current Month Cost */}
      <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 to-violet-500" />
        <div className="flex items-center justify-between p-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Cost in {activeRow ? formatMonthName(activeRow.Month) : "Current Month"}
            </p>
            <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{fmt(currentTotal)}</h3>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
            <DollarSign className="h-6 w-6" />
          </div>
        </div>
      </Card>

      {/* Previous Month Cost */}
      <Card className="relative overflow-hidden border border-muted/50 bg-card/60 backdrop-blur-md transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-slate-400 to-slate-500" />
        <div className="flex items-center justify-between p-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Previous Month Cost</p>
            <h3 className="text-3xl font-extrabold tracking-tight text-foreground">{prevTotal ? fmt(prevTotal) : "—"}</h3>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
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
