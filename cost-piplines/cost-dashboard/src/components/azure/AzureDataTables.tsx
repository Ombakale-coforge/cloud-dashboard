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
import { useCsv } from "@/lib/useCsv";
import type { AzureTopMeter } from "@/lib/types";
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface AzureDataTablesProps {
    selectedMonth: string;
}

type SortKey = "Meter" | "Product" | "Cost";
type SortDir = "asc" | "desc";

const ITEMS_PER_PAGE = 8;

export function AzureDataTables({ selectedMonth }: AzureDataTablesProps) {
    const { data: meters } = useCsv<AzureTopMeter>("/data/azure/azure_top_meters.csv");

    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [sortKey, setSortKey] = useState<SortKey>("Cost");
    const [sortDir, setSortDir] = useState<SortDir>("desc");

    const formatMonthName = (mStr: string) => {
        if (!mStr) return "Latest Month";
        const [year, month] = mStr.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);
        return date.toLocaleString("default", { month: "long", year: "numeric" });
    };

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "Cost" ? "desc" : "asc");
        }
        setPage(1);
    };

    const handleSearch = (val: string) => {
        setSearch(val);
        setPage(1);
    };

    const filteredMeters = useMemo(() => {
        const q = search.toLowerCase();
        const filtered = meters
            .filter((m) => !selectedMonth || m.Month === selectedMonth)
            .filter(
                (m) =>
                    !q ||
                    m.Meter?.toLowerCase().includes(q) ||
                    m.Product?.toLowerCase().includes(q)
            );

        return [...filtered].sort((a, b) => {
            let cmp = 0;
            if (sortKey === "Cost") {
                cmp = a.Cost - b.Cost;
            } else {
                cmp = (a[sortKey] || "").localeCompare(b[sortKey] || "");
            }
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [meters, selectedMonth, search, sortKey, sortDir]);

    const totalPages = Math.ceil(filteredMeters.length / ITEMS_PER_PAGE);
    const paginatedMeters = filteredMeters.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />;
        return sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
    };

    return (
        <Card className="flex flex-col border border-muted/40 shadow-sm bg-card/60 backdrop-blur-md">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg font-semibold tracking-tight">
                    Top Meter Details ({selectedMonth ? formatMonthName(selectedMonth) : "Latest Month"})
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col flex-1 pb-4">
                {/* Search Input */}
                <div className="relative mb-3">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search meters or products..."
                        value={search}
                        onChange={(e) => handleSearch(e.target.value)}
                        className="w-full max-w-sm bg-background pl-8 pr-3 py-1.5 text-sm rounded-md border border-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500/50"
                    />
                </div>

                {/* Table Container */}
                <div className="flex-1 min-h-[360px]">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="max-w-[280px] cursor-pointer select-none" onClick={() => toggleSort("Meter")}>
                                    <span className="inline-flex items-center">
                                        Meter <SortIcon column="Meter" />
                                    </span>
                                </TableHead>
                                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("Product")}>
                                    <span className="inline-flex items-center">
                                        Product <SortIcon column="Product" />
                                    </span>
                                </TableHead>
                                <TableHead className="text-right whitespace-nowrap w-[120px] cursor-pointer select-none" onClick={() => toggleSort("Cost")}>
                                    <span className="inline-flex items-center justify-end w-full">
                                        Cost <SortIcon column="Cost" />
                                    </span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {paginatedMeters.length > 0 ? (
                                paginatedMeters.map((m, i) => (
                                    <TableRow key={`${m.Meter}-${m.Product}-${i}`} className="hover:bg-muted/30">
                                        <TableCell className="max-w-[280px] truncate font-medium py-2.5" title={m.Meter}>
                                            {m.Meter}
                                        </TableCell>
                                        <TableCell className="truncate py-2.5 text-muted-foreground" title={m.Product}>
                                            {m.Product}
                                        </TableCell>
                                        <TableCell className="text-right whitespace-nowrap w-[120px] py-2.5 font-semibold text-xs">
                                            ${m.Cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                                        No meters found
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-muted/30">
                    <div className="text-xs text-muted-foreground">
                        {filteredMeters.length > 0
                            ? `Showing ${(page - 1) * ITEMS_PER_PAGE + 1}-${Math.min(page * ITEMS_PER_PAGE, filteredMeters.length)} of ${filteredMeters.length}`
                            : "0-0 of 0"}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="text-xs font-medium min-w-[32px] text-center">
                            {page} / {totalPages || 1}
                        </span>
                        <button
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages || totalPages === 0}
                            className="p-1 rounded border border-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
