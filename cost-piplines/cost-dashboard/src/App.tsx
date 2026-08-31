import { useState, useEffect, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar, type Provider, type AwsAccountOption } from "@/components/Navbar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { AzureDashboard } from "@/components/azure/AzureDashboard";
import { useCsv } from "@/lib/useCsv";
import type { MonthTotal, AzureMonthlyTotal } from "@/lib/types";

const DEFAULT_AWS_ACCOUNTS: AwsAccountOption[] = [
  { id: "account-1", name: "AWS Account 1 (Primary)", path: "/data" },
  { id: "account-2", name: "AWS Account 2", path: "/data/accounts/account-2" },
];

export default function App() {
  const [activeProvider, setActiveProvider] = useState<Provider>("aws");
  const [awsAccounts, setAwsAccounts] = useState<AwsAccountOption[]>(DEFAULT_AWS_ACCOUNTS);
  const [selectedAwsAccount, setSelectedAwsAccount] = useState<string>("account-1");

  // Fetch accounts.json metadata if available
  useEffect(() => {
    fetch("/data/accounts.json")
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAwsAccounts(data);
          if (!data.some((a) => a.id === selectedAwsAccount)) {
            setSelectedAwsAccount(data[0].id);
          }
        }
      })
      .catch(() => {
        // Fallback to default accounts
      });
  }, []);

  const currentAwsAccount = useMemo(() => {
    return awsAccounts.find((a) => a.id === selectedAwsAccount) || awsAccounts[0];
  }, [awsAccounts, selectedAwsAccount]);

  const awsBasePath = currentAwsAccount?.path || "/data";

  // Monthly totals for active AWS account and Azure
  const { data: awsMonthly } = useCsv<MonthTotal>(`${awsBasePath}/monthly_totals_last_6_months.csv`);
  const { data: azureMonthly } = useCsv<AzureMonthlyTotal>("/data/azure/azure_monthly_totals.csv");

  const awsMonths = useMemo(() => awsMonthly.map((m) => m.Month).sort(), [awsMonthly]);
  const azureMonths = useMemo(() => azureMonthly.map((m) => m.Month).sort(), [azureMonthly]);

  const months = activeProvider === "aws" ? awsMonths : azureMonths;

  const [selectedMonth, setSelectedMonth] = useState<string>("");

  useEffect(() => {
    if (months.length > 0 && !months.includes(selectedMonth)) {
      setSelectedMonth(months[months.length - 1]);
    }
  }, [months, selectedMonth]);

  const handleProviderChange = (provider: Provider) => {
    setActiveProvider(provider);
    setSelectedMonth("");
  };

  const handleAwsAccountChange = (accountId: string) => {
    setSelectedAwsAccount(accountId);
    setSelectedMonth("");
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
          awsAccounts={awsAccounts}
          selectedAwsAccount={selectedAwsAccount}
          onAwsAccountChange={handleAwsAccountChange}
        />

        <main className="mx-auto max-w-7xl space-y-8 p-6">
          {activeProvider === "aws" ? (
            <>
              {/* Main Dashboard Sections with dynamic AWS Account Path */}
              <KpiCards selectedMonth={selectedMonth} basePath={awsBasePath} />
              <ChartsSection selectedMonth={selectedMonth} basePath={awsBasePath} />
              <DataTables selectedMonth={selectedMonth} basePath={awsBasePath} />
            </>
          ) : (
            <AzureDashboard selectedMonth={selectedMonth} />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
