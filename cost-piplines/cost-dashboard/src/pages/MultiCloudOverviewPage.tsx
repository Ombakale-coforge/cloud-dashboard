import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { AdminRequestsModal } from "@/components/AdminRequestsModal";
import { ManualBudgetAlertsSection } from "@/components/ManualBudgetAlertsSection";
import { useAccountRequests } from "@/lib/useAccountRequests";
import { useAuth } from "@/lib/auth";
import { useCsv } from "@/lib/useCsv";
import { formatAzureUsd, azureInrToUsd } from "@/lib/azureCurrency";
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
  UserPlus,
  Sparkles,
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

interface SpendItem {
  name: string;
  id?: string;
  budgetName?: string;
  spend: number;
  budgetLimit?: number | null;
}

interface ExceededItem {
  name: string;
  id?: string;
  spend: number;
  budgetLimit?: number | null;
  utilizationPct: number;
}

function TopSpendTable({
  title,
  items,
  currency = "$",
  page,
  onPageChange,
  emptyText = "No spending accounts found",
}: {
  title: string;
  items: SpendItem[];
  currency?: string;
  page: number;
  onPageChange: (p: number) => void;
  emptyText?: string;
}) {
  const ITEMS_PER_PAGE = 5;
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const paginated = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <TrendingUp className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
            {title}
          </span>
        </div>
        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0">
          Top {items.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden">
        {paginated.length > 0 ? (
          paginated.map((acc, i) => (
            <div key={i} className="py-1.5 flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div
                  className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                  title={acc.name}
                >
                  {acc.name}
                </div>
                <div className="text-[10px] text-slate-400 font-mono leading-tight mt-0.5 truncate">
                  {acc.id || acc.budgetName || "—"}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                  {currency}{Number(acc.spend || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {acc.budgetLimit && Number(acc.budgetLimit) > 0
                    ? `Limit: ${currency}${Number(acc.budgetLimit).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : <span className="text-amber-600 dark:text-amber-400 font-medium">No budget</span>}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-400 py-6">
            {emptyText}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="shrink-0 pt-2 mt-auto border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
            title="Previous Page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
            title="Next Page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TopExceededTable({
  title,
  items,
  currency = "$",
  page,
  onPageChange,
  emptyText = "No accounts exceeding budget limits",
}: {
  title: string;
  items: ExceededItem[];
  currency?: string;
  page: number;
  onPageChange: (p: number) => void;
  emptyText?: string;
}) {
  const ITEMS_PER_PAGE = 5;
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const paginated = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col min-h-0 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20 p-3.5 overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
            {title}
          </span>
        </div>
        <Badge variant="outline" className="text-[10px] font-semibold text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 shrink-0">
          {items.length} exceeded
        </Badge>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-start divide-y divide-slate-200/60 dark:divide-slate-800 overflow-hidden">
        {paginated.length > 0 ? (
          paginated.map((b, i) => {
            const limit = Number(b.budgetLimit || 0);
            const used = Number(b.spend || 0);
            const pct = b.utilizationPct;

            return (
              <div key={i} className="py-1.5 flex flex-col justify-center space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate leading-tight"
                    title={b.name}
                  >
                    {b.name}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0 leading-tight">
                    {currency}{used.toLocaleString(undefined, { maximumFractionDigits: 0 })} / {currency}{limit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-200/70 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-rose-500"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-rose-600 dark:text-rose-400 w-10 text-right leading-none">
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-emerald-600 dark:text-emerald-400 gap-1.5 py-6">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            <span className="font-medium text-slate-600 dark:text-slate-300">{emptyText}</span>
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="shrink-0 pt-2 mt-auto border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
            title="Previous Page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="font-semibold text-slate-700 dark:text-slate-300 px-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="p-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-default"
            title="Next Page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
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

  // Governance Summary States
  const [awsSummary, setAwsSummary] = useState<GovernanceSummary | null>(null);
  const [azureSummary, setAzureSummary] = useState<AzureGovernanceSummary | null>(null);
  const [gcpSummary, setGcpSummary] = useState<any>(null);

  const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long" });
  };

  const awsMonthLabel = formatMonthName(awsLatestMonth);
  const azureMonthLabel = formatMonthName(azureLatestMonth) || awsMonthLabel;
  const gcpMonthLabel = gcpSummary?.monthLabel || awsMonthLabel || "November";

  // =========================================================================
  // AWS Governance Data
  // =========================================================================

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

  const [pageAwsSpend, setPageAwsSpend] = useState(1);
  const [pageAwsExceeded, setPageAwsExceeded] = useState(1);
  const [pageAzureSpend, setPageAzureSpend] = useState(1);
  const [pageAzureExceeded, setPageAzureExceeded] = useState(1);
  const [pageGcpSpend, setPageGcpSpend] = useState(1);
  const [pageGcpExceeded, setPageGcpExceeded] = useState(1);

  useEffect(() => {
    setPageAwsSpend(1);
    setPageAwsExceeded(1);
  }, [selectedAwsAccount]);

  // Top 10 Accounts for AWS
  const top10AwsSpend: SpendItem[] = useMemo(() => {
    const list: SpendItem[] = [];
    const seen = new Set<string>();

    (awsBudgets || []).forEach((b) => {
      if (!b || !b["Budget Name"]) return;
      const name = b["Budget Name"];
      const id = b["Account ID"] || "";
      const spend = Number(b["Current Used"] ?? b["Current Spend"] ?? 0);
      const limit = Number(b.Limit ?? b["Budget Limit"] ?? 0);
      seen.add(id || name);
      list.push({
        name,
        id,
        spend,
        budgetLimit: limit > 0 ? limit : null,
      });
    });

    (awsUnbudgeted || []).forEach((u) => {
      if (!u || !u["Account Name"]) return;
      const name = u["Account Name"];
      const id = u["Account ID"] || "";
      if (seen.has(id || name)) return;
      const spend = Number(u["Current Month Spend"] || 0);
      list.push({
        name,
        id,
        spend,
        budgetLimit: null,
      });
    });

    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [awsBudgets, awsUnbudgeted]);

  const top10AwsExceeded: ExceededItem[] = useMemo(() => {
    const list: ExceededItem[] = [];
    (awsBudgets || []).forEach((b) => {
      if (!b || !b["Budget Name"]) return;
      const name = b["Budget Name"];
      const id = b["Account ID"] || "";
      const limit = Number(b.Limit ?? b["Budget Limit"] ?? 0);
      const spend = Number(b["Current Used"] ?? b["Current Spend"] ?? 0);
      const pct = limit > 0 ? Math.round((spend / limit) * 100) : 0;
      const isExceeded = b["Threshold Status"]?.toLowerCase().includes("exceeded") || pct >= 100;
      if (isExceeded) {
        list.push({
          name,
          id,
          spend,
          budgetLimit: limit,
          utilizationPct: pct,
        });
      }
    });
    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [awsBudgets]);

  // =========================================================================
  // Azure Governance Data
  // =========================================================================
  const [azureBudgets, setAzureBudgets] = useState<AzureBudgetRow[]>([]);
  const [azureUnbudgeted, setAzureUnbudgeted] = useState<any[]>([]);
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
        if (Array.isArray(unbudgetedData)) setAzureUnbudgeted(unbudgetedData);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadAzureData();
  }, [azureLatestMonth]);

  const top10AzureSpend: SpendItem[] = useMemo(() => {
    const list: SpendItem[] = [];
    const seen = new Set<string>();

    (azureBudgets || []).forEach((b) => {
      if (!b) return;
      const name = b["Linked Account"] || b["Account ID"] || "Subscription";
      const id = b["Account ID"] || "";
      const spend = azureInrToUsd(b["Actual Spend"] || 0, "INR");
      const limit = azureInrToUsd(b["Budget Limit"] || 0, "INR");
      seen.add(id || name);
      list.push({
        name,
        id,
        budgetName: b["Budget Name"] || "",
        spend,
        budgetLimit: limit > 0 ? limit : null,
      });
    });

    (azureUnbudgeted || []).forEach((u) => {
      if (!u) return;
      const name = u["Linked Account"] || u["Account ID"] || "Subscription";
      const id = u["Account ID"] || "";
      if (seen.has(id || name)) return;
      const spend = azureInrToUsd(u.Cost || u["Actual Spend"] || 0, "INR");
      list.push({
        name,
        id,
        spend,
        budgetLimit: null,
      });
    });

    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [azureBudgets, azureUnbudgeted]);

  const top10AzureExceeded: ExceededItem[] = useMemo(() => {
    const list: ExceededItem[] = [];
    (azureBudgets || []).forEach((b) => {
      if (!b) return;
      const name = b["Linked Account"] || b["Account ID"] || "Subscription";
      const id = b["Account ID"] || "";
      const rawSpend = Number(b["Actual Spend"] || 0);
      const rawLimit = Number(b["Budget Limit"] || 0);
      const spend = azureInrToUsd(rawSpend, "INR");
      const limit = azureInrToUsd(rawLimit, "INR");
      const pct = Number(b["% Utilized"] || (rawLimit > 0 ? Math.round((rawSpend / rawLimit) * 100) : 0));
      const isExceeded = b.Status === "Exceeded" || pct >= 100;
      if (isExceeded) {
        list.push({
          name,
          id,
          spend,
          budgetLimit: limit,
          utilizationPct: pct,
        });
      }
    });
    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [azureBudgets]);

  // =========================================================================
  // GCP Governance Data
  // =========================================================================
  const [gcpBudgets, setGcpBudgets] = useState<any[]>([]);
  const [gcpProjects, setGcpProjects] = useState<any[]>([]);

  const loadGcpData = () => {
    Promise.all([
      fetch("/api/gcp/summary").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/gcp/budgets").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/gcp/projects").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([summaryData, budgetsData, projectsData]) => {
        if (summaryData) setGcpSummary(summaryData);
        if (Array.isArray(budgetsData)) setGcpBudgets(budgetsData);
        if (Array.isArray(projectsData)) setGcpProjects(projectsData);
      })
      .catch(() => {});
  };

  useEffect(() => {
    loadGcpData();
  }, []);

  const top10GcpSpend: SpendItem[] = useMemo(() => {
    const list: SpendItem[] = [];
    const seen = new Set<string>();

    (gcpProjects || []).forEach((p: any) => {
      const name = p.name || p.projectName || p.projectId || "GCP Project";
      const id = p.projectId || p.id || "";
      const spend = Number(p.currentSpend || p.cost || 0);
      const limit = Number(p.budgetLimit || 0);
      seen.add(id || name);
      list.push({
        name,
        id,
        spend,
        budgetLimit: limit > 0 ? limit : null,
      });
    });

    (gcpBudgets || []).forEach((b: any) => {
      const name = b["Linked Account"] || b.name || "GCP Project";
      const id = b["Account ID"] || b.id || "";
      if (seen.has(id || name)) return;
      const spend = Number(b["Actual Spend"] || b.currentSpend || 0);
      const limit = Number(b["Budget Limit"] || b.budgetLimit || 0);
      list.push({
        name,
        id,
        spend,
        budgetLimit: limit > 0 ? limit : null,
      });
    });

    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [gcpProjects, gcpBudgets]);

  const top10GcpExceeded: ExceededItem[] = useMemo(() => {
    const list: ExceededItem[] = [];
    const seen = new Set<string>();

    (gcpProjects || []).forEach((p: any) => {
      const name = p.name || p.projectName || p.projectId || "GCP Project";
      const id = p.projectId || p.id || "";
      const spend = Number(p.currentSpend || p.cost || 0);
      const limit = Number(p.budgetLimit || 0);
      const pct = Number(p.utilizationPct || (limit > 0 ? Math.round((spend / limit) * 100) : 0));
      const isExceeded = p.status === "Exceeded" || pct >= 100;
      if (isExceeded && limit > 0) {
        seen.add(id || name);
        list.push({
          name,
          id,
          spend,
          budgetLimit: limit,
          utilizationPct: pct,
        });
      }
    });

    (gcpBudgets || []).forEach((b: any) => {
      const name = b["Linked Account"] || b.name || "GCP Project";
      const id = b["Account ID"] || b.id || "";
      if (seen.has(id || name)) return;
      const spend = Number(b["Actual Spend"] || b.currentSpend || 0);
      const limit = Number(b["Budget Limit"] || b.budgetLimit || 0);
      const pct = Number(b["% Utilized"] || (limit > 0 ? Math.round((spend / limit) * 100) : 0));
      const isExceeded = b.Status === "Exceeded" || pct >= 100;
      if (isExceeded && limit > 0) {
        list.push({
          name,
          id,
          spend,
          budgetLimit: limit,
          utilizationPct: pct,
        });
      }
    });

    return list.sort((a, b) => b.spend - a.spend).slice(0, 10);
  }, [gcpProjects, gcpBudgets]);

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

  const azureTotalAccounts =
    azureSummary?.totalAccounts || azureBudgets.length || azureUnbudgeted.length || 0;
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
        <main className="flex-1 p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          {/* =============================================================== */}
          {/* =============================================================== */}
          {/* LEFT PORTAL CARD: AWS                                           */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[560px] rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-indigo-50/60 via-white to-amber-50/40 dark:from-indigo-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 font-extrabold text-xs shadow-2xs">
                    AWS
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      AWS
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

              {/* Row 2: Account Controls */}
              <div className="flex items-center justify-end gap-1.5 pt-0.5">
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

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Budget Coverage + Org Accounts */}
                <div className="col-span-12 sm:col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex items-center gap-3 min-w-0">
                  <CoverageGauge
                    percentage={awsSummary?.budgetCoveragePct || 0}
                    colorClass="text-emerald-500"
                    size={48}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                      <span>Coverage</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">{awsSummary?.budgetCoveragePct || 0}%</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Total accounts:</span>
                      <strong className="font-bold text-slate-800 dark:text-slate-200">{awsSummary ? awsSummary.totalAccounts : "--"}</strong>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Budgets defined:</span>
                      <strong className="font-bold text-emerald-600 dark:text-emerald-400">{awsSummary ? awsSummary.accountsWithBudget : "--"}</strong>
                    </div>
                  </div>
                </div>

                {/* Spend & Limits Card */}
                <div className="col-span-12 sm:col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-between min-w-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total spend:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        ${awsSummary ? awsSummary.activeSpendTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "--"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total budget:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        ${awsSummary ? awsSummary.sumBudgetLimits.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "--"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                      <span>{awsSummary && awsSummary.sumBudgetLimits > 0 ? Math.round((awsSummary.activeSpendTotal / awsSummary.sumBudgetLimits) * 100) : 0}% of budget utilized</span>
                      <span className={awsSummary && awsSummary.activeSpendTotal > awsSummary.sumBudgetLimits ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"}>
                        {awsSummary && awsSummary.activeSpendTotal > awsSummary.sumBudgetLimits ? "Exceeded" : "Under limit"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${awsSummary && awsSummary.activeSpendTotal > awsSummary.sumBudgetLimits ? "bg-rose-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, awsSummary && awsSummary.sumBudgetLimits > 0 ? Math.round((awsSummary.activeSpendTotal / awsSummary.sumBudgetLimits) * 100) : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Side-by-Side: Top 10 by Spend & Top 10 Exceeded */}
              <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3.5 overflow-hidden">
                <TopSpendTable
                  title="Top 10 Accounts by Spend"
                  items={top10AwsSpend}
                  currency="$"
                  page={pageAwsSpend}
                  onPageChange={setPageAwsSpend}
                  emptyText="No spending accounts found"
                />
                <TopExceededTable
                  title="Top 10 Accounts Exceeding Budget"
                  items={top10AwsExceeded}
                  currency="$"
                  page={pageAwsExceeded}
                  onPageChange={setPageAwsExceeded}
                  emptyText="No accounts exceeding budget limits"
                />
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* MIDDLE PORTAL CARD: AZURE                                       */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[560px] rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-sky-50/70 via-white to-blue-50/40 dark:from-sky-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 font-extrabold text-xs shadow-2xs">
                    AZ
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      Azure
                    </h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0 bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800 shrink-0"
                    >
                      {azureMonthLabel}
                    </Badge>
                  </div>
                </div>

                <button
                  onClick={() => navigate("/azure")}
                  className="inline-flex items-center gap-1 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 text-[11px] font-semibold shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Enter Azure</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 2: Secondary Action Controls */}
              <div className="flex items-center justify-end gap-1.5 pt-0.5">
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

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: Azure Coverage */}
                <div className="col-span-12 sm:col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex items-center gap-3 min-w-0">
                  <CoverageGauge
                    percentage={azureCoveragePct}
                    colorClass="text-sky-500"
                    size={48}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                      <span>Coverage</span>
                      <span className="text-sky-600 dark:text-sky-400 font-bold">{azureCoveragePct}%</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Total accounts:</span>
                      <strong className="font-bold text-slate-800 dark:text-slate-200">{azureTotalAccounts}</strong>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Budgets defined:</span>
                      <strong className="font-bold text-emerald-600 dark:text-emerald-400">{azureBudgetedAccounts}</strong>
                    </div>
                  </div>
                </div>

                {/* Spend & Limits Card */}
                <div className="col-span-12 sm:col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-between min-w-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total spend:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        {formatAzureUsd(azureSummary?.activeSpend || 0, "INR", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total budget:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        {formatAzureUsd(azureSummary?.totalBudgetedSpend || 0, "INR", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                      <span>{azureSummary && azureSummary.totalBudgetedSpend && azureSummary.totalBudgetedSpend > 0 ? Math.round(((azureSummary.activeSpend || 0) / azureSummary.totalBudgetedSpend) * 100) : 0}% of budget utilized</span>
                      <span className={azureSummary && (azureSummary.activeSpend || 0) > (azureSummary.totalBudgetedSpend || 0) ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"}>
                        {azureSummary && (azureSummary.activeSpend || 0) > (azureSummary.totalBudgetedSpend || 0) ? "Exceeded" : "Under limit"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${azureSummary && (azureSummary.activeSpend || 0) > (azureSummary.totalBudgetedSpend || 0) ? "bg-rose-500" : "bg-emerald-500"}`}
                        style={{ width: `${Math.min(100, azureSummary && azureSummary.totalBudgetedSpend && azureSummary.totalBudgetedSpend > 0 ? Math.round(((azureSummary.activeSpend || 0) / azureSummary.totalBudgetedSpend) * 100) : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Side-by-Side: Top 10 by Spend & Top 10 Exceeded */}
              <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3.5 overflow-hidden">
                <TopSpendTable
                  title="Top 10 Subscriptions by Spend"
                  items={top10AzureSpend}
                  currency="$"
                  page={pageAzureSpend}
                  onPageChange={setPageAzureSpend}
                  emptyText="No Azure subscriptions found"
                />
                <TopExceededTable
                  title="Top 10 Subscriptions Exceeding Budget"
                  items={top10AzureExceeded}
                  currency="$"
                  page={pageAzureExceeded}
                  onPageChange={setPageAzureExceeded}
                  emptyText="No subscriptions exceeding budget limits"
                />
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT PORTAL CARD: GCP                                          */}
          {/* =============================================================== */}
          <div className="flex flex-col min-h-[560px] rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* Portal Top Banner: 2-Row Layout */}
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/40 dark:from-blue-950/30 dark:via-slate-900 dark:to-slate-900 flex flex-col gap-2.5">
              {/* Row 1: Brand & Primary Action */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 font-extrabold text-xs shadow-2xs">
                    GCP
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      GCP
                    </h2>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-semibold px-2 py-0 bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 shrink-0"
                    >
                      {gcpMonthLabel}
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

              {/* Row 2: Secondary Action Controls */}
              <div className="flex items-center justify-end gap-1.5 pt-0.5">
                <button
                  onClick={() => navigate("/gcp/projects")}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Layers className="w-3 h-3 text-blue-500" />
                  <span>Projects</span>
                </button>
              </div>
            </div>

            {/* Portal Body */}
            <div className="flex-1 min-h-0 p-4 flex flex-col justify-between gap-3.5 overflow-hidden">
              {/* Visual Gauges & Key KPIs Strip */}
              <div className="shrink-0 grid grid-cols-12 gap-3">
                {/* Gauge Card: GCP Coverage */}
                <div className="col-span-12 sm:col-span-5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex items-center gap-3 min-w-0">
                  <CoverageGauge
                    percentage={gcpSummary?.budgetCoveragePct || 95}
                    colorClass="text-blue-500"
                    size={48}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                      <span>Coverage</span>
                      <span className="text-blue-600 dark:text-blue-400 font-bold">{gcpSummary?.budgetCoveragePct || 95}%</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Total accounts:</span>
                      <strong className="font-bold text-slate-800 dark:text-slate-200">{gcpSummary?.totalAccounts || 22}</strong>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span className="text-slate-500 dark:text-slate-400">Budgets defined:</span>
                      <strong className="font-bold text-emerald-600 dark:text-emerald-400">{gcpSummary?.budgetedAccounts || 21}</strong>
                    </div>
                  </div>
                </div>

                {/* Spend & Limits Card */}
                <div className="col-span-12 sm:col-span-7 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3 flex flex-col justify-between min-w-0">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total spend:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        ${(gcpSummary?.activeSpendTotal || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400 font-medium">Total budget:</span>
                      <span className="font-extrabold text-sm text-slate-900 dark:text-white">
                        ${(gcpSummary?.sumBudgetLimits || gcpSummary?.spendUnderBudget || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                      <span>
                        {gcpSummary && (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget) > 0
                          ? Math.round(((gcpSummary.activeSpendTotal || 0) / (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget)) * 100)
                          : 0}
                        % of budget utilized
                      </span>
                      <span
                        className={
                          gcpSummary &&
                          (gcpSummary.activeSpendTotal || 0) >
                            (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget || 0)
                            ? "text-rose-600 font-semibold"
                            : "text-emerald-600 font-semibold"
                        }
                      >
                        {gcpSummary &&
                        (gcpSummary.activeSpendTotal || 0) >
                          (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget || 0)
                          ? "Exceeded"
                          : "Under limit"}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          gcpSummary &&
                          (gcpSummary.activeSpendTotal || 0) >
                            (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget || 0)
                            ? "bg-rose-500"
                            : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            gcpSummary &&
                              (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget) > 0
                              ? Math.round(
                                  ((gcpSummary.activeSpendTotal || 0) /
                                    (gcpSummary.sumBudgetLimits || gcpSummary.spendUnderBudget)) *
                                    100
                                )
                              : 0
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Side-by-Side: Top 10 by Spend & Top 10 Exceeded */}
              <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-3.5 overflow-hidden">
                <TopSpendTable
                  title="Top 10 Projects by Spend"
                  items={top10GcpSpend}
                  currency="$"
                  page={pageGcpSpend}
                  onPageChange={setPageGcpSpend}
                  emptyText="No GCP projects found"
                />
                <TopExceededTable
                  title="Top 10 Projects Exceeding Budget"
                  items={top10GcpExceeded}
                  currency="$"
                  page={pageGcpExceeded}
                  onPageChange={setPageGcpExceeded}
                  emptyText="No projects exceeding budget limits"
                />
              </div>
            </div>
          </div>
          </div>

          {/* ================================================================= */}
          {/* UNIFIED MULTI-CLOUD MANUAL BUDGET ALERTS & INSTANT EMAILS         */}
          {/* ================================================================= */}
          <ManualBudgetAlertsSection defaultProvider="all" />
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
