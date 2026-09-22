import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield } from "lucide-react";

export type Provider = "aws" | "azure";

export interface AccountOption {
    id: string;
    name: string;
    path: string;
    accountId?: string;
    accountName?: string;
}

export type AwsAccountOption = AccountOption;
export type AzureAccountOption = AccountOption;

export interface NavbarProps {
    months?: string[];
    selectedMonth?: string;
    onMonthChange?: (month: string) => void;
    activeProvider: Provider;
    onProviderChange: (provider: Provider) => void;
    awsAccounts?: AccountOption[];
    selectedAwsAccount?: string;
    onAwsAccountChange?: (accountId: string) => void;
    azureAccounts?: AccountOption[];
    selectedAzureAccount?: string;
    onAzureAccountChange?: (accountId: string) => void;
}

export function Navbar({
    activeProvider = "aws",
    onProviderChange = () => { },
}: NavbarProps) {
    return (
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-6 py-3 backdrop-blur shadow-xs">
            {/* Title & Brand */}
            <div>
                <div className="flex items-center gap-2.5">
                    <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Cloud Cost Intelligence
                    </h1>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {activeProvider === "aws" ? "Live AWS Cost Analytics" : "Live Azure Cost Analytics"}
                </p>
            </div>

            {/* AWS / Azure Toggle Switch in Navbar */}
            <div className="flex items-center gap-3">
                <Tabs
                    value={activeProvider}
                    onValueChange={(v) => onProviderChange(v as Provider)}
                    className="w-auto"
                >
                    <TabsList className="bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
                        <TabsTrigger
                            value="aws"
                            className="px-4 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-xs dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-indigo-400 rounded-md transition-all cursor-pointer"
                        >
                            AWS
                        </TabsTrigger>

                        <TabsTrigger
                            value="azure"
                            className="px-4 py-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-sky-600 data-[state=active]:shadow-xs dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-sky-400 rounded-md transition-all cursor-pointer"
                        >
                            Azure
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
        </header>
    );
}


