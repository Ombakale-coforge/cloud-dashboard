import { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    AlertTriangle,
    Bell,
    ShieldAlert,
    TrendingUp,
    CheckCircle2,
    PlusCircle,
    Trash2,
    Calendar,
    Search,
    RefreshCw,
    Mail,
    X,
    Flame,
    Zap,
} from "lucide-react";

interface AzureAlertItem {
    id?: number;
    alertType: string;
    severity: "CRITICAL" | "HIGH" | "WARNING" | "INFO";
    evaluationDate: string;
    billingCurrency?: string;
    currentCost: number;
    baselineCost?: number;
    absoluteIncrease: number;
    percentIncrease?: number;
    subscriptionName?: string;
    service?: string;
    resourceName?: string;
    resourceGroup?: string;
    meterName?: string;
    currentQuantity?: number;
    baselineQuantity?: number;
    unitOfMeasure?: string;
    firstSeenDate?: string;
    likelyDrivenBy?: {
        alertType: string;
        resourceName?: string;
        service?: string;
        absoluteIncrease: number;
        coveragePercent: number;
    };
}

interface AlertSummaryData {
    total: number;
    critical: number;
    high: number;
    warning: number;
    info: number;
    subscriptionCostSpikes?: number;
    serviceCostSpikes?: number;
    resourceCostSpikes?: number;
    newExpensiveResources?: number;
    quantitySpikes?: number;
}

interface MeterOption {
    meter: string;
    category?: string;
    service?: string;
}

interface MeterBudgetItem {
    id: number;
    meterName: string;
    meterCategory?: string;
    service?: string;
    monthlyBudget: number;
    billingCurrency: string;
    alertEmail: string;
    isActive: boolean;
    currentMonthSpend: number;
    percentUsed: number;
    status: "NORMAL" | "NEAR_50" | "NEAR_75" | "AT_100" | "OVER_BUDGET";
    evaluationMonth: string;
    lastNotifiedThreshold?: string;
    lastNotifiedDate?: string;
}

const fmtCurrency = (n: number | undefined | null, currency = "INR") => {
    const val = Number(n ?? 0);
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
    }).format(Number.isFinite(val) ? val : 0);
};

export function AzureAlertsSection({ selectedMonth }: { selectedMonth?: string }) {
    // ── State: Alert Viewer ──────────────────────────────────────────────────
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>("");
    const [alerts, setAlerts] = useState<AzureAlertItem[]>([]);
    const [summary, setSummary] = useState<AlertSummaryData>({
        total: 0,
        critical: 0,
        high: 0,
        warning: 0,
        info: 0,
    });
    const [alertsLoading, setAlertsLoading] = useState(false);
    const [severityFilter, setSeverityFilter] = useState<string>("ALL");
    const [alertSearch, setAlertSearch] = useState("");

    // ── State: Meter Budgets ─────────────────────────────────────────────────
    const [meterBudgets, setMeterBudgets] = useState<MeterBudgetItem[]>([]);
    const [availableMeters, setAvailableMeters] = useState<MeterOption[]>([]);
    const [budgetsLoading, setBudgetsLoading] = useState(false);
    const [showBudgetModal, setShowBudgetModal] = useState(false);
    const [newMeterName, setNewMeterName] = useState("");
    const [newMonthlyBudget, setNewMonthlyBudget] = useState("");
    const [newAlertEmail, setNewAlertEmail] = useState("");
    const [budgetFormError, setBudgetFormError] = useState("");
    const [budgetFormSubmitting, setBudgetFormSubmitting] = useState(false);

    // 1. Fetch available alert evaluation dates
    useEffect(() => {
        fetch("/api/azure/alerts/dates")
            .then((res) => (res.ok ? res.json() : []))
            .then((dates: string[]) => {
                if (Array.isArray(dates) && dates.length > 0) {
                    setAvailableDates(dates);
                    setSelectedDate(dates[0]);
                }
            })
            .catch(() => {});
    }, []);

    // 2. Fetch alerts for selected date
    const fetchAlertsForDate = (dateStr: string) => {
        if (!dateStr) return;
        setAlertsLoading(true);
        fetch(`/api/azure/alerts?date=${encodeURIComponent(dateStr)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data && Array.isArray(data.alerts)) {
                    setAlerts(data.alerts);
                    setSummary(
                        data.summary || {
                            total: data.alerts.length,
                            critical: 0,
                            high: 0,
                            warning: 0,
                            info: 0,
                        }
                    );
                } else {
                    setAlerts([]);
                    setSummary({ total: 0, critical: 0, high: 0, warning: 0, info: 0 });
                }
            })
            .catch(() => {
                setAlerts([]);
            })
            .finally(() => setAlertsLoading(false));
    };

    useEffect(() => {
        if (selectedDate) {
            fetchAlertsForDate(selectedDate);
        }
    }, [selectedDate]);

    // 3. Fetch meter budgets and available meters list
    const fetchMeterBudgets = () => {
        setBudgetsLoading(true);
        fetch("/api/azure/meter-budgets")
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => {
                if (Array.isArray(data)) {
                    setMeterBudgets(data);
                }
            })
            .catch(() => {})
            .finally(() => setBudgetsLoading(false));
    };

    useEffect(() => {
        fetchMeterBudgets();

        fetch("/api/azure/meters")
            .then((res) => (res.ok ? res.json() : []))
            .then((data: MeterOption[]) => {
                if (Array.isArray(data)) {
                    setAvailableMeters(data);
                }
            })
            .catch(() => {});
    }, []);

    // 4. Filter alerts
    const filteredAlerts = useMemo(() => {
        let list = alerts;
        if (severityFilter !== "ALL") {
            list = list.filter((a) => a.severity === severityFilter);
        }
        if (alertSearch.trim()) {
            const q = alertSearch.toLowerCase();
            list = list.filter((a) => {
                return (
                    (a.alertType && a.alertType.toLowerCase().includes(q)) ||
                    (a.service && a.service.toLowerCase().includes(q)) ||
                    (a.resourceName && a.resourceName.toLowerCase().includes(q)) ||
                    (a.subscriptionName && a.subscriptionName.toLowerCase().includes(q)) ||
                    (a.meterName && a.meterName.toLowerCase().includes(q))
                );
            });
        }
        return list;
    }, [alerts, severityFilter, alertSearch]);

    // 5. Submit new meter budget
    const handleCreateBudget = async (e: React.FormEvent) => {
        e.preventDefault();
        setBudgetFormError("");

        if (!newMeterName.trim()) {
            setBudgetFormError("Please select an Azure meter.");
            return;
        }
        const amount = Number(newMonthlyBudget);
        if (!Number.isFinite(amount) || amount <= 0) {
            setBudgetFormError("Please enter a positive monthly budget amount.");
            return;
        }
        if (!newAlertEmail.trim() || !newAlertEmail.includes("@")) {
            setBudgetFormError("Please enter a valid alert recipient email.");
            return;
        }

        const selectedMeterObj = availableMeters.find((m) => m.meter === newMeterName);

        setBudgetFormSubmitting(true);
        try {
            const res = await fetch("/api/azure/meter-budgets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    meterName: newMeterName,
                    meterCategory: selectedMeterObj?.category || null,
                    service: selectedMeterObj?.service || null,
                    monthlyBudget: amount,
                    alertEmail: newAlertEmail,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || "Failed to create budget");
            }

            setNewMeterName("");
            setNewMonthlyBudget("");
            setNewAlertEmail("");
            setShowBudgetModal(false);
            fetchMeterBudgets();
        } catch (err: any) {
            setBudgetFormError(err.message || "Error saving budget.");
        } finally {
            setBudgetFormSubmitting(false);
        }
    };

    // 6. Delete a meter budget
    const handleDeleteBudget = async (id: number) => {
        if (!confirm("Are you sure you want to remove this meter budget?")) return;
        try {
            const res = await fetch(`/api/azure/meter-budgets/${id}`, { method: "DELETE" });
            if (res.ok) {
                setMeterBudgets((prev) => prev.filter((b) => b.id !== id));
            }
        } catch (err) {
            console.error("Failed to delete budget:", err);
        }
    };

    return (
        <Card className="border border-slate-200/90 dark:border-slate-800/80 shadow-xs">
            <CardHeader className="pb-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                <ShieldAlert className="h-5 w-5" />
                            </span>
                            <CardTitle className="text-lg font-bold tracking-tight">
                                Azure Cost Alerts & Meter Budgets
                            </CardTitle>
                        </div>
                        <CardDescription className="text-xs text-muted-foreground">
                            View daily anomaly spike alerts generated for any date, or set manual meter budgets with automated 50%, 75%, 100%, and over-budget daily email pings.
                        </CardDescription>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1.5"
                            onClick={() => {
                                if (selectedDate) fetchAlertsForDate(selectedDate);
                                fetchMeterBudgets();
                            }}
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Refresh
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="pt-2">
                <Tabs defaultValue="alerts" className="w-full space-y-4">
                    <TabsList className="bg-muted/60 p-1">
                        <TabsTrigger value="alerts" className="text-xs gap-2">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Daily Cost Alerts ({summary.total})
                        </TabsTrigger>
                        <TabsTrigger value="budgets" className="text-xs gap-2">
                            <Bell className="h-3.5 w-3.5" />
                            Meter Budgets ({meterBudgets.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* ─────────────────────────────────────────────────────────────
                        TAB 1: DAILY COST ALERTS VIEWER
                    ───────────────────────────────────────────────────────────── */}
                    <TabsContent value="alerts" className="space-y-4">
                        {/* Control bar: Date Picker + Severity Filters */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-muted/20 rounded-lg border border-border/50">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" />
                                    Evaluation Date:
                                </span>
                                {availableDates.length > 0 ? (
                                    <select
                                        value={selectedDate}
                                        onChange={(e) => setSelectedDate(e.target.value)}
                                        className="h-8 px-2.5 py-1 text-xs rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-ring font-medium"
                                    >
                                        {availableDates.map((d) => (
                                            <option key={d} value={d}>
                                                {d}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <span className="text-xs text-muted-foreground italic">
                                        No historical runs found
                                    </span>
                                )}

                                <div className="relative ml-2">
                                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground pointer-events-none" />
                                    <input
                                        type="text"
                                        placeholder="Search alert, service, resource..."
                                        value={alertSearch}
                                        onChange={(e) => setAlertSearch(e.target.value)}
                                        className="h-8 pl-8 pr-3 text-xs rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-ring w-48 md:w-64"
                                    />
                                </div>
                            </div>

                            {/* Severity Filter Pills */}
                            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
                                <button
                                    onClick={() => setSeverityFilter("ALL")}
                                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                                        severityFilter === "ALL"
                                            ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    }`}
                                >
                                    All ({summary.total})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter("CRITICAL")}
                                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                                        severityFilter === "CRITICAL"
                                            ? "bg-rose-600 text-white"
                                            : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100"
                                    }`}
                                >
                                    Critical ({summary.critical})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter("HIGH")}
                                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                                        severityFilter === "HIGH"
                                            ? "bg-orange-600 text-white"
                                            : "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 hover:bg-orange-100"
                                    }`}
                                >
                                    High ({summary.high})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter("WARNING")}
                                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                                        severityFilter === "WARNING"
                                            ? "bg-amber-600 text-white"
                                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100"
                                    }`}
                                >
                                    Warning ({summary.warning})
                                </button>
                                <button
                                    onClick={() => setSeverityFilter("INFO")}
                                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                                        severityFilter === "INFO"
                                            ? "bg-blue-600 text-white"
                                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 hover:bg-blue-100"
                                    }`}
                                >
                                    Info ({summary.info})
                                </button>
                            </div>
                        </div>

                        {/* Alert Cards List */}
                        {alertsLoading ? (
                            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                Loading alerts for {selectedDate}...
                            </div>
                        ) : filteredAlerts.length === 0 ? (
                            <div className="py-12 text-center rounded-lg border border-dashed border-border/60">
                                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                                <p className="text-sm font-semibold text-foreground">No alerts detected</p>
                                <p className="text-xs text-muted-foreground">
                                    No anomaly spikes recorded for {selectedDate || "selected date"}{" "}
                                    {severityFilter !== "ALL" ? `matching ${severityFilter}` : ""}.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                                {filteredAlerts.map((item, idx) => {
                                    const isCrit = item.severity === "CRITICAL";
                                    const isHigh = item.severity === "HIGH";
                                    const isWarn = item.severity === "WARNING";

                                    const badgeClass = isCrit
                                        ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200"
                                        : isHigh
                                        ? "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-200"
                                        : isWarn
                                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200"
                                        : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200";

                                    const entityTitle =
                                        item.resourceName ||
                                        item.service ||
                                        item.subscriptionName ||
                                        item.meterName ||
                                        "Azure Target";

                                    return (
                                        <div
                                            key={item.id || idx}
                                            className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-card hover:bg-muted/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                                        >
                                            <div className="space-y-1.5 flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${badgeClass}`}
                                                    >
                                                        {item.severity}
                                                    </span>
                                                    <span className="font-semibold text-sm text-foreground truncate max-w-md">
                                                        {entityTitle}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground font-mono">
                                                        ({item.alertType.replaceAll("_", " ")})
                                                    </span>
                                                </div>

                                                <div className="flex items-center gap-3 text-muted-foreground flex-wrap text-[11px]">
                                                    {item.service && (
                                                        <span>Service: <strong className="text-foreground">{item.service}</strong></span>
                                                    )}
                                                    {item.subscriptionName && (
                                                        <span>Sub: <strong className="text-foreground">{item.subscriptionName}</strong></span>
                                                    )}
                                                    {item.resourceGroup && (
                                                        <span>RG: <strong className="text-foreground">{item.resourceGroup}</strong></span>
                                                    )}
                                                </div>

                                                {item.likelyDrivenBy && (
                                                    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-muted/60 text-[11px] text-muted-foreground border border-border/40">
                                                        <Zap className="h-3 w-3 text-amber-500" />
                                                        <span>
                                                            Likely driven by:{" "}
                                                            <strong className="text-foreground">
                                                                {item.likelyDrivenBy.resourceName || item.likelyDrivenBy.service}
                                                            </strong>{" "}
                                                            (+{fmtCurrency(item.likelyDrivenBy.absoluteIncrease)}, {item.likelyDrivenBy.coveragePercent}% coverage)
                                                        </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Metrics box */}
                                            <div className="flex items-center gap-4 text-right shrink-0 border-t md:border-t-0 md:border-l border-border/50 pt-2 md:pt-0 md:pl-4">
                                                <div>
                                                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                        Current Spend
                                                    </div>
                                                    <div className="text-sm font-bold text-foreground">
                                                        {fmtCurrency(item.currentCost, item.billingCurrency)}
                                                    </div>
                                                    {item.baselineCost !== undefined && (
                                                        <div className="text-[10px] text-muted-foreground">
                                                            base: {fmtCurrency(item.baselineCost, item.billingCurrency)}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="min-w-[70px]">
                                                    <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                                                        Increase
                                                    </div>
                                                    <div
                                                        className={`text-sm font-bold ${
                                                            item.percentIncrease && item.percentIncrease > 0
                                                                ? "text-rose-600 dark:text-rose-400"
                                                                : "text-foreground"
                                                        }`}
                                                    >
                                                        {item.percentIncrease != null
                                                            ? `+${item.percentIncrease.toFixed(1)}%`
                                                            : `+${fmtCurrency(item.absoluteIncrease, item.billingCurrency)}`}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground">
                                                        +{fmtCurrency(item.absoluteIncrease, item.billingCurrency)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>

                    {/* ─────────────────────────────────────────────────────────────
                        TAB 2: METER BUDGETS MANAGEMENT & MONITORING
                    ───────────────────────────────────────────────────────────── */}
                    <TabsContent value="budgets" className="space-y-4">
                        <div className="flex items-center justify-between gap-4 p-3 bg-muted/20 rounded-lg border border-border/50">
                            <div>
                                <h4 className="text-xs font-semibold text-foreground">
                                    Configured Meter Budgets
                                </h4>
                                <p className="text-[11px] text-muted-foreground">
                                    Automated alerts ping your email at 50%, 75%, 100%, and over-budget during daily evaluation runs.
                                </p>
                            </div>
                            <Button
                                size="sm"
                                className="h-8 text-xs gap-1.5"
                                onClick={() => setShowBudgetModal(true)}
                            >
                                <PlusCircle className="h-3.5 w-3.5" />
                                Set Meter Budget
                            </Button>
                        </div>

                        {/* Modal Dialog for Setting Meter Budget */}
                        {showBudgetModal && (
                            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                                <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 animate-in fade-in-50 zoom-in-95">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                                            <Bell className="h-4 w-4 text-primary" />
                                            Set Manual Meter Budget
                                        </h3>
                                        <button
                                            onClick={() => setShowBudgetModal(false)}
                                            className="text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>

                                    {budgetFormError && (
                                        <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-medium">
                                            {budgetFormError}
                                        </div>
                                    )}

                                    <form onSubmit={handleCreateBudget} className="space-y-3.5 text-xs">
                                        <div className="space-y-1">
                                            <label className="font-semibold text-foreground">
                                                Select Meter:
                                            </label>
                                            <select
                                                value={newMeterName}
                                                onChange={(e) => setNewMeterName(e.target.value)}
                                                className="w-full h-8 px-2.5 rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-ring text-xs"
                                                required
                                            >
                                                <option value="">-- Choose an Azure Meter --</option>
                                                {availableMeters.map((m, idx) => (
                                                    <option key={`${m.meter}-${idx}`} value={m.meter}>
                                                        {m.meter} {m.service ? `(${m.service})` : ""}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="font-semibold text-foreground">
                                                Monthly Budget Limit (INR):
                                            </label>
                                            <div className="relative">
                                                <span className="absolute left-2.5 top-2 text-muted-foreground font-semibold">
                                                    ₹
                                                </span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="0.01"
                                                    placeholder="e.g. 50000"
                                                    value={newMonthlyBudget}
                                                    onChange={(e) => setNewMonthlyBudget(e.target.value)}
                                                    className="w-full h-8 pl-7 pr-3 rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-ring text-xs"
                                                    required
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="font-semibold text-foreground">
                                                Notification Email:
                                            </label>
                                            <div className="relative">
                                                <Mail className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                                                <input
                                                    type="email"
                                                    placeholder="admin@company.com"
                                                    value={newAlertEmail}
                                                    onChange={(e) => setNewAlertEmail(e.target.value)}
                                                    className="w-full h-8 pl-8 pr-3 rounded-md bg-background border border-input focus:outline-none focus:ring-1 focus:ring-ring text-xs"
                                                    required
                                                />
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">
                                                Pings will be sent once a day when spend reaches 50%, 75%, 100%, and &gt;100%.
                                            </p>
                                        </div>

                                        <div className="flex items-center justify-end gap-2 pt-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setShowBudgetModal(false)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="submit"
                                                size="sm"
                                                disabled={budgetFormSubmitting}
                                            >
                                                {budgetFormSubmitting ? "Saving..." : "Save Budget"}
                                            </Button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}

                        {/* Meter Budgets Cards Grid */}
                        {budgetsLoading ? (
                            <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                Loading meter budgets...
                            </div>
                        ) : meterBudgets.length === 0 ? (
                            <div className="py-12 text-center rounded-lg border border-dashed border-border/60">
                                <Bell className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                                <p className="text-sm font-semibold text-foreground">No Meter Budgets Configured</p>
                                <p className="text-xs text-muted-foreground mb-4">
                                    Set a budget on high-consumption meters to receive automated alerts at 50%, 75%, and 100% thresholds.
                                </p>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs gap-1.5"
                                    onClick={() => setShowBudgetModal(true)}
                                >
                                    <PlusCircle className="h-3.5 w-3.5" />
                                    Configure First Meter Budget
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                {meterBudgets.map((b) => {
                                    const pct = b.percentUsed || 0;
                                    const isOver = b.status === "OVER_BUDGET" || pct > 100;
                                    const isAt100 = b.status === "AT_100" || pct === 100;
                                    const isNear75 = b.status === "NEAR_75" || (pct >= 75 && pct < 100);
                                    const isNear50 = b.status === "NEAR_50" || (pct >= 50 && pct < 75);

                                    // Color styling
                                    let barColor = "bg-emerald-500";
                                    let badgeColor = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200";
                                    let badgeLabel = "Healthy (<50%)";

                                    if (isOver) {
                                        barColor = "bg-rose-600";
                                        badgeColor = "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 font-bold";
                                        badgeLabel = `OVER BUDGET (${pct.toFixed(1)}%)`;
                                    } else if (isAt100) {
                                        barColor = "bg-rose-500";
                                        badgeColor = "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200";
                                        badgeLabel = "100% Reached";
                                    } else if (isNear75) {
                                        barColor = "bg-orange-500";
                                        badgeColor = "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200";
                                        badgeLabel = "75% Reached";
                                    } else if (isNear50) {
                                        barColor = "bg-amber-500";
                                        badgeColor = "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200";
                                        badgeLabel = "50% Reached";
                                    }

                                    return (
                                        <div
                                            key={b.id}
                                            className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-card hover:border-slate-300 transition-all space-y-3 text-xs"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="space-y-0.5 min-w-0">
                                                    <h4 className="font-bold text-sm text-foreground truncate" title={b.meterName}>
                                                        {b.meterName}
                                                    </h4>
                                                    <p className="text-[11px] text-muted-foreground truncate">
                                                        {b.meterCategory || "Category N/A"} • {b.service || "Service N/A"}
                                                    </p>
                                                </div>

                                                <button
                                                    onClick={() => handleDeleteBudget(b.id)}
                                                    className="text-muted-foreground hover:text-rose-600 transition-colors p-1"
                                                    title="Delete budget"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>

                                            {/* Progress Bar & Status */}
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="font-semibold text-foreground">
                                                        {fmtCurrency(b.currentMonthSpend, b.billingCurrency)}
                                                        <span className="text-muted-foreground font-normal">
                                                            {" "}of {fmtCurrency(b.monthlyBudget, b.billingCurrency)}
                                                        </span>
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeColor}`}>
                                                        {badgeLabel}
                                                    </span>
                                                </div>

                                                <div className="h-2 w-full bg-muted/80 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full ${barColor} transition-all duration-500 rounded-full`}
                                                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Footer metadata */}
                                            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                                                <span className="flex items-center gap-1 truncate" title={b.alertEmail}>
                                                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                                                    <span className="truncate">{b.alertEmail}</span>
                                                </span>

                                                {b.lastNotifiedThreshold ? (
                                                    <span className="text-[10px] shrink-0 font-mono">
                                                        Pinged: {b.lastNotifiedThreshold} ({b.lastNotifiedDate || ""})
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] shrink-0 italic text-muted-foreground">
                                                        No alerts triggered yet
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
