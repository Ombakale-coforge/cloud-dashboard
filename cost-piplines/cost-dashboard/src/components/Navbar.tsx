import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Cloud, Sun, Moon, CalendarDays, ChevronDown } from "lucide-react";

export interface NavbarProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  months: string[];
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

export function Navbar({
  theme,
  onToggleTheme,
  months = [],
  selectedMonth = "",
  onMonthChange = () => {},
}: NavbarProps) {
  // Format Month string (e.g. "2026-07" to "July 2026")
  const formatMonthName = (mStr: string) => {
    if (!mStr) return "Select Month";
    const [year, month] = mStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-muted/50 bg-background/80 backdrop-blur-md px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/10">
          <Cloud className="h-5 w-5 animate-pulse" />
        </div>
        <div className="space-y-0.5">
          <h1 className="text-lg font-extrabold tracking-tight bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-600 bg-clip-text text-transparent">
            Cloud Cost Intelligence
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live AWS Cost Sync
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Month Selector Dropdown */}
        {months.length > 0 && (
          <div className="relative flex items-center gap-2 bg-muted/40 hover:bg-muted/60 border border-muted/80 rounded-xl px-3 py-1.5 transition-colors cursor-pointer select-none group">
            <CalendarDays className="h-4 w-4 text-indigo-500" />
            <select
              value={selectedMonth}
              onChange={(e) => onMonthChange(e.target.value)}
              className="appearance-none bg-transparent pr-6 text-xs font-semibold text-foreground focus:outline-none cursor-pointer"
            >
              {months.map((m) => (
                <option key={m} value={m} className="bg-background text-foreground">
                  {formatMonthName(m)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 h-3 w-3 text-muted-foreground pointer-events-none group-hover:text-foreground transition-colors" />
          </div>
        )}

        {/* Tab Controls (AWS/Azure) */}
        <Tabs defaultValue="aws" className="w-auto">
          <TabsList className="bg-muted/60 p-0.5">
            <TabsTrigger value="aws" className="px-4 py-1.5 text-xs font-semibold">AWS</TabsTrigger>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="azure" disabled className="px-4 py-1.5 text-xs font-semibold">
                    Azure
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </TabsList>
        </Tabs>

        {/* Dark Mode Switch Toggle Button */}
        <button
          onClick={onToggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-muted/80 bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200"
          title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
}
