import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Mail,
  Send,
  PlusCircle,
  Trash2,
  Edit3,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  UserCheck,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Cloud,
  Search,
  ChevronDown,
  Check,
} from "lucide-react";

export type CloudProvider = "aws" | "azure" | "gcp";

export interface TopServiceCost {
  service: string;
  cost: number;
}

export interface EnrichedAccountBudget {
  id: number;
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  monthlyBudget: number;
  billingCurrency: "USD" | "INR";
  alertEmail: string;
  alertEmails?: string[];
  contactName?: string | null;
  isActive: boolean;
  lastNotifiedThreshold?: "50%" | "75%" | "100%" | "OVER_BUDGET" | null;
  lastNotifiedMonth?: string | null;
  lastNotifiedAt?: string | null;
  lastManualEmailAt?: string | null;
  percentUsed: number;
  remainingBudget: number;
  overBudgetAmount: number;
  status: "NORMAL" | "NEAR_50" | "NEAR_75" | "AT_100" | "OVER_BUDGET";
  thresholdCrossed?: "50%" | "75%" | "100%" | "OVER_BUDGET" | null;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  evaluationMonth: string;
  topCostDriver: string;
  topServices: TopServiceCost[];
  nativeCurrency: "USD" | "INR";
}

export interface CloudAccountUsageItem {
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  parentAccountName?: string | null;
  status: string;
  evaluationMonth: string;
  currentSpend: number;
  previousSpend: number;
  momChangePercent: number;
  billingCurrency: "USD" | "INR";
  conversionRate?: number;
  currentSpendUsd?: number;
  topCostDriver: string;
  topServices: TopServiceCost[];
  manualBudget?: EnrichedAccountBudget | null;
}

export interface ExternalBudgetTrigger {
  cloudProvider: CloudProvider;
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  currentSpend?: number;
  billingCurrency?: "USD" | "INR";
  mode?: "budget" | "instant-email";
}

export interface ManualBudgetAlertsSectionProps {
  defaultProvider?: "all" | CloudProvider;
  lockProvider?: boolean;
  selectedMonth?: string;
  externalTriggerAccount?: ExternalBudgetTrigger | null;
  onClearExternalTrigger?: () => void;
  onBudgetsChanged?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmailList(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(/[;,\s]+/);
  const deduped = new Set<string>();
  for (const part of parts) {
    const cleaned = String(part || "").trim().toLowerCase();
    if (cleaned && EMAIL_REGEX.test(cleaned)) {
      deduped.add(cleaned);
    }
  }
  return Array.from(deduped);
}

function fmtMoney(amount: number | undefined | null, currency: "USD" | "INR" = "USD"): string {
  const val = Number(amount ?? 0);
  const safeVal = Number.isFinite(val) ? val : 0;
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(safeVal);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(safeVal);
}

function getProviderPill(provider: CloudProvider): { label: string; className: string } {
  switch (provider) {
    case "aws":
      return {
        label: "AWS",
        className:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "azure":
      return {
        label: "Azure",
        className:
          "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800",
      };
    case "gcp":
      return {
        label: "GCP",
        className:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800",
      };
  }
}

function getStatusVisuals(status: EnrichedAccountBudget["status"], pct: number) {
  if (status === "OVER_BUDGET" || pct > 100) {
    return {
      barClass: "bg-rose-600",
      badgeClass:
        "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 font-bold",
      label: `OVER BUDGET (${pct.toFixed(1)}%)`,
    };
  }
  if (status === "AT_100" || pct >= 100) {
    return {
      barClass: "bg-rose-500",
      badgeClass:
        "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
      label: "100% Reached",
    };
  }
  if (status === "NEAR_75" || pct >= 75) {
    return {
      barClass: "bg-orange-500",
      badgeClass:
        "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
      label: "75% Reached",
    };
  }
  if (status === "NEAR_50" || pct >= 50) {
    return {
      barClass: "bg-amber-500",
      badgeClass:
        "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
      label: "50% Reached",
    };
  }
  return {
    barClass: "bg-emerald-500",
    badgeClass:
      "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    label: "Healthy (<50%)",
  };
}

async function fetchFallbackCloudAccounts(
  provider: "all" | CloudProvider,
  selectedMonth?: string
): Promise<CloudAccountUsageItem[]> {
  const results: CloudAccountUsageItem[] = [];
  const monthQ = selectedMonth ? `month=${encodeURIComponent(selectedMonth)}` : "";
  const seen = new Set<string>();

  if (provider === "all" || provider === "aws") {
    const awsResponses = await Promise.all(
      ["account-1", "account-2"].map((acc) =>
        fetch(`/api/aws/linked-accounts?account=${acc}${monthQ ? `&${monthQ}` : ""}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    for (const json of awsResponses) {
      for (const a of json?.accounts || []) {
        const key = `aws:${String(a.linkedAccountId).toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          cloudProvider: "aws",
          accountId: a.linkedAccountId,
          accountName: a.accountName || a.linkedAccountId,
          parentAccountId: json?.rootAccount?.id || null,
          parentAccountName: json?.rootAccount?.name || null,
          status: a.status || "ACTIVE",
          evaluationMonth: a.selectedMonth || selectedMonth || new Date().toISOString().slice(0, 7),
          currentSpend: Number(a.currentSpend || 0),
          previousSpend: Number(a.previousSpend || 0),
          momChangePercent: Number(a.momChangePercent || 0),
          billingCurrency: "USD",
          topCostDriver: a.topCostDriver || "Cloud Infrastructure",
          topServices: [],
        });
      }
    }
  }

  if (provider === "all" || provider === "azure") {
    const azJson = await fetch(`/api/azure/linked-accounts${monthQ ? `?${monthQ}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    for (const a of azJson?.accounts || []) {
      const key = `azure:${String(a.linkedAccountId).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        cloudProvider: "azure",
        accountId: a.linkedAccountId,
        accountName: a.accountName || a.linkedAccountId,
        parentAccountId: "azure-root",
        parentAccountName: "Coforge Limited",
        status: a.status || "ACTIVE",
        evaluationMonth: a.selectedMonth || selectedMonth || new Date().toISOString().slice(0, 7),
        currentSpend: Number(a.currentSpend || 0),
        previousSpend: Number(a.previousSpend || 0),
        momChangePercent: Number(a.momChangePercent || 0),
        billingCurrency: "INR",
        topCostDriver: a.topCostDriver || "Azure Infrastructure",
        topServices: [],
      });
    }
  }

  if (provider === "all" || provider === "gcp") {
    const gcpRows = await fetch("/api/gcp/projects")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    if (Array.isArray(gcpRows)) {
      for (const p of gcpRows) {
        const id = p.projectId || p.id;
        const key = `gcp:${String(id).toLowerCase()}`;
        if (!id || seen.has(key)) continue;
        seen.add(key);
        results.push({
          cloudProvider: "gcp",
          accountId: id,
          accountName: p.name || id,
          parentAccountId: p.folder || "Global / Root",
          parentAccountName: "GCP Organization",
          status: p.status || "ACTIVE",
          evaluationMonth: selectedMonth || new Date().toISOString().slice(0, 7),
          currentSpend: Number(p.currentSpend || 0),
          currentSpendUsd: Number(p.currentSpendUsd ?? p.currentSpend ?? 0),
          previousSpend: 0,
          momChangePercent: 0,
          billingCurrency: "INR",
          topCostDriver: "Google Cloud Platform",
          topServices: [],
        });
      }
    }
  }

  return results;
}

export async function sendInstantAccountBudgetEmail(
  budgetId: number,
  accountName: string,
  selectedMonth?: string
): Promise<{ type: "success" | "warning"; message: string }> {
  const res = await fetch(`/api/budgets/${budgetId}/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: selectedMonth || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Failed to dispatch instant email.");
  }

  const er = data.emailResult;
  if (er?.sent) {
    return {
      type: "success",
      message: `Usage details email sent via ${er.transport.toUpperCase()} to ${er.recipients.join(", ")} for "${accountName}".`,
    };
  }
  return {
    type: "warning",
    message: `Usage email HTML preview generated for "${accountName}" (${er?.error || "mail transport unavailable"}).`,
  };
}

export function ManualBudgetAlertsSection({
  defaultProvider = "all",
  lockProvider = false,
  selectedMonth,
  externalTriggerAccount = null,
  onClearExternalTrigger,
  onBudgetsChanged,
}: ManualBudgetAlertsSectionProps) {
  const [providerTab, setProviderTab] = useState<"all" | CloudProvider>(defaultProvider);
  const [budgets, setBudgets] = useState<EnrichedAccountBudget[]>([]);
  const [cloudAccounts, setCloudAccounts] = useState<CloudAccountUsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);

  // Notification banner
  const [banner, setBanner] = useState<{
    type: "success" | "warning" | "error";
    message: string;
  } | null>(null);

  // Per-card instant email sending state
  const [sendingEmailId, setSendingEmailId] = useState<number | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"budget" | "instant-email">("budget");
  const [formProvider, setFormProvider] = useState<CloudProvider>(
    defaultProvider === "all" ? "aws" : defaultProvider
  );
  const [formAccountId, setFormAccountId] = useState("");
  const [formAccountName, setFormAccountName] = useState("");
  const [formParentAccountId, setFormParentAccountId] = useState("");
  const [formCurrency, setFormCurrency] = useState<"USD" | "INR">(
    defaultProvider === "azure" ? "INR" : "USD"
  );
  const [formMonthlyBudget, setFormMonthlyBudget] = useState("");
  const [formContactName, setFormContactName] = useState("");
  const [formAlertEmails, setFormAlertEmails] = useState<string[]>([]);
  const [emailInputDraft, setEmailInputDraft] = useState("");
  const [formError, setFormError] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formInstantSending, setFormInstantSending] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState("");
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAccountDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setIsAccountDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAccountDropdownOpen]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const monthQ = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : "";
      const fetchProvider = lockProvider ? defaultProvider : "all";
      const [budgetsRes, accountsRes] = await Promise.all([
        fetch(`/api/budgets?provider=${encodeURIComponent(fetchProvider)}${monthQ}`),
        fetch(`/api/budgets/cloud-accounts?provider=all${monthQ}`),
      ]);

      if (budgetsRes.ok) {
        const data = await budgetsRes.json();
        if (Array.isArray(data)) setBudgets(data);
      }

      let loadedAccounts: CloudAccountUsageItem[] = [];
      if (accountsRes.ok) {
        const accData = await accountsRes.json();
        if (Array.isArray(accData?.accounts)) {
          loadedAccounts = accData.accounts;
        }
      }

      if (loadedAccounts.length === 0) {
        loadedAccounts = await fetchFallbackCloudAccounts("all", selectedMonth);
      }
      setCloudAccounts(loadedAccounts);
    } catch (err) {
      console.error("Failed loading multi-cloud budgets:", err);
      const fallback = await fetchFallbackCloudAccounts("all", selectedMonth).catch(() => []);
      if (fallback.length > 0) setCloudAccounts(fallback);
    } finally {
      setLoading(false);
    }
  }, [defaultProvider, lockProvider, selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle external trigger from cloud account table rows
  useEffect(() => {
    if (!externalTriggerAccount) return;
    const {
      cloudProvider,
      accountId,
      accountName,
      parentAccountId,
      billingCurrency,
      mode = "budget",
    } = externalTriggerAccount;

    const existing = budgets.find(
      (b) =>
        b.cloudProvider === cloudProvider &&
        (b.accountId.toLowerCase() === accountId.toLowerCase() ||
          b.accountName.toLowerCase() === accountName.toLowerCase())
    );

    const matchedUsage = cloudAccounts.find(
      (a) =>
        a.cloudProvider === cloudProvider &&
        (a.accountId.toLowerCase() === accountId.toLowerCase() ||
          a.accountName.toLowerCase() === accountName.toLowerCase())
    );

    setFormProvider(cloudProvider);
    setFormAccountId(matchedUsage?.accountId || accountId);
    setFormAccountName(matchedUsage?.accountName || accountName);
    setFormParentAccountId(parentAccountId || matchedUsage?.parentAccountId || "");
    setFormCurrency(
      existing?.billingCurrency ||
        billingCurrency ||
        matchedUsage?.billingCurrency ||
        (cloudProvider === "azure" ? "INR" : "USD")
    );
    setFormMonthlyBudget(existing ? String(existing.monthlyBudget) : "");
    setFormContactName(existing?.contactName || "");
    setFormAlertEmails(
      existing ? parseEmailList(existing.alertEmails?.length ? existing.alertEmails : existing.alertEmail) : []
    );
    setEmailInputDraft("");
    setFormError("");
    setAccountSearchQuery("");
    setIsAccountDropdownOpen(false);
    setModalMode(mode);
    setShowModal(true);
    onClearExternalTrigger?.();
  }, [externalTriggerAccount, budgets, cloudAccounts, onClearExternalTrigger]);

  const filteredBudgets = useMemo(() => {
    if (providerTab === "all") return budgets;
    return budgets.filter((b) => b.cloudProvider === providerTab);
  }, [budgets, providerTab]);

  const accountsForSelectedProvider = useMemo(() => {
    return cloudAccounts.filter((a) => a.cloudProvider === formProvider);
  }, [cloudAccounts, formProvider]);

  const filteredModalAccounts = useMemo(() => {
    const q = accountSearchQuery.trim().toLowerCase();
    if (!q) return accountsForSelectedProvider;
    return accountsForSelectedProvider.filter(
      (acc) =>
        acc.accountName.toLowerCase().includes(q) ||
        acc.accountId.toLowerCase().includes(q) ||
        (acc.parentAccountName && acc.parentAccountName.toLowerCase().includes(q)) ||
        (acc.topCostDriver && acc.topCostDriver.toLowerCase().includes(q))
    );
  }, [accountsForSelectedProvider, accountSearchQuery]);

  const selectedAccountUsage = useMemo(() => {
    return accountsForSelectedProvider.find(
      (a) =>
        a.accountId.toLowerCase() === formAccountId.toLowerCase() ||
        a.accountName.toLowerCase() === formAccountId.toLowerCase()
    );
  }, [accountsForSelectedProvider, formAccountId]);

  // Compute live preview spend in formCurrency
  const previewCurrentSpend = useMemo(() => {
    if (selectedAccountUsage) {
      const native = selectedAccountUsage.billingCurrency;
      if (native === formCurrency) return selectedAccountUsage.currentSpend;
      const rate = selectedAccountUsage.conversionRate || 85;
      if (native === "INR" && formCurrency === "USD") {
        return selectedAccountUsage.currentSpendUsd !== undefined
          ? selectedAccountUsage.currentSpendUsd
          : selectedAccountUsage.currentSpend / rate;
      }
      if (native === "USD" && formCurrency === "INR") {
        return selectedAccountUsage.currentSpend * rate;
      }
      return selectedAccountUsage.currentSpend;
    }
    return externalTriggerAccount?.currentSpend || 0;
  }, [selectedAccountUsage, formCurrency, externalTriggerAccount]);

  const previewUtilizationPct = useMemo(() => {
    const limit = Number(formMonthlyBudget);
    if (!Number.isFinite(limit) || limit <= 0) return null;
    return Math.round(((previewCurrentSpend / limit) * 100) * 10) / 10;
  }, [previewCurrentSpend, formMonthlyBudget]);

  // Summary metrics
  const summaryStats = useMemo(() => {
    const list = filteredBudgets;
    return {
      total: list.length,
      at50Plus: list.filter((b) => b.percentUsed >= 50 && b.percentUsed < 75).length,
      at75Plus: list.filter((b) => b.percentUsed >= 75 && b.percentUsed < 100).length,
      at100OrOver: list.filter((b) => b.percentUsed >= 100 || b.status === "OVER_BUDGET").length,
    };
  }, [filteredBudgets]);

  const openCreateModal = (targetProv?: CloudProvider) => {
    const p = targetProv || (providerTab === "all" ? "aws" : providerTab);
    setFormProvider(p);
    setFormAccountId("");
    setFormAccountName("");
    setFormParentAccountId("");
    setFormCurrency(p === "azure" ? "INR" : "USD");
    setFormMonthlyBudget("");
    setFormContactName("");
    setFormAlertEmails([]);
    setEmailInputDraft("");
    setFormError("");
    setAccountSearchQuery("");
    setIsAccountDropdownOpen(false);
    setModalMode("budget");
    setShowModal(true);
  };

  const openEditModal = (b: EnrichedAccountBudget) => {
    setFormProvider(b.cloudProvider);
    setFormAccountId(b.accountId);
    setFormAccountName(b.accountName);
    setFormParentAccountId(b.parentAccountId || "");
    setFormCurrency(b.billingCurrency);
    setFormMonthlyBudget(String(b.monthlyBudget));
    setFormContactName(b.contactName || "");
    setFormAlertEmails(parseEmailList(b.alertEmails?.length ? b.alertEmails : b.alertEmail));
    setEmailInputDraft("");
    setFormError("");
    setAccountSearchQuery("");
    setIsAccountDropdownOpen(false);
    setModalMode("budget");
    setShowModal(true);
  };

  const handleSelectAccountFromDropdown = (accId: string) => {
    setFormAccountId(accId);
    const acc = accountsForSelectedProvider.find((a) => a.accountId === accId);
    if (acc) {
      setFormAccountName(acc.accountName);
      setFormParentAccountId(acc.parentAccountId || "");
      setFormCurrency(acc.manualBudget?.billingCurrency || acc.billingCurrency);
      if (acc.manualBudget) {
        setFormMonthlyBudget(String(acc.manualBudget.monthlyBudget));
        setFormContactName(acc.manualBudget.contactName || "");
        setFormAlertEmails(
          parseEmailList(
            acc.manualBudget.alertEmails?.length
              ? acc.manualBudget.alertEmails
              : acc.manualBudget.alertEmail
          )
        );
        setEmailInputDraft("");
      }
    }
    setAccountSearchQuery("");
    setIsAccountDropdownOpen(false);
  };

  const addEmailsFromDraft = (rawText?: string): boolean => {
    const source = rawText ?? emailInputDraft;
    if (!source.trim()) return false;
    const parsed = parseEmailList(source);
    if (parsed.length === 0) {
      setFormError("Please enter a valid email address (e.g. owner@company.com).");
      return false;
    }
    setFormError("");
    setFormAlertEmails((prev) => Array.from(new Set([...prev, ...parsed])));
    if (rawText === undefined) {
      setEmailInputDraft("");
    }
    return true;
  };

  const resolveSubmissionEmails = (): string[] | null => {
    const draft = emailInputDraft.trim();
    let merged = [...formAlertEmails];
    if (draft) {
      const parsedDraft = parseEmailList(draft);
      if (parsedDraft.length === 0) {
        setFormError("Please enter a valid email address (e.g. owner@company.com).");
        return null;
      }
      merged = Array.from(new Set([...merged, ...parsedDraft]));
      setFormAlertEmails(merged);
      setEmailInputDraft("");
    }
    if (merged.length === 0) {
      setFormError("Please add at least one concerned person email address.");
      return null;
    }
    return merged;
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formAccountId.trim()) {
      setFormError("Please select or enter an account.");
      return;
    }
    const limitNum = Number(formMonthlyBudget);
    if (!Number.isFinite(limitNum) || limitNum <= 0) {
      setFormError("Please enter a positive monthly budget amount.");
      return;
    }
    const recipients = resolveSubmissionEmails();
    if (!recipients) return;

    setFormSubmitting(true);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudProvider: formProvider,
          accountId: formAccountId.trim(),
          accountName: formAccountName.trim() || formAccountId.trim(),
          parentAccountId: formParentAccountId.trim() || null,
          monthlyBudget: limitNum,
          billingCurrency: formCurrency,
          alertEmail: recipients.join(", "),
          alertEmails: recipients,
          contactName: formContactName.trim() || null,
          month: selectedMonth || undefined,
          notifyImmediatelyIfBreached: true,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to save budget.");
      }

      setShowModal(false);
      await loadData();
      onBudgetsChanged?.();

      const notif = data.emailNotification;
      if (notif?.sent) {
        setBanner({
          type: "success",
          message: `Saved budget for ${data.budget?.accountName}. Threshold (${data.budget?.thresholdCrossed}) alert sent via ${notif.transport.toUpperCase()} to ${notif.recipients.join(", ")}.`,
        });
      } else if (notif?.previewed) {
        setBanner({
          type: "warning",
          message: `Saved budget for ${data.budget?.accountName}. Threshold (${data.budget?.thresholdCrossed}) reached; email saved as local preview (${notif.error || "mail transport unavailable"}).`,
        });
      } else {
        setBanner({
          type: "success",
          message: `Saved manual budget for ${data.budget?.accountName}. Threshold alerts active at 50%, 75%, 100%, and Over Budget.`,
        });
      }
    } catch (err: any) {
      setFormError(err.message || "Error saving budget.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleSendInstantEmailFromModal = async () => {
    setFormError("");
    if (!formAccountId.trim()) {
      setFormError("Please select an account first.");
      return;
    }
    const recipients = resolveSubmissionEmails();
    if (!recipients) return;

    setFormInstantSending(true);
    try {
      const res = await fetch("/api/budgets/send-account-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudProvider: formProvider,
          accountId: formAccountId.trim(),
          accountName: formAccountName.trim() || formAccountId.trim(),
          alertEmail: recipients.join(", "),
          alertEmails: recipients,
          contactName: formContactName.trim() || null,
          monthlyBudget: Number(formMonthlyBudget) > 0 ? Number(formMonthlyBudget) : undefined,
          billingCurrency: formCurrency,
          month: selectedMonth || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to send instant usage email.");
      }

      const er = data.emailResult;
      if (er?.sent) {
        setBanner({
          type: "success",
          message: `Instant usage details email sent via ${er.transport.toUpperCase()} to ${er.recipients.join(", ")} for ${data.account?.accountName}.`,
        });
        setShowModal(false);
        await loadData();
      } else {
        setBanner({
          type: "warning",
          message: `Generated usage email preview for ${data.account?.accountName} (${er?.error || "mail transport unavailable"}). Preview saved to logs.`,
        });
      }
    } catch (err: any) {
      setFormError(err.message || "Failed to send email.");
    } finally {
      setFormInstantSending(false);
    }
  };

  const handleSendInstantEmail = async (b: EnrichedAccountBudget) => {
    setSendingEmailId(b.id);
    setBanner(null);
    try {
      const result = await sendInstantAccountBudgetEmail(b.id, b.accountName, selectedMonth);
      setBanner(result);
      await loadData();
    } catch (err: any) {
      setBanner({
        type: "error",
        message: err.message || "Failed to send instant usage email.",
      });
    } finally {
      setSendingEmailId(null);
    }
  };

  const handleEvaluateAll = async () => {
    setEvaluating(true);
    setBanner(null);
    try {
      const res = await fetch("/api/budgets/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: lockProvider ? defaultProvider : providerTab,
          month: selectedMonth || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "Failed to evaluate budgets.");
      }
      await loadData();
      setBanner({
        type: data.triggeredCount > 0 ? "success" : "warning",
        message: `Evaluated ${data.evaluatedCount} active budget(s): ${data.breachedCount} at/over >=50% threshold, ${data.triggeredCount} new notification(s) dispatched.`,
      });
    } catch (err: any) {
      setBanner({
        type: "error",
        message: err.message || "Threshold evaluation failed.",
      });
    } finally {
      setEvaluating(false);
    }
  };

  const handleDeleteBudget = async (b: EnrichedAccountBudget) => {
    if (!confirm(`Delete manual budget for "${b.accountName}" (${b.cloudProvider.toUpperCase()})?`)) return;
    try {
      const res = await fetch(`/api/budgets/${b.id}`, { method: "DELETE" });
      if (res.ok) {
        setBudgets((prev) => prev.filter((item) => item.id !== b.id));
        onBudgetsChanged?.();
        setBanner({
          type: "success",
          message: `Removed manual budget for "${b.accountName}".`,
        });
      }
    } catch (err) {
      console.error("Failed to delete budget:", err);
    }
  };

  return (
    <Card className="border border-slate-200/90 dark:border-slate-800/80 shadow-xs bg-white dark:bg-slate-900">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <Bell className="h-5 w-5" />
              </span>
              <CardTitle className="text-base sm:text-lg font-bold tracking-tight">
                Manual Account Budgets &amp; Instant Email Alerts
              </CardTitle>
              <Badge
                variant="outline"
                className="text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
              >
                50% &bull; 75% &bull; 100% &bull; Over Budget
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground">
              Assign monthly budgets per account across AWS, Azure, and GCP. Concerned owners receive automated alerts at 50%, 75%, 100%, and over-budget, or trigger an instant usage details email anytime.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 cursor-pointer"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 cursor-pointer"
              onClick={handleEvaluateAll}
              disabled={evaluating || filteredBudgets.length === 0}
              title="Check all budgets for 50%, 75%, 100%, and Over-Budget thresholds and notify owners"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              {evaluating ? "Checking..." : "Evaluate & Notify"}
            </Button>

            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
              onClick={() => openCreateModal()}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Set Account Budget
            </Button>
          </div>
        </div>

        {/* Cloud Filter Tabs + Threshold Summary Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3">
          {!lockProvider ? (
            <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200/80 dark:border-slate-700 text-xs w-fit">
              {(["all", "aws", "azure", "gcp"] as const).map((tab) => {
                const count =
                  tab === "all"
                    ? budgets.length
                    : budgets.filter((b) => b.cloudProvider === tab).length;
                return (
                  <button
                    key={tab}
                    onClick={() => setProviderTab(tab)}
                    className={`px-3 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                      providerTab === tab
                        ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                    }`}
                  >
                    {tab === "all" ? "All Clouds" : tab.toUpperCase()} ({count})
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5 text-indigo-500" />
              <span>{defaultProvider.toUpperCase()} Account Budgets ({filteredBudgets.length})</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
              Configured: {summaryStats.total}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-semibold">
              50%–74%: {summaryStats.at50Plus}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800 font-semibold">
              75%–99%: {summaryStats.at75Plus}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-semibold">
              100% / Over: {summaryStats.at100OrOver}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Feedback Banner */}
        {banner && (
          <div
            className={`flex items-start justify-between gap-3 p-3 rounded-lg border text-xs font-medium ${
              banner.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300"
                : banner.type === "warning"
                ? "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300"
                : "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>{banner.message}</span>
            </div>
            <button
              onClick={() => setBanner(null)}
              className="opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Budgets List / Grid */}
        {loading ? (
          <div className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Loading multi-cloud budgets and live account spend...</span>
          </div>
        ) : filteredBudgets.length === 0 ? (
          <div className="py-10 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2.5">
            <Bell className="h-8 w-8 text-muted-foreground mx-auto opacity-50" />
            <p className="text-sm font-semibold text-foreground">
              No Manual Account Budgets Configured
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Set a monthly budget for any AWS Linked Account, Azure Subscription, or GCP Project to trigger automated emails at 50%, 75%, 100%, and over-budget usage.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 cursor-pointer"
              onClick={() => openCreateModal()}
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Configure First Account Budget
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredBudgets.map((b) => {
              const visuals = getStatusVisuals(b.status, b.percentUsed);
              const providerPill = getProviderPill(b.cloudProvider);
              const isSendingThis = sendingEmailId === b.id;

              return (
                <div
                  key={b.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-card hover:border-indigo-300 dark:hover:border-indigo-700 transition-all flex flex-col justify-between gap-3 text-xs shadow-2xs"
                >
                  {/* Top Header */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-bold px-1.5 py-0 ${providerPill.className}`}
                          >
                            {providerPill.label}
                          </Badge>
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {b.evaluationMonth}
                          </span>
                        </div>
                        <h4
                          className="font-bold text-sm text-foreground truncate"
                          title={b.accountName}
                        >
                          {b.accountName}
                        </h4>
                        <p
                          className="text-[11px] font-mono text-muted-foreground truncate"
                          title={b.accountId}
                        >
                          {b.accountId}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openEditModal(b)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
                          title="Edit Budget & Recipient"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteBudget(b)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                          title="Delete Budget"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Spend & Progress Bar with 50% / 75% / 100% Markers */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-foreground">
                          {fmtMoney(b.currentSpend, b.billingCurrency)}
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            / {fmtMoney(b.monthlyBudget, b.billingCurrency)}
                          </span>
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${visuals.badgeClass}`}
                        >
                          {visuals.label}
                        </span>
                      </div>

                      <div className="relative h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${visuals.barClass} transition-all duration-500 rounded-full`}
                          style={{ width: `${Math.min(100, Math.max(0, b.percentUsed))}%` }}
                        />
                        {/* Threshold markers at 50% and 75% */}
                        <div
                          className="absolute top-0 bottom-0 w-px bg-slate-400/70 dark:bg-slate-500/70"
                          style={{ left: "50%" }}
                          title="50% Threshold"
                        />
                        <div
                          className="absolute top-0 bottom-0 w-px bg-slate-400/70 dark:bg-slate-500/70"
                          style={{ left: "75%" }}
                          title="75% Threshold"
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>
                          {b.overBudgetAmount > 0 ? (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">
                              Over by {fmtMoney(b.overBudgetAmount, b.billingCurrency)}
                            </span>
                          ) : (
                            <span>
                              Remaining: {fmtMoney(b.remainingBudget, b.billingCurrency)}
                            </span>
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {b.momChangePercent > 0 ? (
                            <TrendingUp className="h-3 w-3 text-rose-500" />
                          ) : b.momChangePercent < 0 ? (
                            <TrendingDown className="h-3 w-3 text-emerald-500" />
                          ) : null}
                          {b.previousSpend > 0
                            ? `${b.momChangePercent > 0 ? "+" : ""}${b.momChangePercent}% MoM`
                            : "No prior month"}
                        </span>
                      </div>
                    </div>

                    {/* Top Driver + Concerned Person(s) */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span>Top Driver:</span>
                        <span
                          className="font-semibold text-foreground truncate max-w-[180px]"
                          title={b.topCostDriver}
                        >
                          {b.topCostDriver}
                        </span>
                      </div>
                      {(() => {
                        const recipients = parseEmailList(
                          b.alertEmails?.length ? b.alertEmails : b.alertEmail
                        );
                        const shown = recipients.slice(0, 2);
                        const extraCount = recipients.length - shown.length;
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-muted-foreground">
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <UserCheck className="h-3 w-3" />
                                {b.contactName ? b.contactName : "Recipients"}:
                              </span>
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {recipients.length} {recipients.length === 1 ? "email" : "emails"}
                              </span>
                            </div>
                            <div
                              className="flex flex-wrap gap-1"
                              title={recipients.join(", ")}
                            >
                              {shown.map((email) => (
                                <span
                                  key={email}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-medium max-w-full truncate"
                                >
                                  <Mail className="h-2.5 w-2.5 shrink-0 text-indigo-500" />
                                  <span className="truncate">{email}</span>
                                </span>
                              ))}
                              {extraCount > 0 && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-semibold"
                                  title={recipients.slice(2).join(", ")}
                                >
                                  +{extraCount} more
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Card Footer: Alert Status & Instant Send Email Button */}
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="text-[10px] text-muted-foreground min-w-0 truncate">
                      {b.lastNotifiedThreshold ? (
                        <span title={b.lastNotifiedAt || ""}>
                          Alerted: <strong>{b.lastNotifiedThreshold}</strong> (
                          {b.lastNotifiedMonth || b.evaluationMonth})
                        </span>
                      ) : b.lastManualEmailAt ? (
                        <span>
                          Emailed {new Date(b.lastManualEmailAt).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="italic">Auto-alerts: 50/75/100/Over</span>
                      )}
                    </div>

                    <Button
                      size="xs"
                      variant="outline"
                      className="h-7 px-2.5 text-[11px] font-semibold gap-1.5 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 cursor-pointer shrink-0"
                      onClick={() => handleSendInstantEmail(b)}
                      disabled={isSendingThis}
                      title={`Send an email right now with full usage details to ${b.alertEmail}`}
                    >
                      {isSendingThis ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="h-3 w-3" />
                          Send Usage Email
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Set / Edit Manual Budget & Instant Email Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  {modalMode === "instant-email" ? (
                    <>
                      <Send className="h-4 w-4 text-indigo-600" />
                      Send Usage Details Email &amp; Budget Alert
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4 text-indigo-600" />
                      Configure Manual Account Budget
                    </>
                  )}
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium">
                  {formError}
                </div>
              )}

              <form onSubmit={handleSaveBudget} className="space-y-3.5 text-xs">
                {/* Cloud Provider */}
                <div className="grid grid-cols-3 gap-2">
                  {(["aws", "azure", "gcp"] as const).map((prov) => (
                    <button
                      type="button"
                      key={prov}
                      disabled={lockProvider && prov !== defaultProvider}
                      onClick={() => {
                        setFormProvider(prov);
                        setFormAccountId("");
                        setFormAccountName("");
                        setFormParentAccountId("");
                        setFormCurrency(prov === "azure" ? "INR" : "USD");
                        setAccountSearchQuery("");
                        setIsAccountDropdownOpen(false);
                      }}
                      className={`py-2 px-3 rounded-lg border font-bold transition-all cursor-pointer disabled:opacity-40 ${
                        formProvider === prov
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                          : "border-slate-200 dark:border-slate-700 text-muted-foreground hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      {prov.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Searchable Account Combobox */}
                <div className="space-y-1 relative" ref={comboboxRef}>
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-foreground">
                      Select {formProvider.toUpperCase()} Account / Project:
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      {loading && accountsForSelectedProvider.length === 0
                        ? "Loading..."
                        : `${accountsForSelectedProvider.length} available`}
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={
                        isAccountDropdownOpen
                          ? accountSearchQuery
                          : formAccountId
                          ? `${formAccountName || formAccountId} (${formAccountId})`
                          : accountSearchQuery
                      }
                      onFocus={() => setIsAccountDropdownOpen(true)}
                      onChange={(e) => {
                        setAccountSearchQuery(e.target.value);
                        setIsAccountDropdownOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setIsAccountDropdownOpen(false);
                        } else if (e.key === "Enter" && isAccountDropdownOpen) {
                          e.preventDefault();
                          if (filteredModalAccounts.length > 0) {
                            handleSelectAccountFromDropdown(filteredModalAccounts[0].accountId);
                          }
                        }
                      }}
                      placeholder={
                        isAccountDropdownOpen
                          ? formAccountId
                            ? `${formAccountName || formAccountId} (${formAccountId}) — type to filter...`
                            : `Type ${formProvider.toUpperCase()} account name or ID to search...`
                          : loading && accountsForSelectedProvider.length === 0
                          ? `Loading ${formProvider.toUpperCase()} accounts...`
                          : `Search or choose ${formProvider.toUpperCase()} account (${accountsForSelectedProvider.length} available)...`
                      }
                      className="w-full h-9 pl-8 pr-14 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                    />
                    <div className="absolute right-2 top-1.5 flex items-center gap-0.5">
                      {(formAccountId || accountSearchQuery) && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormAccountId("");
                            setFormAccountName("");
                            setFormParentAccountId("");
                            setAccountSearchQuery("");
                            setIsAccountDropdownOpen(true);
                          }}
                          className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                          title="Clear selection"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsAccountDropdownOpen((prev) => !prev)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Toggle account list"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            isAccountDropdownOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {isAccountDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl divide-y divide-slate-100 dark:divide-slate-800/60">
                      {filteredModalAccounts.length === 0 ? (
                        <div className="p-3 text-center space-y-2">
                          <p className="text-[11px] text-muted-foreground">
                            {loading && accountsForSelectedProvider.length === 0
                              ? `Loading ${formProvider.toUpperCase()} accounts...`
                              : "No matching accounts found."}
                          </p>
                          {accountSearchQuery.trim() && (
                            <button
                              type="button"
                              onClick={() => {
                                const customId = accountSearchQuery.trim();
                                setFormAccountId(customId);
                                setFormAccountName(customId);
                                setAccountSearchQuery("");
                                setIsAccountDropdownOpen(false);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-semibold cursor-pointer"
                            >
                              Use &quot;{accountSearchQuery.trim()}&quot; as Account ID
                            </button>
                          )}
                        </div>
                      ) : (
                        filteredModalAccounts.map((acc) => {
                          const isSelected = acc.accountId === formAccountId;
                          return (
                            <button
                              key={`${acc.cloudProvider}:${acc.accountId}`}
                              type="button"
                              onClick={() => handleSelectAccountFromDropdown(acc.accountId)}
                              className={`w-full text-left px-3 py-2 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                                isSelected ? "bg-indigo-50/80 dark:bg-indigo-950/50" : ""
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-xs text-foreground truncate flex items-center gap-1">
                                  {isSelected && (
                                    <Check className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                                  )}
                                  <span className="truncate">{acc.accountName}</span>
                                </div>
                                <div className="text-[10px] font-mono text-muted-foreground truncate">
                                  {acc.accountId}
                                  {acc.parentAccountName ? ` • ${acc.parentAccountName}` : ""}
                                </div>
                              </div>
                              <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
                                <span className="font-mono font-semibold text-[11px] text-foreground">
                                  {fmtMoney(acc.currentSpend, acc.billingCurrency)}
                                </span>
                                {acc.manualBudget && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                                    Budgeted
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Currency + Monthly Budget Limit */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground">Currency:</label>
                    <select
                      value={formCurrency}
                      onChange={(e) => setFormCurrency(e.target.value as "USD" | "INR")}
                      className="w-full h-9 px-2.5 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="INR">INR (₹)</option>
                    </select>
                  </div>

                  <div className="col-span-2 space-y-1">
                    <label className="font-semibold text-foreground">
                      Monthly Budget Limit ({formCurrency}):
                    </label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-2.5 text-muted-foreground font-semibold">
                        {formCurrency === "INR" ? "₹" : "$"}
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        placeholder="e.g. 5000"
                        value={formMonthlyBudget}
                        onChange={(e) => setFormMonthlyBudget(e.target.value)}
                        className="w-full h-9 pl-7 pr-3 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                        required={modalMode === "budget"}
                      />
                    </div>
                  </div>
                </div>

                {/* Live Spend & Threshold Preview Box */}
                {formAccountId && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Current Month Spend:</span>
                      <span className="font-bold text-foreground">
                        {fmtMoney(previewCurrentSpend, formCurrency)}
                      </span>
                    </div>
                    {previewUtilizationPct !== null && (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Projected Threshold Status:</span>
                        <span
                          className={`font-bold ${
                            previewUtilizationPct > 100
                              ? "text-rose-600"
                              : previewUtilizationPct >= 100
                              ? "text-rose-500"
                              : previewUtilizationPct >= 75
                              ? "text-orange-600"
                              : previewUtilizationPct >= 50
                              ? "text-amber-600"
                              : "text-emerald-600"
                          }`}
                        >
                          {previewUtilizationPct.toFixed(1)}% (
                          {previewUtilizationPct > 100
                            ? "OVER BUDGET"
                            : previewUtilizationPct >= 100
                            ? "100% Reached"
                            : previewUtilizationPct >= 75
                            ? "75% Reached"
                            : previewUtilizationPct >= 50
                            ? "50% Reached"
                            : "Healthy <50%"}
                          )
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Concerned Person Name & Multiple Recipient Emails */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground">
                      Concerned Person / Team Name:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. FinOps Team / Account Owner"
                      value={formContactName}
                      onChange={(e) => setFormContactName(e.target.value)}
                      className="w-full h-9 px-3 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="font-semibold text-foreground">
                        Alert Recipient Email(s):
                      </label>
                      <span className="text-[10px] text-muted-foreground">
                        {formAlertEmails.length} {formAlertEmails.length === 1 ? "recipient" : "recipients"} added
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Mail className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="owner@company.com (press Enter, comma, or + Add)"
                          value={emailInputDraft}
                          onChange={(e) => setEmailInputDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "," || e.key === ";") {
                              e.preventDefault();
                              addEmailsFromDraft();
                            }
                          }}
                          onPaste={(e) => {
                            const pasted = e.clipboardData.getData("text");
                            if (/[,;\s\n]/.test(pasted)) {
                              e.preventDefault();
                              addEmailsFromDraft(pasted);
                            }
                          }}
                          className="w-full h-9 pl-8 pr-3 rounded-lg bg-background border border-input focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => addEmailsFromDraft()}
                        className="h-9 px-3 text-xs font-semibold gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 cursor-pointer shrink-0"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>

                    {formAlertEmails.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {formAlertEmails.map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2.5 py-0.5 text-[11px] font-medium"
                          >
                            <span>{email}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setFormAlertEmails((prev) => prev.filter((item) => item !== email))
                              }
                              className="hover:text-rose-600 transition-colors cursor-pointer"
                              title={`Remove ${email}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <p className="text-[10px] text-muted-foreground">
                  Add one or more emails (or paste a comma-separated list). Automated alerts trigger at 50%, 75%, 100%, and Over Budget (&gt;100%).
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 cursor-pointer"
                    onClick={handleSendInstantEmailFromModal}
                    disabled={formInstantSending || formSubmitting}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {formInstantSending ? "Sending..." : "Send Instant Usage Email"}
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="cursor-pointer"
                      onClick={() => setShowModal(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                      disabled={formSubmitting || formInstantSending}
                    >
                      {formSubmitting ? "Saving..." : "Save Budget"}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
