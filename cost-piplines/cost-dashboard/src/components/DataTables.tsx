import { useState, useMemo } from "react";
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
import { useCsv } from "@/lib/useCsv";
import type { ServiceCost, LinkedAccountCost, RecurringRow } from "@/lib/types";
import { Search, ChevronLeft, ChevronRight, Building2 } from "lucide-react";

interface DataTablesProps {
  selectedMonth: string;
}

export function DataTables({ selectedMonth }: DataTablesProps) {
  // Static latest month fallbacks
  const { data: services } = useCsv<ServiceCost>(
    "/data/latest_month_services.csv",
  );
  const { data: accountVariances } = useCsv<any>(
    "/data/account_cost_variance.csv",
  );
  const { data: recurring } = useCsv<RecurringRow>(
    "/data/recurring_vs_onetime.csv",
  );

  // Wide service costs containing full 6 months history
  const { data: wideServices } = useCsv<any>("/data/cost_by_service_wide.csv");

  // Determine if the selected month is the latest month (to check if linked account data is available)
  const isLatestMonth = useMemo(() => {
    if (wideServices.length === 0 || !selectedMonth) return true;
    const sortedMonths = [...new Set(wideServices.filter(r => r && r.Month).map((r) => r.Month))].sort();
    const latest = sortedMonths[sortedMonths.length - 1];
    return selectedMonth === latest;
  }, [wideServices, selectedMonth]);

  // Determine sorted months list from wide CSV
  const sortedMonths = useMemo(() => {
    if (wideServices.length === 0) return [];
    return [...new Set(wideServices.filter(r => r && r.Month).map((r) => r.Month))].sort();
  }, [wideServices]);

  // Determine previous month relative to the selected month
  const prevMonth = useMemo(() => {
    if (sortedMonths.length === 0 || !selectedMonth) return null;
    const idx = sortedMonths.indexOf(selectedMonth);
    return idx > 0 ? sortedMonths[idx - 1] : null;
  }, [sortedMonths, selectedMonth]);

  // Dynamically compute the services and costs for the selected month and previous month from the wide CSV
  const serviceComparisons = useMemo(() => {
    if (!selectedMonth || wideServices.length === 0) {
      return (services || []).map((s) => ({
        Service: s ? s.Service : "",
        CurrentCost: s ? s.Cost : 0,
        PreviousCost: 0,
      }));
    }
    const currentMonthRow = wideServices.find((r) => r && r.Month === selectedMonth);
    const previousMonthRow = prevMonth ? wideServices.find((r) => r && r.Month === prevMonth) : null;

    const rowKeys = currentMonthRow ? Object.keys(currentMonthRow) : [];
    const serviceKeys = rowKeys.filter((k) => k !== "Month" && k !== "Total Cost");

    const list: { Service: string; CurrentCost: number; PreviousCost: number }[] = [];

    for (const service of serviceKeys) {
      const currentCost = currentMonthRow ? Number(currentMonthRow[service]) : 0;
      const previousCost = previousMonthRow ? Number(previousMonthRow[service]) : 0;

      const cleanCurrent = isNaN(currentCost) ? 0 : currentCost;
      const cleanPrevious = isNaN(previousCost) ? 0 : previousCost;

      if (cleanCurrent > 0 || cleanPrevious > 0) {
        list.push({
          Service: service,
          CurrentCost: cleanCurrent,
          PreviousCost: cleanPrevious,
        });
      }
    }
    return list.sort((a, b) => b.CurrentCost - a.CurrentCost || b.PreviousCost - a.PreviousCost);
  }, [services, wideServices, selectedMonth, prevMonth]);

  // Active accounts sorted by current month cost descending
  const activeAccounts = useMemo(() => {
    if (!accountVariances || accountVariances.length === 0) return [];
    return [...accountVariances]
      .filter((a) => a && a["Linked Account"])
      .sort((a, b) => {
        const aCost = Number(a["Curr Month Cost"] || 0);
        const bCost = Number(b["Curr Month Cost"] || 0);
        return bCost - aCost;
      });
  }, [accountVariances]);

  // Search states
  const [searchServices, setSearchServices] = useState("");
  const [searchAccounts, setSearchAccounts] = useState("");
  const [searchRecurring, setSearchRecurring] = useState("");

  // Pagination states
  const [pageServices, setPageServices] = useState(1);
  const [pageAccounts, setPageAccounts] = useState(1);
  const [pageRecurring, setPageRecurring] = useState(1);

  const ITEMS_PER_PAGE = 8;

  // Filter & Paginate 1: Services
  const filteredServices = serviceComparisons.filter((s) =>
    s && s.Service && s.Service.toLowerCase().includes(searchServices.toLowerCase())
  );
  const totalPagesServices = Math.ceil(filteredServices.length / ITEMS_PER_PAGE);
  const paginatedServices = filteredServices.slice(
    (pageServices - 1) * ITEMS_PER_PAGE,
    pageServices * ITEMS_PER_PAGE
  );

  // Filter & Paginate 2: Accounts
  const filteredAccounts = activeAccounts.filter((a) =>
    a && a["Linked Account"] && a["Linked Account"].toLowerCase().includes(searchAccounts.toLowerCase())
  );
  const totalPagesAccounts = Math.ceil(filteredAccounts.length / ITEMS_PER_PAGE);
  const paginatedAccounts = filteredAccounts.slice(
    (pageAccounts - 1) * ITEMS_PER_PAGE,
    pageAccounts * ITEMS_PER_PAGE
  );

  // Filter & Paginate 3: Service Usage Frequency
  const filteredRecurring = (recurring || []).filter((r) =>
    r && r.Service && r.Service.toLowerCase().includes(searchRecurring.toLowerCase())
  );
  const totalPagesRecurring = Math.ceil(filteredRecurring.length / ITEMS_PER_PAGE);
  const paginatedRecurring = filteredRecurring.slice(
    (pageRecurring - 1) * ITEMS_PER_PAGE,
    pageRecurring * ITEMS_PER_PAGE
  );

  // Helper to handle search change & reset page
  const handleSearchServices = (val: string) => {
    setSearchServices(val);
    setPageServices(1);
  };
  const handleSearchAccounts = (val: string) => {
    setSearchAccounts(val);
    setPageAccounts(1);
  };
  const handleSearchRecurring = (val: string) => {
    setSearchRecurring(val);
    setPageRecurring(1);
  };

  // Format month name for headers display
  const formatMonthName = (mStr: string) => {
    if (!mStr) return "";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long" });
  };

  // Format short month name for headers display
  const formatShortMonthName = (mStr: string | null) => {
    if (!mStr) return "-";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "short" });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Cost by Service */}
      <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold tracking-tight">
            Cost by Service ({selectedMonth ? formatMonthName(selectedMonth) : "Latest Month"})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 pb-4">
          {/* Search Input */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search services..."
              value={searchServices}
              onChange={(e) => handleSearchServices(e.target.value)}
              className="w-full bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
            />
          </div>

          {/* Table Container */}
          <div className="flex-1 min-h-[360px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="max-w-[200px]">Service</TableHead>
                  <TableHead className="text-right whitespace-nowrap w-[100px]">
                    {prevMonth ? formatShortMonthName(prevMonth) : "Prev"}
                  </TableHead>
                  <TableHead className="text-right whitespace-nowrap w-[100px]">
                    {selectedMonth ? formatShortMonthName(selectedMonth) : "Curr"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedServices.length > 0 ? (
                  paginatedServices.map((s, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="max-w-[200px] truncate font-medium py-2.5" title={s.Service}>
                        {s.Service}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap w-[100px] py-2.5 text-muted-foreground text-xs font-medium">
                        ${s.PreviousCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-semibold whitespace-nowrap w-[100px] py-2.5 text-xs">
                        ${s.CurrentCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No services found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
            <div className="text-xs text-muted-foreground">
              {filteredServices.length > 0 ? (
                `Showing ${(pageServices - 1) * ITEMS_PER_PAGE + 1}-${Math.min(pageServices * ITEMS_PER_PAGE, filteredServices.length)} of ${filteredServices.length}`
              ) : (
                "0-0 of 0"
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPageServices((p) => Math.max(1, p - 1))}
                disabled={pageServices === 1}
                className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium min-w-[32px] text-center">
                {pageServices} / {totalPagesServices || 1}
              </span>
              <button
                onClick={() => setPageServices((p) => Math.min(totalPagesServices, p + 1))}
                disabled={pageServices === totalPagesServices || totalPagesServices === 0}
                className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost by Linked Account */}
      <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold tracking-tight">Cost by Linked Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 pb-4">
          {isLatestMonth ? (
            <>
              {/* Search Input */}
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search accounts..."
                  value={searchAccounts}
                  onChange={(e) => handleSearchAccounts(e.target.value)}
                  className="w-full bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
                />
              </div>

              {/* Table Container */}
              <div className="flex-1 min-h-[360px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="max-w-[200px]">Account</TableHead>
                      <TableHead className="text-right whitespace-nowrap w-[100px]">
                        {prevMonth ? formatShortMonthName(prevMonth) : "Prev"}
                      </TableHead>
                      <TableHead className="text-right whitespace-nowrap w-[100px]">
                        {selectedMonth ? formatShortMonthName(selectedMonth) : "Curr"}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAccounts.length > 0 ? (
                      paginatedAccounts.map((a, i) => {
                        const prevCost = Number(a["Prev Month Cost"]);
                        const currCost = Number(a["Curr Month Cost"]);

                        const cleanPrev = isNaN(prevCost) ? 0 : prevCost;
                        const cleanCurr = isNaN(currCost) ? 0 : currCost;
                        return (
                          <TableRow key={i} className="hover:bg-muted/30">
                            <TableCell className="max-w-[200px] truncate font-medium py-2.5 text-xs" title={a["Linked Account"]}>
                              {a["Linked Account"]}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap w-[100px] py-2.5 text-muted-foreground text-xs font-medium">
                              ${cleanPrev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-semibold whitespace-nowrap w-[100px] py-2.5 text-xs">
                              ${cleanCurr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          No accounts found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
                <div className="text-xs text-muted-foreground">
                  {filteredAccounts.length > 0 ? (
                    `Showing ${(pageAccounts - 1) * ITEMS_PER_PAGE + 1}-${Math.min(pageAccounts * ITEMS_PER_PAGE, filteredAccounts.length)} of ${filteredAccounts.length}`
                  ) : (
                    "0-0 of 0"
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPageAccounts((p) => Math.max(1, p - 1))}
                    disabled={pageAccounts === 1}
                    className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs font-medium min-w-[32px] text-center">
                    {pageAccounts} / {totalPagesAccounts || 1}
                  </span>
                  <button
                    onClick={() => setPageAccounts((p) => Math.min(totalPagesAccounts, p + 1))}
                    disabled={pageAccounts === totalPagesAccounts || totalPagesAccounts === 0}
                    className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[410px] text-center p-6 text-muted-foreground">
              <Building2 className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-semibold text-foreground">Historical Breakdown Unavailable</p>
              <p className="text-xs max-w-[200px] mt-1.5 leading-relaxed">
                Linked Account monthly breakdowns are only generated for the latest billing period.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service Usage Frequency */}
      <Card className="flex flex-col h-full border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold tracking-tight">Service Usage Frequency</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col flex-1 pb-4">
          {/* Search Input */}
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search usage..."
              value={searchRecurring}
              onChange={(e) => handleSearchRecurring(e.target.value)}
              className="w-full bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
            />
          </div>

          {/* Table Container */}
          <div className="flex-1 min-h-[360px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="max-w-[150px]">Service</TableHead>
                  <TableHead className="whitespace-nowrap w-[60px]">Months</TableHead>
                  <TableHead className="w-[120px]">Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedRecurring.length > 0 ? (
                  paginatedRecurring.map((r, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      <TableCell className="max-w-[150px] truncate font-medium py-2.5" title={r.Service}>
                        {r.Service}
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-[60px] py-2.5 text-muted-foreground font-medium">
                        {r["Months Active"]}/{r["Total Months"]}
                      </TableCell>
                      <TableCell className="w-[120px] py-2.5">
                        <Badge
                          variant="secondary"
                          className={`font-semibold text-xs px-2 py-0.5 border ${
                            r.Classification === "Recurring"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : r.Classification === "Occasional"
                                ? "bg-amber-50 text-amber-700 border-amber-200"
                                : "bg-slate-50 text-slate-600 border-slate-200"
                          }`}
                        >
                          {r.Classification}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No services found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
            <div className="text-xs text-muted-foreground">
              {filteredRecurring.length > 0 ? (
                `Showing ${(pageRecurring - 1) * ITEMS_PER_PAGE + 1}-${Math.min(pageRecurring * ITEMS_PER_PAGE, filteredRecurring.length)} of ${filteredRecurring.length}`
              ) : (
                "0-0 of 0"
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPageRecurring((p) => Math.max(1, p - 1))}
                disabled={pageRecurring === 1}
                className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium min-w-[32px] text-center">
                {pageRecurring} / {totalPagesRecurring || 1}
              </span>
              <button
                onClick={() => setPageRecurring((p) => Math.min(totalPagesRecurring, p + 1))}
                disabled={pageRecurring === totalPagesRecurring || totalPagesRecurring === 0}
                className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
