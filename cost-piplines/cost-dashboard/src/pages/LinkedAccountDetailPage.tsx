import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Mail,
  Calendar,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Copy,
  Check,
  RefreshCw,
  Globe,
  Server,
  DollarSign,
  PieChart as PieChartIcon,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface AccountDetailResponse {
  account: {
    linkedAccountId: string;
    accountName: string;
    status: string;
    rootAccount: {
      id: string;
      name: string;
      awsAccountId: string;
    };
    firstSeenAt?: string;
    lastSeenAt?: string;
  };
  selectedMonth: string;
  financials: {
    currentMonth: string;
    currentSpend: number;
    previousSpend: number;
    momChangePercent: number;
    historicalMonthlySpend: Array<{ month: string; cost: number }>;
  };
  variance: {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    latestVsMeanPct: number;
    volatilityCategory: string;
  } | null;
  governance: {
    hasBudget: boolean;
    status: "Budgeted" | "Unbudgeted";
    topCostDriver: string;
  };
  liveAws?: {
    available: boolean;
    error?: string;
    orgDetails?: {
      name?: string;
      email?: string;
      status?: string;
      arn?: string;
      joinedMethod?: string;
      joinedTimestamp?: string;
    };
    services?: Array<{ service: string; cost: number; sharePct: number }>;
    regions?: Array<{ region: string; cost: number; sharePct: number }>;
  };
}

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatCompactCurrency = (value: unknown) => {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(0)}k`;
  return `$${num}`;
};

const PROFESSIONAL_COLORS = [
  "#4f46e5", // Indigo 600
  "#6366f1", // Indigo 500
  "#7c3aed", // Violet 600
  "#0284c7", // Sky 700
  "#0d9488", // Teal 600
  "#059669", // Emerald 600
  "#f59e0b", // Amber 500
  "#64748b", // Slate 500
];

export function LinkedAccountDetailPage() {
  const { linkedAccountId } = useParams<{ linkedAccountId: string }>();
  const [searchParams] = useSearchParams();
  const rootAccount = searchParams.get("account") || "account-1";
  const monthParam = searchParams.get("month") || "";

  const [data, setData] = useState<AccountDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchDetails = () => {
    if (!linkedAccountId) return;
    setLoading(true);
    setError(null);

    const monthQuery = monthParam ? `&month=${encodeURIComponent(monthParam)}` : "";
    fetch(`/api/aws/linked-accounts/${encodeURIComponent(linkedAccountId)}?account=${encodeURIComponent(rootAccount)}${monthQuery}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to fetch account details (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((json: AccountDetailResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err.message || "Failed to load account profile.");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDetails();
  }, [linkedAccountId, rootAccount, monthParam]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatMonthName = (mStr: string) => {
    if (!mStr) return "Current Month";
    const parts = mStr.split("-");
    if (parts.length < 2) return mStr;
    const [year, month] = parts;
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (isNaN(date.getTime())) return mStr;
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 flex flex-col items-center justify-center space-y-3 font-sans">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Loading 360° Account Analytics & Live AWS Cost Explorer...
        </p>
        <p className="text-xs text-muted-foreground">
          Querying SQL Server database and AWS Organizations for account {linkedAccountId}
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 flex flex-col items-center justify-center p-6 space-y-4 font-sans">
        <AlertTriangle className="w-10 h-10 text-rose-500" />
        <h2 className="text-xl font-bold tracking-tight text-foreground">Failed to Load Account Profile</h2>
        <p className="text-xs text-rose-600 max-w-md text-center">{error}</p>
        <div className="flex gap-2.5 pt-2">
          <Link
            to="/linked-accounts"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors"
          >
            ← Back to Directory
          </Link>
          <button
            onClick={fetchDetails}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { account, financials, variance, governance, liveAws } = data;
  const isPositiveMoM = financials.momChangePercent > 0;
  const isNegativeMoM = financials.momChangePercent < 0;

  const pieData = (liveAws?.services || []).slice(0, 5).map((s) => ({
    name: s.service,
    value: s.cost,
  }));

  return (
    <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased pb-12">
      {/* Top Breadcrumb Header Bar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-6 py-3 backdrop-blur shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/linked-accounts?account=${rootAccount}`}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Accounts Directory</span>
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground">
              {account.accountName}
            </span>
            <span className="font-mono text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-muted/50">
              {account.linkedAccountId}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDetails}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 text-indigo-500" />
            <span>Refresh Live AWS</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Account Identity & Ownership Card */}
        <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
          <div className="p-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {account.accountName}
                </h1>
                {account.status === "ACTIVE" ? (
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
                    {account.status}
                  </Badge>
                )}
                {governance.hasBudget ? (
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
                    Unbudgeted
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                {/* 12-digit Account ID */}
                <div className="flex items-center gap-1.5 font-mono bg-muted/40 px-2.5 py-0.5 rounded border border-muted/50">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-semibold text-foreground">
                    {account.linkedAccountId}
                  </span>
                  <button
                    onClick={() => copyToClipboard(account.linkedAccountId)}
                    title="Copy Account ID"
                    className="hover:text-foreground transition-colors cursor-pointer"
                  >
                    {copiedId === account.linkedAccountId ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>

                {/* Parent Root Payer */}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Payer Org:</span>
                  <span className="font-semibold text-foreground">
                    {account.rootAccount.name}
                  </span>
                </div>

                {/* Owner Email from Organizations */}
                {liveAws?.orgDetails?.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-muted-foreground">Owner:</span>
                    <span className="font-medium text-foreground font-mono">
                      {liveAws.orgDetails.email}
                    </span>
                  </div>
                )}

                {/* Joined Date */}
                {liveAws?.orgDetails?.joinedTimestamp && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Created:</span>
                    <span className="font-medium text-foreground">
                      {new Date(liveAws.orgDetails.joinedTimestamp).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Live AWS Sync Status Pill */}
            <div className="flex items-center gap-2 bg-muted/40 px-3 py-1.5 rounded-lg border border-muted/50 text-xs self-start">
              {liveAws?.available ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    Live AWS Data Synced
                  </span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    SQL Database Mode
                  </span>
                </>
              )}
            </div>
          </div>
        </Card>

        {/* 4 Financial KPI Cards */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  PERIOD SPEND ({formatMonthName(financials.currentMonth).toUpperCase()})
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {fmt(financials.currentSpend)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                  Billed in active billing cycle
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  PREVIOUS PERIOD SPEND
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {financials.previousSpend ? fmt(financials.previousSpend) : "—"}
                </h3>
                <div className="flex items-center gap-1.5 text-xs pt-0.5">
                  {financials.previousSpend > 0 ? (
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        isPositiveMoM
                          ? "text-rose-600 dark:text-rose-500"
                          : isNegativeMoM
                          ? "text-emerald-600 dark:text-emerald-500"
                          : "text-muted-foreground"
                      }`}
                    >
                      {isPositiveMoM && <TrendingUp className="h-3.5 w-3.5" />}
                      {isNegativeMoM && <TrendingDown className="h-3.5 w-3.5" />}
                      {isPositiveMoM ? "+" : ""}
                      {financials.momChangePercent}% MoM
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Prior month total</span>
                  )}
                </div>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isPositiveMoM ? "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"}`}>
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  6-MONTH AVERAGE SPEND
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  {fmt(variance?.mean || financials.currentSpend)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                  Volatility:{" "}
                  <span className="font-semibold text-foreground">
                    {variance?.volatilityCategory || "Stable"}
                  </span>
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                <Building2 className="h-5 w-5" />
              </div>
            </div>
          </Card>

          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 rounded-xl shadow-xs transition-all hover:border-slate-300">
            <div className="flex items-center justify-between">
              <div className="space-y-1 min-w-0 pr-2">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  PRIMARY COST DRIVER
                </p>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate" title={governance.topCostDriver}>
                  {governance.topCostDriver}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                  Dominant service inside account
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400 shrink-0">
                <Sparkles className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Visual Charts Grid: 6-Month Spend Trend & Live Service Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: 6-Month Historical Spend Trajectory */}
          <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                    Historical Monthly Spend Trend
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    6-month billing history from SQL Server database
                  </p>
                </div>
                <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
                  {financials.historicalMonthlySpend.length} Months
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {financials.historicalMonthlySpend.length > 0 ? (
                <div className="h-[280px] w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={financials.historicalMonthlySpend}
                      margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="month"
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatCompactCurrency}
                        width={50}
                      />
                      <Tooltip
                        formatter={(val: any) => [
                          `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                          "Total Spend",
                        ]}
                        contentStyle={{
                          backgroundColor: "#1e293b",
                          borderColor: "#334155",
                          borderRadius: "0.5rem",
                          color: "#fff",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="cost" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-xs">
                  No historical cost data recorded for this account.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Chart 2: Top AWS Services inside this account */}
          <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                    <Server className="w-4 h-4 text-indigo-500" />
                    Services Inside This Account
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Live AWS Cost Explorer breakdown ({financials.currentMonth})
                  </p>
                </div>
                {liveAws?.services && (
                  <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
                    {liveAws.services.length} Services
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {pieData.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 items-center gap-4 h-[280px] pt-2">
                  <div className="h-full w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          innerRadius={45}
                          paddingAngle={3}
                        >
                          {pieData.map((_, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={PROFESSIONAL_COLORS[index % PROFESSIONAL_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) => [
                            `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                            "Cost",
                          ]}
                          contentStyle={{
                            backgroundColor: "#1e293b",
                            borderColor: "#334155",
                            borderRadius: "0.5rem",
                            color: "#fff",
                            fontSize: "12px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Top 5 Service Legend List */}
                  <div className="space-y-2 text-xs pr-2 overflow-y-auto max-h-[250px]">
                    {pieData.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor:
                                PROFESSIONAL_COLORS[idx % PROFESSIONAL_COLORS.length],
                            }}
                          />
                          <span className="font-medium text-foreground truncate">
                            {s.name}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-foreground shrink-0">
                          {fmt(s.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-xs">
                  {liveAws?.error ? `Live AWS Notice: ${liveAws.error}` : "No live service breakdown available."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Section 3: Live Services Table & Regional Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Detailed Services Table (2 Cols) using Shadcn Table */}
          <Card className="lg:col-span-2 border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-muted/30">
              <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                Granular Service Consumption
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                All AWS service charges billed to account {account.linkedAccountId}
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {liveAws?.services && liveAws.services.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-muted/30 bg-muted/20 hover:bg-transparent">
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        AWS Service
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[140px]">
                        Cost
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right w-[110px]">
                        Share %
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liveAws.services.map((s, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/30">
                        <TableCell className="py-2.5 px-4 font-medium text-xs text-foreground">
                          {s.service}
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-mono font-semibold text-xs text-foreground">
                          {fmt(s.cost)}
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-medium text-xs text-indigo-600 dark:text-indigo-400">
                          {s.sharePct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  Service-level details could not be retrieved from AWS Cost Explorer.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Regional Footprint (1 Col) */}
          <Card className="border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-3 border-b border-muted/30">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-500" />
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                    Regional Footprint
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Geographic distribution of spend
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {liveAws?.regions && liveAws.regions.length > 0 ? (
                <div className="space-y-3">
                  {liveAws.regions.slice(0, 6).map((r, idx) => (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground font-mono">
                          {r.region}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {fmt(r.cost)} ({r.sharePct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${Math.min(r.sharePct, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No regional data available.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

export default LinkedAccountDetailPage;
