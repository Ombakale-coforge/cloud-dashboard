import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type {
  MonthTotal,
  MomChange,
  TopService,
  CategoryCost,
} from "@/lib/types";
import { useMemo } from "react";
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

// Premium compact currency formatter (e.g. $300k instead of $300000)
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

// 13 professional, harmonious shades from Indigo/Blue to Teal/Green to Slate-Gray
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

interface ChartsSectionProps {
  selectedMonth: string;
  basePath?: string;
}

export function ChartsSection({ selectedMonth, basePath = "/data" }: ChartsSectionProps) {
  const { data: monthly } = useCsv<MonthTotal>(
    `${basePath}/monthly_totals_last_6_months.csv`,
  );
  const { data: mom } = useCsv<MomChange>(`${basePath}/mom_change.csv`);
  const { data: topServices } = useCsv<TopService>(`${basePath}/top_10_services.csv`);
  const { data: categories } = useCsv<CategoryCost>(
    `${basePath}/category_monthly_costs.csv`,
  );

  const trendData = useMemo(() => {
    return monthly.map((m) => {
      const momRow = mom.find((x) => x.Month === m.Month);
      return {
        Month: m.Month,
        "Total Cost": m["Total Cost"],
        "MoM % Change": momRow ? Number(momRow["MoM % Change"]) || 0 : 0,
      };
    });
  }, [monthly, mom]);

  // Dynamically load categories matching selectedMonth, sorted by cost descending
  const latestCategoryMonth = useMemo(() => {
    if (categories.length === 0) return [];
    
    // Use selectedMonth if available, otherwise default to the latest month in dataset
    const targetMonth = selectedMonth || [...new Set(categories.map((c) => c.Month))].sort().pop();
    if (!targetMonth) return [];

    const rawData = categories.filter((c) => c.Month === targetMonth);
    return [...rawData].sort((a, b) => b.Cost - a.Cost);
  }, [categories, selectedMonth]);

  const totalCategoryCost = useMemo(() => {
    return latestCategoryMonth.reduce((sum, c) => sum + c.Cost, 0);
  }, [latestCategoryMonth]);

  // Format month name for title displaying
  const formatMonthName = (mStr: string) => {
    if (!mStr) return "";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  const activeCategoryMonthName = useMemo(() => {
    if (latestCategoryMonth.length === 0) return "Latest Month";
    return formatMonthName(latestCategoryMonth[0].Month);
  }, [latestCategoryMonth]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* 6 Months Cost Trend */}
      <Card className="lg:col-span-2 border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold tracking-tight text-foreground">Last 6 Months Cost Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            {/* Added generous right margin (35) to prevent label clipping, and left margin (15) to space out Y-axis */}
            <AreaChart data={trendData} margin={{ top: 20, right: 35, left: 15, bottom: 5 }}>
              <defs>
                <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
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
                width={55} // Set width to ensure fully visible compact currency ticks
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
                }}
                formatter={(value) => [formatFullCurrency(value), "Total Cost"]}
              />
              {/* Vertical Reference Line to mark the selected month */}
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
                    offset: 10
                  }} 
                />
              )}
              <Area
                type="monotone"
                dataKey="Total Cost"
                stroke="#6366f1"
                fill="url(#areaGradient)"
                strokeWidth={2.5}
                activeDot={{ r: 6, strokeWidth: 0, fill: "#6366f1" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top 10 Services */}
      <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold tracking-tight text-foreground">Top 10 Services (Cumulative)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            {/* Added standard margins to protect axis values */}
            <BarChart
              data={topServices}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 10, bottom: 10 }}
            >
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                  <stop offset="100%" stopColor="#c084fc" stopOpacity={1}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis 
                type="number" 
                stroke="#94a3b8" 
                fontSize={12} 
                tickLine={false} 
                axisLine={false} 
                tickFormatter={formatCompactCurrency} // Make X axis compact to avoid overlapping
                dy={5}
              />
              <YAxis
                type="category"
                dataKey="Service"
                width={130} // Generous width for service labels
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(t) => t.length > 15 ? `${t.slice(0, 15)}...` : t}
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
                }}
                formatter={(value) => [formatFullCurrency(value), "Total Cost"]}
              />
              <Bar dataKey="Total Cost" fill="url(#barGradient)" radius={[0, 6, 6, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cost by Category */}
      <Card className="border border-muted/50 shadow-sm transition-all duration-300 hover:shadow-md bg-card/60 backdrop-blur-md flex flex-col justify-between">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
            Cost by Category ({activeCategoryMonthName})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row items-center justify-between gap-6 py-6 flex-1">
          {/* Left Column: Clean Donut Chart */}
          <div className="w-full md:w-1/2 flex justify-center">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={latestCategoryMonth}
                  dataKey="Cost"
                  nameKey="Category"
                  innerRadius={65}
                  outerRadius={90}
                  paddingAngle={1.5}
                >
                  {latestCategoryMonth.map((c, i) => (
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
                  }}
                  formatter={(value) => [formatFullCurrency(value), "Cost"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Right Column: Beautiful Scrollable Tabular Legend */}
          <div className="w-full md:w-1/2 flex flex-col justify-center">
            <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1 select-none scrollbar-thin">
              {latestCategoryMonth.map((c, i) => {
                const pct = totalCategoryCost > 0 ? (c.Cost / totalCategoryCost) * 100 : 0;
                const color = PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length];
                return (
                  <div 
                    key={i} 
                    className="flex items-center justify-between text-xs py-1 border-b border-muted/15 last:border-0 hover:bg-muted/10 px-2 rounded transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-medium text-foreground truncate" title={c.Category}>
                        {c.Category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-right shrink-0">
                      <span className="font-semibold text-foreground">
                        {formatFullCurrency(c.Cost)}
                      </span>
                      <span className="text-xs text-muted-foreground w-8 font-medium">
                        {pct.toFixed(0)}%
                      </span>
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
