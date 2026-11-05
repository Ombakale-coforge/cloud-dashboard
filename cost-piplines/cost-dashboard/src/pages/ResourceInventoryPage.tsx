import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Database,
  Cloud,
  HardDrive,
  Cpu,
  Layers,
  Network,
  ShieldCheck,
  Search,
  Filter,
  ArrowUpDown,
  RefreshCw,
  LayoutGrid,
  BarChart3,
  ExternalLink,
  DollarSign,
  Boxes,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Navbar } from '@/components/Navbar';

interface InventoryItem {
  id: string;
  name: string;
  cloud: 'aws' | 'azure';
  service: string;
  resourceGroupOrRegion: string;
  accountOrSubscription: string;
  accountOrSubscriptionId: string;
  month: string;
  cost: number;
  status: string;
  category: string;
}

interface InventoryResponse {
  success: boolean;
  count: number;
  summary: {
    totalAssets: number;
    totalMonthlyCost: number;
    distinctResourceGroupsCount: number;
    awsAssetsCount: number;
    azureAssetsCount: number;
    categoryCounts: Record<string, number>;
  };
  data: InventoryItem[];
}

const fmtCurrency = (n: number) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function ResourceInventoryPage() {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [cloudFilter, setCloudFilter] = useState<'all' | 'aws' | 'azure'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'cost' | 'name' | 'service'>('cost');
  const [sortAsc, setSortAsc] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const fetchInventory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory?cloud=${cloudFilter}&search=${encodeURIComponent(searchTerm)}`);
      if (!res.ok) {
        throw new Error(`Failed to load inventory (HTTP ${res.status})`);
      }
      const json: InventoryResponse = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Failed to fetch resource inventory:', err);
      setError(err.message || 'Error connecting to inventory API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [cloudFilter]);

  // Handle client-side search debounce or direct filter
  const items = useMemo(() => {
    if (!data?.data) return [];
    let list = [...data.data];

    if (categoryFilter !== 'all') {
      list = list.filter((i) => i.category === categoryFilter);
    }

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.service.toLowerCase().includes(q) ||
          i.resourceGroupOrRegion.toLowerCase().includes(q) ||
          i.accountOrSubscription.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'cost') cmp = a.cost - b.cost;
      else if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'service') cmp = a.service.localeCompare(b.service);
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [data, categoryFilter, searchTerm, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const categories = useMemo(() => {
    if (!data?.summary?.categoryCounts) return [];
    return Object.keys(data.summary.categoryCounts);
  }, [data]);

  const toggleSort = (field: 'cost' | 'name' | 'service') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans antialiased">
      <Navbar activeProvider="aws" />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-md shadow-indigo-500/20">
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Asset &amp; Resource Inventory
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Consolidated multi-cloud resource tracking across AWS Organizations and Azure Subscriptions
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchInventory}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Inventory</span>
            </button>
          </div>
        </div>

        {/* Top Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Card className="p-5 border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Total Tracked Assets
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
                  {data?.summary?.totalAssets || 0}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  AWS: {data?.summary?.awsAssetsCount || 0} · Azure: {data?.summary?.azureAssetsCount || 0}
                </p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                <Boxes className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Resource Groups &amp; Scopes
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
                  {data?.summary?.distinctResourceGroupsCount || 0}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Distinct logical deployments</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
                <Layers className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Combined Monthly Spend
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mt-1">
                  {fmtCurrency(data?.summary?.totalMonthlyCost || 0)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Attributed to active assets</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <DollarSign className="h-6 w-6" />
              </div>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-xl shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Governance Status
                </p>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400 tracking-tight mt-1">
                  Healthy
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">All active assets audited</p>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <ShieldCheck className="h-6 w-6" />
              </div>
            </div>
          </Card>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          {/* Cloud Toggle Pills */}
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg">
            <button
              onClick={() => { setCloudFilter('all'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                cloudFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Clouds
            </button>
            <button
              onClick={() => { setCloudFilter('aws'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                cloudFilter === 'aws'
                  ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              AWS Only
            </button>
            <button
              onClick={() => { setCloudFilter('azure'); setCurrentPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                cloudFilter === 'azure'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Azure Only
            </button>
          </div>

          {/* Category Dropdown & Search */}
          <div className="flex flex-1 items-center gap-3 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by resource name, service, resource group, or account..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {categories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Data Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3.5 px-4 cursor-pointer" onClick={() => toggleSort('name')}>
                    <div className="flex items-center gap-1.5">
                      <span>Resource Name</span>
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </div>
                  </th>
                  <th className="py-3.5 px-4">Cloud</th>
                  <th className="py-3.5 px-4 cursor-pointer" onClick={() => toggleSort('service')}>
                    <div className="flex items-center gap-1.5">
                      <span>Service &amp; Category</span>
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </div>
                  </th>
                  <th className="py-3.5 px-4">Resource Group / Region</th>
                  <th className="py-3.5 px-4">Account / Subscription</th>
                  <th className="py-3.5 px-4 text-right cursor-pointer" onClick={() => toggleSort('cost')}>
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Monthly Spend</span>
                      <ArrowUpDown className="w-3.5 h-3.5" />
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
                        <span>Loading asset inventory from database...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-500">
                      No assets found matching your search and filter criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-white max-w-xs truncate">
                        {item.name}
                      </td>

                      <td className="py-3.5 px-4">
                        {item.cloud === 'aws' ? (
                          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                            AWS
                          </Badge>
                        ) : (
                          <Badge className="bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/30 text-[10px] font-bold">
                            Azure
                          </Badge>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{item.service}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{item.category}</div>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-400 max-w-xs truncate text-[11px]">
                        {item.resourceGroupOrRegion}
                      </td>

                      <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 max-w-xs truncate">
                        <div>{item.accountOrSubscription}</div>
                        <div className="text-[10px] font-mono text-slate-400">{item.accountOrSubscriptionId}</div>
                      </td>

                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                        {fmtCurrency(item.cost)}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[10px]">
                          {item.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {!loading && items.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-xs text-slate-500">
              <div>
                Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, items.length)} of {items.length} assets
              </div>
              <div className="flex items-center gap-1">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Previous
                </button>
                <span className="px-2 font-medium">Page {currentPage} of {totalPages}</span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
