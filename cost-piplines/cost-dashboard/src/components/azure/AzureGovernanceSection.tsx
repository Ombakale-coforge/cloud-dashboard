import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
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
  ShieldCheck,
  Building2,
  PieChart,
  AlertTriangle,
  Wallet,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Lock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

interface AzureGovernanceSummary {
  rootAccount?: {
    id: string;
    name: string;
    accountId: string;
  };
  selectedMonth?: string;
  totalAccounts?: number;
  budgetedAccounts?: number;
  unbudgetedAccounts?: number;
  permissionDeniedAccounts?: number;
  totalBudgetedSpend?: number;
  activeSpend?: number;
  currency?: string;
}

interface AzureBudgetRow {
  "Linked Account": string;
  "Account ID": string;
  "Budget Name": string;
  "Budget Limit": number;
  "Actual Spend": number;
  "% Utilized": number;
  Status: "On Track" | "Warning" | "Exceeded" | "Permission Denied" | "Unbudgeted" | string;
  "Permission Error"?: string;
}

interface AzureUnbudgetedRow {
  "Linked Account": string;
  "Account ID": string;
  Cost: number;
  Status: "Permission Denied" | "Unbudgeted" | string;
  "Error Message"?: string;
}

interface AzureGovernanceSectionProps {
  selectedMonth: string;
  basePath?: string;
}

export function AzureGovernanceSection({
  selectedMonth,
}: AzureGovernanceSectionProps) {
  const [summary, setSummary] = useState<AzureGovernanceSummary | null>(null);
  const [budgets, setBudgets] = useState<AzureBudgetRow[]>([]);
  const [unbudgeted, setUnbudgeted] = useState<AzureUnbudgetedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Search & Pagination state
  const [searchBudgets, setSearchBudgets] = useState("");
  const [pageBudgets, setPageBudgets] = useState(1);
  const [searchUnbudgeted, setSearchUnbudgeted] = useState("");
  const [pageUnbudgeted, setPageUnbudgeted] = useState(1);
  const ITEMS_PER_PAGE = 6;

  const loadData = () => {
    setLoading(true);
    const monthParam = selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : "";

    Promise.all([
      fetch(`/api/azure/dataset/governance_summary${monthParam}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/azure/dataset/budgets_overview${monthParam}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/azure/dataset/unbudgeted_accounts${monthParam}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([summaryData, budgetsData, unbudgetedData]) => {
        if (summaryData) setSummary(summaryData);
        if (Array.isArray(budgetsData)) setBudgets(budgetsData);
        if (Array.isArray(unbudgetedData)) setUnbudgeted(unbudgetedData);
      })
      .catch((err) => console.error("Error loading Azure governance data:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, [selectedMonth]);

  const handleSyncBudgets = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/azure/budgets/sync", { method: "POST" });
      if (res.ok) {
        loadData();
      }
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setSyncing(false);
    }
  };

  // Filtered & Paginated Budgets
  const filteredBudgets = useMemo(() => {
    if (!searchBudgets) return budgets;
    const q = searchBudgets.toLowerCase();
    return budgets.filter(
      (b) =>
        (b["Linked Account"] || "").toLowerCase().includes(q) ||
        (b["Account ID"] || "").toLowerCase().includes(q) ||
        (b["Budget Name"] || "").toLowerCase().includes(q) ||
        (b.Status || "").toLowerCase().includes(q)
    );
  }, [budgets, searchBudgets]);

  const paginatedBudgets = useMemo(() => {
    const start = (pageBudgets - 1) * ITEMS_PER_PAGE;
    return filteredBudgets.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredBudgets, pageBudgets]);

  const totalBudgetPages = Math.ceil(filteredBudgets.length / ITEMS_PER_PAGE) || 1;

  // Filtered & Paginated Unbudgeted
  const filteredUnbudgeted = useMemo(() => {
    if (!searchUnbudgeted) return unbudgeted;
    const q = searchUnbudgeted.toLowerCase();
    return unbudgeted.filter(
      (u) =>
        (u["Linked Account"] || "").toLowerCase().includes(q) ||
        (u["Account ID"] || "").toLowerCase().includes(q) ||
        (u.Status || "").toLowerCase().includes(q)
    );
  }, [unbudgeted, searchUnbudgeted]);

  const paginatedUnbudgeted = useMemo(() => {
    const start = (pageUnbudgeted - 1) * ITEMS_PER_PAGE;
    return filteredUnbudgeted.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredUnbudgeted, pageUnbudgeted]);

  const totalUnbudgetedPages = Math.ceil(filteredUnbudgeted.length / ITEMS_PER_PAGE) || 1;

  const totalAccounts = summary?.totalAccounts || budgets.length || unbudgeted.length || 0;
  const budgetedAccounts = summary?.budgetedAccounts || budgets.filter((b) => b.Status === "On Track" || b.Status === "Warning" || b.Status === "Exceeded").length;
  const permissionDeniedCount = summary?.permissionDeniedAccounts || budgets.filter((b) => b.Status === "Permission Denied").length + unbudgeted.filter((u) => u.Status === "Permission Denied").length;
  const coveragePct = totalAccounts > 0 ? Math.round((budgetedAccounts / totalAccounts) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header and Refresh Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Azure Budgets & Governance
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Management-configured Azure budgets, spending thresholds, and RBAC permission checks
          </p>
        </div>
        <button
          onClick={handleSyncBudgets}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin text-blue-600" : ""}`} />
          {syncing ? "Syncing ARM..." : "Sync Azure Budgets"}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Budget Coverage */}
        <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Budget Coverage</span>
              <PieChart className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{coveragePct}%</span>
              <span className="text-xs text-muted-foreground">
                ({budgetedAccounts} of {totalAccounts} subs)
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Total Budget Allocation */}
        <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Total Budget Allocated</span>
              <Wallet className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                ₹{(summary?.totalBudgetedSpend || 0).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Active Spend */}
        <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Active Month Spend</span>
              <Building2 className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                ₹{(summary?.activeSpend || 0).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Permission Denied / Access Restricted */}
        <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Permission Restricted</span>
              <Lock className="h-4 w-4 text-purple-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-2xl font-bold tracking-tight ${permissionDeniedCount > 0 ? "text-purple-600" : "text-slate-900 dark:text-slate-100"}`}>
                {permissionDeniedCount}
              </span>
              <span className="text-xs text-muted-foreground">subs missing RBAC</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table 1: Azure Budgets Overview */}
      <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-slate-800/60 p-4">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-blue-600" />
              Azure Subscriptions Budget Tracking
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live consumption against budgets configured in Azure Portal
            </p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search subscription or budget..."
              value={searchBudgets}
              onChange={(e) => {
                setSearchBudgets(e.target.value);
                setPageBudgets(1);
              }}
              className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-8 pr-3 text-xs outline-hidden focus:border-blue-500"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50 text-[11px]">
                  <TableHead className="py-2.5 font-semibold">Subscription</TableHead>
                  <TableHead className="py-2.5 font-semibold">Budget Name</TableHead>
                  <TableHead className="py-2.5 text-right font-semibold">Budget Limit</TableHead>
                  <TableHead className="py-2.5 text-right font-semibold">Actual Spend</TableHead>
                  <TableHead className="py-2.5 font-semibold">% Utilized</TableHead>
                  <TableHead className="py-2.5 text-center font-semibold">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedBudgets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                      No budget entries found. Run "Sync Azure Budgets" to pull from Azure.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedBudgets.map((b, idx) => {
                    const isPermDenied = b.Status === "Permission Denied";
                    const isWarning = b.Status === "Warning";
                    const isExceeded = b.Status === "Exceeded";

                    return (
                      <TableRow key={idx} className="border-b border-slate-100/60 dark:border-slate-800/40 text-xs hover:bg-slate-50/50 dark:hover:bg-slate-900/30">
                        <TableCell className="font-medium">
                          <div>{b["Linked Account"]}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{b["Account ID"]}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{b["Budget Name"]}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {b["Budget Limit"] ? `₹${b["Budget Limit"].toLocaleString()}` : "—"}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{(b["Actual Spend"] || 0).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {b["Budget Limit"] > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    isExceeded ? "bg-rose-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"
                                  }`}
                                  style={{ width: `${Math.min(100, b["% Utilized"])}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-medium">{b["% Utilized"]}%</span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {isPermDenied ? (
                            <Badge
                              className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20 text-[10px] inline-flex items-center gap-1"
                              title={b["Permission Error"] || "Service principal lacks Cost Management Reader role on this subscription."}
                            >
                              <Lock className="h-2.5 w-2.5" />
                              Permission Denied
                            </Badge>
                          ) : isExceeded ? (
                            <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 text-[10px]">
                              Exceeded
                            </Badge>
                          ) : isWarning ? (
                            <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[10px]">
                              Warning
                            </Badge>
                          ) : b.Status === "Unbudgeted" ? (
                            <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[10px]">
                              Unbudgeted
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-[10px]">
                              On Track
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalBudgetPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 p-3 text-xs text-muted-foreground">
              <span>
                Page {pageBudgets} of {totalBudgetPages}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={pageBudgets <= 1}
                  onClick={() => setPageBudgets((p) => p - 1)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  disabled={pageBudgets >= totalBudgetPages}
                  onClick={() => setPageBudgets((p) => p + 1)}
                  className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table 2: Unbudgeted & Restricted Subscriptions */}
      {unbudgeted.length > 0 && (
        <Card className="rounded-xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 dark:border-slate-800/60 p-4">
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Unbudgeted & Permission Restricted Subscriptions
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active spending subscriptions lacking an allocated budget or requiring Azure RBAC permissions
              </p>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={searchUnbudgeted}
                onChange={(e) => {
                  setSearchUnbudgeted(e.target.value);
                  setPageUnbudgeted(1);
                }}
                className="h-8 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-8 pr-3 text-xs outline-hidden focus:border-blue-500"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/50 text-[11px]">
                    <TableHead className="py-2.5 font-semibold">Subscription</TableHead>
                    <TableHead className="py-2.5 text-right font-semibold">Current Spend</TableHead>
                    <TableHead className="py-2.5 font-semibold">Status</TableHead>
                    <TableHead className="py-2.5 font-semibold">Details / Recommended Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedUnbudgeted.map((u, idx) => (
                    <TableRow key={idx} className="border-b border-slate-100/60 dark:border-slate-800/40 text-xs hover:bg-slate-50/50 dark:hover:bg-slate-900/30">
                      <TableCell className="font-medium">{u["Linked Account"]}</TableCell>
                      <TableCell className="text-right font-semibold">₹{(u.Cost || 0).toLocaleString()}</TableCell>
                      <TableCell>
                        {u.Status === "Permission Denied" ? (
                          <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20 text-[10px] inline-flex items-center gap-1">
                            <Lock className="h-2.5 w-2.5" />
                            Permission Denied
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 text-[10px]">
                            Unbudgeted
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-[11px]">
                        {u["Error Message"] || "Configure budget in Azure Portal > Cost Management > Budgets."}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalUnbudgetedPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/60 p-3 text-xs text-muted-foreground">
                <span>
                  Page {pageUnbudgeted} of {totalUnbudgetedPages}
                </span>
                <div className="flex gap-1">
                  <button
                    disabled={pageUnbudgeted <= 1}
                    onClick={() => setPageUnbudgeted((p) => p - 1)}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    disabled={pageUnbudgeted >= totalUnbudgetedPages}
                    onClick={() => setPageUnbudgeted((p) => p + 1)}
                    className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
