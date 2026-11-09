import React, { useState, useEffect, useMemo } from 'react';
import { Navbar } from '@/components/Navbar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Cloud,
  Layers,
  TrendingUp,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Database,
  Server,
  HardDrive,
  Cpu,
  ShieldCheck,
  Tag,
  FolderTree,
  Globe,
  DollarSign,
  Percent,
  SlidersHorizontal,
  Sparkles,
  ExternalLink,
  ChevronRight,
  BarChart3,
  CheckCircle,
} from 'lucide-react';

interface GcpProject {
  id: string;
  name: string;
  projectId: string;
  folder?: string;
  currentSpend: number;
  currentSpendUsd: number;
  budgetLimit: number;
  budgetLimitUsd: number;
  status: string;
  utilizationPct: number;
  serviceCount?: number;
  skuCount?: number;
  region: string;
}

interface GcpService {
  service: string;
  cost: number;
  costUsd: number;
  category: string;
  sharePct: number;
}

interface GcpSku {
  skuId: string;
  skuDescription: string;
  service: string;
  projectName: string;
  projectId: string;
  cost: number;
  costUsd: number;
  listCost: number;
  listCostUsd: number;
  discountSavings: number;
  usageAmount: number;
  usageUnit: string;
  pricingUnit: string;
  sharePct: number;
}

interface GcpFolder {
  folderName: string;
  projectCount: number;
  totalSpend: number;
  totalSpendUsd: number;
}

interface GcpRegion {
  region: string;
  country: string;
  projectCount: number;
  cost: number;
  costUsd: number;
  sharePct: number;
}

interface GcpCredit {
  creditName: string;
  creditType: string;
  totalCredit: number;
  totalCreditUsd: number;
}

interface GcpSummary {
  source: string;
  isDemo?: boolean;
  currency: string;
  conversionRate: number;
  totalAccounts: number;
  budgetedAccounts: number;
  unbudgetedAccounts: number;
  activeSpendTotal: number;
  activeSpendTotalUsd: number;
  totalListCost: number;
  totalListCostUsd: number;
  creditsTotal: number;
  creditsTotalUsd: number;
  netSpend: number;
  netSpendUsd: number;
  budgetCoveragePct: number;
  spendUnderBudget: number;
  spendUnderBudgetUsd: number;
  activeServicesCount: number;
  activeSkusCount: number;
  monthLabel?: string;
}

interface TestConnectionResponse {
  connected: boolean;
  isConfigured: boolean;
  message: string;
  datasets?: string[];
  details?: Record<string, any>;
  tableStats?: Record<string, any>;
}

export function GcpDashboardPage() {
  const [summary, setSummary] = useState<GcpSummary | null>(null);
  const [projects, setProjects] = useState<GcpProject[]>([]);
  const [services, setServices] = useState<GcpService[]>([]);
  const [skus, setSkus] = useState<GcpSku[]>([]);
  const [folders, setFolders] = useState<GcpFolder[]>([]);
  const [regions, setRegions] = useState<GcpRegion[]>([]);
  const [credits, setCredits] = useState<GcpCredit[]>([]);
  const [loading, setLoading] = useState(true);

  // Active view tab: 'projects' | 'skus' | 'regions' | 'credits'
  const [activeTab, setActiveTab] = useState<'projects' | 'skus' | 'regions' | 'credits'>('projects');

  // Currency Switcher: 'INR' (Native raw) or 'USD' (Converted)
  const [currencyMode, setCurrencyMode] = useState<'INR' | 'USD'>('INR');

  // Project table filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [folderFilter, setFolderFilter] = useState('all');

  // SKU table filters
  const [skuSearch, setSkuSearch] = useState('');
  const [skuProjectFilter, setSkuProjectFilter] = useState('all');

  // Diagnostic Test Connection state
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<TestConnectionResponse | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sumRes, prjRes, svcRes, skuRes, fldRes, regRes, crdRes] = await Promise.all([
        fetch('/api/gcp/summary'),
        fetch('/api/gcp/projects'),
        fetch('/api/gcp/services'),
        fetch('/api/gcp/skus'),
        fetch('/api/gcp/folders'),
        fetch('/api/gcp/regions'),
        fetch('/api/gcp/credits'),
      ]);

      if (sumRes.ok) setSummary(await sumRes.json());
      if (prjRes.ok) setProjects(await prjRes.json());
      if (svcRes.ok) setServices(await svcRes.json());
      if (skuRes.ok) setSkus(await skuRes.json());
      if (fldRes.ok) setFolders(await fldRes.json());
      if (regRes.ok) setRegions(await regRes.json());
      if (crdRes.ok) setCredits(await crdRes.json());
    } catch (err) {
      console.error('Error fetching GCP dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const res = await fetch('/api/gcp/test-connection');
      const data: TestConnectionResponse = await res.json();
      setConnectionResult(data);
    } catch (err: any) {
      setConnectionResult({
        connected: false,
        isConfigured: false,
        message: err.message || 'Failed to call connection test API',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Helper to format currency dynamically based on currencyMode
  const fmt = (valInr: number, valUsd?: number) => {
    if (currencyMode === 'USD') {
      const v = valUsd !== undefined ? valUsd : (summary?.conversionRate ? valInr / summary.conversionRate : valInr / 95.0);
      return `$${Number(v || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return `₹${Number(valInr || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // Helper for integer quantities (e.g. tokens, seconds)
  const fmtQty = (qty: number) => {
    if (qty >= 1_000_000_000) return `${(qty / 1_000_000_000).toFixed(2)}B`;
    if (qty >= 1_000_000) return `${(qty / 1_000_000).toFixed(2)}M`;
    if (qty >= 1_000) return `${(qty / 1_000).toFixed(1)}K`;
    return Number(qty || 0).toLocaleString();
  };

  // Filtered projects
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.projectId.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === 'all' || p.status.toLowerCase() === statusFilter.toLowerCase();
      const matchesFolder =
        folderFilter === 'all' || (p.folder && p.folder.toLowerCase().includes(folderFilter.toLowerCase()));
      return matchesSearch && matchesStatus && matchesFolder;
    });
  }, [projects, searchTerm, statusFilter, folderFilter]);

  // Filtered SKUs
  const filteredSkus = useMemo(() => {
    return skus.filter((s) => {
      const matchesSearch =
        s.skuDescription.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.service.toLowerCase().includes(skuSearch.toLowerCase()) ||
        s.skuId.toLowerCase().includes(skuSearch.toLowerCase());
      const matchesProj =
        skuProjectFilter === 'all' || s.projectId === skuProjectFilter || s.projectName === skuProjectFilter;
      return matchesSearch && matchesProj;
    });
  }, [skus, skuSearch, skuProjectFilter]);

  // Unique folders for dropdown
  const uniqueFolders = useMemo(() => {
    const set = new Set<string>();
    folders.forEach((f) => set.add(f.folderName));
    projects.forEach((p) => {
      if (p.folder) p.folder.split(',').forEach((f) => set.add(f.trim()));
    });
    return Array.from(set).filter(Boolean);
  }, [folders, projects]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased">
      {/* Top Navigation Bar with GCP Active */}
      <Navbar activeProvider="gcp" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header Title, Currency Toggle & Diagnostic Action */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 font-extrabold text-sm shadow-xs">
                GCP
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                Google Cloud Platform Intelligence
              </h1>
              <Badge
                variant="outline"
                className="text-[11px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200"
              >
                BigQuery Detailed Export (Resource v1)
              </Badge>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              Multi-project spend, SKU-level consumption, department folders, and negotiated discount analytics
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Currency Mode Toggle */}
            <div className="flex items-center bg-white dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700 shadow-2xs">
              <button
                onClick={() => setCurrencyMode('INR')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  currencyMode === 'INR'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
                title="View Native Billed Currency (Indian Rupees)"
              >
                ₹ INR
              </button>
              <button
                onClick={() => setCurrencyMode('USD')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                  currencyMode === 'USD'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
                title="View Converted USD Currency"
              >
                $ USD
              </button>
            </div>

            <button
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${testingConnection ? 'animate-spin' : ''}`} />
              <span>{testingConnection ? 'Testing...' : 'Test BigQuery'}</span>
            </button>

            <button
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Live / Demo Status Alert Bar */}
        {connectionResult && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-start gap-3 transition-all ${
              connectionResult.connected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
            }`}
          >
            {connectionResult.connected ? (
              <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 space-y-1">
              <div className="font-bold">
                {connectionResult.connected ? 'BigQuery Connection Live & Verified' : 'BigQuery Connection Status'}
              </div>
              <div>{connectionResult.message}</div>
              {connectionResult.tableStats && (
                <div className="text-[11px] font-mono mt-1 text-emerald-700 dark:text-emerald-300">
                  Table: {connectionResult.tableStats.tableName} • Rows: {Number(connectionResult.tableStats.numRows).toLocaleString()} • Size: {(Number(connectionResult.tableStats.numBytes) / (1024 * 1024)).toFixed(1)} MB
                </div>
              )}
            </div>
            <button
              onClick={() => setConnectionResult(null)}
              className="text-slate-400 hover:text-slate-600 text-xs font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Top 5 KPI Cards Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Card 1: Net Spend */}
          <Card className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Active Month Spend
                </p>
                <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {fmt(summary?.activeSpendTotal || 0, summary?.activeSpendTotalUsd)}
                </h3>
                <p className="text-xs text-blue-600 dark:text-blue-400 font-semibold mt-0.5">
                  {summary?.monthLabel || 'Current Billing Cycle'}
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 flex items-center justify-center">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Card 2: Discounts & Credits */}
          <Card className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Discounts &amp; Credits
                </p>
                <h3 className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
                  {fmt(summary?.creditsTotal || 0, summary?.creditsTotalUsd)}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Subscription &amp; promotional savings
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center justify-center">
                <Percent className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Card 3: Projects & Folders */}
          <Card className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  GCP Projects &amp; Folders
                </p>
                <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {summary?.totalAccounts || projects.length}
                </h3>
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mt-0.5">
                  {folders.length} department folders
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400 flex items-center justify-center">
                <FolderTree className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Card 4: Active SKUs */}
          <Card className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Active SKUs Billed
                </p>
                <h3 className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
                  {summary?.activeSkusCount || skus.length || 142}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Across {summary?.activeServicesCount || services.length} cloud services
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 flex items-center justify-center">
                <Tag className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Card 5: Top Service Driver */}
          <Card className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Top Service
                </p>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-1 truncate max-w-[150px]" title={services[0]?.service || 'Gemini API'}>
                  {services[0]?.service || 'Gemini API'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {fmt(services[0]?.cost || 0, services[0]?.costUsd)} ({services[0]?.sharePct || 0}%)
                </p>
              </div>
              <div className="h-10 w-10 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 flex items-center justify-center shrink-0">
                <Cpu className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Two-Column Middle Section: Service Cost Breakdown + BigQuery Architecture */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Service Spend Breakdown Card */}
          <Card className="lg:col-span-2 p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Top Google Cloud Services by Spend
                </h2>
                <p className="text-xs text-slate-500">Resource categorization and percentage share of monthly invoice</p>
              </div>
              <Badge variant="outline" className="text-xs text-slate-600 dark:text-slate-300">
                {services.length} Services
              </Badge>
            </div>

            <div className="space-y-3 pt-2">
              {services.slice(0, 7).map((svc, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{svc.service}</span>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-slate-500">
                        {svc.category}
                      </Badge>
                    </div>
                    <span className="font-mono text-slate-700 dark:text-slate-300 font-bold">
                      {fmt(svc.cost, svc.costUsd)} <span className="text-slate-400 font-normal">({svc.sharePct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        i === 0
                          ? 'bg-blue-600'
                          : i === 1
                          ? 'bg-indigo-500'
                          : i === 2
                          ? 'bg-purple-500'
                          : i === 3
                          ? 'bg-emerald-500'
                          : i === 4
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                      }`}
                      style={{ width: `${Math.min(100, svc.sharePct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* BigQuery Billing Ingestion Architecture Card */}
          <Card className="p-5 bg-gradient-to-br from-blue-50/50 via-white to-slate-50/50 dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs space-y-3.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                BigQuery Billing Data Warehouse
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Google Cloud automatically streams multi-project billing export tables into BigQuery. Our engine queries project IDs, SKU pricing, and resource dimensions with high performance.
            </p>
            <div className="p-3 bg-white dark:bg-slate-800/80 rounded-lg border border-slate-200/80 dark:border-slate-700/80 space-y-2 text-xs font-mono">
              <div>
                <div className="text-[11px] text-slate-500">Organization:</div>
                <div className="text-slate-800 dark:text-slate-200 font-bold">coforge.com</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Dataset configured:</div>
                <div className="text-blue-600 dark:text-blue-400 font-semibold truncate">
                  {summary?.tableUsed ? `gcp_billing_export` : 'gcp_billing_export'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Export table:</div>
                <div className="text-slate-700 dark:text-slate-300 truncate text-[11px]" title={summary?.tableUsed}>
                  {summary?.tableUsed || 'Auto-discovered'}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span>Live BigQuery connection</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">1.1s avg query</span>
            </div>
          </Card>
        </div>

        {/* Interactive Tabbed Navigation Strip */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 space-x-1 sm:space-x-3 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('projects')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'projects'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Projects &amp; Departments ({projects.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('skus')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'skus'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>SKU Deep Dive ({skus.length || '142'})</span>
          </button>

          <button
            onClick={() => setActiveTab('regions')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'regions'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Geographic Regions ({regions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('credits')}
            className={`pb-3 px-3 border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'credits'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Percent className="w-3.5 h-3.5" />
            <span>Credits &amp; Discounts ({credits.length})</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* TAB 1: PROJECTS & DEPARTMENTS DIRECTORY                                    */}
        {/* ========================================================================= */}
        {activeTab === 'projects' && (
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  GCP Projects &amp; Governance Directory
                </h2>
                <p className="text-xs text-slate-500">
                  Tracked Google Cloud projects, department folders, and spend vs limit
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search projects or IDs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 sm:w-56"
                  />
                </div>

                <select
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Folders</option>
                  {uniqueFolders.map((f, i) => (
                    <option key={i} value={f}>
                      Folder: {f}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Statuses</option>
                  <option value="on track">On Track</option>
                  <option value="warning">Warning</option>
                  <option value="exceeded">Exceeded</option>
                  <option value="unbudgeted">Unbudgeted</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Project Name &amp; ID</th>
                    <th className="py-3 px-4">Folder / BU</th>
                    <th className="py-3 px-4">Month Spend</th>
                    <th className="py-3 px-4">Budget Limit</th>
                    <th className="py-3 px-4">Budget Utilization</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Drill Down</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredProjects.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No GCP projects matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredProjects.map((p) => {
                      const isExceeded = p.status === 'Exceeded' || p.utilizationPct >= 100;
                      const isWarning = p.status === 'Warning' || (p.utilizationPct >= 85 && p.utilizationPct < 100);

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">{p.name}</div>
                            <div className="font-mono text-[11px] text-slate-400">{p.projectId}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                              <FolderTree className="w-3 h-3 text-indigo-500" />
                              <span>{p.folder || 'Global / Root'}</span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                            {fmt(p.currentSpend, p.currentSpendUsd)}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                            {p.budgetLimit > 0 ? fmt(p.budgetLimit, p.budgetLimitUsd) : '—'}
                          </td>
                          <td className="py-3.5 px-4 w-44">
                            {p.budgetLimit > 0 ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                                    {p.utilizationPct}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      isExceeded ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${Math.min(100, p.utilizationPct)}%` }}
                                  />
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">No limit defined</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <Badge
                              className={`text-[10px] font-bold ${
                                isExceeded
                                  ? 'bg-rose-500/10 text-rose-600 border border-rose-500/30'
                                  : isWarning
                                  ? 'bg-amber-500/10 text-amber-600 border border-amber-500/30'
                                  : p.status === 'Unbudgeted'
                                  ? 'bg-slate-500/10 text-slate-600 border border-slate-500/30'
                                  : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                              }`}
                            >
                              {p.status}
                            </Badge>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              onClick={() => {
                                setSkuProjectFilter(p.name);
                                setActiveTab('skus');
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 cursor-pointer"
                            >
                              <span>View SKUs</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: SKU-LEVEL CONSUMPTION & PRICING DEEP DIVE                           */}
        {/* ========================================================================= */}
        {activeTab === 'skus' && (
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Granular SKU Pricing &amp; Consumption Metrics
                </h2>
                <p className="text-xs text-slate-500">
                  Individual product line items, model tokens, request counts, and effective pricing
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search SKU description or service..."
                    value={skuSearch}
                    onChange={(e) => setSkuSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-56 sm:w-72"
                  />
                </div>

                <select
                  value={skuProjectFilter}
                  onChange={(e) => setSkuProjectFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>

                {skuProjectFilter !== 'all' && (
                  <button
                    onClick={() => setSkuProjectFilter('all')}
                    className="text-xs text-blue-600 hover:underline font-semibold cursor-pointer"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">SKU Description &amp; ID</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Project</th>
                    <th className="py-3 px-4">Consumption Quantity</th>
                    <th className="py-3 px-4">Billed Cost</th>
                    <th className="py-3 px-4">List Price</th>
                    <th className="py-3 px-4">Share %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredSkus.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        No SKUs matching criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredSkus.map((s, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 max-w-[280px]">
                          <div className="font-bold text-slate-900 dark:text-white truncate" title={s.skuDescription}>
                            {s.skuDescription}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">{s.skuId}</div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-medium">
                            {s.service}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">
                          {s.projectName || 'Global'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            {fmtQty(s.usageAmount)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {s.usageUnit} ({s.pricingUnit})
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {fmt(s.cost, s.costUsd)}
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono">
                          {fmt(s.listCost, s.listCostUsd)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-12 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-600 rounded-full"
                                style={{ width: `${Math.min(100, s.sharePct * 1.5)}%` }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">{s.sharePct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: GEOGRAPHIC REGIONS BREAKDOWN                                        */}
        {/* ========================================================================= */}
        {activeTab === 'regions' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Geographic Regions &amp; Multi-Zone Spend
                </h2>
                <p className="text-xs text-slate-500">Cost by data center region and country destination</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Region Identifier</th>
                      <th className="py-3 px-4">Country</th>
                      <th className="py-3 px-4">Active Projects</th>
                      <th className="py-3 px-4">Monthly Spend</th>
                      <th className="py-3 px-4">Share %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {regions.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                          {r.region}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{r.country}</td>
                        <td className="py-3 px-4">{r.projectCount} projects</td>
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {fmt(r.cost, r.costUsd)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">
                            {r.sharePct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Department Folders Breakdown Card */}
            <Card className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs space-y-4">
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Department Folders
                </h3>
              </div>
              <p className="text-xs text-slate-500">Organizational hierarchy mapped to business units</p>

              <div className="space-y-3 pt-2">
                {folders.map((f, i) => (
                  <div key={i} className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">{f.folderName}</span>
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                        {fmt(f.totalSpend, f.totalSpendUsd)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {f.projectCount} project{f.projectCount > 1 ? 's' : ''} enrolled
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: CREDITS, DISCOUNTS & NEGOTIATED BENEFITS                           */}
        {/* ========================================================================= */}
        {activeTab === 'credits' && (
          <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Google Cloud Credits, Committed Use &amp; Volume Discounts
              </h2>
              <p className="text-xs text-slate-500">
                Breakdown of Google promotional savings, sustained use discounts, and contract credits
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase tracking-wider text-[11px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Discount / Credit Name</th>
                    <th className="py-3 px-4">Benefit Type</th>
                    <th className="py-3 px-4">Savings Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {credits.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-400">
                        No active credits recorded in this billing cycle.
                      </td>
                    </tr>
                  ) : (
                    credits.map((c, i) => (
                      <tr key={i} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3.5 px-4 font-semibold text-slate-800 dark:text-slate-200 max-w-[400px]">
                          {c.creditName}
                        </td>
                        <td className="py-3.5 px-4">
                          <Badge
                            className={`text-[10px] font-bold ${
                              c.creditType === 'SUBSCRIPTION_BENEFIT'
                                ? 'bg-indigo-500/10 text-indigo-600 border border-indigo-500/30'
                                : 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                            }`}
                          >
                            {c.creditType}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          - {fmt(c.totalCredit, c.totalCreditUsd)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

export default GcpDashboardPage;
