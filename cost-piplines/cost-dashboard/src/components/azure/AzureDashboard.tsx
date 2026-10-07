import { AzureKpiCards } from "@/components/azure/AzureKpiCards";
import { AzureCharts } from "@/components/azure/AzureCharts";
import { AzureDataTables } from "@/components/azure/AzureDataTables";
import { AzureGovernanceSection } from "@/components/azure/AzureGovernanceSection";

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
            <AzureGovernanceSection selectedMonth={selectedMonth} basePath={basePath} />
        </div>
    );
}
