import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";

interface LinkedAccountItem {
  linkedAccountId: string;
  accountName: string;
  status: string;
  selectedMonth: string;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  hasBudget: boolean;
  budgetStatus: "Budgeted" | "Unbudgeted";
  topCostDriver: string;
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
  accounts: LinkedAccountItem[];
}

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function LinkedAccountsPage() {
  const [awsAccounts, setAwsAccounts] = useState<AccountOption[]>([
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
  ]);
  const [selectedAwsAccount, setSelectedAwsAccount] = useState<string>("account-1");
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [budgetFilter, setBudgetFilter] = useState<"ALL" | "BUDGETED" | "UNBUDGETED">("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 12;

  // Available months
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  // 1. Fetch AWS Accounts
  useEffect(() => {
    fetch("/api/aws/accounts")
      .then((res) => (res.ok ? res.json() : []))
      .then((accs) => {
        if (Array.isArray(accs) && accs.length > 0) {
          setAwsAccounts(accs);
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
    fetch(`/api/aws/linked-accounts?account=${encodeURIComponent(selectedAwsAccount)}${monthQuery}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to fetch accounts (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((json: ApiResponse) => {
        setData(json);
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
          a.topCostDriver.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "ALL") {
      list = list.filter((a) => a.status.toUpperCase() === statusFilter);
    }

    if (budgetFilter === "BUDGETED") {
      list = list.filter((a) => a.hasBudget);
    } else if (budgetFilter === "UNBUDGETED") {
      list = list.filter((a) => !a.hasBudget);
    }

    return list;
  }, [data, searchQuery, statusFilter, budgetFilter]);

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
                Member account inventory, billing trajectory, and budget enforcement
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

        {/* 4 Summary KPI Cards */}
        {data && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
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

            {/* Card 2: Total Month Spend */}
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

            {/* Card 3: Budget Coverage */}
            <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    BUDGET COVERAGE
                  </p>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {data.activeAccountsCount > 0
                      ? `${((data.budgetedCount / data.activeAccountsCount) * 100).toFixed(1)}%`
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

            {/* Card 4: Top Cost Account */}
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

        {/* Directory Card with Search, Filter & Shadcn Table */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <CardHeader className="pb-3 border-b border-muted/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                  Member Accounts Inventory
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Detailed billing, active governance status, and direct deep-dive analysis
                </p>
              </div>

              {/* Status & Budget Quick Filters */}
              <div className="flex flex-wrap items-center gap-2">
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
                placeholder="Search by account name, 12-digit ID, or service driver..."
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
              <div className="py-16 text-center text-muted-foreground text-xs space-y-2">
                <p>No member accounts found matching your filters.</p>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                    setBudgetFilter("ALL");
                  }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 underline font-medium cursor-pointer"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-muted/30 bg-muted/20 hover:bg-transparent">
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Account Name & ID
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[100px]">
                      Status
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[120px]">
                      Current Spend
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[120px]">
                      Prior Spend
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[110px]">
                      MoM Variance
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-[120px]">
                      Governance
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Top Cost Driver
                    </TableHead>
                    <TableHead className="py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center w-[120px]">
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
                            <span className="font-semibold text-xs text-foreground">
                              {acc.accountName}
                            </span>
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
                          {acc.hasBudget ? (
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

                        {/* Action: Open in Current Tab */}
                        <TableCell className="py-3 px-4 text-center">
                          <Link
                            to={`/linked-accounts/${encodeURIComponent(acc.linkedAccountId || "")}?account=${encodeURIComponent(selectedAwsAccount)}${selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : ""}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
                          >
                            <span>Open</span>
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          </Link>
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
      </main>
    </div>
  );
}

export default LinkedAccountsPage;
