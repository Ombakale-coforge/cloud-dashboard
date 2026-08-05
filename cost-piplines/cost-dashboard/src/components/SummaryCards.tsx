import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useCsv } from "@/lib/useCsv";
import type { LinkedAccountCost, TopService, RecurringRow } from "@/lib/types";
import { Building2, TrendingUp, Repeat } from "lucide-react";

export function SummaryCards() {
  const { data: accounts } = useCsv<LinkedAccountCost>(
    "/data/Cost_By_Linked_Account.csv",
  );
  const { data: topServices } = useCsv<TopService>("/data/top_10_services.csv");
  const { data: recurring } = useCsv<RecurringRow>(
    "/data/recurring_vs_onetime.csv",
  );

  const recurringCount = recurring.filter(
    (r) => r.Classification === "Recurring",
  ).length;
  const oneTimeCount = recurring.filter(
    (r) => r.Classification === "One-time / Sporadic",
  ).length;
  const occasionalCount = recurring.filter(
    (r) => r.Classification === "Occasional",
  ).length;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Building2 className="text-sky-500" size={18} />
          <CardTitle className="text-sm text-muted-foreground">
            Top Linked Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-semibold">
            {accounts[0]?.["Linked Account"] ?? "—"}
          </div>
          <div className="text-sm text-muted-foreground">
            ${accounts[0]?.Cost.toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <TrendingUp className="text-violet-500" size={18} />
          <CardTitle className="text-sm text-muted-foreground">
            Most-Used Service
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xl font-semibold">
            {topServices[0]?.Service ?? "—"}
          </div>
          <div className="text-sm text-muted-foreground">
            ${topServices[0]?.["Total Cost"].toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Repeat className="text-amber-500" size={18} />
          <CardTitle className="text-sm text-muted-foreground">
            Recurring vs One-Time
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div>
            Recurring:{" "}
            <span className="font-semibold text-emerald-600">
              {recurringCount}
            </span>
          </div>
          <div>
            Occasional:{" "}
            <span className="font-semibold text-amber-600">
              {occasionalCount}
            </span>
          </div>
          <div>
            One-time:{" "}
            <span className="font-semibold text-slate-500">{oneTimeCount}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
