import { useState, useEffect, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { useCsv } from "@/lib/useCsv";
import type { MonthTotal } from "@/lib/types";

export default function App() {
  // Month History State
  const { data: monthly } = useCsv<MonthTotal>("/data/monthly_totals_last_6_months.csv");

  const months = useMemo(() => {
    return monthly.map((m) => m.Month).sort();
  }, [monthly]);

  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // Initialize selectedMonth to the latest month in the dataset
  useEffect(() => {
    if (months.length > 0 && !selectedMonth) {
      setSelectedMonth(months[months.length - 1]);
    }
  }, [months, selectedMonth]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30 text-foreground">
        <Navbar
          months={months}
          selectedMonth={selectedMonth}
          onMonthChange={setSelectedMonth}
        />

        <main className="mx-auto max-w-7xl space-y-6 p-6">
          <KpiCards selectedMonth={selectedMonth} />
          <ChartsSection selectedMonth={selectedMonth} />
          <DataTables selectedMonth={selectedMonth} />
        </main>
      </div>
    </TooltipProvider>
  );
}