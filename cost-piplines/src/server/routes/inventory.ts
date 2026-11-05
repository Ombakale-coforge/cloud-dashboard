import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';

const router = Router();

export interface InventoryItem {
  id: string;
  name: string;
  cloud: 'aws' | 'azure';
  service: string;
  resourceGroupOrRegion: string;
  accountOrSubscription: string;
  accountOrSubscriptionId: string;
  month: string;
  cost: number;
  status: string;
  category: string;
}

// Map service to high-level category
function getCategory(serviceName: string): string {
  const s = (serviceName || '').toLowerCase();
  if (s.includes('virtual machine') || s.includes('ec2') || s.includes('compute') || s.includes('batch') || s.includes('lambda') || s.includes('function')) {
    return 'Compute';
  }
  if (s.includes('storage') || s.includes('s3') || s.includes('blob') || s.includes('disk') || s.includes('ebs') || s.includes('file')) {
    return 'Storage';
  }
  if (s.includes('sql') || s.includes('rds') || s.includes('database') || s.includes('cosmos') || s.includes('dynamodb') || s.includes('aurora')) {
    return 'Database';
  }
  if (s.includes('network') || s.includes('vpc') || s.includes('gateway') || s.includes('bandwidth') || s.includes('dns') || s.includes('ip') || s.includes('traffic')) {
    return 'Networking';
  }
  if (s.includes('cognitive') || s.includes('openai') || s.includes('ai') || s.includes('machine learning') || s.includes('sagemaker') || s.includes('bedrock')) {
    return 'AI & ML';
  }
  if (s.includes('monitor') || s.includes('cloudwatch') || s.includes('log') || s.includes('insight') || s.includes('security') || s.includes('guardduty')) {
    return 'Management & Security';
  }
  return 'Other Services';
}

router.get('/', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_NOT_CONNECTED', message: 'SQL Server database is not connected.' });
    }

    const cloudFilter = String(req.query.cloud || 'all').toLowerCase(); // 'all' | 'aws' | 'azure'
    const search = String(req.query.search || '').trim().toLowerCase();
    const targetMonth = req.query.month ? String(req.query.month).trim() : null;

    const inventory: InventoryItem[] = [];

    // =========================================================================
    // 1. Fetch Azure Resources
    // =========================================================================
    if (cloudFilter === 'all' || cloudFilter === 'azure') {
      try {
        const latestAzureRun =
          (await prisma.azureReportRun.findFirst({
            where: { status: 'success' },
            orderBy: { id: 'desc' },
          })) ||
          (await prisma.azureReportRun.findFirst({
            orderBy: { id: 'desc' },
          }));

        if (latestAzureRun) {
          const runId = latestAzureRun.id;

          // Fetch top resources
          const topResources = await prisma.azureReportTopResources.findMany({
            where: {
              reportRunId: runId,
              ...(targetMonth ? { month: targetMonth } : {}),
            },
            orderBy: { cost: 'desc' },
            take: 300,
          });

          // Also get subscription mapping for context
          const subs = await prisma.azureReportBySubscription.findMany({
            where: { reportRunId: runId },
            distinct: ['subscription'],
          });
          const defaultSubName = subs[0]?.subscription || 'Primary Subscription';

          topResources.forEach((r, idx) => {
            inventory.push({
              id: `azure-${r.id || idx}`,
              name: r.resourceName || 'Unnamed Azure Resource',
              cloud: 'azure',
              service: r.service || 'Cloud Service',
              resourceGroupOrRegion: r.resourceGroup || 'Default RG',
              accountOrSubscription: defaultSubName,
              accountOrSubscriptionId: defaultSubName,
              month: r.month,
              cost: Number(r.cost),
              status: 'ACTIVE',
              category: getCategory(r.service),
            });
          });
        }
      } catch (azureErr: any) {
        console.warn('⚠️ [Inventory] Could not fetch Azure resources from DB:', azureErr.message);
      }
    }

    // =========================================================================
    // 2. Fetch AWS Resources (from cost by service and linked accounts)
    // =========================================================================
    if (cloudFilter === 'all' || cloudFilter === 'aws') {
      try {
        const latestAwsRun = await prisma.awsReportRun.findFirst({
          where: { status: 'success' },
          orderBy: { id: 'desc' },
        });

        if (latestAwsRun) {
          const runId = latestAwsRun.id;
          const currentMonth = latestAwsRun.currentMonth || targetMonth || new Date().toISOString().slice(0, 7);

          const [linkedAccounts, costByAccount, costByService] = await Promise.all([
            prisma.awsLinkedAccount.findMany({
              where: { accountId: latestAwsRun.accountId },
            }),
            prisma.awsCostByLinkedAccount.findMany({
              where: {
                reportRunId: runId,
                month: targetMonth || currentMonth,
              },
              orderBy: { cost: 'desc' },
            }),
            prisma.awsCostByService.findMany({
              where: {
                reportRunId: runId,
                month: targetMonth || currentMonth,
              },
              orderBy: { cost: 'desc' },
              take: 100,
            }),
          ]);

          const linkedMap = new Map<string, string>();
          linkedAccounts.forEach((la) => {
            linkedMap.set(la.linkedAccountId, la.name);
          });

          // Surface prominent services per account / service
          costByService.forEach((s, idx) => {
            inventory.push({
              id: `aws-svc-${s.id || idx}`,
              name: `${s.service} (Fleet)`,
              cloud: 'aws',
              service: s.service,
              resourceGroupOrRegion: 'Global / Multi-Region',
              accountOrSubscription: 'AWS Organization Payer',
              accountOrSubscriptionId: latestAwsRun.accountName || 'Primary Org',
              month: s.month,
              cost: Number(s.cost),
              status: 'ACTIVE',
              category: getCategory(s.service),
            });
          });

          // Surface top linked accounts
          costByAccount.forEach((a, idx) => {
            const accName = linkedMap.get(a.linkedAccount) || a.linkedAccount;
            inventory.push({
              id: `aws-acc-${a.id || idx}`,
              name: `${accName} Workspace`,
              cloud: 'aws',
              service: 'Member Account Infrastructure',
              resourceGroupOrRegion: 'AWS Organizations Member',
              accountOrSubscription: accName,
              accountOrSubscriptionId: a.linkedAccount,
              month: a.month,
              cost: Number(a.cost),
              status: 'ACTIVE',
              category: 'Compute & Workload',
            });
          });
        }
      } catch (awsErr: any) {
        console.warn('⚠️ [Inventory] Could not fetch AWS resources from DB:', awsErr.message);
      }
    }

    // Apply text search filter if provided
    let filtered = inventory;
    if (search) {
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(search) ||
          item.service.toLowerCase().includes(search) ||
          item.resourceGroupOrRegion.toLowerCase().includes(search) ||
          item.accountOrSubscription.toLowerCase().includes(search) ||
          item.category.toLowerCase().includes(search)
      );
    }

    // Sort by cost descending
    filtered.sort((a, b) => b.cost - a.cost);

    // Compute summary KPI aggregations
    const totalCost = filtered.reduce((sum, item) => sum + item.cost, 0);
    const categoryCounts: Record<string, number> = {};
    const cloudCounts: Record<string, number> = { aws: 0, azure: 0 };
    const distinctResourceGroups = new Set<string>();

    filtered.forEach((item) => {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      cloudCounts[item.cloud] = (cloudCounts[item.cloud] || 0) + 1;
      if (item.resourceGroupOrRegion) distinctResourceGroups.add(item.resourceGroupOrRegion);
    });

    return res.json({
      success: true,
      count: filtered.length,
      summary: {
        totalAssets: filtered.length,
        totalMonthlyCost: Number(totalCost.toFixed(2)),
        distinctResourceGroupsCount: distinctResourceGroups.size,
        awsAssetsCount: cloudCounts.aws,
        azureAssetsCount: cloudCounts.azure,
        categoryCounts,
      },
      data: filtered,
    });
  } catch (err: any) {
    console.error('Error in /api/inventory:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

export default router;
