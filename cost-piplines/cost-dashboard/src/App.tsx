import { useState, useEffect, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar, type Provider } from "@/components/Navbar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { AzureDashboard } from "@/components/azure/AzureDashboard";
import { useCsv } from "@/lib/useCsv";
import type { MonthTotal, AzureMonthlyTotal } from "@/lib/types";

export default function App() {
    const [activeProvider, setActiveProvider] = useState<Provider>("aws");

    // Both providers' month lists are fetched up front (cheap - they're small
    // aggregate CSVs) so switching the toggle is instant, no loading flash.
    const { data: awsMonthly } = useCsv<MonthTotal>("/data/monthly_totals_last_6_months.csv");
    const { data: azureMonthly } = useCsv<AzureMonthlyTotal>("/data/azure/azure_monthly_totals.csv");

    const awsMonths = useMemo(() => awsMonthly.map((m) => m.Month).sort(), [awsMonthly]);
    const azureMonths = useMemo(() => azureMonthly.map((m) => m.Month).sort(), [azureMonthly]);

    const months = activeProvider === "aws" ? awsMonths : azureMonths;

    const [selectedMonth, setSelectedMonth] = useState<string>("");

    // Whenever the active month list changes - on first load, or because the
    // provider was switched to one with a different set of months - fall back
    // to that list's latest month if the current selection isn't valid for it.
    useEffect(() => {
        if (months.length > 0 && !months.includes(selectedMonth)) {
            setSelectedMonth(months[months.length - 1]);
        }
    }, [months, selectedMonth]);

    const handleProviderChange = (provider: Provider) => {
        setActiveProvider(provider);
        setSelectedMonth(""); // effect above re-selects that provider's latest month
    };

    return (
        <TooltipProvider>
            <div className="min-h-screen bg-muted/30 text-foreground">
                <Navbar
                    months={months}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                    activeProvider={activeProvider}
                    onProviderChange={handleProviderChange}
        />

                <main className="mx-auto max-w-7xl space-y-8 p-6">
                    {activeProvider === "aws" ? (
                        <>
                            {/* Main Dashboard Sections */}
          <KpiCards selectedMonth={selectedMonth} />
                            <ChartsSection selectedMonth={selectedMonth} />
                            <DataTables selectedMonth={selectedMonth} />
                        </>
                    ) : (
                        <AzureDashboard selectedMonth={selectedMonth} />
                    )}
        

        </main>
            </div>
        </TooltipProvider>
    );
}
