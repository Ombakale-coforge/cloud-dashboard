import { useState, useEffect, useMemo, Component, ReactNode, ErrorInfo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Navbar, type Provider, type AccountOption } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { KpiCards } from "@/components/KpiCards";
import { DataTables } from "@/components/DataTables";
import { ChartsSection } from "@/components/ChartsSection";
import { AzureDashboard } from "@/components/azure/AzureDashboard";
import { useCsv } from "@/lib/useCsv";
import type { MonthTotal, AzureMonthlyTotal } from "@/lib/types";

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    public state: ErrorBoundaryState = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center rounded-xl border border-rose-500/30 bg-rose-500/10 my-8">
                    <h2 className="text-lg font-bold text-rose-600 mb-2">Something went wrong rendering this section</h2>
                    <p className="text-xs text-muted-foreground mb-4">
                        {this.state.error?.message || "An unexpected error occurred."}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors cursor-pointer"
                    >
                        Try Again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const DEFAULT_AWS_ACCOUNTS: AccountOption[] = [
    {
        id: "account-1",
        name: "Coforge Limited (5131-6780-3309)",
        accountId: "5131-6780-3309",
        accountName: "Coforge Limited",
        path: "/data",
    },
    {
        id: "account-2",
        name: "Coforge OICL (0068-5003-1580)",
        accountId: "0068-5003-1580",
        accountName: "Coforge OICL",
        path: "/data/accounts/account-2",
    },
];

const DEFAULT_AZURE_ACCOUNTS: AccountOption[] = [
    {
        id: "account-1",
        name: "Coforge Global IT (da60cf86-4c9b-4a5c-b60d-ffcfff067740)",
        accountId: "da60cf86-4c9b-4a5c-b60d-ffcfff067740",
        accountName: "Coforge Global IT",
        path: "/data/azure",
    },
    {
        id: "account-2",
        name: "Coforge Secondary (b727a530-a0d5-4fb8-bd40-d8f9763e97db)",
        accountId: "b727a530-a0d5-4fb8-bd40-d8f9763e97db",
        accountName: "Coforge Secondary",
        path: "/data/azure/accounts/account-2",
    },
];

const formatAwsAccount = (acc: AccountOption): AccountOption => {
    let name = acc.name;
    let accountName = acc.accountName;
    let accountId = acc.accountId;

    if (acc.id === "account-1" || name.includes("Primary") || name.includes("AWS Account 1")) {
        accountName = accountName || "Coforge Limited";
        accountId = accountId || "5131-6780-3309";
        name = `${accountName} (${accountId})`;
    } else if (acc.id === "account-2" || name.includes("AWS Account 2")) {
        accountName = accountName || "Coforge OICL";
        accountId = accountId || "0068-5003-1580";
        name = `${accountName} (${accountId})`;
    }

    return {
        ...acc,
        name,
        accountName,
        accountId,
    };
};

export default function App() {
    const [activeProvider, setActiveProvider] = useState<Provider>("aws");
    const [awsAccounts, setAwsAccounts] = useState<AccountOption[]>(DEFAULT_AWS_ACCOUNTS);
    const [selectedAwsAccount, setSelectedAwsAccount] = useState<string>("account-1");
    const [azureAccounts, setAzureAccounts] = useState<AccountOption[]>(DEFAULT_AZURE_ACCOUNTS);
    const [selectedAzureAccount, setSelectedAzureAccount] = useState<string>("account-1");

    // Fetch accounts.json metadata if available
    useEffect(() => {
        fetch("/data/accounts.json")
            .then((res) => {
                if (res.ok) return res.json();
                return null;
            })
            .then((data) => {
                if (Array.isArray(data) && data.length > 0) {
                    const formatted = data.map(formatAwsAccount);
                    setAwsAccounts(formatted);
                    if (!formatted.some((a) => a.id === selectedAwsAccount)) {
                        setSelectedAwsAccount(formatted[0].id);
                    }
                }
            })
            .catch(() => {
                // Fallback to default accounts
            });
    }, []);

    // Fetch Azure accounts.json metadata if available
    useEffect(() => {
        fetch("/data/azure/accounts.json")
            .then((res) => {
                if (res.ok) return res.json();
                return null;
            })
            .then((data) => {
                if (Array.isArray(data) && data.length > 0) {
                    setAzureAccounts(data);
                    if (!data.some((a) => a.id === selectedAzureAccount)) {
                        setSelectedAzureAccount(data[0].id);
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

    const currentAzureAccount = useMemo(() => {
        return azureAccounts.find((a) => a.id === selectedAzureAccount) || azureAccounts[0];
    }, [azureAccounts, selectedAzureAccount]);

    const awsBasePath = currentAwsAccount?.path || "/data";
    const azureBasePath = currentAzureAccount?.path || "/data/azure";

    // Monthly totals for active AWS account and active Azure account
    const { data: awsMonthly } = useCsv<MonthTotal>(`${awsBasePath}/monthly_totals_last_6_months.csv`);
    const { data: azureMonthly } = useCsv<AzureMonthlyTotal>(`${azureBasePath}/azure_usage_monthly_totals.csv`);

    // Restrict AWS months strictly to the last 6 months (e.g. 2026-04 to 2026-09)
    const awsMonths = useMemo(() => {
        const sorted = awsMonthly
            .filter((m) => m && m.Month)
            .map((m) => m.Month)
            .sort();
        return sorted.slice(-6);
    }, [awsMonthly]);

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

    const handleAzureAccountChange = (accountId: string) => {
        setSelectedAzureAccount(accountId);
        setSelectedMonth("");
    };

    return (
        <TooltipProvider>
            <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased">
                {/* Navbar with Cloud Cost Intelligence & AWS/Azure Toggle */}
                <Navbar
                    activeProvider={activeProvider}
                    onProviderChange={handleProviderChange}
                />

                {/* Left Hover-Activated Sidebar */}
                <Sidebar
                    months={months}
                    selectedMonth={selectedMonth}
                    onMonthChange={setSelectedMonth}
                    activeProvider={activeProvider}
                    awsAccounts={awsAccounts}
                    selectedAwsAccount={selectedAwsAccount}
                    onAwsAccountChange={handleAwsAccountChange}
                    azureAccounts={azureAccounts}
                    selectedAzureAccount={selectedAzureAccount}
                    onAzureAccountChange={handleAzureAccountChange}
                />

                {/* Main Dashboard Analytics */}
                <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
                    <ErrorBoundary>
                        {activeProvider === "aws" ? (
                            <>
                                {/* Main Dashboard Sections with dynamic AWS Account Path */}
                                <KpiCards selectedMonth={selectedMonth} basePath={awsBasePath} />
                                <ChartsSection selectedMonth={selectedMonth} basePath={awsBasePath} />
                                <DataTables selectedMonth={selectedMonth} basePath={awsBasePath} />
                            </>
                        ) : (
                            <AzureDashboard selectedMonth={selectedMonth} basePath={azureBasePath} />
                        )}
                    </ErrorBoundary>
                </main>
            </div>
        </TooltipProvider>
    );
}
