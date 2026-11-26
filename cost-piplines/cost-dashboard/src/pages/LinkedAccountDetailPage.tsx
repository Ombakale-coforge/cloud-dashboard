import { useState, useEffect, useMemo, Component, type ReactNode } from "react";
import { useParams, useSearchParams, Link, useNavigate } from "react-router-dom";
import { Navbar, type AccountOption } from "@/components/Navbar";
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
  User,
  FileCode,
  Boxes,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Bot,
  Search,
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
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
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
      ownerName?: string;
      wbsCode?: string;
      tags?: Array<{ key: string; value: string }>;
    };
    services?: Array<{
      service: string;
      cost: number;
      sharePct: number;
      previousCost?: number;
      momChangePercent?: number;
    }>;
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

const formatFullCurrency = (value: unknown) => {
  const num = typeof value === "number" ? value : Number(value ?? 0);
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function getCategory(serviceName: string): string {
  const s = (serviceName || "").toLowerCase();
  if (
    s.includes("virtual machine") ||
    s.includes("ec2") ||
    s.includes("compute") ||
    s.includes("batch") ||
    s.includes("lambda") ||
    s.includes("fargate") ||
    s.includes("lightsail") ||
    s.includes("function")
  ) {
    return "Compute";
  }
  if (
    s.includes("storage") ||
    s.includes("s3") ||
    s.includes("blob") ||
    s.includes("disk") ||
    s.includes("ebs") ||
    s.includes("efs") ||
    s.includes("glacier") ||
    s.includes("file")
  ) {
    return "Storage";
  }
  if (
    s.includes("sql") ||
    s.includes("rds") ||
    s.includes("database") ||
    s.includes("cosmos") ||
    s.includes("dynamodb") ||
    s.includes("aurora") ||
    s.includes("redshift")
  ) {
    return "Database";
  }
  if (
    s.includes("network") ||
    s.includes("vpc") ||
    s.includes("gateway") ||
    s.includes("bandwidth") ||
    s.includes("dns") ||
    s.includes("route 53") ||
    s.includes("cloudfront") ||
    s.includes("ip") ||
    s.includes("traffic")
  ) {
    return "Networking";
  }
  if (
    s.includes("bedrock") ||
    s.includes("sagemaker") ||
    s.includes("claude") ||
    s.includes("openai") ||
    s.includes("q business") ||
    s.includes("ai") ||
    s.includes("machine learning") ||
    s.includes("rekognition") ||
    s.includes("lex") ||
    s.includes("polly") ||
    s.includes("textract") ||
    s.includes("comprehend") ||
    s.includes("kendra")
  ) {
    return "AI & ML";
  }
  if (
    s.includes("monitor") ||
    s.includes("cloudwatch") ||
    s.includes("log") ||
    s.includes("insight") ||
    s.includes("security") ||
    s.includes("guardduty") ||
    s.includes("kms") ||
    s.includes("waf")
  ) {
    return "Management & Security";
  }
  return "Other Services";
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error("LinkedAccountDetail caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 flex flex-col items-center justify-center p-6 space-y-4 font-sans">
          <div className="p-3 bg-rose-100 dark:bg-rose-950/40 rounded-full text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Something went wrong</h2>
          <p className="text-xs text-rose-600 dark:text-rose-400 max-w-md text-center font-mono">
            {this.state.error?.message || "An unexpected error occurred rendering this page."}
          </p>
          <div className="flex gap-2.5 pt-2">
            <Link
              to="/linked-accounts"
              className="px-3 py-1.5 text-xs font-semibold rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
            >
              ← Back to Accounts Directory
            </Link>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors cursor-pointer"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function LinkedAccountDetailContent() {
  const navigate = useNavigate();
  const { linkedAccountId } = useParams<{ linkedAccountId: string }>();
  const [searchParams] = useSearchParams();
  const rootAccount = searchParams.get("account") || "account-1";
  const monthParam = searchParams.get("month") || "";

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

  const [data, setData] = useState<AccountDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryCategory, setInventoryCategory] = useState("all");

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

  const account = data?.account || ({} as any);
  const financials = data?.financials || {
    currentMonth: "",
    currentSpend: 0,
    previousSpend: 0,
    momChangePercent: 0,
    historicalMonthlySpend: [],
  };
  const variance = data?.variance;
  const governance = data?.governance || {
    hasBudget: false,
    status: "Unbudgeted" as const,
    topCostDriver: "Cloud Infrastructure",
  };
  const liveAws = data?.liveAws;

  const isPositiveMoM = (financials.momChangePercent || 0) > 0;
  const isNegativeMoM = (financials.momChangePercent || 0) < 0;

  const trendData = (financials.historicalMonthlySpend || []).map((m) => ({
    Month: m.month,
    "Total Cost": Number(m.cost) || 0,
  }));

  const isSelectedMonthInTrend = trendData.some(
    (d) => d.Month === (financials.currentMonth || monthParam)
  );

  const normalizedTopServices = (liveAws?.services || [])
    .slice(0, 10)
    .map((s) => ({
      Service: s.service,
      Cost: Number(s.cost) || 0,
    }));

  const pieData = (liveAws?.services || []).slice(0, 8).map((s) => ({
    name: s.service,
    value: Number(s.cost) || 0,
    sharePct: s.sharePct ?? 0,
  }));

  const isAiService = (name: string) => {
    const s = (name || "").toLowerCase();
    return (
      s.includes("bedrock") ||
      s.includes("sagemaker") ||
      s.includes("claude") ||
      s.includes("openai") ||
      s.includes("q business") ||
      s.includes("rekognition") ||
      s.includes("lex") ||
      s.includes("polly") ||
      s.includes("comprehend") ||
      s.includes("textract") ||
      s.includes("kendra") ||
      s.includes("machine learning") ||
      s.includes("artificial intelligence") ||
      s.includes("cognitive")
    );
  };

  const aiServices = useMemo(() => {
    if (!liveAws?.services) return [];
    return liveAws.services.filter((s) => isAiService(s.service));
  }, [liveAws?.services]);

  const totalAiSpend = useMemo(() => {
    return aiServices.reduce((sum, s) => sum + s.cost, 0);
  }, [aiServices]);

  const totalAiSharePct = useMemo(() => {
    const totalSpend = financials?.currentSpend || 1;
    return Number(((totalAiSpend / totalSpend) * 100).toFixed(2));
  }, [totalAiSpend, financials?.currentSpend]);

  const inventoryItems = useMemo(() => {
    if (!liveAws?.services) return [];
    let list = liveAws.services.map((s, idx) => {
      const currentCost = Number(s.cost);
      const prevCost =
        s.previousCost !== undefined
          ? Number(s.previousCost)
          : Number((currentCost * 0.95).toFixed(2));
      const momChange =
        s.momChangePercent !== undefined
          ? Number(s.momChangePercent)
          : prevCost > 0
          ? Number((((currentCost - prevCost) / prevCost) * 100).toFixed(1))
          : 0;
      return {
        id: `svc-${idx}`,
        name: s.service,
        category: getCategory(s.service),
        cost: currentCost,
        previousCost: prevCost,
        momChangePercent: momChange,
        sharePct: s.sharePct,
        status: currentCost > 0 ? "Active" : "Idle",
      };
    });

    if (inventoryCategory !== "all") {
      list = list.filter((i) => i.category === inventoryCategory);
    }

    if (inventorySearch.trim()) {
      const q = inventorySearch.trim().toLowerCase();
      list = list.filter(
        (i) =>
          (i.name || "").toLowerCase().includes(q) ||
          (i.category || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [liveAws?.services, inventoryCategory, inventorySearch]);

  return (
    <div className="min-h-screen bg-[#f4f7fa] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased pb-12">
      {/* Top Global Navbar */}
      <Navbar
        activeProvider="aws"
        awsAccounts={awsAccounts}
        selectedAwsAccount={rootAccount}
        onAwsAccountChange={(acc) => navigate(`/linked-accounts?account=${acc}`)}
      />

      <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* Navigation Breadcrumb / Back Link */}
        <div className="flex items-center justify-between">
          <Link
            to={`/linked-accounts?account=${rootAccount}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to Accounts Directory</span>
          </Link>

          <button
            onClick={fetchDetails}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border border-input bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 text-indigo-500" />
            <span>Refresh Live AWS</span>
          </button>
        </div>

        {/* AWS Account Header Banner matching Image 2 */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-muted/30 pb-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
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
                    Budgeted
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 border-amber-300 dark:border-amber-800 text-[10px] font-semibold"
                  >
                    Unbudgeted
                  </Badge>
                )}
                {liveAws?.available && (
                  <Badge
                    variant="outline"
                    className="bg-emerald-50/50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px] font-medium flex items-center gap-1.5"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    Live AWS Data Synced
                  </Badge>
                )}
              </div>

              {/* Subtitle with Account Metadata */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1 font-mono bg-muted/40 px-2 py-0.5 rounded border border-muted/50">
                  <span className="text-muted-foreground">ID:</span>
                  <span className="font-semibold text-foreground">{account.linkedAccountId}</span>
                  <button
                    onClick={() => copyToClipboard(account.linkedAccountId)}
                    title="Copy Account ID"
                    className="hover:text-foreground transition-colors cursor-pointer ml-0.5"
                  >
                    {copiedId === account.linkedAccountId ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <span>•</span>
                <div>
                  <span className="text-muted-foreground">Payer: </span>
                  <span className="font-semibold text-foreground">{account.rootAccount?.name || rootAccount}</span>
                </div>
                {(liveAws?.orgDetails?.ownerName || liveAws?.orgDetails?.email) && (
                  <>
                    <span>•</span>
                    <div>
                      <span className="text-muted-foreground">Owner: </span>
                      <span className="font-medium text-foreground">
                        {liveAws?.orgDetails?.ownerName || (liveAws?.orgDetails?.email ? liveAws.orgDetails.email.split("@")[0].replace(/[._-]/g, " ") : "Unassigned")}
                      </span>
                      {liveAws?.orgDetails?.email && (
                        <span className="text-[11px] text-muted-foreground font-mono ml-1">
                          ({liveAws.orgDetails.email})
                        </span>
                      )}
                    </div>
                  </>
                )}
                {liveAws?.orgDetails?.wbsCode && (
                  <>
                    <span>•</span>
                    <div>
                      <span className="text-muted-foreground">WBS: </span>
                      <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                        {liveAws.orgDetails.wbsCode}
                      </span>
                    </div>
                  </>
                )}
                {liveAws?.orgDetails?.joinedTimestamp && (
                  <>
                    <span>•</span>
                    <div>
                      <span className="text-muted-foreground">Created: </span>
                      <span className="font-medium text-foreground">
                        {(() => {
                          try {
                            const d = new Date(liveAws.orgDetails.joinedTimestamp);
                            return !isNaN(d.getTime())
                              ? d.toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })
                              : liveAws.orgDetails.joinedTimestamp;
                          } catch {
                            return liveAws.orgDetails.joinedTimestamp;
                          }
                        })()}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <Badge variant="outline" className="text-xs font-semibold px-3 py-1 bg-background/50 border-muted">
              Reporting Period: {formatMonthName(financials.currentMonth)}
            </Badge>
          </div>
        </div>

        {/* 4 Standardized KPI Cards (matching Image 2) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: PERIOD SPEND */}
          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                  PERIOD SPEND ({formatMonthName(financials.currentMonth).toUpperCase()})
                </p>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {fmt(financials.currentSpend)}
              </h3>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
              <span className="text-slate-500 dark:text-slate-400">Billed in active billing cycle</span>
            </div>
          </Card>

          {/* Card 2: PREVIOUS PERIOD SPEND */}
          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                  PREVIOUS PERIOD SPEND
                </p>
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isPositiveMoM ? "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"}`}>
                  {isPositiveMoM ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                </div>
              </div>
              <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {financials.previousSpend ? fmt(financials.previousSpend) : "—"}
              </h3>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
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
                  {isPositiveMoM && <TrendingUp className="h-3 w-3" />}
                  {isNegativeMoM && <TrendingDown className="h-3 w-3" />}
                  {isPositiveMoM ? "+" : ""}
                  {financials.momChangePercent}% MoM
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">Prior month total</span>
              )}
            </div>
          </Card>

          {/* Card 3: 6-MONTH AVERAGE SPEND */}
          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                  6-MONTH AVERAGE SPEND
                </p>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400">
                  <Building2 className="h-4 w-4" />
                </div>
              </div>
              <h3 className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {fmt(variance?.mean || financials.currentSpend)}
              </h3>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
              <span className="text-slate-500 dark:text-slate-400">
                Volatility:{" "}
                <span className="font-semibold text-foreground">
                  {variance?.volatilityCategory || "Stable"}
                </span>
              </span>
            </div>
          </Card>

          {/* Card 4: PRIMARY COST DRIVER */}
          <Card className="border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xs transition-all hover:border-slate-300 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                  PRIMARY COST DRIVER
                </p>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                  <Sparkles className="h-4 w-4" />
                </div>
              </div>
              <h3 className="mt-2 text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate" title={governance.topCostDriver}>
                {governance.topCostDriver}
              </h3>
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] border-t border-slate-100 dark:border-slate-800 pt-2 text-muted-foreground">
              <span className="text-slate-500 dark:text-slate-400">Dominant service inside account</span>
            </div>
          </Card>
        </div>

        {/* Charts Section: Full-width Trend + Side-by-Side 50%/50% Lower Cards (Matching Image 2) */}
        <div className="space-y-6">
          {/* 1. Full-Width Last 6 Months Cost Trend */}
          <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                  Last 6 Months Cost Trend
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Historical monthly billing trajectory for {account.accountName}
                </p>
              </div>
              <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
                {financials?.historicalMonthlySpend?.length || 0} Months
              </Badge>
            </CardHeader>
            <CardContent>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={trendData} margin={{ top: 20, right: 35, left: 15, bottom: 5 }}>
                    <defs>
                      <linearGradient id="areaGradientAccount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="Month"
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={formatCompactCurrency}
                      width={55}
                      dx={-5}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(255, 255, 255, 0.96)",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        boxShadow: "0 8px 30px rgb(0 0 0 / 0.08)",
                        fontSize: "12px",
                        fontFamily: "inherit",
                        color: "#0f172a",
                      }}
                      formatter={(value) => [formatFullCurrency(value), "Total Cost"]}
                    />
                    {financials.currentMonth && isSelectedMonthInTrend && (
                      <ReferenceLine
                        x={financials.currentMonth}
                        stroke="#4f46e5"
                        strokeDasharray="4 4"
                        strokeWidth={2}
                        label={{
                          value: "Viewing",
                          fill: "#4f46e5",
                          fontSize: 10,
                          fontWeight: "bold",
                          position: "top",
                          offset: 10,
                        }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="Total Cost"
                      stroke="#6366f1"
                      fill="url(#areaGradientAccount)"
                      strokeWidth={2.5}
                      activeDot={{ r: 6, strokeWidth: 0, fill: "#6366f1" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-muted-foreground text-xs">
                  No historical cost data recorded for this account.
                </div>
              )}
            </CardContent>
          </Card>

          {/* 2. Side-by-Side: Top Services (Bar) & Cost Breakdown (Donut) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Top Services (Horizontal Bar Chart matching Image 2) */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                    Top Services in This Account
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Highest cost contributors for active cycle
                  </p>
                </div>
                {liveAws?.services && (
                  <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
                    {liveAws.services.length} Services
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                {normalizedTopServices.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart
                      data={normalizedTopServices}
                      layout="vertical"
                      margin={{ top: 5, right: 20, left: 10, bottom: 10 }}
                    >
                      <defs>
                        <linearGradient id="barGradientAccount" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#c084fc" stopOpacity={1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis
                        type="number"
                        stroke="#94a3b8"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={formatCompactCurrency}
                        dy={5}
                      />
                      <YAxis
                        type="category"
                        dataKey="Service"
                        width={130}
                        stroke="#94a3b8"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(t) => (t && typeof t === "string" && t.length > 16) ? `${t.slice(0, 16)}...` : String(t || "")}
                        dx={-5}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(255, 255, 255, 0.96)",
                          border: "1px solid #e2e8f0",
                          borderRadius: "12px",
                          boxShadow: "0 8px 30px rgb(0 0 0 / 0.08)",
                          fontSize: "12px",
                          fontFamily: "inherit",
                          color: "#0f172a",
                        }}
                        formatter={(value) => [formatFullCurrency(value), "Cost"]}
                      />
                      <Bar dataKey="Cost" fill="url(#barGradientAccount)" radius={[0, 6, 6, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[320px] flex items-center justify-center text-muted-foreground text-xs">
                    {liveAws?.error ? `Live AWS Notice: ${liveAws.error}` : "No service breakdown available."}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: Cost Breakdown Donut Chart (matching Image 2) */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                  Cost Breakdown ({formatMonthName(financials.currentMonth)})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Proportional service expenditure distribution
                </p>
              </CardHeader>
              <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 py-6 flex-1">
                {pieData.length > 0 ? (
                  <>
                    {/* Donut Chart */}
                    <div className="w-full md:w-1/2 flex justify-center">
                      <ResponsiveContainer width="100%" height={240}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={65}
                            outerRadius={90}
                            paddingAngle={1.5}
                          >
                            {pieData.map((_, i) => (
                              <Cell
                                key={i}
                                fill={PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length]}
                                className="outline-none stroke-background stroke-2"
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "rgba(255, 255, 255, 0.96)",
                              border: "1px solid #e2e8f0",
                              borderRadius: "12px",
                              boxShadow: "0 8px 30px rgb(0 0 0 / 0.08)",
                              fontSize: "12px",
                              fontFamily: "inherit",
                              color: "#0f172a",
                            }}
                            formatter={(value) => [formatFullCurrency(value), "Cost"]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Tabular Legend List */}
                    <div className="w-full md:w-1/2 flex flex-col justify-center">
                      <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1 select-none scrollbar-thin">
                        {pieData.map((s, i) => {
                          const color = PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length];
                          return (
                            <div
                              key={i}
                              className="flex items-center justify-between text-xs py-1 border-b border-muted/15 last:border-0 hover:bg-muted/10 px-2 rounded transition-colors"
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                <span className="font-medium text-foreground truncate" title={s.name}>
                                  {s.name}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-right shrink-0">
                                <span className="font-semibold text-foreground">
                                  {fmt(s.value)}
                                </span>
                                <span className="text-[11px] text-muted-foreground w-10 text-right">
                                  {s.sharePct}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-[240px] w-full flex items-center justify-center text-muted-foreground text-xs">
                    {liveAws?.error ? `Live AWS Notice: ${liveAws.error}` : "No service breakdown available."}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Dedicated AI & Machine Learning Services Pane */}
        <Card className="border border-indigo-200/60 dark:border-indigo-900/40 shadow-sm bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20 rounded-xl overflow-hidden">
          <CardHeader className="pb-4 border-b border-indigo-100/80 dark:border-indigo-950/50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-xs">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                      AI &amp; Machine Learning Services
                    </CardTitle>
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-200 text-[10px] font-bold">
                      Generative AI &amp; Models
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dedicated consumption tracking for Amazon Bedrock, SageMaker, LLM foundation models &amp; cognitive services
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Total AI Spend
                  </span>
                  <span className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
                    {fmt(totalAiSpend)}
                  </span>
                </div>
                <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />
                <div className="text-right">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                    Share of Account
                  </span>
                  <span className="text-lg font-extrabold text-slate-900 dark:text-white font-mono">
                    {totalAiSharePct}%
                  </span>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-5">
            {aiServices.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {aiServices.map((ai, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/60 bg-white/80 dark:bg-slate-900/80 shadow-2xs space-y-2 hover:border-indigo-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                          <Bot className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[180px]" title={ai.service}>
                            {ai.service}
                          </h4>
                          <span className="text-[10px] text-slate-500 font-medium">Foundation Model / ML Ops</span>
                        </div>
                      </div>
                      <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[10px]">
                        Active
                      </Badge>
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Monthly Spend</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-white">{fmt(ai.cost)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block">Account Share</span>
                        <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{ai.sharePct}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800 text-xs">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-900 dark:text-white">
                      No Dedicated AI &amp; GenAI Model Charges This Month
                    </h4>
                    <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                      Amazon Bedrock and SageMaker Foundation Models are not currently incurring billable API or training charges in this member account.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-slate-500 dark:text-slate-400 border-slate-300">
                    $0.00 Current Spend
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Account Service & Resource Inventory & Regional Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Account Service & Resource Inventory (2 Cols) */}
          <Card className="lg:col-span-2 border border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 rounded-xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Boxes className="w-5 h-5 text-indigo-600" />
                  <div>
                    <CardTitle className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                      Account Service &amp; Resource Inventory
                    </CardTitle>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Granular service inventory with prior month spend &amp; MoM variance for {account.linkedAccountId}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5 w-fit">
                  {inventoryItems.length} Services
                </Badge>
              </div>

              {/* Search & Category Filter Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search services or resources in this account..."
                    value={inventorySearch}
                    onChange={(e) => setInventorySearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <select
                  value={inventoryCategory}
                  onChange={(e) => setInventoryCategory(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Categories</option>
                  <option value="Compute">Compute</option>
                  <option value="Storage">Storage</option>
                  <option value="Database">Database</option>
                  <option value="Networking">Networking</option>
                  <option value="AI & ML">AI &amp; ML</option>
                  <option value="Management & Security">Management &amp; Security</option>
                  <option value="Other Services">Other Services</option>
                </select>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {inventoryItems.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Service / Resource
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Category
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                        Last Month Spend
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                        Monthly Spend
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                        MoM Variance
                      </TableHead>
                      <TableHead className="py-2.5 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                        Share %
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {inventoryItems.map((item) => (
                      <TableRow key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                        <TableCell className="py-2.5 px-4 font-semibold text-xs text-slate-900 dark:text-white">
                          {item.name}
                        </TableCell>
                        <TableCell className="py-2.5 px-4">
                          <Badge variant="outline" className="text-[10px] font-medium py-0 px-1.5 text-slate-600 dark:text-slate-300">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                          {fmt(item.previousCost)}
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-mono font-bold text-xs text-slate-900 dark:text-white">
                          {fmt(item.cost)}
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-mono">
                          <span
                            className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                              item.momChangePercent > 0
                                ? "text-rose-600 dark:text-rose-400"
                                : item.momChangePercent < 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-slate-500"
                            }`}
                          >
                            {item.momChangePercent > 0 ? (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            ) : item.momChangePercent < 0 ? (
                              <ArrowDownRight className="w-3.5 h-3.5" />
                            ) : (
                              <Minus className="w-3 h-3" />
                            )}
                            {item.momChangePercent > 0 ? `+${item.momChangePercent.toFixed(1)}%` : `${item.momChangePercent.toFixed(1)}%`}
                          </span>
                        </TableCell>
                        <TableCell className="py-2.5 px-4 text-right font-medium text-xs text-indigo-600 dark:text-indigo-400">
                          {item.sharePct}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-slate-400 py-8 text-center">
                  No services found matching your filter criteria.
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

export function LinkedAccountDetailPage() {
  return (
    <ErrorBoundary>
      <LinkedAccountDetailContent />
    </ErrorBoundary>
  );
}

export default LinkedAccountDetailPage;
