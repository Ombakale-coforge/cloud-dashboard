import { useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type {
    AzureMonthlyTotal,
    AzureCategoryCost,
    AzureProductCost,
    AzureCustomerCost,
    AzureChargeTypeCost,
} from "@/lib/types";
import {
    AreaChart,
    Area,
    BarChart,
    Bar,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from "recharts";

// Same formatters as ChartsSection.tsx
const formatCompactCurrency = (value: unknown) => {
    const num = typeof value === "number" ? value : Number(value ?? 0);
    if (num >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}k`;
    return `$${num}`;
};

const formatFullCurrency = (value: unknown) => {
    const num = typeof value === "number" ? value : Number(value ?? 0);
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

// Same 13-shade palette as ChartsSection.tsx
const PROFESSIONAL_COLORS = [
    "#4f46e5", // Indigo 600
    "#6366f1", // Indigo 500
    "#7c3aed", // Violet 600
    "#8b5cf6", // Violet 500
    "#0284c7", // Sky 700
    "#0ea5e9", // Sky 600
    "#0d9488", // Teal 600
    "#14b8a6", // Teal 500
    "#059669", // Emerald 600
    "#10b981", // Emerald 500
    "#64748b", // Slate 500
    "#94a3b8", // Slate 400
    "#cbd5e1", // Slate 300
];

const tooltipStyle = {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    boxShadow: "0 8px 30px rgb(0 0 0 / 0.08)",
    fontSize: "12px",
    fontFamily: "inherit",
};

const formatMonthName = (mStr: string) => {
    if (!mStr) return "";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
};

interface AzureChartsProps {
    selectedMonth: string;
}

export function AzureCharts({ selectedMonth }: AzureChartsProps) {
    const { data: monthlyTotals } = useCsv<AzureMonthlyTotal>("/data/azure/azure_monthly_totals.csv");
    const { data: categoryData } = useCsv<AzureCategoryCost>("/data/azure/azure_cost_by_category.csv");
    const { data: productData } = useCsv<AzureProductCost>("/data/azure/azure_cost_by_product.csv");
    const { data: customerData } = useCsv<AzureCustomerCost>("/data/azure/azure_cost_by_customer.csv");
    const { data: chargeData } = useCsv<AzureChargeTypeCost>("/data/azure/azure_cost_by_charge_type.csv");

    // All five CSVs come from the same source transactions, so their month
    // sets line up - derive the effective month once from the trend data.
    const effectiveMonth = useMemo(() => {
        if (selectedMonth) return selectedMonth;
        const months = [...new Set(monthlyTotals.map((d) => d.Month))].sort();
        return months[months.length - 1] || "";
    }, [monthlyTotals, selectedMonth]);

    const activeMonthName = formatMonthName(effectiveMonth) || "Latest Month";

    // Monthly Cost Trend - spans every month; the selector marks a point on
    // it via ReferenceLine rather than truncating the series.
    const trendData = useMemo(
        () =>
            [...monthlyTotals]
                .sort((a, b) => a.Month.localeCompare(b.Month))
                .map((d) => ({ Month: d.Month, "Total Cost": d["Total Cost"] })),
        [monthlyTotals]
    );

    const categoryChartData = useMemo(
        () =>
            categoryData
                .filter((d) => d.Month === effectiveMonth)
                .sort((a, b) => b.Cost - a.Cost),
        [categoryData, effectiveMonth]
    );

    const totalCategoryCost = useMemo(
        () => categoryChartData.reduce((sum, c) => sum + c.Cost, 0),
        [categoryChartData]
    );

    const chargeChartData = useMemo(
        () =>
            chargeData
                .filter((d) => d.Month === effectiveMonth)
                .sort((a, b) => b.Cost - a.Cost),
        [chargeData, effectiveMonth]
    );

    const totalChargeCost = useMemo(
        () => chargeChartData.reduce((sum, c) => sum + c.Cost, 0),
        [chargeChartData]
    );

    const topProductsData = useMemo(
        () =>
            productData
                .filter((d) => d.Month === effectiveMonth && d.Cost > 0)
                .sort((a, b) => b.Cost - a.Cost)
                .slice(0, 10),
        [productData, effectiveMonth]
    );

    const topCustomersData = useMemo(
        () =>
            customerData
                .filter((d) => d.Month === effectiveMonth && d.Cost > 0)
                .sort((a, b) => b.Cost - a.Cost)
                .slice(0, 10),
        [customerData, effectiveMonth]
    );

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Monthly Cost Trend - full width */}
            <Card className="lg:col-span-2 border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight text-foreground">Monthly Cost Trend</CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={trendData} margin={{ top: 20, right: 35, left: 15, bottom: 5 }}>
                            <defs>
                                <linearGradient id="azureAreaGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="Month" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                            <YAxis
                                stroke="#94a3b8"
                                fontSize={12}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={formatCompactCurrency}
                                width={55}
                                dx={-5}
                            />
                            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatFullCurrency(value), "Total Cost"]} />
                            {selectedMonth && (
                                <ReferenceLine
                                    x={selectedMonth}
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
                                stroke="#4f46e5"
                                fill="url(#azureAreaGradient)"
                                strokeWidth={2.5}
                                activeDot={{ r: 6, strokeWidth: 0, fill: "#4f46e5" }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Top Products */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                        Top Products ({activeMonthName})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={topProductsData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 10 }}>
                            <defs>
                                <linearGradient id="azureProductGradient" x1="0" y1="0" x2="1" y2="0">
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
                                dataKey="Product"
                                width={130}
                                stroke="#94a3b8"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(t) => (t.length > 15 ? `${t.slice(0, 15)}...` : t)}
                                dx={-5}
                            />
                            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatFullCurrency(value), "Cost"]} />
                            <Bar dataKey="Cost" fill="url(#azureProductGradient)" radius={[0, 6, 6, 0]} barSize={16} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Top Customers */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                        Top Customers ({activeMonthName})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={topCustomersData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 10 }}>
                            <defs>
                                <linearGradient id="azureCustomerGradient" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor="#0d9488" stopOpacity={0.8} />
                                    <stop offset="100%" stopColor="#5eead4" stopOpacity={1} />
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
                                dataKey="Customer"
                                width={130}
                                stroke="#94a3b8"
                                fontSize={11}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(t) => (t.length > 15 ? `${t.slice(0, 15)}...` : t)}
                                dx={-5}
                            />
                            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatFullCurrency(value), "Cost"]} />
                            <Bar dataKey="Cost" fill="url(#azureCustomerGradient)" radius={[0, 6, 6, 0]} barSize={16} />
                        </BarChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Cost by Category - donut + scrollable legend, same treatment as ChartsSection.tsx */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md flex flex-col justify-between">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                        Cost by Category ({activeMonthName})
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 py-6 flex-1">
                    <div className="w-full md:w-1/2 flex justify-center">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie data={categoryChartData} dataKey="Cost" nameKey="Category" innerRadius={65} outerRadius={90} paddingAngle={1.5}>
                                    {categoryChartData.map((_, i) => (
                                        <Cell key={i} fill={PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length]} className="outline-none stroke-background stroke-2" />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatFullCurrency(value), "Cost"]} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="w-full md:w-1/2 flex flex-col justify-center">
                        <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1 select-none scrollbar-thin">
                            {categoryChartData.map((c, i) => {
                                const pct = totalCategoryCost > 0 ? (c.Cost / totalCategoryCost) * 100 : 0;
                                const color = PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length];
                                return (
                                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-muted/15 last:border-0 hover:bg-muted/10 px-2 rounded transition-colors">
                                        <div className="flex items-center gap-2 truncate">
                                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                            <span className="font-medium text-foreground truncate" title={c.Category}>
                                                {c.Category}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-right shrink-0">
                                            <span className="font-semibold text-foreground">{formatFullCurrency(c.Cost)}</span>
                                            <span className="text-xs text-muted-foreground w-8 font-medium">{pct.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Charge Type - same donut+legend treatment, smaller/secondary */}
            <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md flex flex-col justify-between">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                        Charge Type ({activeMonthName})
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 py-6 flex-1">
                    <div className="w-full md:w-1/2 flex justify-center">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie data={chargeChartData} dataKey="Cost" nameKey="ChargeType" innerRadius={65} outerRadius={90} paddingAngle={1.5}>
                                    {chargeChartData.map((_, i) => (
                                        <Cell key={i} fill={PROFESSIONAL_COLORS[(i + 4) % PROFESSIONAL_COLORS.length]} className="outline-none stroke-background stroke-2" />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatFullCurrency(value), "Cost"]} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="w-full md:w-1/2 flex flex-col justify-center">
                        <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1 select-none scrollbar-thin">
                            {chargeChartData.map((c, i) => {
                                const pct = totalChargeCost > 0 ? (c.Cost / totalChargeCost) * 100 : 0;
                                const color = PROFESSIONAL_COLORS[(i + 4) % PROFESSIONAL_COLORS.length];
                                return (
                                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-muted/15 last:border-0 hover:bg-muted/10 px-2 rounded transition-colors">
                                        <div className="flex items-center gap-2 truncate">
                                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                                            <span className="font-medium text-foreground truncate" title={c.ChargeType}>
                                                {c.ChargeType}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 text-right shrink-0">
                                            <span className="font-semibold text-foreground">{formatFullCurrency(c.Cost)}</span>
                                            <span className="text-xs text-muted-foreground w-8 font-medium">{pct.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
