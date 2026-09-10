import { useState } from "react";
import { Shield, LogOut } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AdminRequestsModal } from "./AdminRequestsModal";
import { useAccountRequests } from "@/lib/useAccountRequests";

export type Provider = "aws" | "azure";

export interface AccountOption {
    id: string;
    name: string;
    path: string;
}

export interface SidebarProps {
    months?: string[];
    selectedMonth?: string;
    onMonthChange?: (month: string) => void;
    activeProvider?: Provider;
    onProviderChange?: (provider: Provider) => void;
    awsAccounts?: AccountOption[];
    selectedAwsAccount?: string;
    onAwsAccountChange?: (accountId: string) => void;
    azureAccounts?: AccountOption[];
    selectedAzureAccount?: string;
    onAzureAccountChange?: (accountId: string) => void;
}

export function Sidebar({
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
}: SidebarProps) {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout, isAdmin } = useAuth();
    const { records = [] } = useAccountRequests() || {};
    const [isAdminRequestsOpen, setIsAdminRequestsOpen] = useState(false);

    const safeRecords = Array.isArray(records) ? records : [];
    const pendingRequestsCount = safeRecords.filter(
        (r) => (r?.status || "pending") === "pending"
    ).length;

    const formatMonthName = (mStr: string) => {
        if (!mStr) return "Select Month";
        const [year, month] = mStr.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);
        return date.toLocaleString("default", {
            month: "short",
            year: "numeric",
        });
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const activeAccounts = activeProvider === "aws" ? awsAccounts : azureAccounts;
    const activeSelectedAccount = activeProvider === "aws" ? selectedAwsAccount : selectedAzureAccount;
    const handleActiveAccountChange = activeProvider === "aws" ? onAwsAccountChange : onAzureAccountChange;

    const isRequestPage = location.pathname === "/newrequest";

    return (
        <>
            {/* Clean Vertical Navigation Sidebar */}
            <aside className="w-56 shrink-0 border-r border-slate-200/80 dark:border-border bg-white dark:bg-card flex flex-col justify-between min-h-screen p-5 sticky top-0 h-screen z-30 shadow-2xs">
                {/* Header & Menu Options (No option icons) */}
                <div className="space-y-6">
                    {/* Header */}
                    <div className="flex flex-col border-b border-slate-100 dark:border-border/60 pb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-foreground">
                                Cloud Intelligence
                            </span>
                            {isAdmin && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                    <Shield className="w-2.5 h-2.5" />
                                    Admin
                                </span>
                            )}
                        </div>
                        <span className="text-[11px] text-slate-400 dark:text-muted-foreground mt-0.5 font-medium">
                            Navigation Drawer
                        </span>
                    </div>

                    {/* Navigation Menu Options - Clean text without option icons */}
                    <nav className="space-y-1">
                        <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-muted-foreground/60 mb-2">
                            Cloud Analytics
                        </p>

                        <button
                            onClick={() => {
                                if (isRequestPage) navigate("/");
                                onProviderChange("aws");
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                !isRequestPage && activeProvider === "aws"
                                    ? "bg-indigo-600 text-white font-bold shadow-xs"
                                    : "text-slate-600 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-muted hover:text-slate-900"
                            }`}
                        >
                            AWS Analytics
                        </button>

                        <button
                            onClick={() => {
                                if (isRequestPage) navigate("/");
                                onProviderChange("azure");
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                !isRequestPage && activeProvider === "azure"
                                    ? "bg-indigo-600 text-white font-bold shadow-xs"
                                    : "text-slate-600 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-muted hover:text-slate-900"
                            }`}
                        >
                            Azure Analytics
                        </button>

                        <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-muted-foreground/60 pt-4 mb-2">
                            Management & Support
                        </p>

                        <button
                            onClick={() => navigate("/newrequest")}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                isRequestPage
                                    ? "bg-indigo-600 text-white font-bold shadow-xs"
                                    : "text-slate-600 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-muted hover:text-slate-900"
                            }`}
                        >
                            New Request Form
                        </button>

                        {isAdmin && (
                            <button
                                onClick={() => setIsAdminRequestsOpen(true)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-muted-foreground hover:bg-slate-100 dark:hover:bg-muted hover:text-slate-900 transition-all cursor-pointer"
                            >
                                <span>Review Requests</span>
                                {pendingRequestsCount > 0 && (
                                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                                        {pendingRequestsCount}
                                    </span>
                                )}
                            </button>
                        )}
                    </nav>

                    {/* Contextual Filters */}
                    {!isRequestPage && (
                        <div className="pt-4 border-t border-slate-100 dark:border-border/60 space-y-3">
                            <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-muted-foreground/60">
                                Context Selectors
                            </p>

                            {/* Account Selector */}
                            {activeAccounts && activeAccounts.length > 1 && (
                                <div className="space-y-1">
                                    <label className="px-2 text-[11px] text-slate-500 dark:text-muted-foreground font-medium block">
                                        Account
                                    </label>
                                    <select
                                        value={activeSelectedAccount}
                                        onChange={(e) => handleActiveAccountChange(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none cursor-pointer truncate"
                                    >
                                        {activeAccounts.map((acc) => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Month Selector */}
                            {months.length > 0 && (
                                <div className="space-y-1">
                                    <label className="px-2 text-[11px] text-slate-500 dark:text-muted-foreground font-medium block">
                                        Period
                                    </label>
                                    <select
                                        value={selectedMonth}
                                        onChange={(e) => onMonthChange(e.target.value)}
                                        className="w-full rounded-lg border border-slate-200 dark:border-border bg-slate-50 dark:bg-background px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-foreground focus:outline-none cursor-pointer truncate"
                                    >
                                        {months.map((m) => (
                                            <option key={m} value={m}>
                                                {formatMonthName(m)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom User Info */}
                <div className="pt-4 border-t border-slate-100 dark:border-border/60 flex items-center justify-between">
                    <div className="flex flex-col min-w-0 pr-2">
                        <span className="text-xs font-bold leading-tight text-slate-900 dark:text-foreground truncate">
                            {user?.name || "Administrator"}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-muted-foreground truncate mt-0.5">
                            {user?.email}
                        </span>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Sign Out"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </aside>

            {/* Admin Requests Modal Dialog */}
            <AdminRequestsModal
                isOpen={isAdminRequestsOpen}
                onClose={() => setIsAdminRequestsOpen(false)}
            />
        </>
    );
}
