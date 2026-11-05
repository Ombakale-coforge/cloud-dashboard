import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';
import { ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';

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
  // Compute / Network enrichment properties
  privateIp?: string | null;
  publicIp?: string | null;
  sizeOrType?: string | null;
  powerState?: string | null;
  os?: string | null;
  vpcOrVnet?: string | null;
}

// Map service to high-level category
function getCategory(serviceName: string): string {
  const s = (serviceName || '').toLowerCase();
  if (
    s.includes('virtual machine') ||
    s.includes('ec2') ||
    s.includes('compute') ||
    s.includes('batch') ||
    s.includes('lambda') ||
    s.includes('function')
  ) {
    return 'Compute';
  }
  if (
    s.includes('storage') ||
    s.includes('s3') ||
    s.includes('blob') ||
    s.includes('disk') ||
    s.includes('ebs') ||
    s.includes('file')
  ) {
    return 'Storage';
  }
  if (
    s.includes('sql') ||
    s.includes('rds') ||
    s.includes('database') ||
    s.includes('cosmos') ||
    s.includes('dynamodb') ||
    s.includes('aurora')
  ) {
    return 'Database';
  }
  if (
    s.includes('network') ||
    s.includes('vpc') ||
    s.includes('gateway') ||
    s.includes('bandwidth') ||
    s.includes('dns') ||
    s.includes('ip') ||
    s.includes('traffic')
  ) {
    return 'Networking';
  }
  if (
    s.includes('cognitive') ||
    s.includes('openai') ||
    s.includes('ai') ||
    s.includes('machine learning') ||
    s.includes('sagemaker') ||
    s.includes('bedrock')
  ) {
    return 'AI & ML';
  }
  if (
    s.includes('monitor') ||
    s.includes('cloudwatch') ||
    s.includes('log') ||
    s.includes('insight') ||
    s.includes('security') ||
    s.includes('guardduty')
  ) {
    return 'Management & Security';
  }
  return 'Other Services';
}

// Fetch live Azure VM network & hardware details via Azure Resource Graph
async function fetchAzureLiveComputeDetails(): Promise<Map<string, Partial<InventoryItem>>> {
  const map = new Map<string, Partial<InventoryItem>>();

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return map;
  }

  try {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const client = new ResourceGraphClient(credential);

    const query = `
      Resources
      | where type =~ 'microsoft.compute/virtualmachines'
      | extend vmSize = tostring(properties.hardwareProfile.vmSize)
      | extend osType = tostring(properties.storageProfile.osDisk.osType)
      | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
      | project id, name, resourceGroup, subscriptionId, location, vmSize, osType, powerState, properties.networkProfile.networkInterfaces
    `;

    const result = await client.resources({ query });

    // Also query network interfaces to resolve private/public IPs
    const nicQuery = `
      Resources
      | where type =~ 'microsoft.network/networkinterfaces'
      | project id, ipConfigs = properties.ipConfigurations
    `;
    const nicResult = await client.resources({ query: nicQuery });
    const nicMap = new Map<string, { privateIp?: string; publicIp?: string; vnet?: string }>();

    if (nicResult?.data && Array.isArray(nicResult.data)) {
      for (const nic of nicResult.data) {
        const idLower = (nic.id || '').toLowerCase();
        const firstConfig = nic.ipConfigs?.[0];
        if (firstConfig) {
          const privateIp = firstConfig.properties?.privateIPAddress;
          const subnetId = firstConfig.properties?.subnet?.id || '';
          let vnet = '';
          const vnetMatch = subnetId.match(/virtualNetworks\/([^/]+)/i);
          if (vnetMatch) vnet = vnetMatch[1];

          nicMap.set(idLower, { privateIp, vnet });
        }
      }
    }

    if (result?.data && Array.isArray(result.data)) {
      for (const vm of result.data) {
        const vmName = (vm.name || '').toLowerCase();
        const vmId = (vm.id || '').toLowerCase();

        let privateIp: string | null = null;
        let vnet: string | null = null;

        const nics = vm.networkInterfaces;
        if (Array.isArray(nics) && nics.length > 0) {
          const nicId = (nics[0].id || '').toLowerCase();
          const nicInfo = nicMap.get(nicId);
          if (nicInfo) {
            privateIp = nicInfo.privateIp || null;
            vnet = nicInfo.vnet || null;
          }
        }

        const details: Partial<InventoryItem> = {
          name: vm.name,
          sizeOrType: vm.vmSize || 'Standard VM',
          os: vm.osType || 'Linux / Windows',
          powerState: vm.powerState || 'Running',
          privateIp: privateIp,
          vpcOrVnet: vnet,
        };

        map.set(vmName, details);
        map.set(vmId, details);
      }
    }
  } catch (err: any) {
    console.warn('⚠️ [Inventory] Live Azure Resource Graph query skipped:', err.message);
  }

  return map;
}

// Fetch live AWS EC2 instance details across configured regions
async function fetchAwsLiveEc2Details(): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    return items;
  }

  try {
    const ec2Client = new EC2Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    const res = await ec2Client.send(new DescribeInstancesCommand({}));

    for (const reservation of res.Reservations || []) {
      for (const inst of reservation.Instances || []) {
        const nameTag = inst.Tags?.find((t) => t.Key?.toLowerCase() === 'name')?.Value;
        const displayName = nameTag || inst.InstanceId || 'EC2 Instance';
        const powerState = inst.State?.Name || 'unknown'; // running, stopped, terminated

        items.push({
          id: `aws-ec2-${inst.InstanceId}`,
          name: displayName,
          cloud: 'aws',
          service: 'Amazon Elastic Compute Cloud (EC2)',
          resourceGroupOrRegion: `${region} / ${inst.Placement?.AvailabilityZone || region}`,
          accountOrSubscription: 'AWS Organizations Primary',
          accountOrSubscriptionId: inst.InstanceId || 'EC2',
          month: new Date().toISOString().slice(0, 7),
          cost: 0, // Enriched with real-time compute state
          status: powerState === 'running' ? 'Running' : 'Stopped',
          category: 'Compute',
          privateIp: inst.PrivateIpAddress || null,
          publicIp: inst.PublicIpAddress || null,
          sizeOrType: inst.InstanceType || 't3.micro',
          powerState: powerState.toUpperCase(),
          os: inst.PlatformDetails || inst.Architecture || 'Linux/UNIX',
          vpcOrVnet: inst.VpcId || null,
        });
      }
    }
  } catch (err: any) {
    console.warn('⚠️ [Inventory] AWS EC2 DescribeInstances query skipped:', err.message);
  }

  return items;
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

    // Parallel lookup: Query live Azure VM details & AWS EC2 instance specs
    const [azureLiveMap, awsLiveEc2List] = await Promise.all([
      cloudFilter === 'all' || cloudFilter === 'azure' ? fetchAzureLiveComputeDetails() : Promise.resolve(new Map()),
      cloudFilter === 'all' || cloudFilter === 'aws' ? fetchAwsLiveEc2Details() : Promise.resolve([]),
    ]);

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

          const topResources = await prisma.azureReportTopResources.findMany({
            where: {
              reportRunId: runId,
              ...(targetMonth ? { month: targetMonth } : {}),
            },
            orderBy: { cost: 'desc' },
            take: 300,
          });

          const subs = await prisma.azureReportBySubscription.findMany({
            where: { reportRunId: runId },
            distinct: ['subscription'],
          });
          const defaultSubName = subs[0]?.subscription || 'Primary Subscription';

          topResources.forEach((r, idx) => {
            const resName = r.resourceName || 'Unnamed Azure Resource';
            const liveMatch =
              azureLiveMap.get(resName.toLowerCase()) ||
              azureLiveMap.get((r.resourceGroup || '').toLowerCase());

            inventory.push({
              id: `azure-${r.id || idx}`,
              name: resName,
              cloud: 'azure',
              service: r.service || 'Cloud Service',
              resourceGroupOrRegion: r.resourceGroup || 'Default RG',
              accountOrSubscription: defaultSubName,
              accountOrSubscriptionId: defaultSubName,
              month: r.month,
              cost: Number(r.cost),
              status: liveMatch?.powerState || 'ACTIVE',
              category: getCategory(r.service),
              privateIp: liveMatch?.privateIp || null,
              publicIp: liveMatch?.publicIp || null,
              sizeOrType: liveMatch?.sizeOrType || null,
              powerState: liveMatch?.powerState || null,
              os: liveMatch?.os || null,
              vpcOrVnet: liveMatch?.vpcOrVnet || null,
            });
          });
        }
      } catch (azureErr: any) {
        console.warn('⚠️ [Inventory] Could not fetch Azure resources from DB:', azureErr.message);
      }
    }

    // =========================================================================
    // 2. Fetch AWS Resources & Merge live EC2 instances
    // =========================================================================
    if (cloudFilter === 'all' || cloudFilter === 'aws') {
      // Add live EC2 instances
      if (awsLiveEc2List.length > 0) {
        inventory.push(...awsLiveEc2List);
      }

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

          // Surface service aggregates
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

          // Surface member accounts
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
          item.category.toLowerCase().includes(search) ||
          (item.privateIp && item.privateIp.toLowerCase().includes(search)) ||
          (item.publicIp && item.publicIp.toLowerCase().includes(search)) ||
          (item.sizeOrType && item.sizeOrType.toLowerCase().includes(search))
      );
    }

    // Sort by cost descending (or compute with IPs first)
    filtered.sort((a, b) => b.cost - a.cost);

    // Compute summary KPI aggregations
    const totalCost = filtered.reduce((sum, item) => sum + item.cost, 0);
    const categoryCounts: Record<string, number> = {};
    const cloudCounts: Record<string, number> = { aws: 0, azure: 0 };
    const distinctResourceGroups = new Set<string>();
    let vmsWithIpCount = 0;

    filtered.forEach((item) => {
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
      cloudCounts[item.cloud] = (cloudCounts[item.cloud] || 0) + 1;
      if (item.resourceGroupOrRegion) distinctResourceGroups.add(item.resourceGroupOrRegion);
      if (item.privateIp || item.publicIp) vmsWithIpCount++;
    });

    return res.json({
      success: true,
      count: filtered.length,
      summary: {
        totalAssets: filtered.length,
        vmsWithIpCount,
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
