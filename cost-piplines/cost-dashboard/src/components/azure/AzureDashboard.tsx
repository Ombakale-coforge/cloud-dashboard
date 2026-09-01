import { AzureKpiCards } from "@/components/azure/AzureKpiCards";
import { AzureCharts } from "@/components/azure/AzureCharts";
import { AzureDataTables } from "@/components/azure/AzureDataTables";

interface AzureDashboardProps {
    selectedMonth: string;
    basePath?: string;
}

export function AzureDashboard({ selectedMonth, basePath = "/data/azure" }: AzureDashboardProps) {
    return (
        <div className="space-y-6">
            <AzureKpiCards selectedMonth={selectedMonth} basePath={basePath} />
            <AzureCharts selectedMonth={selectedMonth} basePath={basePath} />
            <AzureDataTables selectedMonth={selectedMonth} basePath={basePath} />
        </div>
    );
}
