import { useState, useEffect, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar } from "@/components/Navbar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { useCsv } from "@/lib/useCsv";
import type { MonthTotal } from "@/lib/types";

export default function App() {
  // 1. Theme State (Light / Dark)
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    // Read theme from localStorage or system settings
    const savedTheme = localStorage.getItem("theme") as "light" | "dark" | null;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(savedTheme || systemTheme);
  }, []);

  useEffect(() => {
    if (!theme) return;
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  // 2. Month History State
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

  if (!theme) return null; // Avoid layout flash during load

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/30 dark:bg-[#0b0f19] text-foreground transition-colors duration-300">
        <Navbar 
          theme={theme}
          onToggleTheme={handleToggleTheme}
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
