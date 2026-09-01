import { useMemo } from "react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    Pie,
    PieChart,
    Cell,
} from "recharts";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

import { useCsv } from "@/lib/useCsv";

/*
 * CSV data types
 */

interface AzureMonthlyTotal {
    Month: string;
    "Total Cost": number;
}

interface AzureServiceCost {
    Month: string;
    ConsumedService: string;
    Cost: number;
}

interface AzureSubscriptionCost {
    Month: string;
    Subscription: string;
    Cost: number;
}

interface AzureTopResource {
    Month: string;
    ResourceName: string;
    ResourceGroup: string;
    Service: string;
    Cost: number;
}

interface AzurePricingModelCost {
    Month: string;
    PricingModel: string;
    Cost: number;
}

interface AzureChartsProps {
    selectedMonth: string;
    basePath?: string;
}

interface EmptyChartMessageProps {
    message?: string;
}

/*
 * Chart colors
 */

const PRICING_MODEL_COLORS = [
    "#2563eb",
    "#7c3aed",
    "#0d9488",
    "#f59e0b",
    "#e11d48",
    "#64748b",
];

/*
 * Currency formatting
 */

const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const formatFullCurrency = (value: unknown) => {
    const amount = Number(value ?? 0);

    return inrFormatter.format(
        Number.isFinite(amount) ? amount : 0
    );
};

const formatCompactCurrency = (value: unknown) => {
    const amount = Number(value ?? 0);

    if (!Number.isFinite(amount)) {
        return "₹0";
    }

    const absoluteAmount = Math.abs(amount);
    const sign = amount < 0 ? "-" : "";

    if (absoluteAmount >= 10_000_000) {
        return `${sign}₹${(
            absoluteAmount / 10_000_000
        ).toFixed(1)}Cr`;
    }

    if (absoluteAmount >= 100_000) {
        return `${sign}₹${(
            absoluteAmount / 100_000
        ).toFixed(1)}L`;
    }

    if (absoluteAmount >= 1_000) {
        return `${sign}₹${(
            absoluteAmount / 1_000
        ).toFixed(1)}K`;
    }

    return `${sign}₹${absoluteAmount.toFixed(0)}`;
};

/*
 * Display formatting
 */

const formatMonthName = (monthValue: string) => {
    if (!monthValue) {
        return "Latest Month";
    }

    const [year, month] = monthValue.split("-").map(Number);

    if (!year || !month) {
        return monthValue;
    }

    return new Date(year, month - 1, 1).toLocaleString(
        "en-IN",
        {
            month: "long",
            year: "numeric",
        }
    );
};

const truncateLabel = (
    value: string,
    maximumLength = 20
) => {
    if (!value) {
        return "Unknown";
    }

    return value.length > maximumLength
        ? `${value.slice(0, maximumLength)}…`
        : value;
};

/*
 * Shared chart styling
 */

const tooltipStyle = {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    boxShadow: "0 8px 30px rgb(0 0 0 / 0.08)",
    fontSize: "12px",
};

const chartCardClass =
    "border border-muted/50 bg-card/60 shadow-sm " +
    "backdrop-blur-md transition-all duration-300 " +
    "hover:shadow-md";

export function AzureCharts({
    selectedMonth,
    basePath = "/data/azure",
}: AzureChartsProps) {
    /*
     * Load processed CSV files.
     */

    const { data: monthlyTotals } =
        useCsv<AzureMonthlyTotal>(
            `${basePath}/azure_usage_monthly_totals.csv`
        );

    const { data: serviceCosts } =
        useCsv<AzureServiceCost>(
            `${basePath}/azure_usage_by_service.csv`
        );

    const { data: subscriptionCosts } =
        useCsv<AzureSubscriptionCost>(
            `${basePath}/azure_usage_by_subscription.csv`
        );

    const { data: topResources } =
        useCsv<AzureTopResource>(
            `${basePath}/azure_usage_top_resources.csv`
        );

    const { data: pricingModelCosts } =
        useCsv<AzurePricingModelCost>(
            `${basePath}/azure_usage_by_pricing_model.csv`
        );

    /*
     * If selectedMonth is empty, use the latest month
     * available in the monthly totals CSV.
     */

    const effectiveMonth = useMemo(() => {
        if (selectedMonth) {
            return selectedMonth;
        }

        const months = monthlyTotals
            .map((row) => row.Month)
            .filter(Boolean)
            .sort();

        return months[months.length - 1] ?? "";
    }, [monthlyTotals, selectedMonth]);

    const activeMonthName =
        formatMonthName(effectiveMonth);

    /*
     * Monthly cost trend.
     *
     * The complete history is displayed. The selected month
     * is highlighted using a reference line.
     */

    const trendData = useMemo(() => {
        return [...monthlyTotals]
            .filter(
                (row) =>
                    row.Month &&
                    Number.isFinite(
                        Number(row["Total Cost"])
                    )
            )
            .sort((a, b) =>
                a.Month.localeCompare(b.Month)
            )
            .map((row) => ({
                Month: row.Month,
                Cost: Number(row["Total Cost"]),
            }));
    }, [monthlyTotals]);

    /*
     * Top ten services for the active month.
     */

    const topServiceData = useMemo(() => {
        return serviceCosts
            .filter(
                (row) =>
                    row.Month === effectiveMonth &&
                    Number(row.Cost) > 0
            )
            .map((row) => ({
                name:
                    row.ConsumedService ||
                    "Unknown Service",
                cost: Number(row.Cost),
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 10);
    }, [serviceCosts, effectiveMonth]);

    /*
     * Top ten subscriptions for the active month.
     */

    const topSubscriptionData = useMemo(() => {
        return subscriptionCosts
            .filter(
                (row) =>
                    row.Month === effectiveMonth &&
                    Number(row.Cost) > 0
            )
            .map((row) => ({
                name:
                    row.Subscription ||
                    "Unknown Subscription",
                cost: Number(row.Cost),
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 10);
    }, [subscriptionCosts, effectiveMonth]);

    /*
     * Top ten resources for the active month.
     *
     * azure_usage_top_resources.csv must include Month.
     */

    const topResourceData = useMemo(() => {
        return topResources
            .filter(
                (row) =>
                    row.Month === effectiveMonth &&
                    Number(row.Cost) > 0
            )
            .map((row) => ({
                name:
                    row.ResourceName ||
                    "Unassigned Resource",
                resourceGroup:
                    row.ResourceGroup ||
                    "Unassigned",
                service:
                    row.Service ||
                    "Unknown Service",
                cost: Number(row.Cost),
            }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 10);
    }, [topResources, effectiveMonth]);

    /*
     * Pricing-model distribution for the active month.
     *
     * The Map makes this robust against duplicate pricing-model
     * rows in the CSV.
     */

    const pricingModelData = useMemo(() => {
        const grouped = new Map<string, number>();

        for (const row of pricingModelCosts) {
            if (row.Month !== effectiveMonth) {
                continue;
            }

            const cost = Number(row.Cost);

            if (!Number.isFinite(cost) || cost <= 0) {
                continue;
            }

            const pricingModel =
                row.PricingModel?.trim() ||
                "Unknown";

            grouped.set(
                pricingModel,
                (grouped.get(pricingModel) ?? 0) +
                cost
            );
        }

        return Array.from(grouped.entries())
            .map(([name, cost]) => ({
                name,
                cost,
            }))
            .sort((a, b) => b.cost - a.cost);
    }, [pricingModelCosts, effectiveMonth]);

    const totalPricingModelCost = useMemo(() => {
        return pricingModelData.reduce(
            (sum, row) => sum + row.cost,
            0
        );
    }, [pricingModelData]);

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Monthly cost trend */}

            <Card
                className={`lg:col-span-2 ${chartCardClass}`}
            >
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                        Monthly Cost Trend
                    </CardTitle>

                    <p className="text-xs text-muted-foreground">
                        Total Azure usage cost across all
                        available months
                    </p>
                </CardHeader>

                <CardContent>
                    {trendData.length > 0 ? (
                        <ResponsiveContainer
                            width="100%"
                            height={320}
                        >
                            <AreaChart
                                data={trendData}
                                margin={{
                                    top: 20,
                                    right: 30,
                                    left: 10,
                                    bottom: 5,
                                }}
                            >
                                <defs>
                                    <linearGradient
                                        id="azureCostGradient"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="5%"
                                            stopColor="#2563eb"
                                            stopOpacity={0.3}
                                        />

                                        <stop
                                            offset="95%"
                                            stopColor="#2563eb"
                                            stopOpacity={0}
                                        />
                                    </linearGradient>
                                </defs>

                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e2e8f0"
                                    vertical={false}
                                />

                                <XAxis
                                    dataKey="Month"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={12}
                                    dy={10}
                                />

                                <YAxis
                                    tickFormatter={
                                        formatCompactCurrency
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={12}
                                    width={70}
                                />

                                <Tooltip
                                    contentStyle={
                                        tooltipStyle
                                    }
                                    formatter={(value) => [
                                        formatFullCurrency(
                                            value
                                        ),
                                        "Total Cost",
                                    ]}
                                    labelFormatter={(label) =>
                                        formatMonthName(
                                            String(label)
                                        )
                                    }
                                />

                                {effectiveMonth && (
                                    <ReferenceLine
                                        x={effectiveMonth}
                                        stroke="#2563eb"
                                        strokeDasharray="4 4"
                                        strokeWidth={2}
                                        label={{
                                            value: "Selected",
                                            fill: "#2563eb",
                                            fontSize: 10,
                                            fontWeight: 600,
                                            position: "top",
                                        }}
                                    />
                                )}

                                <Area
                                    type="monotone"
                                    dataKey="Cost"
                                    name="Total Cost"
                                    stroke="#2563eb"
                                    strokeWidth={2.5}
                                    fill="url(#azureCostGradient)"
                                    activeDot={{
                                        r: 6,
                                        fill: "#2563eb",
                                        strokeWidth: 0,
                                    }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyChartMessage />
                    )}
                </CardContent>
            </Card>

            {/* Top services */}

            <Card className={chartCardClass}>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                        Top Services
                    </CardTitle>

                    <p className="text-xs text-muted-foreground">
                        Highest-cost services for{" "}
                        {activeMonthName}
                    </p>
                </CardHeader>

                <CardContent>
                    {topServiceData.length > 0 ? (
                        <ResponsiveContainer
                            width="100%"
                            height={380}
                        >
                            <BarChart
                                data={topServiceData}
                                layout="vertical"
                                margin={{
                                    top: 5,
                                    right: 25,
                                    left: 20,
                                    bottom: 5,
                                }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e2e8f0"
                                    horizontal={false}
                                />

                                <XAxis
                                    type="number"
                                    tickFormatter={
                                        formatCompactCurrency
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={145}
                                    tickFormatter={(value) =>
                                        truncateLabel(
                                            String(value),
                                            20
                                        )
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <Tooltip
                                    contentStyle={
                                        tooltipStyle
                                    }
                                    formatter={(value) => [
                                        formatFullCurrency(
                                            value
                                        ),
                                        "Cost",
                                    ]}
                                    labelFormatter={(label) =>
                                        String(label)
                                    }
                                />

                                <Bar
                                    dataKey="cost"
                                    name="Cost"
                                    fill="#2563eb"
                                    radius={[0, 6, 6, 0]}
                                    barSize={18}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyChartMessage
                            message={`No service cost data is available for ${activeMonthName}.`}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Cost by subscription */}

            <Card className={chartCardClass}>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                        Cost by Subscription
                    </CardTitle>

                    <p className="text-xs text-muted-foreground">
                        Highest-cost subscriptions for{" "}
                        {activeMonthName}
                    </p>
                </CardHeader>

                <CardContent>
                    {topSubscriptionData.length > 0 ? (
                        <ResponsiveContainer
                            width="100%"
                            height={380}
                        >
                            <BarChart
                                data={
                                    topSubscriptionData
                                }
                                layout="vertical"
                                margin={{
                                    top: 5,
                                    right: 25,
                                    left: 20,
                                    bottom: 5,
                                }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e2e8f0"
                                    horizontal={false}
                                />

                                <XAxis
                                    type="number"
                                    tickFormatter={
                                        formatCompactCurrency
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={145}
                                    tickFormatter={(value) =>
                                        truncateLabel(
                                            String(value),
                                            20
                                        )
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <Tooltip
                                    contentStyle={
                                        tooltipStyle
                                    }
                                    formatter={(value) => [
                                        formatFullCurrency(
                                            value
                                        ),
                                        "Cost",
                                    ]}
                                    labelFormatter={(label) =>
                                        String(label)
                                    }
                                />

                                <Bar
                                    dataKey="cost"
                                    name="Cost"
                                    fill="#7c3aed"
                                    radius={[0, 6, 6, 0]}
                                    barSize={18}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyChartMessage
                            message={`No subscription cost data is available for ${activeMonthName}.`}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Cost by pricing model */}

            <Card className={chartCardClass}>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                        Cost by Pricing Model
                    </CardTitle>

                    <p className="text-xs text-muted-foreground">
                        Cost distribution for{" "}
                        {activeMonthName}
                    </p>
                </CardHeader>

                <CardContent>
                    {pricingModelData.length > 0 ? (
                        <div className="flex flex-col items-center gap-5 xl:flex-row">
                            {/* Donut chart */}

                            <div className="relative w-full xl:w-1/2">
                                <ResponsiveContainer
                                    width="100%"
                                    height={280}
                                >
                                    <PieChart>
                                        <Pie
                                            data={
                                                pricingModelData
                                            }
                                            dataKey="cost"
                                            nameKey="name"
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={68}

                                            outerRadius={98}
                                            paddingAngle={2}
                                            stroke="hsl(var(--background))"
                                            strokeWidth={2}
                                        >
                                            {pricingModelData.map(
                                                (
                                                    row,
                                                    index
                                                ) => (
                                                    <Cell
                                                        key={`${row.name}-${index}`}
                                                        fill={
                                                            PRICING_MODEL_COLORS[
                                                            index %
                                                            PRICING_MODEL_COLORS.length
                                                            ]
                                                        }
                                                    />
                                                )
                                            )}
                                        </Pie>

                                        <Tooltip
                                            contentStyle={
                                                tooltipStyle
                                            }
                                            formatter={(
                                                value,
                                                _name,
                                                item
                                            ) => [
                                                    formatFullCurrency(
                                                        value
                                                    ),
                                                    item
                                                        .payload
                                                        ?.name ??
                                                    "Pricing Model",
                                                ]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>

                                {/* Donut center value */}

                                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-xs text-muted-foreground">
                                        Total Cost
                                    </span>

                                    <span
                                        className="mt-1 text-lg font-bold text-foreground"
                                        title={formatFullCurrency(
                                            totalPricingModelCost
                                        )}
                                    >
                                        {formatCompactCurrency(
                                            totalPricingModelCost
                                        )}
                                    </span>
                                </div>
                            </div>

                            {/* Pricing-model legend */}

                            <div className="w-full space-y-1 xl:w-1/2">
                                {pricingModelData.map(
                                    (
                                        row,
                                        index
                                    ) => {
                                        const percentage =
                                            totalPricingModelCost >
                                                0
                                                ? (row.cost /
                                                    totalPricingModelCost) *
                                                100
                                                : 0;

                                        const color =
                                            PRICING_MODEL_COLORS[
                                            index %
                                            PRICING_MODEL_COLORS.length
                                            ];

                                        return (
                                            <div
                                                key={`${row.name}-${index}`}
                                                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
                                            >
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <span
                                                        className="h-3 w-3 shrink-0 rounded-full"
                                                        style={{
                                                            backgroundColor:
                                                                color,
                                                        }}
                                                    />

                                                    <span
                                                        className="truncate text-sm font-medium"
                                                        title={
                                                            row.name
                                                        }
                                                    >
                                                        {
                                                            row.name
                                                        }
                                                    </span>
                                                </div>

                                                <div className="shrink-0 text-right">
                                                    <p className="text-sm font-semibold text-foreground">
                                                        {formatFullCurrency(
                                                            row.cost
                                                        )}
                                                    </p>

                                                    <p className="text-xs text-muted-foreground">
                                                        {percentage.toFixed(
                                                            1
                                                        )}
                                                        %
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    }
                                )}
                            </div>
                        </div>
                    ) : (
                        <EmptyChartMessage
                            message={`No pricing model data is available for ${activeMonthName}.`}
                        />
                    )}
                </CardContent>
            </Card>

            {/* Top individual resources */}

            <Card className={chartCardClass}>
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                        Top Individual Resource Groups
                    </CardTitle>

                    <p className="text-xs text-muted-foreground">
                        Most expensive resources for{" "}
                        {activeMonthName}
                    </p>
                </CardHeader>

                <CardContent>
                    {topResourceData.length > 0 ? (
                        <ResponsiveContainer
                            width="100%"
                            height={400}
                        >
                            <BarChart
                                data={topResourceData}
                                layout="vertical"
                                margin={{
                                    top: 5,
                                    right: 35,
                                    left: 35,
                                    bottom: 5,
                                }}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e2e8f0"
                                    horizontal={false}
                                />

                                <XAxis
                                    type="number"
                                    tickFormatter={
                                        formatCompactCurrency
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <YAxis
                                    type="category"
                                    dataKey="resourceGroup"
                                    width={180}
                                    tickFormatter={(value) =>
                                        truncateLabel(
                                            String(value),
                                            24
                                        )
                                    }
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                />

                                <Tooltip
                                    contentStyle={
                                        tooltipStyle
                                    }
                                    formatter={(value) => [
                                        formatFullCurrency(
                                            value
                                        ),
                                        "Cost",
                                    ]}
                                    labelFormatter={(label) =>
                                        String(label)
                                    }
                                />

                                <Bar
                                    dataKey="cost"
                                    name="Cost"
                                    fill="#0d9488"
                                    radius={[0, 6, 6, 0]}
                                    barSize={19}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyChartMessage
                            message={`No resource cost data is available for ${activeMonthName}.`}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function EmptyChartMessage({
    message = "No cost data is available for this selection.",
}: EmptyChartMessageProps) {
    return (
        <div className="flex h-[320px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {message}
        </div>
    );
}
