import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';

const router = Router();

async function getLatestAzureReportRun() {
  if (!prisma) return null;
  const latestRun = await prisma.azureReportRun.findFirst({
    where: { status: 'success' },
    orderBy: { id: 'desc' },
  });
  if (latestRun) return latestRun;
  return await prisma.azureReportRun.findFirst({
    orderBy: { id: 'desc' },
  });
}

// 1. Get Azure accounts / subscriptions
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED', message: 'SQL Server connection not initialized.' });
    }
    const latestRun = await getLatestAzureReportRun();
    if (latestRun) {
      const subscriptions = await prisma.azureReportBySubscription.findMany({
        where: { reportRunId: latestRun.id },
        distinct: ['subscription'],
        orderBy: { cost: 'desc' },
      });
      if (subscriptions.length > 0) {
        const formatted = subscriptions.map((s, idx) => ({
          id: `account-${idx + 1}`,
          name: s.subscription,
          accountId: s.subscription,
          accountName: s.subscription,
          path: idx === 0 ? '/data/azure' : `/data/azure/accounts/account-${idx + 1}`,
        }));
        return res.json(formatted);
      }
    }
    // Fallback default
    res.json([
      {
        id: 'account-1',
        name: 'Coforge Global IT (da60cf86-4c9b-4a5c-b60d-ffcfff067740)',
        accountId: 'da60cf86-4c9b-4a5c-b60d-ffcfff067740',
        accountName: 'Coforge Global IT',
        path: '/data/azure',
      },
    ]);
  } catch (err: any) {
    console.error('Error fetching Azure accounts:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 2. Dynamic Azure Dataset endpoint (returns data shaped for dashboard components)
router.get('/dataset/:filename', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }

    const rawFilename = req.params.filename || '';
    const cleanFilename = rawFilename
      .toLowerCase()
      .replace(/\.csv$/, '')
      .replace(/\.json$/, '');
    const normalized = cleanFilename.replace(/^(azure_usage_|azure_)/, '');

    const latestRun = await getLatestAzureReportRun();
    if (!latestRun) {
      return res.status(404).json({ error: 'NO_AZURE_RUN_FOUND' });
    }

    const reportRunId = latestRun.id;

    switch (normalized) {
      case 'monthly_totals':
      case 'monthly_totals_last_6_months': {
        const records = await prisma.azureReportMonthlyTotals.findMany({
          where: { reportRunId },
          orderBy: { month: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
        }));
        return res.json(mapped);
      }

      case 'kpis_by_month': {
        const records = await prisma.azureReportKpisByMonth.findMany({
          where: { reportRunId },
          orderBy: { month: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
          'Top Subscription': r.topSubscription || '',
          'Top Subscription Cost': r.topSubscriptionCost !== null ? Number(r.topSubscriptionCost) : '',
          'Top Customer': r.topSubscription || '',
          'Top Customer Cost': r.topSubscriptionCost !== null ? Number(r.topSubscriptionCost) : '',
          'Top Service': r.topService || '',
          'Top Service Cost': r.topServiceCost !== null ? Number(r.topServiceCost) : '',
          'Top Product': r.topService || '',
          'Top Product Cost': r.topServiceCost !== null ? Number(r.topServiceCost) : '',
          Subscriptions: r.subscriptions,
          'Resource Groups': r.resourceGroups,
        }));
        return res.json(mapped);
      }

      case 'mom_change': {
        const records = await prisma.azureReportMomChange.findMany({
          where: { reportRunId },
          orderBy: { month: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
          'Previous Month Cost': r.previousMonthCost !== null ? Number(r.previousMonthCost) : '',
          'MoM % Change': r.momPercentChange !== null ? Number(r.momPercentChange) : '',
        }));
        return res.json(mapped);
      }

      case 'by_service': {
        const records = await prisma.azureReportByService.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          ConsumedService: r.consumedService,
          Service: r.consumedService,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'by_subscription': {
        const records = await prisma.azureReportBySubscription.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Subscription: r.subscription,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'top_resources': {
        const records = await prisma.azureReportTopResources.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          ResourceName: r.resourceName,
          ResourceGroup: r.resourceGroup,
          Service: r.service,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'by_pricing_model': {
        const records = await prisma.azureReportByPricingModel.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { cost: 'desc' }],
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          PricingModel: r.pricingModel,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'top_meters': {
        const records = await prisma.azureReportTopMeters.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          MeterName: r.meterName,
          MeterCategory: r.meterCategory,
          Service: r.service,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'by_resource_group': {
        const records = await prisma.azureReportByResourceGroup.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          ResourceGroup: r.resourceGroup,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'by_charge_type': {
        const records = await prisma.azureReportByChargeType.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { cost: 'desc' }],
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          ChargeType: r.chargeType,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'by_region': {
        const records = await prisma.azureReportByRegion.findMany({
          where: { reportRunId },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          ResourceLocation: r.resourceLocation,
          Region: r.resourceLocation,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'credit_eligibility': {
        const records = await prisma.azureReportCreditEligibility.findMany({
          where: { reportRunId },
          orderBy: [{ month: 'asc' }, { cost: 'desc' }],
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          CreditEligible: r.creditEligible,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'cost_concentration_pareto': {
        const records = await prisma.azureReportCostConcentrationPareto.findMany({
          where: { reportRunId },
          orderBy: { rank: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Service: r.service,
          Cost: Number(r.cost),
          'Share %': Number(r.sharePct),
          'Cumulative %': Number(r.cumulativePct),
          Rank: r.rank,
        }));
        return res.json(mapped);
      }

      case 'anomaly_flags': {
        const records = await prisma.azureReportAnomalyFlags.findMany({
          where: { reportRunId },
          orderBy: { date: 'desc' },
        });
        const mapped = records.map((r) => ({
          Date: r.date.toISOString().slice(0, 10),
          Service: r.service,
          Cost: Number(r.cost),
          'Mean (30d)': Number(r.meanCost),
          'StdDev (30d)': Number(r.stdDev),
          'Anomaly Score': Number(r.anomalyScore),
          Severity: r.severity,
          Direction: r.direction,
        }));
        return res.json(mapped);
      }

      case 'new_services_by_month': {
        const records = await prisma.azureReportNewServicesByMonth.findMany({
          where: { reportRunId },
          orderBy: { firstSeenMonth: 'desc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'First Seen Month': r.firstSeenMonth,
          'Initial Month Cost': Number(r.initialMonthCost),
        }));
        return res.json(mapped);
      }

      case 'forecast_next_month': {
        const records = await prisma.azureReportForecastNextMonth.findMany({
          where: { reportRunId },
          orderBy: { month: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Actual Cost': r.actualCost !== null ? Number(r.actualCost) : '',
          'Forecasted Cost': r.forecastedCost !== null ? Number(r.forecastedCost) : '',
          Method: r.method,
        }));
        return res.json(mapped);
      }

      case 'volatility': {
        const records = await prisma.azureReportVolatility.findMany({
          where: { reportRunId },
          orderBy: { coefficientOfVariation: 'desc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'Mean Cost': Number(r.meanCost),
          'Std Dev': Number(r.stdDev),
          'Coeff of Variation': Number(r.coefficientOfVariation),
          'Min Cost': Number(r.minCost),
          'Max Cost': Number(r.maxCost),
          Volatility: r.volatility,
        }));
        return res.json(mapped);
      }

      default:
        return res.status(404).json({ error: `Dataset ${cleanFilename} not found` });
    }
  } catch (err: any) {
    console.error(`Error serving Azure dataset ${req.params.filename}:`, err.message);
    res.status(500).json({ error: 'DB_QUERY_ERROR', message: err.message });
  }
});

export default router;
