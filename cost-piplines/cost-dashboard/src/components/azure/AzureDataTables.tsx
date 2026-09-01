import {
    useEffect,
    useMemo,
    useState,
} from "react";

import {
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronLeft,
    ChevronRight,
    Search,
} from "lucide-react";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { useCsv } from "@/lib/useCsv";

interface AzureDataTablesProps {
    selectedMonth: string;
    basePath?: string;
}

/*
 * Matches azure_usage_top_meters.csv:
 *
 * Month,
 * Meter,
 * Category,
 * Service,
 * ResourceGroup,
 * Cost
 */
interface AzureTopMeter {
    Month: string;
    Meter: string;
    Category: string;
    Service: string;
    ResourceGroup: string;
    Cost: number;
}

type SortKey =
    | "Meter"
    | "Category"
    | "Service"
    | "ResourceGroup"
    | "Cost";

type SortDirection = "asc" | "desc";

const ITEMS_PER_PAGE = 10;

const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const formatCurrency = (value: unknown) => {
    const amount = Number(value ?? 0);

    return inrFormatter.format(
        Number.isFinite(amount) ? amount : 0
    );
};

const formatMonthName = (monthValue: string) => {
    if (!monthValue) {
        return "Latest Month";
    }

    const [year, month] = monthValue
        .split("-")
        .map(Number);

    if (!year || !month) {
        return monthValue;
    }

    return new Date(
        year,
        month - 1,
        1
    ).toLocaleString("en-IN", {
        month: "long",
        year: "numeric",
    });
};

const normalizeText = (value: unknown) => {
    return String(value ?? "")
        .trim()
        .toLowerCase();
};

export function AzureDataTables({
    selectedMonth,
    basePath = "/data/azure",
}: AzureDataTablesProps) {
    const { data: meters } = useCsv<AzureTopMeter>(
        `${basePath}/azure_usage_top_meters.csv`
    );

    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [sortKey, setSortKey] =
        useState<SortKey>("Cost");
    const [sortDirection, setSortDirection] =
        useState<SortDirection>("desc");

    /*
     * If selectedMonth is empty, use the latest month
     * available in the meter CSV.
     */
    const effectiveMonth = useMemo(() => {
        if (selectedMonth) {
            return selectedMonth;
        }

        const months = meters
            .map((row) => row.Month)
            .filter(Boolean)
            .sort();

        return months[months.length - 1] ?? "";
    }, [meters, selectedMonth]);

    const activeMonthName =
        formatMonthName(effectiveMonth);

    /*
     * Reset pagination whenever the selected month changes.
     */
    useEffect(() => {
        setPage(1);
    }, [effectiveMonth]);

    /*
     * Search, filter, and sort meter records.
     */
    const filteredMeters = useMemo(() => {
        const query = normalizeText(search);

        const filtered = meters.filter((meter) => {
            const belongsToActiveMonth =
                meter.Month === effectiveMonth;

            if (!belongsToActiveMonth) {
                return false;
            }

            if (!query) {
                return true;
            }

            return [
                meter.Meter,
                meter.Category,
                meter.Service,
                meter.ResourceGroup,
            ].some((value) =>
                normalizeText(value).includes(query)
            );
        });

        return [...filtered].sort((a, b) => {
            let comparison = 0;

            if (sortKey === "Cost") {
                comparison =
                    Number(a.Cost) - Number(b.Cost);
            } else {
                comparison = String(
                    a[sortKey] ?? ""
                ).localeCompare(
                    String(b[sortKey] ?? ""),
                    undefined,
                    {
                        sensitivity: "base",
                    }
                );
            }

            return sortDirection === "asc"
                ? comparison
                : -comparison;
        });
    }, [
        meters,
        effectiveMonth,
        search,
        sortKey,
        sortDirection,
    ]);

    const totalCost = useMemo(() => {
        return filteredMeters.reduce(
            (sum, meter) =>
                sum + Number(meter.Cost || 0),
            0
        );
    }, [filteredMeters]);

    const totalPages = Math.max(
        1,
        Math.ceil(
            filteredMeters.length /
            ITEMS_PER_PAGE
        )
    );

    /*
     * Keep page valid if filtering reduces the
     * number of available pages.
     */
    useEffect(() => {
        setPage((currentPage) =>
            Math.min(currentPage, totalPages)
        );
    }, [totalPages]);

    const paginatedMeters = useMemo(() => {
        const startIndex =
            (page - 1) * ITEMS_PER_PAGE;

        return filteredMeters.slice(
            startIndex,
            startIndex + ITEMS_PER_PAGE
        );
    }, [filteredMeters, page]);

    const startRow =
        filteredMeters.length === 0
            ? 0
            : (page - 1) *
            ITEMS_PER_PAGE +
            1;

    const endRow = Math.min(
        page * ITEMS_PER_PAGE,
        filteredMeters.length
    );

    const toggleSort = (key: SortKey) => {
        if (key === sortKey) {
            setSortDirection((current) =>
                current === "asc"
                    ? "desc"
                    : "asc"
            );
        } else {
            setSortKey(key);

            /*
             * Cost defaults to descending.
             * Text columns default to ascending.
             */
            setSortDirection(
                key === "Cost"
                    ? "desc"
                    : "asc"
            );
        }

        setPage(1);
    };

    const handleSearchChange = (
        value: string
    ) => {
        setSearch(value);
        setPage(1);
    };

    const goToPreviousPage = () => {
        setPage((currentPage) =>
            Math.max(1, currentPage - 1)
        );
    };

    const goToNextPage = () => {
        setPage((currentPage) =>
            Math.min(
                totalPages,
                currentPage + 1
            )
        );
    };

    return (
        <div className="space-y-6">
            <Card className="border border-muted/50 bg-card/60 shadow-sm backdrop-blur-md transition-all duration-300 hover:shadow-md">
                <CardHeader className="space-y-3 pb-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle className="text-lg font-semibold tracking-tight">
                                Top Meter Details
                            </CardTitle>

                            <p className="mt-1 text-xs text-muted-foreground">
                                Meter-level Azure costs for{" "}
                                {activeMonthName}
                            </p>
                        </div>

                        <div className="text-left sm:text-right">
                            <p className="text-xs text-muted-foreground">
                                Filtered total
                            </p>

                            <p className="text-sm font-semibold text-foreground">
                                {formatCurrency(totalCost)}
                            </p>
                        </div>
                    </div>

                    <div className="relative w-full sm:max-w-md">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                        <input
                            type="search"
                            value={search}
                            onChange={(event) =>
                                handleSearchChange(
                                    event.target.value
                                )
                            }
                            placeholder="Search meter, category, service, or resource group..."
                            aria-label="Search Azure meter details"
                            className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-blue-500/40"
                        />
                    </div>
                </CardHeader>

                <CardContent className="pb-4">
                    <div className="overflow-x-auto rounded-md border border-muted/40">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/20 hover:bg-muted/20">
                                    <SortableTableHead
                                        label="Meter"
                                        column="Meter"
                                        activeColumn={
                                            sortKey
                                        }
                                        direction={
                                            sortDirection
                                        }
                                        onSort={
                                            toggleSort
                                        }
                                        className="min-w-[230px]"
                                    />

                                    <SortableTableHead
                                        label="Category"
                                        column="Category"
                                        activeColumn={
                                            sortKey
                                        }
                                        direction={
                                            sortDirection
                                        }
                                        onSort={
                                            toggleSort
                                        }
                                        className="min-w-[150px]"
                                    />

                                    <SortableTableHead
                                        label="Service"
                                        column="Service"
                                        activeColumn={
                                            sortKey
                                        }
                                        direction={
                                            sortDirection
                                        }
                                        onSort={
                                            toggleSort
                                        }
                                        className="min-w-[180px]"
                                    />

                                    <SortableTableHead
                                        label="Resource Group"
                                        column="ResourceGroup"
                                        activeColumn={
                                            sortKey
                                        }
                                        direction={
                                            sortDirection
                                        }
                                        onSort={
                                            toggleSort
                                        }

                                        className="min-w-[180px]"
                                    />

                                    <SortableTableHead
                                        label="Cost"
                                        column="Cost"
                                        activeColumn={
                                            sortKey
                                        }
                                        direction={
                                            sortDirection
                                        }
                                        onSort={
                                            toggleSort
                                        }
                                        className="min-w-[130px] text-right"
                                        rightAligned
                                    />
                                </TableRow>
                            </TableHeader>

                            <TableBody>
                                {paginatedMeters.length >
                                    0 ? (
                                    paginatedMeters.map(
                                        (
                                            meter,
                                            index
                                        ) => (
                                            <TableRow
                                                key={`${meter.Month}-${meter.Meter}-${meter.ResourceGroup}-${index}`}
                                                className="hover:bg-muted/30"
                                            >
                                                <TableCell
                                                    className="max-w-[280px] truncate py-3 font-medium"
                                                    title={
                                                        meter.Meter
                                                    }
                                                >
                                                    {meter.Meter ||
                                                        "Unknown Meter"}
                                                </TableCell>

                                                <TableCell
                                                    className="max-w-[200px] truncate py-3 text-muted-foreground"
                                                    title={
                                                        meter.Category
                                                    }
                                                >
                                                    {meter.Category ||
                                                        "Uncategorized"}
                                                </TableCell>

                                                <TableCell
                                                    className="max-w-[230px] truncate py-3 text-muted-foreground"
                                                    title={
                                                        meter.Service
                                                    }
                                                >
                                                    {meter.Service ||
                                                        "Unknown Service"}
                                                </TableCell>

                                                <TableCell
                                                    className="max-w-[230px] truncate py-3 text-muted-foreground"
                                                    title={
                                                        meter.ResourceGroup
                                                    }
                                                >
                                                    {meter.ResourceGroup ||
                                                        "Unassigned"}
                                                </TableCell>

                                                <TableCell className="whitespace-nowrap py-3 text-right font-semibold">
                                                    {formatCurrency(
                                                        meter.Cost
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    )
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={5}
                                            className="h-48 text-center"
                                        >
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium text-foreground">
                                                    No
                                                    meter
                                                    data
                                                    found
                                                </p>

                                                <p className="text-xs text-muted-foreground">
                                                    No
                                                    meter
                                                    costs
                                                    match
                                                    the
                                                    current
                                                    month
                                                    and
                                                    search.
                                                </p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 border-t border-muted/30 pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-muted-foreground">
                            Showing {startRow}-
                            {endRow} of{" "}
                            {filteredMeters.length}{" "}
                            records
                        </p>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={
                                    goToPreviousPage
                                }
                                disabled={page <= 1}
                                aria-label="Previous page"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-muted/50 bg-background transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>

                            <span className="min-w-[90px] text-center text-xs font-medium">
                                Page {page} of{" "}
                                {totalPages}
                            </span>

                            <button
                                type="button"
                                onClick={
                                    goToNextPage
                                }
                                disabled={
                                    page >=
                                    totalPages
                                }
                                aria-label="Next page"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-muted/50 bg-background transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

interface SortableTableHeadProps {
    label: string;
    column: SortKey;
    activeColumn: SortKey;
    direction: SortDirection;
    onSort: (key: SortKey) => void;
    className?: string;
    rightAligned?: boolean;
}

function SortableTableHead({
    label,
    column,
    activeColumn,
    direction,
    onSort,
    className = "",
    rightAligned = false,
}: SortableTableHeadProps) {
    const isActive =
        activeColumn === column;

    const SortIcon = !isActive
        ? ArrowUpDown
        : direction === "asc"
            ? ArrowUp
            : ArrowDown;

    return (
        <TableHead
            className={`cursor-pointer select-none ${className}`}
            onClick={() => onSort(column)}
        >
            <button
                type="button"
                className={`inline-flex w-full items-center gap-1.5 ${rightAligned
                    ? "justify-end"
                    : "justify-start"
                    }`}
                onClick={(event) => {
                    event.stopPropagation();
                    onSort(column);
                }}
            >
                <span>{label}</span>

                <SortIcon
                    className={`h-3.5 w-3.5 ${isActive
                        ? "opacity-100"
                        : "opacity-40"
                        }`}
                />
            </button>
        </TableHead>
    );
}
