import { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Navbar, type AccountOption } from "@/components/Navbar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Building2,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  RefreshCw,
  Layers,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  PieChart,
  CalendarPlus,
  Sparkles,
  Calendar,
  User,
  FileCode,
  Bell,
  Send,
} from "lucide-react";
import {
  ManualBudgetAlertsSection,
  sendInstantAccountBudgetEmail,
  type EnrichedAccountBudget,
  type ExternalBudgetTrigger,
} from "@/components/ManualBudgetAlertsSection";

interface LinkedAccountItem {
  linkedAccountId: string;
  accountName: string;
  status: string;
  selectedMonth: string;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  hasBudget: boolean;
  budgetStatus: "Budgeted" | "Unbudgeted" | "Closed";
  topCostDriver: string;
  createdAt?: string | null;
  joinedMethod?: string | null;
  email?: string | null;
  ownerName?: string | null;
  wbsCode?: string | null;
  isCreatedCurrentWeek?: boolean;
}

interface ApiResponse {
  rootAccount: {
    id: string;
    name: string;
    awsAccountId: string;
  };
  selectedMonth: string;
  totalLinkedAccounts: number;
  activeAccountsCount: number;
  suspendedAccountsCount: number;
  budgetedCount: number;
  unbudgetedCount: number;
  totalSpend: number;
  currentWeekStart?: string;
  currentWeekEnd?: string;
  currentWeekLabel?: string;
  newAccountsCurrentWeekCount?: number;
  newAccountsCurrentWeekSpend?: number;
  newAccountsCurrentWeek?: LinkedAccountItem[];
  accounts: LinkedAccountItem[];
}

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function getClientCurrentWeekBounds(now = new Date()) {
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 23, 59, 59, 999);
  const fmtShort = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const label = `${fmtShort(weekStart)} – ${fmtShort(weekEnd)}, ${weekEnd.getFullYear()}`;
  return { weekStart, weekEnd, label };
}

export function LinkedAccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialAccountParam = searchParams.get("account") || "account-1";
  const initialFilterParam = searchParams.get("filter");

  const [awsAccounts, setAwsAccounts] = useState<AccountOption[]>([
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
  ]);
  const [selectedAwsAccount, setSelectedAwsAccount] = useState<string>(initialAccountParam);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [budgetFilter, setBudgetFilter] = useState<"ALL" | "BUDGETED" | "UNBUDGETED">("ALL");
  const [createdFilter, setCreatedFilter] = useState<"ALL" | "THIS_WEEK" | "NEWEST">(
    initialFilterParam === "new-this-week" ? "THIS_WEEK" : "ALL"
  );
  const [showWeeklyDrawer, setShowWeeklyDrawer] = useState<boolean>(
    initialFilterParam === "new-this-week"
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 12;

  // Available months
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const weekBounds = useMemo(() => getClientCurrentWeekBounds(), []);

  // Manual Budgets & Instant Email actions
  const [manualBudgets, setManualBudgets] = useState<EnrichedAccountBudget[]>([]);
  const [budgetTrigger, setBudgetTrigger] = useState<ExternalBudgetTrigger | null>(null);
  const [sendingRowId, setSendingRowId] = useState<string | null>(null);
  const [rowEmailBanner, setRowEmailBanner] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  const fetchManualBudgets = () => {
    const monthQ = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : "";
    fetch(`/api/budgets?provider=aws${monthQ}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        if (Array.isArray(rows)) setManualBudgets(rows);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchManualBudgets();
  }, [selectedMonth]);

  const findManualBudgetForAccount = (acc: LinkedAccountItem) =>
    manualBudgets.find(
      (b) =>
        b.accountId.toLowerCase() === acc.linkedAccountId.toLowerCase() ||
        b.accountName.toLowerCase() === acc.accountName.toLowerCase()
    );

  const handleQuickSendEmail = async (acc: LinkedAccountItem) => {
    const existing = findManualBudgetForAccount(acc);
    if (!existing) {
      setBudgetTrigger({
        cloudProvider: "aws",
        accountId: acc.linkedAccountId,
        accountName: acc.accountName,
        parentAccountId: selectedAwsAccount,
        currentSpend: acc.currentSpend,
        billingCurrency: "USD",
        mode: "instant-email",
      });
      return;
    }

    setSendingRowId(acc.linkedAccountId);
    setRowEmailBanner(null);
    try {
      const result = await sendInstantAccountBudgetEmail(
        existing.id,
        acc.accountName,
        selectedMonth
      );
      setRowEmailBanner(result);
      fetchManualBudgets();
    } catch (err: any) {
      setRowEmailBanner({
        type: "error",
        message: err.message || "Failed to send instant email.",
      });
    } finally {
      setSendingRowId(null);
    }
  };

  // 1. Fetch AWS Accounts
  useEffect(() => {
    fetch("/api/aws/accounts")
      .then((res) => (res.ok ? res.json() : []))
      .then((accs) => {
        if (Array.isArray(accs) && accs.length > 0) {
          const mapped = accs.map((a: AccountOption) => {
            const cleanId = (a.accountId || a.id || "").replace(/[^0-9]/g, "");
            let accountName = a.accountName || a.name;
            if (cleanId === "513167803309" || a.id === "account-2") {
              accountName = "AWS-Coforge";
            } else if (cleanId === "507672385186" || a.id === "account-1") {
              accountName = "AWS-Encora";
            }
            const name = a.accountId ? `${accountName} (${a.accountId})` : accountName;
            return { ...a, name, accountName };
          });
          setAwsAccounts(mapped);
        }
      })
      .catch(() => {});
  }, []);

  // 2. Fetch available months
  useEffect(() => {
    fetch(`/api/aws/dataset/monthly_totals_last_6_months?account=${selectedAwsAccount}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((resData) => {
        if (Array.isArray(resData) && resData.length > 0) {
          const mList = resData.map((r: any) => r.Month).filter(Boolean).sort();
          setAvailableMonths(mList);
          if (!selectedMonth || !mList.includes(selectedMonth)) {
            setSelectedMonth(mList[mList.length - 1] || "");
          }
        }
      })
      .catch(() => {});
  }, [selectedAwsAccount]);

  // 3. Fetch Linked Accounts
  const fetchLinkedAccounts = () => {
    setLoading(true);
    setError(null);
    const monthQuery = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : "";
    Promise.all([
      fetch(`/api/aws/linked-accounts?account=${encodeURIComponent(selectedAwsAccount)}${monthQuery}`).then(
        async (res) => {
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Failed to fetch accounts (HTTP ${res.status})`);
          }
          return res.json();
        }
      ),
      fetch(`/api/aws/dataset/budgets_overview?account=${encodeURIComponent(selectedAwsAccount)}`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch(`/api/aws/dataset/governance_summary?account=${encodeURIComponent(selectedAwsAccount)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([json, budgetsList, govSummary]: [ApiResponse, any[], any]) => {
        const govItem = Array.isArray(govSummary) ? govSummary[0] : govSummary;
        const hasAnyOrgBudgets =
          Array.isArray(budgetsList) &&
          budgetsList.length > 0 &&
          (govItem ? Number(govItem.accountsWithBudget ?? 1) > 0 : true);

        const normalizedAccounts: LinkedAccountItem[] = (json.accounts || []).map((acc) => {
          const isActive = acc.status?.toUpperCase() === "ACTIVE";
          const hasBudget = isActive && hasAnyOrgBudgets && acc.hasBudget;
          let isCreatedCurrentWeek = Boolean(acc.isCreatedCurrentWeek);
          if (acc.createdAt && acc.isCreatedCurrentWeek === undefined) {
            const dt = new Date(acc.createdAt);
            if (!isNaN(dt.getTime())) {
              isCreatedCurrentWeek = dt >= weekBounds.weekStart && dt <= weekBounds.weekEnd;
            }
          }
          return {
            ...acc,
            hasBudget,
            isCreatedCurrentWeek,
            budgetStatus: !isActive ? "Closed" : hasBudget ? "Budgeted" : "Unbudgeted",
          };
        });

        const activeList = normalizedAccounts.filter((a) => a.status?.toUpperCase() === "ACTIVE");
        const budgetedCount = activeList.filter((a) => a.hasBudget).length;
        const unbudgetedCount = activeList.filter((a) => !a.hasBudget).length;

        setData({
          ...json,
          accounts: normalizedAccounts,
          activeAccountsCount: activeList.length,
          budgetedCount,
          unbudgetedCount,
        });
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err.message || "Failed to load linked accounts.");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLinkedAccounts();
  }, [selectedAwsAccount, selectedMonth]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Current week newly created accounts list
  const newAccountsThisWeek = useMemo(() => {
    if (!data?.accounts) return [];
    return data.accounts
      .filter((a) => a.isCreatedCurrentWeek)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [data]);

  // Most recently created accounts (top 5 newest with a known createdAt timestamp)
  const newestAccounts = useMemo(() => {
    if (!data?.accounts) return [];
    return [...data.accounts]
      .filter((a) => Boolean(a.createdAt))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5);
  }, [data]);

  const currentWeekLabel = data?.currentWeekLabel || weekBounds.label;

  // Filtered accounts
  const filteredAccounts = useMemo(() => {
    if (!data?.accounts) return [];
    let list = [...data.accounts];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.accountName.toLowerCase().includes(q) ||
          a.linkedAccountId.includes(q) ||
          a.topCostDriver.toLowerCase().includes(q) ||
          (a.email && a.email.toLowerCase().includes(q)) ||
          (a.ownerName && a.ownerName.toLowerCase().includes(q)) ||
          (a.wbsCode && a.wbsCode.toLowerCase().includes(q))
      );
    }

    if (statusFilter !== "ALL") {
      list = list.filter((a) => a.status.toUpperCase() === statusFilter);
    }

    if (budgetFilter === "BUDGETED") {
      list = list.filter((a) => a.hasBudget && a.status.toUpperCase() === "ACTIVE");
    } else if (budgetFilter === "UNBUDGETED") {
      list = list.filter((a) => !a.hasBudget && (statusFilter !== "ALL" || a.status.toUpperCase() === "ACTIVE"));
    }

    if (createdFilter === "THIS_WEEK") {
      list = list.filter((a) => a.isCreatedCurrentWeek);
    } else if (createdFilter === "NEWEST") {
      list.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });
    }

    return list;
  }, [data, searchQuery, statusFilter, budgetFilter, createdFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / ITEMS_PER_PAGE));
  const paginatedAccounts = useMemo(() => {
    return filteredAccounts.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  }, [filteredAccounts, currentPage]);

  const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current Month";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const [year, month] = parts;
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  const formatCreatedDate = (iso?: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleToggleThisWeekFilter = () => {
    const next = createdFilter === "THIS_WEEK" ? "ALL" : "THIS_WEEK";
    setCreatedFilter(next);
    setShowWeeklyDrawer(true);
    setCurrentPage(1);
    if (next === "THIS_WEEK") {
      setSearchParams({ account: selectedAwsAccount, filter: "new-this-week" });
    } else {
      setSearchParams({ account: selectedAwsAccount });
    }
  };

  return (
    <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased">
      {/* Top Navbar */}
      <Navbar
        activeProvider="aws"
        awsAccounts={awsAccounts}
        selectedAwsAccount={selectedAwsAccount}
        onAwsAccountChange={setSelectedAwsAccount}
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-muted/30 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                AWS Linked Accounts Directory
              </h2>
              <p className="text-xs text-muted-foreground">
                Member account inventory, weekly account creations, billing trajectory, and budget enforcement
              </p>
            </div>
          </div>

          {/* Account and Month Selectors */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Payer:</span>
              <select
                value={selectedAwsAccount}
                onChange={(e) => setSelectedAwsAccount(e.target.value)}
                className="text-xs font-medium bg-background border border-input rounded-md px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50 cursor-pointer"
              >
                {awsAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            {availableMonths.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Month:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="text-xs font-medium bg-background border border-input rounded-md px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50 cursor-pointer"
                >
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={fetchLinkedAccounts}
              disabled={loading}
              title="Refresh Accounts"
              className="p-1.5 rounded-md border border-input bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* 5 Summary KPI Cards */}
        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Card 1: Org Accounts */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    ORG ACCOUNTS
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {data.totalLinkedAccounts}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {data.activeAccountsCount} active
                    </span>
                    <span>•</span>
                    <span className="text-slate-500">
                      {data.suspendedAccountsCount} closed
                    </span>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>
            </Card>

            {/* Card 2: New Accounts Created in Current Week */}
            <Card
              onClick={() => setShowWeeklyDrawer((prev) => !prev)}
              className={`border p-5 rounded-xl shadow-xs transition-all cursor-pointer ${
                showWeeklyDrawer || createdFilter === "THIS_WEEK"
                  ? "border-indigo-500 ring-1 ring-indigo-500/30 bg-indigo-50/20 dark:bg-indigo-950/20"
                  : "border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider truncate">
                      NEW THIS WEEK
                    </p>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                      {newAccountsThisWeek.length}
                    </h3>
                    <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {newAccountsThisWeek.length === 1 ? "account" : "accounts"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate pt-0.5" title={currentWeekLabel}>
                    {currentWeekLabel}
                  </p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
                  <CalendarPlus className="h-5 w-5" />
                </div>
              </div>
            </Card>

            {/* Card 3: Total Month Spend */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {formatMonthName(data.selectedMonth).toUpperCase()} SPEND
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {fmt(data.totalSpend)}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                    Across {data.activeAccountsCount} member accounts
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
            </Card>

            {/* Card 4: Budget Coverage */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    BUDGET COVERAGE
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {data.activeAccountsCount > 0
                      ? `${Math.min(100, (data.budgetedCount / data.activeAccountsCount) * 100).toFixed(1)}%`
                      : "0%"}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {data.budgetedCount} budgeted
                    </span>
                    <span>•</span>
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      {data.unbudgetedCount} unbudgeted
                    </span>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                  <PieChart className="h-5 w-5" />
                </div>
              </div>
            </Card>

            {/* Card 5: Top Cost Account */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="space-y-1 min-w-0 pr-2">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    TOP CONTRIBUTOR
                  </p>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate" title={data.accounts[0]?.accountName}>
                    {data.accounts[0]?.accountName || "N/A"}
                  </h3>
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold pt-0.5">
                    {fmt(data.accounts[0]?.currentSpend || 0)}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 shrink-0">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Dedicated "Accounts Created in Current Week" Spotlight Panel */}
        {data && (
          <Card className="border border-indigo-200/80 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/50 via-white to-violet-50/40 dark:from-indigo-950/25 dark:via-slate-900 dark:to-slate-900 shadow-xs overflow-hidden">
            <CardHeader className="py-3.5 px-5 border-b border-indigo-100/80 dark:border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-2xs">
                    <CalendarPlus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                        Accounts Created in Current Week
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-semibold bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800"
                      >
                        {currentWeekLabel}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-bold ${
                          newAccountsThisWeek.length > 0
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-400"
                            : "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        {newAccountsThisWeek.length} Created This Week
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Live AWS Organizations member account provisioning tracker (via AWS JoinedTimestamp)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleThisWeekFilter}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                      createdFilter === "THIS_WEEK"
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {createdFilter === "THIS_WEEK" ? "Showing Only This Week ✓" : "Filter Table: This Week"}
                  </button>
                  <button
                    onClick={() => setShowWeeklyDrawer((v) => !v)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    {showWeeklyDrawer ? "Hide Details" : "View Details"}
                  </button>
                </div>
              </div>
            </CardHeader>

            {showWeeklyDrawer && (
              <CardContent className="p-4">
                {newAccountsThisWeek.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {newAccountsThisWeek.map((acc) => (
                        <div
                          key={acc.linkedAccountId}
                          className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-white dark:bg-slate-900 p-3.5 shadow-2xs flex flex-col justify-between gap-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-bold text-xs text-slate-900 dark:text-white truncate" title={acc.accountName}>
                                {acc.accountName}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                {acc.linkedAccountId}
                              </div>
                            </div>
                            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-bold shrink-0">
                              NEW THIS WEEK
                            </Badge>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-indigo-500" />
                              Created: <strong className="text-slate-700 dark:text-slate-200">{formatCreatedDate(acc.createdAt)}</strong>
                            </span>
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {fmt(acc.currentSpend)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                        <Sparkles className="w-4 h-4 text-indigo-500" />
                        <span>No new AWS member accounts created during {currentWeekLabel}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {newestAccounts.length > 0
                          ? `Most recent account created: ${newestAccounts[0].accountName} (${newestAccounts[0].linkedAccountId}) on ${formatCreatedDate(newestAccounts[0].createdAt)}.`
                          : "All member accounts in this organization were provisioned prior to the current week."}
                      </p>
                    </div>

                    {newestAccounts.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setCreatedFilter("NEWEST");
                            setCurrentPage(1);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-colors cursor-pointer"
                        >
                          Sort Inventory by Newest Created
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Recent 5 Created Accounts Mini Strip */}
                {newestAccounts.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-indigo-100/80 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Latest 5 Provisioned Accounts in Organization
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Sorted by AWS JoinedTimestamp
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                      {newestAccounts.map((acc) => (
                        <Link
                          key={acc.linkedAccountId}
                          to={`/linked-accounts/${encodeURIComponent(acc.linkedAccountId)}?account=${encodeURIComponent(selectedAwsAccount)}${selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : ""}`}
                          className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 hover:border-indigo-400 transition-all group"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-indigo-600">
                              {acc.accountName}
                            </span>
                            {acc.joinedMethod && (
                              <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                                {acc.joinedMethod}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            {acc.linkedAccountId}
                          </div>
                          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 text-[10px]">
                            <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                              {formatCreatedDate(acc.createdAt)}
                            </span>
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {fmt(acc.currentSpend)}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Directory Card with Search, Filter & Shadcn Table */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardHeader className="pb-3 border-b border-muted/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                  Member Accounts Inventory
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Detailed billing, creation date, active governance status, and direct deep-dive analysis
                </p>
              </div>

              {/* Status, Budget & Creation Date Quick Filters */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Created Filter Toggle */}
                <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-input text-xs">
                  <button
                    onClick={() => { setCreatedFilter("ALL"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      createdFilter === "ALL"
                        ? "bg-background text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All Dates
                  </button>
                  <button
                    onClick={() => { setCreatedFilter("THIS_WEEK"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer flex items-center gap-1 ${
                      createdFilter === "THIS_WEEK"
                        ? "bg-background text-violet-600 dark:text-violet-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>Created This Week</span>
                    <span className="px-1.5 py-0 rounded-full text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold">
                      {newAccountsThisWeek.length}
                    </span>
                  </button>
                  <button
                    onClick={() => { setCreatedFilter("NEWEST"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      createdFilter === "NEWEST"
                        ? "bg-background text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Newest First
                  </button>
                </div>

                {/* Status Toggle */}
                <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-input text-xs">
                  <button
                    onClick={() => { setStatusFilter("ALL"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      statusFilter === "ALL"
                        ? "bg-background text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => { setStatusFilter("ACTIVE"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      statusFilter === "ACTIVE"
                        ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => { setStatusFilter("SUSPENDED"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      statusFilter === "SUSPENDED"
                        ? "bg-background text-rose-600 dark:text-rose-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Suspended
                  </button>
                </div>

                {/* Budget Toggle */}
                <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-input text-xs">
                  <button
                    onClick={() => { setBudgetFilter("ALL"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      budgetFilter === "ALL"
                        ? "bg-background text-indigo-600 dark:text-indigo-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => { setBudgetFilter("BUDGETED"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      budgetFilter === "BUDGETED"
                        ? "bg-background text-sky-600 dark:text-sky-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Budgeted
                  </button>
                  <button
                    onClick={() => { setBudgetFilter("UNBUDGETED"); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                      budgetFilter === "UNBUDGETED"
                        ? "bg-background text-amber-600 dark:text-amber-400 shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Unbudgeted
                  </button>
                </div>
              </div>
            </div>

            {/* Search Input matching DataTables.tsx */}
            <div className="relative mt-3">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by account name, 12-digit ID, owner name, WBS code, email, or service..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-background pl-8 pr-3 py-1.5 text-xs rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
              />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {rowEmailBanner && (
              <div
                className={`m-4 mb-0 p-3 rounded-lg border text-xs font-medium flex items-center justify-between gap-2 ${
                  rowEmailBanner.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300"
                    : rowEmailBanner.type === "warning"
                    ? "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300"
                    : "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300"
                }`}
              >
                <span>{rowEmailBanner.message}</span>
                <button
                  onClick={() => setRowEmailBanner(null)}
                  className="text-xs underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}
            {loading ? (
              <div className="py-20 text-center space-y-3">
                <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin mx-auto" />
                <p className="text-xs font-medium text-muted-foreground">
                  Loading member accounts from database...
                </p>
              </div>
            ) : error ? (
              <div className="py-16 text-center space-y-3 px-4">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <p className="text-xs font-semibold text-rose-600">{error}</p>
                <button
                  onClick={fetchLinkedAccounts}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : paginatedAccounts.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-xs space-y-2.5 px-4">
                <p className="font-semibold text-foreground">
                  {createdFilter === "THIS_WEEK"
                    ? `No AWS member accounts were created in the current week (${currentWeekLabel}).`
                    : "No member accounts found matching your filters."}
                </p>
                <div className="flex items-center justify-center gap-3">
                  {createdFilter === "THIS_WEEK" && (
                    <button
                      onClick={() => {
                        setCreatedFilter("NEWEST");
                        setCurrentPage(1);
                      }}
                      className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors cursor-pointer"
                    >
                      View Newest Created Accounts
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("ALL");
                      setBudgetFilter("ALL");
                      setCreatedFilter("ALL");
                    }}
                    className="text-xs text-indigo-600 dark:text-indigo-400 underline font-medium cursor-pointer"
                  >
                    Reset all filters
                  </button>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-muted/30 bg-muted/20 hover:bg-transparent">
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Account Name & ID
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[140px]">
                      Owner & WBS Code
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[125px]">
                      Created Date
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[90px]">
                      Status
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[110px]">
                      Current Spend
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[110px]">
                      Prior Spend
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[100px]">
                      MoM Variance
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[110px]">
                      Governance
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Top Cost Driver
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center w-[220px]">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedAccounts.map((acc) => {
                    const isPositiveMoM = acc.momChangePercent > 0;
                    const isNegativeMoM = acc.momChangePercent < 0;

                    return (
                      <TableRow key={acc.linkedAccountId} className="hover:bg-muted/30">
                        {/* Name and ID */}
                        <TableCell className="py-3 px-4">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-xs text-foreground">
                                {acc.accountName}
                              </span>
                              {acc.isCreatedCurrentWeek && (
                                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0 font-bold">
                                  NEW THIS WEEK
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-muted-foreground text-[11px] font-mono">
                              <span>{acc.linkedAccountId}</span>
                              <button
                                onClick={() => copyToClipboard(acc.linkedAccountId)}
                                title="Copy Account ID"
                                className="hover:text-foreground transition-colors cursor-pointer"
                              >
                                {copiedId === acc.linkedAccountId ? (
                                  <Check className="w-3 h-3 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>
                        </TableCell>

                        {/* Owner & WBS Code */}
                        <TableCell className="py-3 px-4">
                          <div className="flex flex-col gap-1 min-w-[130px]">
                            {/* Owner */}
                            <div className="flex items-center gap-1.5 text-xs">
                              <User className="w-3 h-3 text-indigo-500 shrink-0" />
                              <span
                                className="font-medium text-foreground truncate max-w-[160px]"
                                title={acc.ownerName || acc.email || "Unassigned"}
                              >
                                {acc.ownerName || (acc.email ? acc.email.split("@")[0].replace(/[._-]/g, " ") : "Unassigned")}
                              </span>
                            </div>

                            {/* WBS Code */}
                            <div className="flex items-center gap-1.5 text-[11px]">
                              <FileCode className="w-3 h-3 text-slate-400 shrink-0" />
                              {acc.wbsCode ? (
                                <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.2 rounded border border-indigo-200/60 dark:border-indigo-900/60 text-[10px]">
                                  {acc.wbsCode}
                                </span>
                              ) : (
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  N/A
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Created Date */}
                        <TableCell className="py-3 px-4 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-foreground">
                              {formatCreatedDate(acc.createdAt)}
                            </span>
                            {acc.joinedMethod && (
                              <span className="text-[10px] text-muted-foreground">
                                {acc.joinedMethod === "CREATED" ? "Created in Org" : "Invited"}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="py-3 px-4">
                          {acc.status === "ACTIVE" ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 text-[10px] font-semibold"
                            >
                              ACTIVE
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border-rose-300 dark:border-rose-800 text-[10px] font-semibold"
                            >
                              {acc.status}
                            </Badge>
                          )}
                        </TableCell>

                        {/* Current Spend */}
                        <TableCell className="py-3 px-4 text-right font-semibold whitespace-nowrap text-xs text-foreground font-mono">
                          {fmt(acc.currentSpend)}
                        </TableCell>

                        {/* Previous Spend */}
                        <TableCell className="py-3 px-4 text-right whitespace-nowrap text-muted-foreground text-xs font-medium font-mono">
                          {fmt(acc.previousSpend)}
                        </TableCell>

                        {/* MoM Variance */}
                        <TableCell className="py-3 px-4 text-right font-medium whitespace-nowrap text-xs">
                          {acc.previousSpend > 0 ? (
                            <span
                              className={`inline-flex items-center gap-1 ${
                                isPositiveMoM
                                  ? "text-rose-600 dark:text-rose-400 font-semibold"
                                  : isNegativeMoM
                                  ? "text-emerald-600 dark:text-emerald-400 font-semibold"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {isPositiveMoM && <TrendingUp className="w-3.5 h-3.5" />}
                              {isNegativeMoM && <TrendingDown className="w-3.5 h-3.5" />}
                              {isPositiveMoM ? "+" : ""}
                              {acc.momChangePercent}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Budget Status */}
                        <TableCell className="py-3 px-4">
                          {acc.status.toUpperCase() !== "ACTIVE" ? (
                            <Badge
                              variant="outline"
                              className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-300 dark:border-slate-700 text-[10px] font-semibold"
                            >
                              Closed
                            </Badge>
                          ) : acc.hasBudget ? (
                            <Badge
                              variant="outline"
                              className="bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border-sky-300 dark:border-sky-800 text-[10px] font-semibold"
                            >
                              <ShieldCheck className="w-3 h-3 mr-1" />
                              Budgeted
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-300 dark:border-amber-800 text-[10px] font-semibold"
                            >
                              <AlertTriangle className="w-3 h-3 mr-1" />
                              No Budget
                            </Badge>
                          )}
                        </TableCell>

                        {/* Top Cost Driver */}
                        <TableCell className="py-3 px-4 text-muted-foreground text-xs font-medium truncate max-w-[160px]">
                          {acc.topCostDriver}
                        </TableCell>

                        {/* Action: Set Budget, Instant Email & Open */}
                        <TableCell className="py-3 px-4 text-center">
                          <div className="inline-flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setBudgetTrigger({
                                  cloudProvider: "aws",
                                  accountId: acc.linkedAccountId,
                                  accountName: acc.accountName,
                                  parentAccountId: selectedAwsAccount,
                                  currentSpend: acc.currentSpend,
                                  billingCurrency: "USD",
                                  mode: "budget",
                                })
                              }
                              title={
                                findManualBudgetForAccount(acc)
                                  ? `Edit Manual Budget (${findManualBudgetForAccount(acc)?.percentUsed}%)`
                                  : "Set Manual Budget Alert"
                              }
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/30 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                            >
                              <Bell className="w-3 h-3" />
                              <span>{findManualBudgetForAccount(acc) ? `${findManualBudgetForAccount(acc)?.percentUsed}%` : "Budget"}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleQuickSendEmail(acc)}
                              disabled={sendingRowId === acc.linkedAccountId}
                              title="Send Instant Usage Details Email"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Send className="w-3 h-3" />
                              <span>{sendingRowId === acc.linkedAccountId ? "..." : "Email"}</span>
                            </button>

                            <Link
                              to={`/linked-accounts/${encodeURIComponent(acc.linkedAccountId || "")}?account=${encodeURIComponent(selectedAwsAccount)}${selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : ""}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
                            >
                              <span>Open</span>
                              <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Pagination Controls matching DataTables.tsx */}
            <div className="flex items-center justify-between p-4 border-t border-muted/30">
              <div className="text-xs text-muted-foreground">
                {filteredAccounts.length > 0 ? (
                  `Showing ${(currentPage - 1) * ITEMS_PER_PAGE + 1}-${Math.min(
                    currentPage * ITEMS_PER_PAGE,
                    filteredAccounts.length
                  )} of ${filteredAccounts.length} accounts`
                ) : (
                  "0 of 0 accounts"
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-medium min-w-[32px] text-center">
                  {currentPage} / {totalPages || 1}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        <ManualBudgetAlertsSection
          defaultProvider="aws"
          lockProvider
          selectedMonth={selectedMonth}
          externalTriggerAccount={budgetTrigger}
          onClearExternalTrigger={() => setBudgetTrigger(null)}
          onBudgetsChanged={fetchManualBudgets}
        />
      </main>
    </div>
  );
}

export default LinkedAccountsPage;

