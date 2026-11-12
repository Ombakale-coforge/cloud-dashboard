import { useState, useEffect, useMemo, useRef } from "react";
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
  ChevronLeft,
  ChevronRight,
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
    name: "AWS-Encora (5076-7238-5186)",
    accountId: "5076-7238-5186",
    accountName: "AWS-Encora",
    path: "/data",
  },
  {
    id: "account-2",
    name: "AWS-Coforge (5131-6780-3309)",
    accountId: "5131-6780-3309",
    accountName: "AWS-Coforge",
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

  const cleanId = (accountId || acc.id || "").replace(/[^0-9]/g, "");
  if (cleanId === "513167803309" || acc.id === "account-2") {
    accountName = "AWS-Coforge";
  } else if (cleanId === "507672385186" || acc.id === "account-1") {
    accountName = "AWS-Encora";
  }

  return {
    ...acc,
    name: accountId && accountName ? `${accountName} (${accountId})` : (accountName || rawName),
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
  const budgetsPath = awsLatestMonth
    ? `${awsBasePath}/budgets_overview.csv?month=${encodeURIComponent(awsLatestMonth)}`
    : `${awsBasePath}/budgets_overview.csv`;
  const { data: awsBudgets } = useCsv<BudgetOverviewRow>(budgetsPath);

  const awsListRef = useRef<HTMLDivElement | null>(null);
  const azureListRef = useRef<HTMLDivElement | null>(null);
  const [awsItemsPerPage, setAwsItemsPerPage] = useState(5);
  const [azureItemsPerPage, setAzureItemsPerPage] = useState(5);

  const [pageAwsUnbudgeted, setPageAwsUnbudgeted] = useState(1);
  const [pageAwsBudgets, setPageAwsBudgets] = useState(1);
  const [pageAzureBudgets, setPageAzureBudgets] = useState(1);

  // Dynamically compute how many rows fit cleanly whenever window/card resizes or zooms
  useEffect(() => {
    const ROW_HEIGHT = 50; // comfortable height in px per row without overlapping
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (height > 0) {
          const fitCount = Math.max(3, Math.floor(height / ROW_HEIGHT));
          if (entry.target === awsListRef.current) {
            setAwsItemsPerPage(fitCount);
          } else if (entry.target === azureListRef.current) {
            setAzureItemsPerPage(fitCount);
          }
        }
      }
    });

    if (awsListRef.current) observer.observe(awsListRef.current);
    if (azureListRef.current) observer.observe(azureListRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPageAwsUnbudgeted(1);
    setPageAwsBudgets(1);
  }, [selectedAwsAccount]);

  const validAwsUnbudgeted = useMemo(
    () => (awsUnbudgeted || []).filter((a) => a && a["Account Name"]),
    [awsUnbudgeted]
  );
  const totalPagesAwsUnbudgeted = Math.max(
    1,
    Math.ceil(validAwsUnbudgeted.length / awsItemsPerPage)
  );
  useEffect(() => {
    setPageAwsUnbudgeted((p) => Math.min(p, totalPagesAwsUnbudgeted));
  }, [totalPagesAwsUnbudgeted]);

  const paginatedAwsUnbudgeted = useMemo(
    () =>
      validAwsUnbudgeted.slice(
        (pageAwsUnbudgeted - 1) * awsItemsPerPage,
        pageAwsUnbudgeted * awsItemsPerPage
      ),
    [validAwsUnbudgeted, pageAwsUnbudgeted, awsItemsPerPage]
  );

  const validAwsBudgets = useMemo(
    () => (awsBudgets || []).filter((b) => b && b["Budget Name"]),
    [awsBudgets]
  );
  const totalPagesAwsBudgets = Math.max(
    1,
    Math.ceil(validAwsBudgets.length / awsItemsPerPage)
  );
  useEffect(() => {
    setPageAwsBudgets((p) => Math.min(p, totalPagesAwsBudgets));
  }, [totalPagesAwsBudgets]);

  const paginatedAwsBudgets = useMemo(
    () =>
      validAwsBudgets.slice(
        (pageAwsBudgets - 1) * awsItemsPerPage,
        pageAwsBudgets * awsItemsPerPage
      ),
    [validAwsBudgets, pageAwsBudgets, awsItemsPerPage]
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

  // =========================================================================
  // GCP Governance Data
  // =========================================================================
  const [gcpSummary, setGcpSummary] = useState<any>(null);
  const [gcpBudgets, setGcpBudgets] = useState<any[]>([]);
  const [pageGcpBudgets, setPageGcpBudgets] = useState(1);
  const gcpItemsPerPage = 4;

  const loadGcpData = () => {
    Promise.all([
      fetch("/api/gcp/summary").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/gcp/budgets").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([summaryData, budgetsData]) => {
        if (summaryData) setGcpSummary(summaryData);
        if (Array.isArray(budgetsData)) setGcpBudgets(budgetsData);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadGcpData();
  }, []);

  const totalPagesGcpBudgets = Math.max(
    1,
    Math.ceil(gcpBudgets.length / gcpItemsPerPage)
  );

  const paginatedGcpBudgets = useMemo(
    () =>
      gcpBudgets.slice(
        (pageGcpBudgets - 1) * gcpItemsPerPage,
        pageGcpBudgets * gcpItemsPerPage
      ),
    [gcpBudgets, pageGcpBudgets, gcpItemsPerPage]
  );

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
  const totalPagesAzureBudgets = Math.max(
    1,
    Math.ceil(activeAzureBudgets.length / azureItemsPerPage)
  );
  useEffect(() => {
    setPageAzureBudgets((p) => Math.min(p, totalPagesAzureBudgets));
  }, [totalPagesAzureBudgets]);

  const paginatedAzureBudgets = useMemo(
    () =>
      activeAzureBudgets.slice(
        (pageAzureBudgets - 1) * azureItemsPerPage,
        pageAzureBudgets * azureItemsPerPage
      ),
    [activeAzureBudgets, pageAzureBudgets, azureItemsPerPage]
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
      <div className="min-h-screen w-full overflow-x-hidden bg-slate-100/80 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased flex flex-col">
        {/* ================================================================= */}
        {/* CLEAN TOP BAR                                                     */}
        {/* ================================================================= */}
        <header className="shrink-0 h-14 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-sm">
              <Cloud className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white truncate">
                  Cloud Cost Intelligence
                </h1>
                <span className="hidden sm:inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800 shrink-0">
                  Executive Portal
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Multi-Cloud Governance &amp; Budgets Command Center
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => navigate("/newrequest")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-500" />
              <span className="hidden sm:inline">New Request</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => setIsAdminRequestsOpen(true)}
                className="relative inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                <Inbox className="w-3.5 h-3.5 text-indigo-500" />
                <span className="hidden sm:inline">Requests</span>
                {pendingRequestsCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {pendingRequestsCount}
                  </span>
                )}
              </button>
            )}

            <div className="flex items-center gap-2.5 pl-2.5 border-l border-slate-200 dark:border-slate-800">
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
        {/* MULTI-CLOUD EXECUTIVE COMMAND CENTER (AWS | AZURE | GCP)          */}
        {/* ================================================================= */}
        <main className="flex-1 p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* =============================================================== */}
          {/* LEFT PORTAL CARD: AWS ORGANIZATION & BUDGET GOVERNANCE          */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[560px] rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Non-Colliding Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/60 via-white to-amber-50/40 dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 font-extrabold text-xs shadow-2xs">
                    AWS
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      AWS Governance
                    </h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 shrink-0"
                    >
                      {awsMonthLabel}
                    </Badge>
                  </div>
                </div>

                <button
                  onClick={() =>
                    navigate(`/aws?account=${encodeURIComponent(selectedAwsAccount)}`)
                  }
                  className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-[11px] font-semibold shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Enter AWS</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 2: Subtitle & Account Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px] sm:max-w-none">
                  Organization inventory &amp; budgets
                </p>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* AWS Account Pill Switcher */}
                  {awsAccounts.length > 1 && (
                    <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/80 dark:border-slate-700">
                      {awsAccounts.map((acc) => {
                        const active = acc.id === selectedAwsAccount;
                        const label =
                          acc.accountName?.replace(/^AWS-?/i, "") ||
                          (acc.id === "account-2" ? "Coforge" : "Encora");
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => setSelectedAwsAccount(acc.id)}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap ${
                              active
                                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
                            }`}
                            title={acc.name}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    onClick={() => navigate("/linked-accounts")}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Layers className="w-3 h-3 text-indigo-500" />
                    <span>Accounts</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Budget Coverage + Org Accounts */}
                <div className="col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-2.5 flex items-center gap-2.5 min-w-0">
                  <CoverageGauge
                    percentage={awsSummary?.budgetCoveragePct || 0}
                    colorClass="text-emerald-500"
                    size={50}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        Coverage
                      </span>
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                        {awsSummary ? awsSummary.totalAccounts : "--"} Accs
                      </span>
                    </div>

                    {/* Budgeted vs Unbudgeted */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-semibold leading-tight">
                      <span className="text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {awsSummary ? awsSummary.accountsWithBudget : "--"} budgeted
                      </span>
                      <span className="text-amber-600 dark:text-amber-500 whitespace-nowrap">
                        {awsSummary ? awsSummary.accountsWithNoBudget : "--"} unbudgeted
                      </span>
                    </div>

                    {/* Active vs Closed */}
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-tight">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        {awsSummary ? awsSummary.activeAccounts : "--"} active
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <span>{awsSummary ? awsSummary.suspendedAccounts : "--"} closed</span>
                    </div>
                  </div>
                </div>

                {/* Spend & Limits Visual Card */}
                <div className="col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-between">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <TrendingUp className="w-3 h-3 text-blue-500 shrink-0" />
                        <span className="truncate">{awsMonthLabel} Spend</span>
                      </div>
                      <div className="text-base xl:text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        $
                        {awsSummary
                          ? awsSummary.activeSpendTotal.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : "--"}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <Wallet className="w-3 h-3 text-purple-500 shrink-0" />
                        <span className="truncate">Budget Limits</span>
                      </div>
                      <div className="text-base xl:text-lg font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        $
                        {awsSummary
                          ? awsSummary.sumBudgetLimits.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : "--"}
                      </div>
                    </div>
                  </div>

                  {/* Suspended Leaks notice */}
                  <div className="mt-1 flex items-center justify-between text-[11px] bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 px-2 py-0.5 rounded-md">
                    <span className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1 truncate">
                      <AlertTriangle className="w-3 h-3 shrink-0 text-amber-500" />
                      <span className="truncate">Suspended Leaks</span>
                    </span>
                    <span className="font-bold text-amber-700 dark:text-amber-300 whitespace-nowrap ml-1">
                      {awsSummary ? awsSummary.suspendedAccountsChargingCount : 0}{" "}
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">
                        (${awsSummary ? awsSummary.suspendedAccountsSpendTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0"})
                      </span>
                    </span>
                  </div>

                  {/* Segmented Spend Bar: Under Budget vs Unbudgeted */}
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between text-[11px] mb-1 gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                        $
                        {awsSummary
                          ? awsSummary.spendUnderBudget.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : 0}{" "}
                        under budget
                      </span>
                      <span className="text-rose-600 dark:text-rose-400 font-semibold truncate">
                        $
                        {awsSummary
                          ? awsSummary.spendWithNoBudget.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : 0}{" "}
                        unbudgeted ({awsSummary ? `${awsSummary.shareSpendUncoveredPct}%` : "0%"})
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-rose-500/20 overflow-hidden flex">
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

              {/* Paginated Cards (Side-by-Side: Unbudgeted Accounts & AWS Budgets) */}
              <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3.5 overflow-hidden">
                {/* Card 1: Largest Accounts with No Budget */}
                <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        Largest Accounts with No Budget
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0">
                      {validAwsUnbudgeted.length} total
                    </span>
                  </div>

                  <div
                    ref={awsListRef}
                    className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden"
                  >
                    {paginatedAwsUnbudgeted.length > 0 ? (
                      paginatedAwsUnbudgeted.map((acc, i) => (
                        <div
                          key={i}
                          className={`${
                            paginatedAwsUnbudgeted.length === awsItemsPerPage ? "flex-1" : ""
                          } py-1.5 flex items-center justify-between gap-2`}
                        >
                          <div className="min-w-0">
                            <div
                              className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                              title={acc["Account Name"]}
                            >
                              {acc["Account Name"]}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono leading-tight mt-0.5">
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

                  {/* Pagination Footer */}
                  <div className="shrink-0 pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {validAwsUnbudgeted.length > 0
                        ? `${(pageAwsUnbudgeted - 1) * awsItemsPerPage + 1}–${Math.min(
                            pageAwsUnbudgeted * awsItemsPerPage,
                            validAwsUnbudgeted.length
                          )} of ${validAwsUnbudgeted.length}`
                        : "0 of 0"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPageAwsUnbudgeted((p) => Math.max(1, p - 1))}
                        disabled={pageAwsUnbudgeted <= 1}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Previous Page"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
                        {pageAwsUnbudgeted} / {totalPagesAwsUnbudgeted}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPageAwsUnbudgeted((p) =>
                            Math.min(totalPagesAwsUnbudgeted, p + 1)
                          )
                        }
                        disabled={pageAwsUnbudgeted >= totalPagesAwsUnbudgeted}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Next Page"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card 2: AWS Budgets Overview */}
                <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        AWS Budgets Overview
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                      {validAwsBudgets.length} active
                    </span>
                  </div>

                  <div className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden">
                    {paginatedAwsBudgets.length > 0 ? (
                      paginatedAwsBudgets.map((b, i) => {
                        const limit = Number(b.Limit ?? b["Budget Limit"] ?? 0);
                        const used = Number(b["Current Used"] ?? b["Current Spend"] ?? 0);
                        const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
                        const isExceeded =
                          b["Threshold Status"]?.toLowerCase().includes("exceeded") ||
                          pct >= 100;

                        return (
                          <div
                            key={i}
                            className={`${
                              paginatedAwsBudgets.length === awsItemsPerPage ? "flex-1" : ""
                            } py-1.5 flex flex-col justify-center space-y-1`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                                title={b["Budget Name"]}
                              >
                                {b["Budget Name"]}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0 leading-tight">
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
                              <span className="text-[10px] font-mono font-bold text-slate-500 w-8 text-right leading-none">
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

                  {/* Pagination Footer */}
                  <div className="shrink-0 pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      {validAwsBudgets.length > 0
                        ? `${(pageAwsBudgets - 1) * awsItemsPerPage + 1}–${Math.min(
                            pageAwsBudgets * awsItemsPerPage,
                            validAwsBudgets.length
                          )} of ${validAwsBudgets.length}`
                        : "0 of 0"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPageAwsBudgets((p) => Math.max(1, p - 1))}
                        disabled={pageAwsBudgets <= 1}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Previous Page"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
                        {pageAwsBudgets} / {totalPagesAwsBudgets}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPageAwsBudgets((p) => Math.min(totalPagesAwsBudgets, p + 1))
                        }
                        disabled={pageAwsBudgets >= totalPagesAwsBudgets}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Next Page"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT PORTAL CARD: AZURE BUDGETS & GOVERNANCE                   */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[540px] lg:min-h-0 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Non-Colliding Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50/70 via-white to-blue-50/40 dark:from-sky-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 font-extrabold text-xs shadow-2xs">
                    AZ
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    Azure Budgets & Governance
                  </h2>
                </div>

                <button
                  onClick={() => navigate("/azure")}
                  className="inline-flex items-center gap-1 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 text-[11px] font-semibold shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Enter Azure</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 2: Subtitle & Secondary Action Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px] sm:max-w-none">
                  Management-configured budgets & thresholds
                </p>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={handleSyncAzureBudgets}
                    disabled={syncingAzure}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${syncingAzure ? "animate-spin text-sky-600" : ""}`}
                    />
                    <span>{syncingAzure ? "Syncing..." : "Sync"}</span>
                  </button>

                  <button
                    onClick={() => navigate("/azure/subscriptions")}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Layers className="w-3 h-3 text-sky-500" />
                    <span>Subscriptions</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Azure Coverage + Permission Restricted */}
                <div className="col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex items-center gap-3">
                  <CoverageGauge
                    percentage={azureCoveragePct}
                    colorClass="text-sky-500"
                    size={56}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      Budget Coverage
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium truncate">
                      {azureBudgetedAccounts} of {azureTotalAccounts} subscriptions
                    </div>
                    <div className="text-[11px] flex items-center gap-1 pt-0.5 text-purple-600 dark:text-purple-400 font-semibold truncate">
                      <Lock className="w-3 h-3 shrink-0" />
                      <span className="truncate">{azurePermissionDenied} subs missing RBAC</span>
                    </div>
                  </div>
                </div>

                {/* Spend & Allocation Summary Card */}
                <div className="col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-center">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <Wallet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">Total Budget Allocated</span>
                      </div>
                      <div className="text-lg xl:text-xl font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        ₹{(azureSummary?.totalBudgetedSpend || 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 truncate">
                        Configured across {azureBudgetedAccounts} subs
                      </div>
                    </div>

                    <div className="border-l border-slate-200/70 dark:border-slate-700/70 pl-3 min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate">Active Month Spend</span>
                      </div>
                      <div className="text-lg xl:text-xl font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        ₹
                        {(azureSummary?.activeSpend || 0).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        Live consumption across org
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Paginated Azure Subscriptions Budget Tracking Card */}
              <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                <div className="shrink-0 flex items-center justify-between mb-1.5 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Wallet className="h-4 w-4 text-sky-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      Azure Subscriptions Budget Tracking
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400 shrink-0">
                    {activeAzureBudgets.length} budgets
                  </span>
                </div>

                <div
                  ref={azureListRef}
                  className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden"
                >
                  {paginatedAzureBudgets.length > 0 ? (
                    paginatedAzureBudgets.map((b, idx) => {
                      const isExceeded = b.Status === "Exceeded";
                      const isWarning = b.Status === "Warning";

                      return (
                        <div
                          key={idx}
                          className={`${
                            paginatedAzureBudgets.length === azureItemsPerPage ? "flex-1" : ""
                          } py-1.5 flex items-center justify-between gap-4`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                                title={b["Linked Account"]}
                              >
                                {b["Linked Account"]}
                              </span>
                              <span className="text-[10px] text-slate-400 truncate max-w-[160px] leading-tight">
                                ({b["Budget Name"]})
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono truncate leading-tight mt-0.5">
                              {b["Account ID"]}
                            </div>
                          </div>

                          <div className="text-right shrink-0 w-36">
                            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight">
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
                              <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-300 leading-none">
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

                {/* Pagination Footer */}
                <div className="shrink-0 pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>
                    {activeAzureBudgets.length > 0
                      ? `Showing ${(pageAzureBudgets - 1) * azureItemsPerPage + 1}–${Math.min(
                          pageAzureBudgets * azureItemsPerPage,
                          activeAzureBudgets.length
                        )} of ${activeAzureBudgets.length}`
                      : "0 of 0"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPageAzureBudgets((p) => Math.max(1, p - 1))}
                      disabled={pageAzureBudgets <= 1}
                      className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                      title="Previous Page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
                      Page {pageAzureBudgets} of {totalPagesAzureBudgets}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPageAzureBudgets((p) =>
                          Math.min(totalPagesAzureBudgets, p + 1)
                        )
                      }
                      disabled={pageAzureBudgets >= totalPagesAzureBudgets}
                      className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                      title="Next Page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT PORTAL CARD: GCP BUDGETS & BIGQUERY INTELLIGENCE          */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[540px] xl:min-h-0 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Non-Colliding Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/40 dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand, Badge & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-extrabold text-xs shadow-2xs">
                    GCP
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      GCP Governance
                    </h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shrink-0"
                    >
                      BigQuery
                    </Badge>
                  </div>
                </div>

                <button
                  onClick={() => navigate("/gcp")}
                  className="inline-flex items-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-[11px] font-semibold shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Enter GCP</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 2: Subtitle & Secondary Action Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[200px] sm:max-w-none">
                  Multi-project cost intelligence &amp; budgets
                </p>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => navigate("/gcp/projects")}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Layers className="w-3 h-3 text-blue-500" />
                    <span>Projects</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: GCP Coverage */}
                <div className="col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex items-center gap-3">
                  <CoverageGauge
                    percentage={gcpSummary?.budgetCoveragePct || 80}
                    colorClass="text-blue-500"
                    size={56}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      Budget Coverage
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium truncate">
                      {gcpSummary?.budgetedAccounts || 4} of {gcpSummary?.totalAccounts || 5} projects
                    </div>
                    <div className="text-[11px] flex items-center gap-1 pt-0.5 text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span className="truncate">Active BigQuery sync</span>
                    </div>
                  </div>
                </div>

                {/* Spend & Allocation Summary Card */}
                <div className="col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-center">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        <span className="truncate">Monthly Spend</span>
                      </div>
                      <div className="text-lg xl:text-xl font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        ${(gcpSummary?.activeSpendTotal || 50562).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold mt-0.5 truncate">
                        {gcpSummary?.monthLabel || "Active Cycle"}
                      </div>
                    </div>

                    <div className="border-l border-slate-200/70 dark:border-slate-700/70 pl-3 min-w-0">
                      <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1 truncate">
                        <Wallet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">Spend Controlled</span>
                      </div>
                      <div className="text-lg xl:text-xl font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                        ${(gcpSummary?.spendUnderBudget || 45000).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 truncate">
                        Under active limits
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Budgets & Projects Overview Card */}
              <div className="flex-1 min-h-0 flex flex-col justify-between gap-3 overflow-hidden">
                <div className="flex flex-col min-h-0 flex-1 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        GCP Project Budgets
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                      {gcpBudgets.length} projects
                    </span>
                  </div>

                  <div className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden">
                    {paginatedGcpBudgets.length > 0 ? (
                      paginatedGcpBudgets.map((b, i) => {
                        const limit = Number(b['Budget Limit'] || 0);
                        const used = Number(b['Actual Spend'] || 0);
                        const pct = Number(b['% Utilized'] || 0);
                        const isExceeded = b.Status === 'Exceeded' || pct >= 100;
                        const isWarning = b.Status === 'Warning' || (pct >= 85 && pct < 100);

                        return (
                          <div key={i} className="py-1.5 flex flex-col justify-center space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                                title={b['Linked Account']}
                              >
                                {b['Linked Account']}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0 leading-tight">
                                ${used.toLocaleString(undefined, { maximumFractionDigits: 0 })} / $
                                {limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-200/70 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isExceeded
                                      ? 'bg-rose-500'
                                      : isWarning
                                      ? 'bg-amber-500'
                                      : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono font-bold text-slate-500 w-8 text-right leading-none">
                                {pct}%
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                        No active GCP project budgets
                      </div>
                    )}
                  </div>

                  {/* Pagination Footer */}
                  <div className="shrink-0 pt-2 mt-1 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>
                      Page {pageGcpBudgets} of {totalPagesGcpBudgets}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPageGcpBudgets((p) => Math.max(1, p - 1))}
                        disabled={pageGcpBudgets <= 1}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Previous Page"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPageGcpBudgets((p) =>
                            Math.min(totalPagesGcpBudgets, p + 1)
                          )
                        }
                        disabled={pageGcpBudgets >= totalPagesGcpBudgets}
                        className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
                        title="Next Page"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
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
