import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cloud, CalendarDays, ChevronDown, Plus } from "lucide-react";

export type Provider = "aws" | "azure";

export interface NavbarProps {
    months: string[];
    selectedMonth: string;
    onMonthChange: (month: string) => void;
    activeProvider: Provider;
    onProviderChange: (provider: Provider) => void;
  onScrollToForm?: () => void;
}

export function Navbar({
    months = [],
    selectedMonth = "",
    onMonthChange = () => { },
    activeProvider = "aws",
    onProviderChange = () => { },
  onScrollToForm,
}: NavbarProps) {
    // Format Month string (e.g. "2026-07" to "July 2026")
    const formatMonthName = (mStr: string) => {
        if (!mStr) return "Select Month";

        const [year, month] = mStr.split("-");
        const date = new Date(Number(year), Number(month) - 1, 1);

        return date.toLocaleString("default", {
            month: "long",
            year: "numeric",
        });
    };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/80 px-6 py-3.5 backdrop-blur">
      {/* Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
          <Cloud className="h-6 w-6 text-primary" />
        </div>

                <div>
                    <h1 className="text-xl font-bold">Cloud Cost Intelligence</h1>
                    <p className="text-sm text-muted-foreground">
                        {activeProvider === "aws" ? "Live AWS Cost Sync" : "Live Azure Cost Sync"}
                    </p>
                </div>
            </div>

      {/* Right Side */}
      <div className="flex items-center gap-3">
        {/* Quick Add Request Button */}
        {onScrollToForm && (
          <button
            onClick={onScrollToForm}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 text-xs font-semibold shadow-sm transition-all"
          >
            <Plus size={14} />
            <span>New Account Request</span>
          </button>
        )}

        {/* Month Selector */}
        {months.length > 0 && (
          <div className="relative flex items-center gap-2 rounded-xl border border-muted/80 bg-muted/40 px-3 py-1.5 transition-colors">
            <CalendarDays className="h-4 w-4 text-indigo-500" />

                        <select
                            value={selectedMonth}
                            onChange={(e) => onMonthChange(e.target.value)}
                            className="appearance-none bg-transparent pr-6 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
                        >
                            {months.map((m) => (
                                <option
                                    key={m}
                                    value={m}
                                    className="bg-background text-foreground"
                                >
                                    {formatMonthName(m)}
                                </option>
                            ))}
                        </select>

                        <ChevronDown className="pointer-events-none absolute right-3 h-3 w-3 text-muted-foreground" />
                    </div>
                )}

                {/* AWS / Azure Tabs */}
                <Tabs
                    value={activeProvider}
                    onValueChange={(v) => onProviderChange(v as Provider)}
                    className="w-auto"
                >
                    <TabsList className="bg-muted/60 p-0.5">
                        <TabsTrigger
                            value="aws"
                            className="px-4 py-1.5 text-xs font-semibold"
                        >
                            AWS
                        </TabsTrigger>

                        <TabsTrigger
                            value="azure"
                            className="px-4 py-1.5 text-xs font-semibold"
                        >
                            Azure
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>
        </header>
    );
}
