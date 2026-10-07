import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db.ts';
import { ensureAlertTablesExist } from '../db-alert-tables.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 2. Alert evaluation dates
router.get('/alerts/dates', async (req: Request, res: Response) => {
  try {
    if (prisma) {
      await ensureAlertTablesExist(prisma);
      const dateRecords = await prisma.azureCostAlert.findMany({
        select: { evaluationDate: true },
        distinct: ['evaluationDate'],
        orderBy: { evaluationDate: 'desc' },
      });
      const dates: string[] = dateRecords.map((d: any) => d.evaluationDate);

      // Check logs directory for precomputed files as supplementary dates
      const logsDir = path.resolve(__dirname, '../../alerts/logs');
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        for (const f of files) {
          const match = f.match(/alert-(?:report|preview)-(\d{4}-\d{2}-\d{2})\.(?:json|html)/);
          if (match && !dates.includes(match[1])) {
            dates.push(match[1]);
          }
        }
      }
      return res.json(dates.sort().reverse());
    }
    res.json([]);
  } catch (err: any) {
    console.error('Error fetching alert dates:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 3. Alerts for a specific evaluation date
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    await ensureAlertTablesExist(prisma);
    let date = req.query.date as string | undefined;

    if (!date) {
      const latestAlert = await prisma.azureCostAlert.findFirst({
        orderBy: { evaluationDate: 'desc' },
        select: { evaluationDate: true },
      });
      date = latestAlert?.evaluationDate;
    }

    if (!date) {
      const logsDir = path.resolve(__dirname, '../../alerts/logs');
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir).filter(f => f.startsWith('alert-report-') && f.endsWith('.json'));
        if (files.length > 0) {
          files.sort().reverse();
          const match = files[0].match(/alert-report-(\d{4}-\d{2}-\d{2})\.json/);
          if (match) date = match[1];
        }
      }
    }

    if (!date) {
      return res.json({
        evaluationDate: '',
        summary: { total: 0, critical: 0, high: 0, warning: 0, info: 0 },
        alerts: [],
      });
    }

    const dbAlerts = await prisma.azureCostAlert.findMany({
      where: { evaluationDate: date },
      orderBy: [{ severity: 'desc' }, { absoluteIncrease: 'desc' }],
    });

    if (dbAlerts && dbAlerts.length > 0) {
      const formattedAlerts = dbAlerts.map((a: any) => ({
        id: a.id,
        alertType: a.alertType,
        severity: a.severity,
        evaluationDate: a.evaluationDate,
        billingCurrency: a.billingCurrency,
        currentCost: Number(a.currentCost),
        baselineCost: a.baselineCost !== null ? Number(a.baselineCost) : undefined,
        absoluteIncrease: Number(a.absoluteIncrease),
        percentIncrease: a.percentIncrease !== null ? Number(a.percentIncrease) : undefined,
        subscriptionId: a.subscriptionId,
        subscriptionName: a.subscriptionName,
        resourceId: a.resourceId,
        resourceName: a.resourceName,
        resourceGroup: a.resourceGroup,
        service: a.service,
        firstSeenDate: a.firstSeenDate,
        currentQuantity: a.currentQuantity !== null ? Number(a.currentQuantity) : undefined,
        baselineQuantity: a.baselineQuantity !== null ? Number(a.baselineQuantity) : undefined,
        meterId: a.meterId,
        meterName: a.meterName,
        meterCategory: a.meterCategory,
        meterSubCategory: a.meterSubCategory,
        unitOfMeasure: a.unitOfMeasure,
        likelyDrivenBy: a.driverAnnotationJson ? JSON.parse(a.driverAnnotationJson) : undefined,
      }));

      const summary = {
        total: formattedAlerts.length,
        critical: formattedAlerts.filter((a: any) => a.severity === 'CRITICAL').length,
        high: formattedAlerts.filter((a: any) => a.severity === 'HIGH').length,
        warning: formattedAlerts.filter((a: any) => a.severity === 'WARNING').length,
        info: formattedAlerts.filter((a: any) => a.severity === 'INFO').length,
        subscriptionCostSpikes: formattedAlerts.filter((a: any) => a.alertType === 'SUBSCRIPTION_COST_SPIKE').length,
        serviceCostSpikes: formattedAlerts.filter((a: any) => a.alertType === 'SERVICE_COST_SPIKE').length,
        resourceCostSpikes: formattedAlerts.filter((a: any) => a.alertType === 'RESOURCE_COST_SPIKE').length,
        newExpensiveResources: formattedAlerts.filter((a: any) => a.alertType === 'NEW_EXPENSIVE_RESOURCE').length,
        quantitySpikes: formattedAlerts.filter((a: any) => a.alertType === 'QUANTITY_SPIKE').length,
      };

      return res.json({
        evaluationDate: date,
        summary,
        alerts: formattedAlerts,
      });
    }

    // Fallback to JSON report in logs if exists
    const reportPath = path.resolve(__dirname, `../../alerts/logs/alert-report-${date}.json`);
    if (fs.existsSync(reportPath)) {
      const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      return res.json(data);
    }

    res.json({
      evaluationDate: date,
      summary: { total: 0, critical: 0, high: 0, warning: 0, info: 0 },
      alerts: [],
    });
  } catch (err: any) {
    console.error('Error fetching alerts:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 4. Meters catalogue for selection
router.get('/meters', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    const latestRun = await getLatestAzureReportRun();
    let meters: Array<{ meter: string; category: string; service: string }> = [];

    if (latestRun) {
      const topMeters = await prisma.azureReportTopMeters.findMany({
        where: { reportRunId: latestRun.id },
        distinct: ['meter'],
        select: { meter: true, category: true, service: true },
        orderBy: { cost: 'desc' },
      });
      meters = topMeters;
    }

    if (meters.length === 0) {
      const fromUsage = await prisma.azureUsageRecord.findMany({
        distinct: ['meterName'],
        select: { meterName: true, meterCategory: true, service: true },
        take: 100,
      });
      meters = fromUsage.map((m: any) => ({
        meter: m.meterName || '',
        category: m.meterCategory || '',
        service: m.service || '',
      })).filter((m: any) => Boolean(m.meter));
    }

    res.json(meters);
  } catch (err: any) {
    console.error('Error fetching meters:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 5. Meter budgets list with current month usage & status
router.get('/meter-budgets', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    await ensureAlertTablesExist(prisma);
    const budgets = await prisma.azureMeterBudget.findMany({
      orderBy: { createdAt: 'desc' },
    });

    // Detect latest month with data
    const latestRecord = await prisma.azureUsageRecord.findFirst({
      orderBy: { usageDate: 'desc' },
      select: { usageDate: true },
    });
    const currentMonth = latestRecord
      ? latestRecord.usageDate.toISOString().slice(0, 7)
      : new Date().toISOString().slice(0, 7);

    const enriched = await Promise.all(
      budgets.map(async (b: any) => {
        let currentSpend = 0;
        try {
          const sumResult = await prisma.azureUsageRecord.aggregate({
            where: {
              meterName: b.meterName,
              isDuplicateOfEarlierRow: false,
              isSupersededByLaterRow: false,
              usageDate: {
                gte: new Date(`${currentMonth}-01T00:00:00Z`),
              },
            },
            _sum: { billedCost: true },
          });
          currentSpend = Number(sumResult._sum.billedCost || 0);

          if (currentSpend === 0) {
            const reportMeter = await prisma.azureReportTopMeters.findFirst({
              where: { meter: b.meterName, month: currentMonth },
            });
            if (reportMeter) {
              currentSpend = Number(reportMeter.cost);
            }
          }
        } catch {
          // fallback gracefully
        }

        const limit = Number(b.monthlyBudget) || 1;
        const percentUsed = (currentSpend / limit) * 100;
        let status = 'NORMAL';
        if (percentUsed >= 100) status = percentUsed > 100 ? 'OVER_BUDGET' : 'AT_100';
        else if (percentUsed >= 75) status = 'NEAR_75';
        else if (percentUsed >= 50) status = 'NEAR_50';

        return {
          id: b.id,
          meterName: b.meterName,
          meterCategory: b.meterCategory,
          service: b.service,
          monthlyBudget: Number(b.monthlyBudget),
          billingCurrency: b.billingCurrency,
          alertEmail: b.alertEmail,
          isActive: b.isActive,
          currentMonthSpend: Math.round(currentSpend * 100) / 100,
          percentUsed: Math.round(percentUsed * 10) / 10,
          status,
          evaluationMonth: currentMonth,
          lastNotifiedThreshold: b.lastNotifiedThreshold,
          lastNotifiedDate: b.lastNotifiedDate,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        };
      })
    );

    res.json(enriched);
  } catch (err: any) {
    console.error('Error fetching meter budgets:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 6. Create or update a meter budget
router.post('/meter-budgets', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    await ensureAlertTablesExist(prisma);
    const { meterName, monthlyBudget, alertEmail, meterCategory, service } = req.body;

    if (!meterName || typeof meterName !== 'string' || !meterName.trim()) {
      return res.status(400).json({ error: 'INVALID_METER', message: 'Meter name is required.' });
    }
    const budgetNum = Number(monthlyBudget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({ error: 'INVALID_BUDGET', message: 'Monthly budget must be a positive number.' });
    }
    if (!alertEmail || typeof alertEmail !== 'string' || !alertEmail.includes('@')) {
      return res.status(400).json({ error: 'INVALID_EMAIL', message: 'A valid alert email is required.' });
    }

    const created = await prisma.azureMeterBudget.create({
      data: {
        meterName: meterName.trim(),
        meterCategory: meterCategory ? String(meterCategory).trim() : null,
        service: service ? String(service).trim() : null,
        monthlyBudget: budgetNum.toFixed(2),
        billingCurrency: 'INR',
        alertEmail: alertEmail.trim().toLowerCase(),
        isActive: true,
      },
    });

    res.status(201).json({ success: true, budget: created });
  } catch (err: any) {
    console.error('Error creating meter budget:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 7. Delete a meter budget
router.delete('/meter-budgets/:id', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }
    await ensureAlertTablesExist(prisma);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'INVALID_ID' });
    }
    await prisma.azureMeterBudget.delete({
      where: { id },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting meter budget:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 8. Dynamic Azure Dataset endpoint (returns data shaped for dashboard components)
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
          Meter: r.meter,
          MeterName: r.meter,
          Category: r.category,
          MeterCategory: r.category,
          Service: r.service,
          ResourceGroup: r.resourceGroup,
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
