import { useState, useEffect, useMemo, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { AccountRequestForm } from "@/components/AccountRequestForm";
import { useCsv } from "@/lib/useCsv";
import { useAccountRequests } from "@/lib/useAccountRequests";
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

  // Account Requests State
  const { addRecord } = useAccountRequests();
  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30 text-foreground">
        <Navbar
          months={months}
          selectedMonth={selectedMonth}
          onMonthChange={setSelectedMonth}
          onScrollToForm={scrollToForm}
        />

        <main className="mx-auto max-w-7xl space-y-8 p-6">
          {/* Main Dashboard Sections */}
          <KpiCards selectedMonth={selectedMonth} />
          <ChartsSection selectedMonth={selectedMonth} />
          <DataTables selectedMonth={selectedMonth} />

          {/* AWS Account Request Form Section */}
          <div ref={formRef} className="pt-4 border-t border-muted/50">
            <AccountRequestForm onSubmit={addRecord} />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}