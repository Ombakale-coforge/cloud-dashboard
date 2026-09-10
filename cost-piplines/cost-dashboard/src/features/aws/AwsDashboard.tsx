import { KpiCards } from "@/components/KpiCards";
import { ChartsSection } from "@/components/ChartsSection";
import { DataTables } from "@/components/DataTables";

interface AwsDashboardProps {
    selectedMonth: string;
    basePath: string;
}

export function AwsDashboard({ selectedMonth, basePath }: AwsDashboardProps) {
    return (
        <div className="space-y-8">
            <KpiCards selectedMonth={selectedMonth} basePath={basePath} />
            <ChartsSection selectedMonth={selectedMonth} basePath={basePath} />
            <DataTables selectedMonth={selectedMonth} basePath={basePath} />
        </div>
    );
}
