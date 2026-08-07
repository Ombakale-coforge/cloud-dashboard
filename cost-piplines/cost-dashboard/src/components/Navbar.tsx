import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Cloud, CalendarDays, ChevronDown } from "lucide-react";

export interface NavbarProps {
  months: string[];
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

export function Navbar({
  months = [],
  selectedMonth = "",
  onMonthChange = () => {},
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
    <header className="sticky top-0 z-50 flex items-center justify-between border-b bg-background/80 px-6 py-4 backdrop-blur">
      {/* Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Cloud className="h-6 w-6 text-primary" />
        </div>

        <div>
          <h1 className="text-xl font-bold">Cloud Cost Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Live AWS Cost Sync
          </p>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-4">
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
        <Tabs defaultValue="aws" className="w-auto">
          <TabsList className="bg-muted/60 p-0.5">
            <TabsTrigger
              value="aws"
              className="px-4 py-1.5 text-xs font-semibold"
            >
              AWS
            </TabsTrigger>

            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger
                    value="azure"
                    disabled
                    className="px-4 py-1.5 text-xs font-semibold"
                  >
                    Azure
                  </TabsTrigger>
                </span>
              </TooltipTrigger>

              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </TabsList>
        </Tabs>
      </div>
    </header>
  );
}