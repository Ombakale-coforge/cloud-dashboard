import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { AdminRequestsModal } from "@/components/AdminRequestsModal";
import { useAccountRequests } from "@/lib/useAccountRequests";
import { useAuth } from "@/lib/auth";
import { useCsv } from "@/lib/useCsv";
import type { AccountOption } from "@/components/Navbar";
import type {
  MonthTotal,
  AzureMonthlyTotal,
  GovernanceSummary,
  UnbudgetedAccountRow,
  BudgetOverviewRow,
} from "@/lib/types";
import {
  Cloud,
  ArrowRight,
  Layers,
  LogOut,
  Plus,
  Inbox,
  Shield,
  Building2,
  TrendingUp,
  Wallet,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Lock,
} from "lucide-react";

interface AzureGovernanceSummary {
  totalAccounts?: number;
  budgetedAccounts?: number;
  unbudgetedAccounts?: number;
  permissionDeniedAccounts?: number;
  totalBudgetedSpend?: number;
  activeSpend?: number;
}

interface AzureBudgetRow {
  "Linked Account": string;
  "Account ID": string;
  "Budget Name": string;
  "Budget Limit": number;
  "Actual Spend": number;
  "% Utilized": number;
  Status: string;
  "Permission Error"?: string;
}

const DEFAULT_AWS_ACCOUNTS: AccountOption[] = [
  {
    id: "account-1",
    name: "AWS Account 1 (5076-7238-5186)",
    accountId: "5076-7238-5186",
    accountName: "AWS Account 1",
    path: "/data",
  },
  {
    id: "account-2",
    name: "AWS Account 2 (5131-6780-3309)",
    accountId: "5131-6780-3309",
    accountName: "AWS Account 2",
    path: "/data/accounts/account-2",
  },
];

const formatAwsAccount = (acc: AccountOption): AccountOption => {
  const rawName = (acc.name || "")
    .replace(/\s*\(Primary\)/gi, "")
    .replace(/\s*\(Secondary\)/gi, "")
    .trim();
  let accountName = acc.accountName
    ? acc.accountName
        .replace(/\s*\(Primary\)/gi, "")
        .replace(/\s*\(Secondary\)/gi, "")
        .trim()
    : "";
  let accountId = acc.accountId || "";

  const match = rawName.match(/\(([^)]+)\)/);
  if (match) {
    accountId = match[1];
    accountName = rawName.replace(/\s*\([^)]+\)/, "").trim();
  } else if (!accountName) {
    accountName = rawName;
  }

  return {
    ...acc,
    name: accountId && accountName ? `${accountName} (${accountId})` : rawName,
    accountName: accountName || rawName,
    accountId: accountId || acc.id,
  };
};

/** Clean SVG Donut Gauge for Budget Coverage */
function CoverageGauge({
  percentage,
  colorClass,
  size = 68,
}: {
  percentage: number;
  colorClass: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percentage || 0));
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-slate-100 dark:text-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${colorClass} transition-all duration-700 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-extrabold text-slate-900 dark:text-white leading-none">
          {Math.round(clamped)}%
        </span>
      </div>
    </div>
  );
}

export function MultiCloudOverviewPage() {
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const { records } = useAccountRequests();
  const [isAdminRequestsOpen, setIsAdminRequestsOpen] = useState(false);

  // AWS Account State
  const [awsAccounts, setAwsAccounts] = useState<AccountOption[]>(DEFAULT_AWS_ACCOUNTS);
  const [selectedAwsAccount, setSelectedAwsAccount] = useState<string>("account-1");

  const pendingRequestsCount = useMemo(
    () => records.filter((r) => (r.status || "pending") === "pending").length,
    [records]
  );

  useEffect(() => {
    fetch("/api/aws/accounts")
      .then((res) => {
        if (res.ok) return res.json();
        return fetch("/data/accounts.json").then((r) => (r.ok ? r.json() : null));
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
      .catch(() => {});
  }, []);

  const currentAwsAccount = useMemo(
    () => awsAccounts.find((a) => a.id === selectedAwsAccount) || awsAccounts[0],
    [awsAccounts, selectedAwsAccount]
  );
  const awsBasePath = currentAwsAccount?.path || "/data";

  // Latest months for AWS & Azure
  const { data: awsMonthly } = useCsv<MonthTotal>(
    `${awsBasePath}/monthly_totals_last_6_months.csv`
  );
  const { data: azureMonthly } = useCsv<AzureMonthlyTotal>(
    `/data/azure/azure_usage_monthly_totals.csv`
  );

  const awsLatestMonth = useMemo(() => {
    const sorted = (awsMonthly || [])
      .filter((m) => m && m.Month)
      .map((m) => m.Month)
      .sort();
    return sorted.length > 0 ? sorted[sorted.length - 1] : "";
  }, [awsMonthly]);

  const azureLatestMonth = useMemo(() => {
    const sorted = (azureMonthly || [])
      .filter((m) => m && m.Month)
      .map((m) => m.Month)
      .sort();
    return sorted.length > 0 ? sorted[sorted.length - 1] : "";
  }, [azureMonthly]);

  const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long" });
  };

  const awsMonthLabel = formatMonthName(awsLatestMonth);

  // =========================================================================
  // AWS Governance Data
  // =========================================================================
  const [awsSummary, setAwsSummary] = useState<GovernanceSummary | null>(null);

  useEffect(() => {
    let active = true;
    const monthParam = awsLatestMonth ? `&month=${encodeURIComponent(awsLatestMonth)}` : "";
    const apiUrl = `/api/aws/dataset/governance_summary?account=${encodeURIComponent(
      selectedAwsAccount
    )}${monthParam}`;

    fetch(apiUrl)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error(`API ${res.status}`);
      })
      .then((data) => {
        if (!active) return;
        if (data) setAwsSummary(Array.isArray(data) ? data[0] : data);
      })
      .catch(() => {
        fetch(`${awsBasePath}/governance_summary.json`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (active && data) setAwsSummary(data);
          })
          .catch(() => {
            if (active) setAwsSummary(null);
          });
      });

    return () => {
      active = false;
    };
  }, [awsBasePath, selectedAwsAccount, awsLatestMonth]);

  const unbudgetedPath = awsLatestMonth
    ? `${awsBasePath}/unbudgeted_accounts.csv?month=${encodeURIComponent(awsLatestMonth)}`
    : `${awsBasePath}/unbudgeted_accounts.csv`;
  const { data: awsUnbudgeted } = useCsv<UnbudgetedAccountRow>(unbudgetedPath);
  const { data: awsBudgets } = useCsv<BudgetOverviewRow>(
    `${awsBasePath}/budgets_overview.csv`
  );

  const validAwsUnbudgeted = useMemo(
    () => (awsUnbudgeted || []).filter((a) => a && a["Account Name"]),
    [awsUnbudgeted]
  );
  const topAwsUnbudgeted = useMemo(
    () => validAwsUnbudgeted.slice(0, 4),
    [validAwsUnbudgeted]
  );

  const validAwsBudgets = useMemo(
    () => (awsBudgets || []).filter((b) => b && b["Budget Name"]),
    [awsBudgets]
  );
  const topAwsBudgets = useMemo(
    () => validAwsBudgets.slice(0, 4),
    [validAwsBudgets]
  );

  // =========================================================================
  // Azure Governance Data
  // =========================================================================
  const [azureSummary, setAzureSummary] = useState<AzureGovernanceSummary | null>(null);
  const [azureBudgets, setAzureBudgets] = useState<AzureBudgetRow[]>([]);
  const [azureUnbudgetedCount, setAzureUnbudgetedCount] = useState(0);
  const [syncingAzure, setSyncingAzure] = useState(false);

  const loadAzureData = () => {
    const monthParam = azureLatestMonth
      ? `?month=${encodeURIComponent(azureLatestMonth)}`
      : "";
    Promise.all([
      fetch(`/api/azure/dataset/governance_summary${monthParam}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/azure/dataset/budgets_overview${monthParam}`).then((r) =>
        r.ok ? r.json() : []
      ),
      fetch(`/api/azure/dataset/unbudgeted_accounts${monthParam}`).then((r) =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([summaryData, budgetsData, unbudgetedData]) => {
        if (summaryData) setAzureSummary(summaryData);
        if (Array.isArray(budgetsData)) setAzureBudgets(budgetsData);
        if (Array.isArray(unbudgetedData)) setAzureUnbudgetedCount(unbudgetedData.length);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAzureData();
  }, [azureLatestMonth]);

  const handleSyncAzureBudgets = async () => {
    setSyncingAzure(true);
    try {
      const res = await fetch("/api/azure/budgets/sync", { method: "POST" });
      if (res.ok) loadAzureData();
    } catch {
      // ignore
    } finally {
      setSyncingAzure(false);
    }
  };

  const activeAzureBudgets = useMemo(
    () =>
      azureBudgets.filter(
        (b) => b.Status !== "Permission Denied" && b.Status !== "Unbudgeted"
      ),
    [azureBudgets]
  );
  const topAzureBudgets = useMemo(
    () => activeAzureBudgets.slice(0, 4),
    [activeAzureBudgets]
  );

  const azureTotalAccounts =
    azureSummary?.totalAccounts || azureBudgets.length || azureUnbudgetedCount || 0;
  const azureBudgetedAccounts =
    azureSummary?.budgetedAccounts ||
    azureBudgets.filter(
      (b) => b.Status === "On Track" || b.Status === "Warning" || b.Status === "Exceeded"
    ).length;
  const azurePermissionDenied =
    azureSummary?.permissionDeniedAccounts ||
    azureBudgets.filter((b) => b.Status === "Permission Denied").length;
  const azureCoveragePct =
    azureTotalAccounts > 0
      ? Math.round((azureBudgetedAccounts / azureTotalAccounts) * 100)
      : 0;

  const awsBudgetedSpendPct = useMemo(() => {
    if (!awsSummary || !awsSummary.activeSpendTotal) return 50;
    return Math.max(
      5,
      Math.min(
        95,
        Math.round((awsSummary.spendUnderBudget / awsSummary.activeSpendTotal) * 100)
      )
    );
  }, [awsSummary]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-slate-100/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased flex flex-col">
        {/* ================================================================= */}
        {/* CLEAN TOP BAR                                                     */}
        {/* ================================================================= */}
        <header className="shrink-0 h-14 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-sm">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  Cloud Cost Intelligence
                </h1>
                <span className="hidden sm:inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800">
                  Executive Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Multi-Cloud Governance & Budgets Command Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => navigate("/newrequest")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-500" />
              <span>New Request</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => setIsAdminRequestsOpen(true)}
                className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Inbox className="w-3.5 h-3.5 text-indigo-500" />
                <span>Requests</span>
                {pendingRequestsCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {pendingRequestsCount}
                  </span>
                )}
              </button>
            )}

            <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200 dark:border-slate-800">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center justify-end gap-1">
                  {user?.name || "Admin"}
                  <Shield className="w-3 h-3 text-indigo-500" />
                </span>
                <span className="text-[10px] text-slate-400">{user?.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        {/* ================================================================= */}
        {/* 50 / 50 EXECUTIVE PORTAL SPLIT (AWS LEFT | AZURE RIGHT)           */}
        {/* ================================================================= */}
        <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-5 p-5 overflow-hidden">
          {/* =============================================================== */}
          {/* LEFT PORTAL CARD: AWS ORGANIZATION & BUDGET GOVERNANCE          */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-0 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner */}
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/60 via-white to-amber-50/40 dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 font-extrabold text-xs shadow-2xs">
                  AWS
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      AWS Governance & Budgets
                    </h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                    >
                      {awsMonthLabel}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Organization inventory, budget coverage & unbudgeted exposure
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Account 1 / Account 2 Pill Switcher */}
                {awsAccounts.length > 1 && (
                  <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700">
                    {awsAccounts.map((acc, idx) => {
                      const active = acc.id === selectedAwsAccount;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => setSelectedAwsAccount(acc.id)}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                            active
                              ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                              : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
                          }`}
                          title={acc.name}
                        >
                          Account {idx + 1}
                        </button>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => navigate("/linked-accounts")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Accounts</span>
                </button>

                <button
                  onClick={() =>
                    navigate(`/aws?account=${encodeURIComponent(selectedAwsAccount)}`)
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-all cursor-pointer"
                >
                  <span>Enter AWS</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-5 flex flex-col justify-between gap-4 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Budget Coverage + Org Accounts */}
                <div className="col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex items-center gap-3.5">
                  <CoverageGauge
                    percentage={awsSummary?.budgetCoveragePct || 0}
                    colorClass="text-emerald-500"
                    size={64}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        Budget Coverage
                      </span>
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {awsSummary ? awsSummary.totalAccounts : "--"} Org Accs
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        {awsSummary ? `${awsSummary.accountsWithBudget} budgeted` : "--"}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <span className="text-amber-600 dark:text-amber-400 font-semibold">
                        {awsSummary ? `${awsSummary.accountsWithNoBudget} unbudgeted` : "--"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 pt-0.5">
                      <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {awsSummary ? `${awsSummary.activeAccounts} active` : "--"}
                      </span>
                      <span>•</span>
                      <span>{awsSummary ? `${awsSummary.suspendedAccounts} closed` : "--"}</span>
                    </div>
                  </div>
                </div>

                {/* Spend & Limits Visual Card */}
                <div className="col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex flex-col justify-between">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        {awsMonthLabel} Spend
                      </div>
                      <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                        $
                        {awsSummary
                          ? awsSummary.activeSpendTotal.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : "--"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-purple-500" />
                        Budget Limits
                      </div>
                      <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        $
                        {awsSummary
                          ? awsSummary.sumBudgetLimits.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : "--"}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        Suspended Leakage
                      </div>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <span className="text-lg font-extrabold text-amber-600 dark:text-amber-400">
                          {awsSummary ? awsSummary.suspendedAccountsChargingCount : 0}
                        </span>
                        <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                          ($
                          {awsSummary
                            ? awsSummary.suspendedAccountsSpendTotal.toLocaleString(
                                undefined,
                                { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                              )
                            : "0.00"}
                          )
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Segmented Spend Bar: Under Budget vs Unbudgeted */}
                  <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        $
                        {awsSummary
                          ? awsSummary.spendUnderBudget.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : 0}{" "}
                        under budget
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">
                        $
                        {awsSummary
                          ? awsSummary.spendWithNoBudget.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : 0}{" "}
                        unbudgeted ({awsSummary ? `${awsSummary.shareSpendUncoveredPct}%` : "0%"})
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-rose-500/20 overflow-hidden flex">
                      <div
                        className="h-full bg-emerald-500 rounded-l-full"
                        style={{ width: `${awsBudgetedSpendPct}%` }}
                      />
                      <div
                        className="h-full bg-rose-500 rounded-r-full"
                        style={{ width: `${100 - awsBudgetedSpendPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Clean Top Previews (Side-by-Side: Top Unbudgeted Accounts & Top AWS Budgets) */}
              <div className="flex-1 min-h-0 grid grid-cols-2 gap-3.5 overflow-hidden">
                {/* Preview 1: Largest Accounts with No Budget */}
                <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Largest Accounts with No Budget
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      {validAwsUnbudgeted.length} total
                    </span>
                  </div>

                  <div className="flex-1 min-h-0 flex flex-col justify-between divide-y divide-slate-200/60 dark:divide-slate-800">
                    {topAwsUnbudgeted.length > 0 ? (
                      topAwsUnbudgeted.map((acc, i) => (
                        <div
                          key={i}
                          className="py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div
                              className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
                              title={acc["Account Name"]}
                            >
                              {acc["Account Name"]}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {acc["Account ID"]}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                              $
                              {Number(acc["Current Month Spend"] || 0).toLocaleString(
                                undefined,
                                { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                              )}
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                        No unbudgeted accounts
                      </div>
                    )}
                  </div>
                </div>

                {/* Preview 2: AWS Budgets Overview */}
                <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        AWS Budgets Overview
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {validAwsBudgets.length} active
                    </span>
                  </div>

                  <div className="flex-1 min-h-0 flex flex-col justify-between divide-y divide-slate-200/60 dark:divide-slate-800">
                    {topAwsBudgets.length > 0 ? (
                      topAwsBudgets.map((b, i) => {
                        const limit = Number(b.Limit ?? b["Budget Limit"] ?? 0);
                        const used = Number(b["Current Used"] ?? b["Current Spend"] ?? 0);
                        const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
                        const isExceeded =
                          b["Threshold Status"]?.toLowerCase().includes("exceeded") ||
                          pct >= 100;

                        return (
                          <div key={i} className="py-2 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
                                title={b["Budget Name"]}
                              >
                                {b["Budget Name"]}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                                ${used.toLocaleString(undefined, { maximumFractionDigits: 0 })} / $
                                {limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-200/70 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isExceeded
                                      ? "bg-rose-500"
                                      : pct >= 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono font-bold text-slate-500 w-8 text-right">
                                {pct}%
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                        No active budgets
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT PORTAL CARD: AZURE BUDGETS & GOVERNANCE                   */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-0 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner */}
            <div className="shrink-0 px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50/70 via-white to-blue-50/40 dark:from-sky-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 font-extrabold text-xs shadow-2xs">
                  AZ
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Azure Budgets & Governance
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Management-configured budgets, thresholds & RBAC status
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncAzureBudgets}
                  disabled={syncingAzure}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${syncingAzure ? "animate-spin text-sky-600" : ""}`}
                  />
                  <span>{syncingAzure ? "Syncing..." : "Sync"}</span>
                </button>

                <button
                  onClick={() => navigate("/azure/subscriptions")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5 text-sky-500" />
                  <span>Subscriptions</span>
                </button>

                <button
                  onClick={() => navigate("/azure")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-all cursor-pointer"
                >
                  <span>Enter Azure</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-5 flex flex-col justify-between gap-4 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Azure Coverage + Permission Restricted */}
                <div className="col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex items-center gap-3.5">
                  <CoverageGauge
                    percentage={azureCoveragePct}
                    colorClass="text-sky-500"
                    size={64}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      Budget Coverage
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      {azureBudgetedAccounts} of {azureTotalAccounts} subscriptions
                    </div>
                    <div className="text-[11px] flex items-center gap-1.5 pt-0.5 text-purple-600 dark:text-purple-400 font-semibold">
                      <Lock className="w-3 h-3" />
                      <span>{azurePermissionDenied} subs missing RBAC</span>
                    </div>
                  </div>
                </div>

                {/* Spend & Allocation Summary Card */}
                <div className="col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex flex-col justify-center">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                        Total Budget Allocated
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1 truncate">
                        ₹{(azureSummary?.totalBudgetedSpend || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                        Configured across {azureBudgetedAccounts} subs
                      </div>
                    </div>

                    <div className="border-l border-slate-200/70 dark:border-slate-700/70 pl-4">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                        Active Month Spend
                      </div>
                      <div className="text-xl font-extrabold text-slate-900 dark:text-white mt-1 truncate">
                        ₹
                        {(azureSummary?.activeSpend || 0).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Live consumption across org
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Clean Top 4 Azure Subscriptions Budget Tracking Preview */}
              <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                <div className="shrink-0 flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-sky-600" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Azure Subscriptions Budget Tracking
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                    Top {topAzureBudgets.length} of {activeAzureBudgets.length} budgets
                  </span>
                </div>

                <div className="flex-1 min-h-0 flex flex-col justify-between divide-y divide-slate-200/60 dark:divide-slate-800">
                  {topAzureBudgets.length > 0 ? (
                    topAzureBudgets.map((b, idx) => {
                      const isExceeded = b.Status === "Exceeded";
                      const isWarning = b.Status === "Warning";

                      return (
                        <div
                          key={idx}
                          className="py-2 flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
                                title={b["Linked Account"]}
                              >
                                {b["Linked Account"]}
                              </span>
                              <span className="text-[10px] text-slate-400 truncate max-w-[160px]">
                                ({b["Budget Name"]})
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">
                              {b["Account ID"]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 w-36">
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              ₹
                              {(b["Actual Spend"] || 0).toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}{" "}
                              <span className="text-[10px] font-normal text-slate-400">
                                / ₹{(b["Budget Limit"] || 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="flex-1 h-1.5 bg-slate-200/70 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isExceeded
                                      ? "bg-rose-500"
                                      : isWarning
                                      ? "bg-amber-500"
                                      : "bg-emerald-500"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, b["% Utilized"] || 0)}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300">
                                {b["% Utilized"]}%
                              </span>
                            </div>
                          </div>

                          <div className="shrink-0 w-18 text-right">
                            <Badge
                              className={`text-[10px] px-2 py-0.5 border ${
                                isExceeded
                                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
                                  : isWarning
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                              }`}
                            >
                              {b.Status || "On Track"}
                            </Badge>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                      No Azure budgets found
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Admin Requests Modal */}
        <AdminRequestsModal
          isOpen={isAdminRequestsOpen}
          onClose={() => setIsAdminRequestsOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}
