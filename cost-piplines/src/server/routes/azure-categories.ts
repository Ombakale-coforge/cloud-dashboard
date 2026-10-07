/**
 * src/server/routes/azure-categories.ts
 *
 * FinOps category mappings for Azure services, providing 1:1 parity
 * with AWS service category breakdowns.
 */

export const AZURE_CATEGORY_RULES: Array<[string, string[]]> = [
    ['AI & Cognitive Services', ['openai', 'search', 'cognitive', 'bot', 'machine learning', 'vision', 'speech']],
    ['Compute', ['virtual machines', 'app service', 'functions', 'container', 'batch', 'kubernetes', 'aks', 'cloud services']],
    ['Storage', ['storage', 'backup', 'data lake', 'files', 'archive']],
    ['Database', ['sql', 'cosmos', 'mysql', 'postgresql', 'redis', 'synapse', 'database']],
    ['Networking', ['virtual network', 'vpn', 'expressroute', 'application gateway', 'dns', 'bandwidth', 'load balancer', 'firewall', 'front door', 'ip address']],
    ['Security & Identity', ['key vault', 'defender', 'sentinel', 'entra', 'active directory', 'security center']],
    ['Monitoring & Management', ['monitor', 'log analytics', 'application insights', 'automation', 'service bus']],
    ['Analytics', ['event hubs', 'stream analytics', 'data factory', 'fabric', 'databricks', 'hdinsight', 'kusto']],
];

export function categorizeAzureService(serviceName: string): string {
    const lower = (serviceName || '').toLowerCase();
    for (const [category, keywords] of AZURE_CATEGORY_RULES) {
        if (keywords.some((kw) => lower.includes(kw))) {
            return category;
        }
    }
    return 'Other';
}
