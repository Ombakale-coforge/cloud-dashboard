import { useState, useRef } from "react";
import {
    CalendarDays,
    ChevronDown,
    Plus,
    Layers,
    Inbox,
    Shield,
    LogOut,
    SlidersHorizontal,
    X,
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
    accountId?: string;
    accountName?: string;
}

export interface SidebarProps {
    months: string[];
    selectedMonth: string;
    onMonthChange: (month: string) => void;
    activeProvider: Provider;
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
    awsAccounts = [],
    selectedAwsAccount = "account-1",
    onAwsAccountChange = () => { },
    azureAccounts = [],
    selectedAzureAccount = "account-1",
    onAzureAccountChange = () => { },
}: SidebarProps) {
    const navigate = useNavigate();
    const { user, logout, isAdmin } = useAuth();
    const { records } = useAccountRequests();
    const [isOpen, setIsOpen] = useState(false);
    const [isAdminRequestsOpen, setIsAdminRequestsOpen] = useState(false);
    const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const pendingRequestsCount = records.filter(
        (r) => (r.status || "pending") === "pending"
    ).length;

    const handleMouseEnter = () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
        setIsOpen(true);
    };

    const handleMouseLeave = () => {
        closeTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
        }, 300);
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

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

    const activeAccounts = activeProvider === "aws" ? awsAccounts : azureAccounts;
    const activeSelectedAccount = activeProvider === "aws" ? selectedAwsAccount : selectedAzureAccount;
    const handleActiveAccountChange = activeProvider === "aws" ? onAwsAccountChange : onAzureAccountChange;

    return (
        <>
            {/* Invisible / Compact Hover Edge Trigger on Left */}
            <div
                onMouseEnter={handleMouseEnter}
                className="fixed top-20 left-0 z-40 flex items-center group cursor-pointer"
            >
                <div className="flex items-center gap-1.5 py-3 px-2.5 bg-white dark:bg-slate-900 border border-l-0 border-slate-200 dark:border-slate-800 rounded-r-xl shadow-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all">
                    <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold select-none hidden sm:inline">Menu</span>
                </div>
            </div>

            {/* Backdrop overlay when sidebar is open */}
            {isOpen && (
                <div
                    onClick={() => setIsOpen(false)}
                    className="fixed inset-0 bg-slate-900/20 dark:bg-slate-950/40 backdrop-blur-xs z-40 transition-opacity"
                />
            )}

            {/* Slide-out Sidebar on Hover */}
            <aside
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={`fixed top-0 left-0 bottom-0 z-50 w-72 sm:w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl transition-transform duration-300 ease-in-out flex flex-col justify-between ${
                    isOpen ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                {/* Top Section */}
                <div className="p-5 space-y-6 overflow-y-auto">
                    {/* Brand / Close Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            <span className="text-sm font-bold text-slate-900 dark:text-white">
                                {activeProvider === "aws" ? "AWS Options" : "Azure Options"}
                            </span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Account Selector */}
                    {activeAccounts && activeAccounts.length > 0 && (
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                {activeProvider === "aws" ? "AWS Account" : "Azure Account / Scope"}
                            </label>
                            <div className="relative flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 px-3 py-2 transition-colors focus-within:border-indigo-500">
                                <Layers
                                    className={
                                        activeProvider === "aws"
                                            ? "h-4 w-4 text-amber-500 shrink-0 mr-2"
                                            : "h-4 w-4 text-sky-500 shrink-0 mr-2"
                                    }
                                />
                                <select
                                    value={activeSelectedAccount}
                                    onChange={(e) => handleActiveAccountChange(e.target.value)}
                                    className="w-full appearance-none bg-transparent pr-6 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer"
                                    title={activeProvider === "aws" ? "Select AWS Account" : "Select Azure Account"}
                                >
                                    {activeAccounts.map((acc) => {
                                        const displayName =
                                            acc.accountName && acc.accountId
                                                ? `${acc.accountName} (${acc.accountId})`
                                                : acc.name;
                                        return (
                                            <option
                                                key={acc.id}
                                                value={acc.id}
                                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium"
                                            >
                                                {displayName}
                                            </option>
                                        );
                                    })}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
                            </div>
                        </div>
                    )}

                    {/* Billing Month Selector */}
                    {months.length > 0 && (
                        <div className="space-y-1.5">
                            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Billing Period
                            </label>
                            <div className="relative flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 px-3 py-2 transition-colors focus-within:border-indigo-500">
                                <CalendarDays className="h-4 w-4 text-indigo-500 shrink-0 mr-2" />
                                <select
                                    value={selectedMonth}
                                    onChange={(e) => onMonthChange(e.target.value)}
                                    className="w-full appearance-none bg-transparent pr-6 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none cursor-pointer"
                                >
                                    {months.map((m) => (
                                        <option
                                            key={m}
                                            value={m}
                                            className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-medium"
                                        >
                                            {formatMonthName(m)}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 h-3.5 w-3.5 text-slate-400" />
                            </div>
                        </div>
                    )}

                    {/* Quick Action Features */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Actions
                        </label>

                        {/* Quick Add Request Button */}
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                navigate("/newrequest");
                            }}
                            className="w-full flex items-center justify-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 text-xs font-semibold shadow-xs transition-all cursor-pointer"
                        >
                            <Plus size={15} />
                            <span>New Request Form</span>
                        </button>

                        {/* Admin Account Requests Governance Button */}
                        {isAdmin && (
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    setIsAdminRequestsOpen(true);
                                }}
                                className="w-full relative flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                title="Manage Account Provisioning Requests"
                            >
                                <div className="flex items-center gap-2">
                                    <Inbox size={15} className="text-indigo-500" />
                                    <span>Review Requests</span>
                                </div>
                                {pendingRequestsCount > 0 && (
                                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                                        {pendingRequestsCount}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* Bottom Section: User Profile & Logout button */}
                <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-900 dark:text-white">
                                    {user?.name || "Administrator"}
                                </span>
                                {isAdmin && (
                                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                        <Shield className="w-2.5 h-2.5" />
                                        Admin
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                {user?.email}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/60 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-xs font-semibold transition-all cursor-pointer"
                        title="Sign Out"
                    >
                        <LogOut size={14} />
                        <span>Sign Out</span>
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
