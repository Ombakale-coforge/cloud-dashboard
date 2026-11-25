import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Edit3,
  Mail,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";

type BudgetStatus = "NORMAL" | "NEAR_50" | "NEAR_75" | "AT_100" | "OVER_BUDGET";

interface TopServiceCost {
  service: string;
  cost: number;
}

interface OwnerManualBudget {
  id: number;
  cloudProvider: "azure" | "aws";
  accountId: string;
  accountName: string;
  monthlyBudget: number;
  billingCurrency: "USD" | "INR";
  alertEmail: string;
  alertEmails?: string[];
  contactName?: string | null;
  isActive: boolean;
  percentUsed: number;
  remainingBudget: number;
  overBudgetAmount: number;
  status: BudgetStatus;
  thresholdCrossed?: "50%" | "75%" | "100%" | "OVER_BUDGET" | null;
}

interface OwnedAccountItem {
  cloudProvider: "azure" | "aws";
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  state: string;
  ownershipSources: string[];
  projectCode?: string | null;
  costCode?: string | null;
  evaluationMonth: string;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  billingCurrency: "USD" | "INR";
  topCostDriver: string;
  topServices: TopServiceCost[];
  manualBudget: OwnerManualBudget | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatCurrency(amount: number, currency: "USD" | "INR"): string {
  const safe = Number(amount) || 0;
  if (currency === "INR") {
    return `₹${safe.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  return `$${safe.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function getStatusBadge(status: BudgetStatus) {
  switch (status) {
    case "OVER_BUDGET":
      return {
        label: "Over Budget",
        className: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
        barColor: "bg-rose-500",
      };
    case "AT_100":
      return {
        label: "At 100%",
        className: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
        barColor: "bg-rose-500",
      };
    case "NEAR_75":
      return {
        label: "Near 75%",
        className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
        barColor: "bg-amber-500",
      };
    case "NEAR_50":
      return {
        label: "At 50%",
        className: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
        barColor: "bg-sky-500",
      };
    default:
      return {
        label: "On Track",
        className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
        barColor: "bg-emerald-500",
      };
  }
}

export function MyAccountsBudgetTab() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<OwnedAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<"all" | "azure" | "aws">("all");

  // Modal state
  const [editingAccount, setEditingAccount] = useState<OwnedAccountItem | null>(null);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<"INR" | "USD">("INR");
  const [contactName, setContactName] = useState("");
  const [emailChips, setEmailChips] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadAccounts = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      setSessionExpired(false);

      const url = forceRefresh ? "/api/budgets/my-accounts?refresh=true" : "/api/budgets/my-accounts";
      const res = await fetch(url, { credentials: "include" });

      if (res.status === 401) {
        setSessionExpired(true);
        setAccounts([]);
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to load your owned accounts.");
      }
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
    } catch (err: any) {
      setError(err?.message || "Unable to fetch your cloud accounts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts(false);
  }, [loadAccounts]);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (providerFilter !== "all" && acc.cloudProvider !== providerFilter) return false;
      if (!q) return true;
      return (
        acc.accountName.toLowerCase().includes(q) ||
        acc.accountId.toLowerCase().includes(q) ||
        (acc.projectCode && acc.projectCode.toLowerCase().includes(q)) ||
        (acc.costCode && acc.costCode.toLowerCase().includes(q)) ||
        acc.ownershipSources.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [accounts, providerFilter, searchQuery]);

  const summary = useMemo(() => {
    let totalInrSpend = 0;
    let totalUsdSpend = 0;
    let totalInrBudget = 0;
    let totalUsdBudget = 0;
    let configuredCount = 0;
    let alertCount = 0;

    for (const acc of accounts) {
      if (acc.billingCurrency === "INR") totalInrSpend += acc.currentSpend;
      else totalUsdSpend += acc.currentSpend;

      if (acc.manualBudget) {
        configuredCount++;
        if (acc.manualBudget.billingCurrency === "INR") totalInrBudget += acc.manualBudget.monthlyBudget;
        else totalUsdBudget += acc.manualBudget.monthlyBudget;

        if (["NEAR_75", "AT_100", "OVER_BUDGET"].includes(acc.manualBudget.status)) {
          alertCount++;
        }
      }
    }

    return {
      totalAccounts: accounts.length,
      azureCount: accounts.filter((a) => a.cloudProvider === "azure").length,
      awsCount: accounts.filter((a) => a.cloudProvider === "aws").length,
      totalInrSpend,
      totalUsdSpend,
      totalInrBudget,
      totalUsdBudget,
      configuredCount,
      alertCount,
    };
  }, [accounts]);

  const openBudgetModal = (acc: OwnedAccountItem) => {
    const b = acc.manualBudget;
    setEditingAccount(acc);
    setBudgetAmount(b ? String(b.monthlyBudget) : "");
    setBudgetCurrency(b?.billingCurrency || acc.billingCurrency || (acc.cloudProvider === "azure" ? "INR" : "USD"));
    setContactName(b?.contactName || user?.name || "");
    const initialEmails =
      b?.alertEmails && b.alertEmails.length > 0
        ? b.alertEmails
        : b?.alertEmail
        ? b.alertEmail.split(/[,;\s]+/).filter(Boolean)
        : user?.email
        ? [user.email.toLowerCase()]
        : [];
    setEmailChips(Array.from(new Set(initialEmails.map((e) => e.trim().toLowerCase()))));
    setEmailInput("");
    setIsActive(b ? b.isActive : true);
    setModalError(null);
  };

  const addEmailChip = (raw: string) => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;

    for (const part of parts) {
      if (!EMAIL_RE.test(part)) {
        setModalError(`"${part}" is not a valid email address.`);
        return;
      }
    }
    setModalError(null);
    setEmailChips((prev) => Array.from(new Set([...prev, ...parts])));
    setEmailInput("");
  };

  const removeEmailChip = (email: string) => {
    setEmailChips((prev) => prev.filter((e) => e !== email));
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    const amount = Number(budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setModalError("Please enter a valid positive monthly budget amount.");
      return;
    }

    let finalEmails = [...emailChips];
    if (emailInput.trim()) {
      const candidate = emailInput.trim().toLowerCase();
      if (!EMAIL_RE.test(candidate)) {
        setModalError(`"${candidate}" is not a valid email address.`);
        return;
      }
      finalEmails = Array.from(new Set([...finalEmails, candidate]));
    }
    if (finalEmails.length === 0 && user?.email) {
      finalEmails = [user.email.toLowerCase()];
    }
    if (finalEmails.length === 0) {
      setModalError("At least one alert email address is required.");
      return;
    }

    try {
      setSaving(true);
      setModalError(null);
      const res = await fetch("/api/budgets/my-accounts/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          cloudProvider: editingAccount.cloudProvider,
          accountId: editingAccount.accountId,
          accountName: editingAccount.accountName,
          parentAccountId: editingAccount.parentAccountId,
          monthlyBudget: amount,
          billingCurrency: budgetCurrency,
          alertEmails: finalEmails,
          contactName: contactName.trim() || user?.name || null,
          isActive,
          month: editingAccount.evaluationMonth,
        }),
      });

      const data = await res.json();
      if (res.status === 401) {
        setSessionExpired(true);
        setEditingAccount(null);
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to save budget.");
      }

      setEditingAccount(null);
      setFeedback({
        type: "success",
        text: `Saved ${formatCurrency(amount, budgetCurrency)} monthly budget for ${editingAccount.accountName}.`,
      });
      await loadAccounts(false);
    } catch (err: any) {
      setModalError(err?.message || "Failed to save budget.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBudget = async (acc: OwnedAccountItem) => {
    if (!acc.manualBudget) return;
    if (!window.confirm(`Remove the monthly budget for "${acc.accountName}"?`)) return;

    try {
      setDeletingId(acc.manualBudget.id);
      setFeedback(null);
      const res = await fetch(`/api/budgets/my-accounts/budget/${acc.manualBudget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (res.status === 401) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to delete budget.");
      }
      setFeedback({
        type: "success",
        text: `Removed budget for ${acc.accountName}.`,
      });
      await loadAccounts(false);
    } catch (err: any) {
      setFeedback({
        type: "error",
        text: err?.message || "Failed to remove budget.",
      });
    } finally {
      setDeletingId(null);
    }
  };

  if (sessionExpired) {
    return (
      <Card className="p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-foreground mb-1">Session Cookie Required</h3>
        <p className="text-xs text-muted-foreground max-w-md mx-auto mb-4">
          Your browser signed in before server-side session cookies were enabled. Please sign out and sign back in once to verify your account ownership.
        </p>
        <Button
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          Sign In Again
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Intro & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-500" />
            <span>My Owned Cloud Accounts &amp; Budgets</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accounts matched to <span className="font-semibold text-foreground">{user?.email}</span> via Azure RBAC Owner, resource/subscription tags, and AWS Organizations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadAccounts(true)}
          disabled={refreshing || loading}
          className="self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span>{refreshing ? "Refreshing..." : "Refresh Ownership"}</span>
        </Button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardDescription className="text-xs">Owned Accounts</CardDescription>
            <CardTitle className="text-2xl">{summary.totalAccounts}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 text-xs text-muted-foreground">
            {summary.azureCount} Azure · {summary.awsCount} AWS
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="text-xs">Current Month Spend</CardDescription>
            <CardTitle className="text-2xl">
              {summary.totalInrSpend > 0
                ? formatCurrency(summary.totalInrSpend, "INR")
                : formatCurrency(summary.totalUsdSpend, "USD")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 text-xs text-muted-foreground">
            {summary.totalInrSpend > 0 && summary.totalUsdSpend > 0
              ? `Plus ${formatCurrency(summary.totalUsdSpend, "USD")} AWS spend`
              : "Latest billing period"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="text-xs">Budgets Configured</CardDescription>
            <CardTitle className="text-2xl">
              {summary.configuredCount} / {summary.totalAccounts}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 text-xs text-muted-foreground">
            {summary.totalInrBudget > 0 && `${formatCurrency(summary.totalInrBudget, "INR")} INR`}
            {summary.totalInrBudget > 0 && summary.totalUsdBudget > 0 && " · "}
            {summary.totalUsdBudget > 0 && `${formatCurrency(summary.totalUsdBudget, "USD")} USD`}
            {summary.totalInrBudget === 0 && summary.totalUsdBudget === 0 && "No monthly caps set yet"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription className="text-xs">Near / Over Budget</CardDescription>
            <CardTitle className={`text-2xl ${summary.alertCount > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>
              {summary.alertCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 text-xs text-muted-foreground">
            Accounts at ≥ 75% monthly threshold
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by account name, ID, project code, or owner role..."
            className="w-full rounded-xl border border-border bg-card pl-9 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 self-start">
          {(["all", "azure", "aws"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProviderFilter(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                providerFilter === p
                  ? "bg-indigo-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p === "all" ? `All (${summary.totalAccounts})` : p === "azure" ? `Azure (${summary.azureCount})` : `AWS (${summary.awsCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error / Empty / List */}
      {loading ? (
        <Card className="p-10 text-center text-xs text-muted-foreground">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
          Discovering your owned Azure &amp; AWS accounts...
        </Card>
      ) : error ? (
        <Card className="p-8 text-center border-rose-500/30">
          <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground mb-1">Could not load your accounts</p>
          <p className="text-xs text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadAccounts(false)}>
            Try Again
          </Button>
        </Card>
      ) : filteredAccounts.length === 0 ? (
        <Card className="p-10 text-center">
          <Cloud className="w-10 h-10 text-indigo-500/50 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-foreground mb-1">
            {accounts.length === 0 ? "No Owned Cloud Accounts Found" : "No Accounts Match Your Filter"}
          </h3>
          <p className="text-xs text-muted-foreground max-w-lg mx-auto">
            {accounts.length === 0
              ? `No Azure subscriptions (RBAC Owner or Owner/POC tags) or AWS linked accounts matched "${user?.email}". If you manage a subscription under a different tag or need access, contact FinOps.`
              : "Try clearing your search query or switching provider filters."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredAccounts.map((acc) => {
            const b = acc.manualBudget;
            const statusMeta = b ? getStatusBadge(b.status) : null;
            const progressPct = b ? Math.min(100, Math.max(0, b.percentUsed)) : 0;

            return (
              <Card key={`${acc.cloudProvider}:${acc.accountId}`} className="justify-between">
                <div className="space-y-3">
                  {/* Top row: name + provider + budget status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={
                            acc.cloudProvider === "azure"
                              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 uppercase text-[10px]"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 uppercase text-[10px]"
                          }
                        >
                          {acc.cloudProvider}
                        </Badge>
                        <h3 className="font-bold text-sm text-foreground truncate">{acc.accountName}</h3>
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground mt-1 truncate">{acc.accountId}</p>
                    </div>

                    {statusMeta ? (
                      <Badge variant="outline" className={`shrink-0 text-[11px] ${statusMeta.className}`}>
                        {statusMeta.label} ({b!.percentUsed}%)
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
                        No Budget
                      </Badge>
                    )}
                  </div>

                  {/* Ownership Sources */}
                  <div className="flex flex-wrap gap-1.5">
                    {acc.ownershipSources.map((src) => (
                      <span
                        key={src}
                        className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        <UserCheck className="w-3 h-3 text-indigo-500" />
                        {src}
                      </span>
                    ))}
                    {acc.projectCode && (
                      <span className="rounded-md bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Project: {acc.projectCode}
                      </span>
                    )}
                  </div>

                  {/* Spend Metrics */}
                  <div className="grid grid-cols-3 gap-3 rounded-xl bg-muted/40 p-3 border border-border/60">
                    <div>
                      <span className="block text-[10px] text-muted-foreground">
                        Spend ({acc.evaluationMonth})
                      </span>
                      <span className="text-sm font-bold text-foreground">
                        {formatCurrency(acc.currentSpend, acc.billingCurrency)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground">MoM Trend</span>
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          acc.momChangePercent > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : acc.momChangePercent < 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {acc.momChangePercent > 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : acc.momChangePercent < 0 ? (
                          <TrendingDown className="w-3 h-3" />
                        ) : null}
                        {acc.momChangePercent > 0 ? `+${acc.momChangePercent}%` : `${acc.momChangePercent}%`}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="block text-[10px] text-muted-foreground">Top Driver</span>
                      <span className="block text-xs font-medium text-foreground truncate" title={acc.topCostDriver}>
                        {acc.topCostDriver}
                      </span>
                    </div>
                  </div>

                  {/* Budget Progress Bar */}
                  {b ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Monthly Limit:{" "}
                          <span className="font-semibold text-foreground">
                            {formatCurrency(b.monthlyBudget, b.billingCurrency)}
                          </span>
                          {!b.isActive && <span className="ml-1.5 text-[10px] text-amber-500">(Paused)</span>}
                        </span>
                        <span className="text-muted-foreground">
                          {b.overBudgetAmount > 0
                            ? `Over by ${formatCurrency(b.overBudgetAmount, b.billingCurrency)}`
                            : `${formatCurrency(b.remainingBudget, b.billingCurrency)} left`}
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${statusMeta?.barColor || "bg-indigo-500"}`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                        <Mail className="w-3 h-3 shrink-0" />
                        <span className="truncate" title={b.alertEmail}>
                          Alerts: {b.alertEmail}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No monthly budget configured yet. Set a threshold to receive 50%, 75%, 100%, and over-budget email alerts.
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
                  {b && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteBudget(acc)}
                      disabled={deletingId === b.id}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-500/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{deletingId === b.id ? "Removing..." : "Remove"}</span>
                    </Button>
                  )}
                  <Button size="sm" onClick={() => openBudgetModal(acc)}>
                    {b ? <Edit3 className="w-3.5 h-3.5" /> : <PlusCircle className="w-3.5 h-3.5" />}
                    <span>{b ? "Edit Budget" : "Set Budget"}</span>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Set / Edit Budget Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {editingAccount.manualBudget ? "Edit Account Budget" : "Set Monthly Account Budget"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {editingAccount.accountName} ({editingAccount.cloudProvider.toUpperCase()})
                </p>
              </div>
              <button
                onClick={() => setEditingAccount(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSaveBudget} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-foreground">Monthly Budget</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground">Currency</label>
                  <select
                    value={budgetCurrency}
                    onChange={(e) => setBudgetCurrency(e.target.value as "INR" | "USD")}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-foreground">Owner / Contact Name</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Account Owner Name"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Alert Recipient Emails</label>
                {emailChips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {emailChips.map((em) => (
                      <span
                        key={em}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-0.5 text-xs text-indigo-700 dark:text-indigo-300"
                      >
                        {em}
                        <button
                          type="button"
                          onClick={() => removeEmailChip(em)}
                          className="hover:text-rose-500 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addEmailChip(emailInput);
                      }
                    }}
                    placeholder="Add email and press Enter..."
                    className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addEmailChip(emailInput)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </Button>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-border"
                />
                <span>Enable automated threshold alerts (50%, 75%, 100%, Over Budget)</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setEditingAccount(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Budget"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
