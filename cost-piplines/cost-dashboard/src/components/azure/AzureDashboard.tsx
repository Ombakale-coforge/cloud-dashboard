import { AzureKpiCards } from "@/components/azure/AzureKpiCards";
import { AzureCharts } from "@/components/azure/AzureCharts";
import { AzureDataTables } from "@/components/azure/AzureDataTables";

interface AzureDashboardProps {
    selectedMonth: string;
}

export function AzureDashboard({ selectedMonth }: AzureDashboardProps) {
    return (
        <div className="space-y-6">
            <AzureKpiCards selectedMonth={selectedMonth} />
            <AzureCharts selectedMonth={selectedMonth} />
            <AzureDataTables selectedMonth={selectedMonth} />
        </div>
    );
}
