import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Cloud,
    CalendarDays,
    ChevronDown,
    Plus,
    Shield,
    LogOut,
    Layers,
    Inbox,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AdminRequestsModal } from "./AdminRequestsModal";
import { useAccountRequests } from "@/lib/useAccountRequests";

export type Provider = "aws" | "azure";

export interface AccountOption {
    id: string;
    name: string;
    path: string;
}

// Kept as aliases for backwards compatibility with existing imports
export type AwsAccountOption = AccountOption;
export type AzureAccountOption = AccountOption;

export interface NavbarProps {
    months: string[];
    selectedMonth: string;
    onMonthChange: (month: string) => void;
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
    months = [],
    selectedMonth = "",
    onMonthChange = () => { },
    activeProvider = "aws",
    onProviderChange = () => { },
    awsAccounts = [],
    selectedAwsAccount = "account-1",
    onAwsAccountChange = () => { },
    azureAccounts = [],
    selectedAzureAccount = "account-1",
    onAzureAccountChange = () => { },
}: NavbarProps) {
    const navigate = useNavigate();
    const { user, logout, isAdmin } = useAuth();
    const { records } = useAccountRequests();
    const [isAdminRequestsOpen, setIsAdminRequestsOpen] = useState(false);

    console.log("Selected - month -> ", selectedMonth);

    const pendingRequestsCount = records.filter(
        (r) => (r.status || "pending") === "pending"
    ).length;

    // Format Month string (e.g. "2026-07" to "July 2026")
    const formatMonthName = (mStr: string) => {
        if (!mStr) return "Select Month";

        const [year, month] = mStr.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);

        return date.toLocaleString("default", {
            month: "long",
            year: "numeric",
        });
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    // Resolve the account list / selection / handler for whichever provider is active,
    // so AWS and Azure share the same account-selector UI.
    const activeAccounts = activeProvider === "aws" ? awsAccounts : azureAccounts;
    const activeSelectedAccount = activeProvider === "aws" ? selectedAwsAccount : selectedAzureAccount;
    const handleActiveAccountChange = activeProvider === "aws" ? onAwsAccountChange : onAzureAccountChange;

    return (
        <>
            <header className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-4 border-b bg-background/80 px-6 py-3 backdrop-blur">
                {/* Logo & Title */}
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                        <Cloud className="h-6 w-6 text-primary" />
                    </div>

                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold leading-none">Cloud Cost Intelligence</h1>
                            {isAdmin && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                                    <Shield className="w-2.5 h-2.5" />
                                    Admin
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {activeProvider === "aws" ? "Live AWS Cost Analytics" : "Live Azure Cost Analytics"}
                        </p>
                    </div>
                </div>

                {/* Right Controls */}
                <div className="flex items-center flex-wrap gap-2.5">
                    {/* Admin Account Requests Governance Button */}
                    {isAdmin && (
                        <button
                            onClick={() => setIsAdminRequestsOpen(true)}
                            className="relative flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-colors cursor-pointer"
                            title="Manage Account Provisioning Requests"
                        >
                            <Inbox size={14} className="text-indigo-500" />
                            <span>Review Requests</span>
                            {pendingRequestsCount > 0 && (
                                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                                    {pendingRequestsCount}
                                </span>
                            )}
                        </button>
                    )}

                    {/* Quick Add Request Button */}
                    <button
                        onClick={() => navigate("/newrequest")}
                        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all cursor-pointer"
                    >
                        <Plus size={14} />
                        <span>New Request Form</span>
                    </button>

                    {/* Account Selector Dropdown (shown for whichever provider is active, when it has multiple accounts) */}
                    {activeAccounts && activeAccounts.length > 1 && (
                        <div
                            className={
                                activeProvider === "aws"
                                    ? "relative flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/20 px-3 py-1.5 transition-colors"
                                    : "relative flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 dark:bg-sky-950/20 px-3 py-1.5 transition-colors"
                            }
                        >
                            <Layers
                                className={
                                    activeProvider === "aws"
                                        ? "h-4 w-4 text-amber-500 shrink-0"
                                        : "h-4 w-4 text-sky-500 shrink-0"
                                }
                            />

                            <select
                                value={activeSelectedAccount}
                                onChange={(e) => handleActiveAccountChange(e.target.value)}
                                className="appearance-none bg-transparent pr-6 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
                                title={activeProvider === "aws" ? "Select AWS Account" : "Select Azure Account"}
                            >
                                {activeAccounts.map((acc) => (
                                    <option
                                        key={acc.id}
                                        value={acc.id}
                                        className="bg-background text-foreground font-medium"
                                    >
                                        {acc.name}
                                    </option>
                                ))}
                            </select>

                            <ChevronDown
                                className={
                                    activeProvider === "aws"
                                        ? "pointer-events-none absolute right-3 h-3 w-3 text-amber-500/80"
                                        : "pointer-events-none absolute right-3 h-3 w-3 text-sky-500/80"
                                }
                            />
                        </div>
                    )}

                    {/* Month Selector */}
                    {months.length > 0 && (
                        <div className="relative flex items-center gap-2 rounded-xl border border-muted/80 bg-muted/40 px-3 py-1.5 transition-colors">
                            <CalendarDays className="h-4 w-4 text-indigo-500" />

                            <select
                                value={selectedMonth}
                                onChange={(e) => onMonthChange(e.target.value)}
                                className="appearance-none bg-transparent pr-6 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
                            >
                                {months.map((m) => (
                                    <option
                                        key={m}
                                        value={m}
                                        className="bg-background text-foreground"
                                    >
                                        {formatMonthName(m)}
                                    </option>
                                ))}
                            </select>

                            <ChevronDown className="pointer-events-none absolute right-3 h-3 w-3 text-muted-foreground" />
                        </div>
                    )}

                    {/* AWS / Azure Tabs */}
                    <Tabs
                        value={activeProvider}
                        onValueChange={(v) => onProviderChange(v as Provider)}
                        className="w-auto"
                    >
                        <TabsList className="bg-muted/60 p-0.5">
                            <TabsTrigger
                                value="aws"
                                className="px-4 py-1.5 text-xs font-semibold"
                            >
                                AWS
                            </TabsTrigger>

                            <TabsTrigger
                                value="azure"
                                className="px-4 py-1.5 text-xs font-semibold"
                            >
                                Azure
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* User profile & Logout */}
                    <div className="flex items-center gap-2 pl-2 border-l border-border">
                        <div className="hidden md:flex flex-col text-right">
                            <span className="text-xs font-medium leading-none text-foreground">
                                {user?.name || "Administrator"}
                            </span>
                            <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                {user?.email}
                            </span>
                        </div>

                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-1 p-2 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                            title="Sign Out"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Admin Requests Modal Dialog */}
            <AdminRequestsModal
                isOpen={isAdminRequestsOpen}
                onClose={() => setIsAdminRequestsOpen(false)}
            />
        </>
    );
}
