import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from both local directory and parent cost-piplines directory
dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// SQL Server Prisma Client Setup
// ─────────────────────────────────────────────────────────────
let prisma = null;
if (process.env.DATABASE_URL) {
  try {
    const adapter = new PrismaMssql(process.env.DATABASE_URL);
    prisma = new PrismaClient({ adapter });
    console.log('🗄️ [SQL Server] Connected Prisma Client for Cost Intelligence');
  } catch (dbInitErr) {
    console.error('❌ [SQL Server] Failed to initialize Prisma Client:', dbInitErr.message);
  }
}

// ───────────────────── Authentication Endpoints (SQL Server) ─────────────────────

const ADMIN_EMAIL = 'dashboard-admin@coforge.com';
const ADMIN_PASSWORD = '8iie9gb';

// Login Endpoint (Strictly queries SQL Server dbo.users)
app.post('/api/auth/login', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Admin Verification
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      if (password === ADMIN_PASSWORD) {
        // Record login audit
        await prisma.userLoginEvent.create({
          data: {
            emailAttempted: normalizedEmail,
            outcome: 'success',
          },
        }).catch(() => {});

        return res.json({
          success: true,
          user: {
            id: 'admin-01',
            name: 'Dashboard Administrator',
            email: ADMIN_EMAIL,
            role: 'admin',
            department: 'Cloud Governance & FinOps',
            provider: 'credentials',
            loginTime: new Date().toISOString(),
          },
        });
      } else {
        await prisma.userLoginEvent.create({
          data: {
            emailAttempted: normalizedEmail,
            outcome: 'invalid_admin_credentials',
          },
        }).catch(() => {});

        return res.status(401).json({
          error: 'INVALID_ADMIN_CREDENTIALS',
          message: 'Invalid Admin password. Please check your credentials.',
        });
      }
    }

    // 2. Fetch User from SQL Server dbo.users
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      await prisma.userLoginEvent.create({
        data: {
          emailAttempted: normalizedEmail,
          outcome: 'user_not_found',
        },
      }).catch(() => {});

      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Account not found. Please sign up to create a new requester account.',
      });
    }

    if (user.passwordHash !== password) {
      await prisma.userLoginEvent.create({
        data: {
          userId: user.id,
          emailAttempted: normalizedEmail,
          outcome: 'invalid_password',
        },
      }).catch(() => {});

      return res.status(401).json({
        error: 'INVALID_PASSWORD',
        message: 'Incorrect password for this account.',
      });
    }

    // Update last login timestamp & log success
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {});

    await prisma.userLoginEvent.create({
      data: {
        userId: user.id,
        emailAttempted: normalizedEmail,
        outcome: 'success',
      },
    }).catch(() => {});

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role || 'basic',
        department: user.department || 'Engineering',
        provider: user.provider || 'credentials',
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// Signup Endpoint (Strictly writes to SQL Server dbo.users)
app.post('/api/auth/signup', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { name, email, password, department } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const finalName = name?.trim() || normalizedEmail.split('@')[0].replace(/[._-]/g, ' ');

    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      return res.status(400).json({
        error: 'RESERVED_EMAIL',
        message: 'This email is reserved for Admin authentication.',
      });
    }

    // Check if user exists in SQL Server
    const exists = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (exists) {
      return res.status(409).json({
        error: 'USER_ALREADY_EXISTS',
        message: 'An account with this email already exists. Please log in.',
      });
    }

    const newUser = await prisma.user.create({
      data: {
        name: finalName,
        email: normalizedEmail,
        passwordHash: password,
        passwordAlgo: 'plain',
        department: department?.trim() || 'Digital Engineering',
        role: 'basic',
        provider: 'credentials',
        isActive: true,
      },
    });

    await prisma.userLoginEvent.create({
      data: {
        userId: newUser.id,
        emailAttempted: normalizedEmail,
        outcome: 'success',
      },
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department,
        provider: newUser.provider,
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// ───────────────────── Account Requests Endpoints (SQL Server) ─────────────────────

// Fetch all requests strictly from SQL Server dbo.account_requests
app.get('/api/requests', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const requests = await prisma.accountRequest.findMany({
      include: {
        environments: true,
        adminEmails: true,
        budgetAlertEmails: true,
        statusHistory: {
          orderBy: { changedAt: 'desc' },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const formatted = requests.map((r) => ({
      id: r.legacyId || String(r.id),
      sqlId: r.id,
      division: r.division,
      projectName: r.projectName,
      businessJustification: r.businessJustification,
      pointOfContact: r.pointOfContact,
      accountManager: r.accountManager,
      managedByCoforge: r.managedByCoforge,
      externalAudienceAccess: r.externalAudienceAccess,
      storesCustomerData: r.storesCustomerData,
      customerDataDetails: r.customerDataDetails,
      storesConfidentialData: r.storesConfidentialData,
      estimatedMonthlyCost: r.estimatedMonthlyCost ? Number(r.estimatedMonthlyCost) : 0,
      costChargedBack: r.costChargedBack,
      foreseenInBudget: r.foreseenInBudget,
      wbsCode: r.wbsCode,
      costCenter: r.costCenter,
      awsPartnershipRelated: r.awsPartnershipRelated,
      buFinanceController: r.buFinanceController,
      status: r.status,
      adminNotes: r.adminNotes,
      reviewedByName: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      submittedAt: r.submittedAt,
      submitterEmail: r.submitterEmail,
      submitterName: r.submitterName,
      accountEnvironment: r.environments.map((e) => e.environment).join(', '),
      adminEmails: r.adminEmails.map((e) => e.email),
      budgetAlertEmails: r.budgetAlertEmails.map((e) => e.email),
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Fetch requests error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// Submit a new request strictly to SQL Server
app.post('/api/requests', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const body = req.body;
    if (!body || !body.projectName) {
      return res.status(400).json({ error: 'Project name and details are required' });
    }

    const legacyId = body.id || `req-${Date.now().toString(36)}`;
    const envList = Array.isArray(body.accountEnvironment)
      ? body.accountEnvironment
      : typeof body.accountEnvironment === 'string'
      ? body.accountEnvironment.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const adminEmailsList = Array.isArray(body.adminEmails) ? body.adminEmails : [body.pointOfContact || 'admin@coforge.com'];
    const budgetEmailsList = Array.isArray(body.budgetAlertEmails) ? body.budgetAlertEmails : [];

    const newRecord = await prisma.accountRequest.create({
      data: {
        legacyId,
        division: body.division || 'General',
        projectName: body.projectName,
        businessJustification: body.businessJustification || '',
        pointOfContact: body.pointOfContact || '',
        accountManager: body.accountManager || '',
        managedByCoforge: Boolean(body.managedByCoforge === 'Yes' || body.managedByCoforge === true),
        externalAudienceAccess: Boolean(body.externalAudienceAccess === 'Yes' || body.externalAudienceAccess === true),
        storesCustomerData: Boolean(body.storesCustomerData === 'Yes' || body.storesCustomerData === true),
        customerDataDetails: body.customerDataDetails || '',
        storesConfidentialData: Boolean(body.storesConfidentialData === 'Yes' || body.storesConfidentialData === true),
        estimatedMonthlyCost: body.estimatedMonthlyCost ? Number(body.estimatedMonthlyCost) : 0,
        costChargedBack: Boolean(body.costChargedBack === 'Yes' || body.costChargedBack === true),
        foreseenInBudget: Boolean(body.foreseenInBudget === 'Yes' || body.foreseenInBudget === true),
        wbsCode: body.wbsCode || '',
        costCenter: body.costCenter || '',
        awsPartnershipRelated: Boolean(body.awsPartnershipRelated === 'Yes' || body.awsPartnershipRelated === true),
        buFinanceController: body.buFinanceController || '',
        status: body.status || 'pending',
        submitterEmail: body.pointOfContact || 'requester@coforge.com',
        submitterName: body.submitterName || body.projectName,
        environments: {
          create: envList.map((env) => ({ environment: env })),
        },
        adminEmails: {
          create: adminEmailsList.map((email) => ({ email })),
        },
        budgetAlertEmails: {
          create: budgetEmailsList.map((email) => ({ email })),
        },
      },
    });

    res.status(201).json({ success: true, data: newRecord });
  } catch (err) {
    console.error('Create request error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// Admin update status (approve, reject, review) in SQL Server
app.put('/api/requests/:id/status', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { id } = req.params;
    const { status, adminNotes, reviewedBy } = req.body;

    const request = await prisma.accountRequest.findFirst({
      where: {
        OR: [
          { legacyId: id },
          { id: !isNaN(Number(id)) ? Number(id) : -1 },
        ],
      },
    });

    if (!request) {
      return res.status(404).json({ error: 'Request not found in database' });
    }

    const updated = await prisma.accountRequest.update({
      where: { id: request.id },
      data: {
        status: status || request.status,
        adminNotes: adminNotes !== undefined ? adminNotes : request.adminNotes,
        reviewedByName: reviewedBy || 'Admin',
        reviewedAt: new Date(),
        statusHistory: {
          create: {
            fromStatus: request.status,
            toStatus: status || request.status,
            note: adminNotes || '',
            changedByName: reviewedBy || 'Admin',
          },
        },
      },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Update request status error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// ───────────────────── AWS Cost Intelligence (SQL Server / Prisma) Endpoints ─────────────────────

async function getLatestRunForAccount(accountParam) {
  if (!prisma) return null;
  const configId = accountParam ? String(accountParam).replace('/data/accounts/', '').replace('/data', '') || 'account-1' : 'account-1';

  let account = await prisma.awsAccount.findFirst({
    where: {
      OR: [
        { configId: configId },
        { configId: configId === 'default' ? 'account-1' : configId },
      ],
    },
  });

  if (!account) {
    account = (await prisma.awsAccount.findFirst({ where: { isPrimary: true } })) ||
              (await prisma.awsAccount.findFirst());
  }

  if (!account) return null;

  const latestRun = await prisma.awsReportRun.findFirst({
    where: {
      accountId: account.id,
      status: 'success',
    },
    orderBy: {
      id: 'desc',
    },
  });

  return { account, run: latestRun };
}

// 1. Get list of configured AWS accounts from SQL Server
app.get('/api/aws/accounts', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED', message: 'SQL Server connection not initialized.' });
    }
    const accounts = await prisma.awsAccount.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });

    const formatted = accounts.map((a) => {
      let accountName = a.name;
      let accountId = a.awsAccountId || '';
      const match = a.name.match(/\(([^)]+)\)/);
      if (match) {
        accountId = match[1];
        accountName = a.name.replace(/\s*\([^)]+\)/, '').trim();
      }

      return {
        id: a.configId,
        name: a.name,
        accountId: accountId || a.configId,
        accountName: accountName || a.name,
        path: a.isPrimary ? '/data' : `/data/accounts/${a.configId}`,
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching AWS accounts:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 2. Dynamic AWS Dataset endpoint (returns data shaped for dashboard components)
app.get('/api/aws/dataset/:filename', async (req, res) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DATABASE_NOT_CONFIGURED' });
    }

    const rawFilename = req.params.filename || '';
    const cleanFilename = rawFilename.toLowerCase().replace(/\.csv$/, '').replace(/\.json$/, '');
    const accountParam = req.query.account || req.query.path || 'account-1';

    const accountContext = await getLatestRunForAccount(accountParam);
    if (!accountContext || !accountContext.run) {
      return res.json([]);
    }

    const { run } = accountContext;
    const reportRunId = run.id;

    switch (cleanFilename) {
      case 'mom_change': {
        const records = await prisma.awsMomChange.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
          'Previous Month Cost': r.previousMonthCost !== null ? Number(r.previousMonthCost) : '',
          Difference: r.difference !== null ? Number(r.difference) : '',
          'MoM % Change': r.momPercentChange !== null ? Number(r.momPercentChange) : '',
        }));
        return res.json(mapped);
      }

      case 'monthly_totals_last_6_months': {
        const records = await prisma.awsMonthlyTotal.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
        }));
        return res.json(mapped);
      }

      case 'current_month_total': {
        const record = await prisma.awsMonthlyTotal.findFirst({
          where: { reportRunId, isCurrentMonth: true },
        });
        return res.json([{ 'Total Cost': Number(record?.totalCost || 0) }]);
      }

      case 'top_10_services': {
        const records = await prisma.awsTopService.findMany({
          where: { reportRunId },
          orderBy: { rank: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Cost: Number(r.cost),
          'Total Cost': Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'latest_month_services': {
        const records = await prisma.awsCostByService.findMany({
          where: { reportRunId, month: run.currentMonth || undefined },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'cost_by_service_wide': {
        const records = await prisma.awsCostByService.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const monthsMap = {};
        for (const r of records) {
          if (!monthsMap[r.month]) {
            monthsMap[r.month] = { Month: r.month, 'Total Cost': 0 };
          }
          const cost = Number(r.cost);
          monthsMap[r.month][r.service] = cost;
          monthsMap[r.month]['Total Cost'] += cost;
        }
        return res.json(Object.values(monthsMap));
      }

      case 'cost_by_linked_account': {
        const records = await prisma.awsCostByLinkedAccount.findMany({
          where: { reportRunId, month: run.currentMonth || undefined },
          orderBy: { cost: 'desc' },
        });
        const mapped = records.map((r) => ({
          'Linked Account': r.linkedAccount,
          Cost: Number(r.cost),
        }));
        return res.json(mapped);
      }

      case 'cost_by_linked_account_wide': {
        const records = await prisma.awsCostByLinkedAccount.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const accMap = {};
        for (const r of records) {
          if (!accMap[r.linkedAccount]) {
            accMap[r.linkedAccount] = { 'Linked Account': r.linkedAccount };
          }
          accMap[r.linkedAccount][r.month] = Number(r.cost);
        }
        return res.json(Object.values(accMap));
      }

      case 'account_cost_variance': {
        const records = await prisma.awsAccountCostVariance.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Linked Account': r.linkedAccount,
          'Previous Month Cost': Number(r.prevMonthCost),
          'Current Month Cost': Number(r.currMonthCost),
          Difference: Number(r.difference),
          'MoM % Change': Number(r.percentageChange),
        }));
        return res.json(mapped);
      }

      case 'pareto_analysis': {
        const records = await prisma.awsParetoAnalysis.findMany({
          where: { reportRunId },
          orderBy: { rank: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Cost: Number(r.cost),
          'Cumulative Cost': Number(r.cumulativeCost),
          'Cumulative %': Number(r.cumulativePercent),
          'Pareto Class': r.paretoClass,
        }));
        return res.json(mapped);
      }

      case 'anomaly_flags': {
        const records = await prisma.awsAnomalyFlag.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          'Total Cost': Number(r.totalCost),
          '3M Rolling Avg': r.rollingAvg !== null ? Number(r.rollingAvg) : '',
          '3M Rolling Std': r.rollingStd !== null ? Number(r.rollingStd) : '',
          'Anomaly Flag': r.anomalyFlag,
          'Is Anomaly': r.isAnomaly,
          'Rolling Avg (3mo)': r.rollingAvg !== null ? Number(r.rollingAvg) : Number(r.totalCost),
        }));
        return res.json(mapped);
      }

      case 'recurring_vs_onetime': {
        const records = await prisma.awsRecurringVsOnetime.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'Months Active': r.activeMonths,
          'Total Months': r.totalMonthsInRun,
          'Active %': Number(r.activePercent),
          'Total Cost Over Period': Number(r.totalCostOverPeriod),
          Classification: r.classification,
        }));
        return res.json(mapped);
      }

      case 'new_services_flag': {
        const records = await prisma.awsNewServiceFlag.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          'Cost in Latest Month': Number(r.costInLatestMonth),
          'First Seen Month': r.firstSeenMonth,
          Note: r.note,
        }));
        return res.json(mapped);
      }

      case 'category_monthly_costs': {
        const records = await prisma.awsCategoryMonthlyCost.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Month: r.month,
          Category: r.category,
          Cost: Number(r.cost),
          'Share %': Number(r.sharePercent),
        }));
        return res.json(mapped);
      }

      case 'forecast_simple': {
        const records = await prisma.awsForecast.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Forecast Month': r.forecastMonth,
          'Forecasted Total Cost': Number(r.projectedCost),
          'Projected Cost': Number(r.projectedCost),
          Method: r.method,
        }));
        return res.json(mapped);
      }

      case 'service_volatility': {
        const records = await prisma.awsServiceVolatility.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          Service: r.service,
          Mean: Number(r.mean),
          'Std Dev': Number(r.stdDev),
          'Coefficient of Variation %': Number(r.coefficientOfVariationPercent),
        }));
        return res.json(mapped);
      }

      case 'budgets_overview': {
        const records = await prisma.awsBudgetOverview.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Budget Name': r.budgetName,
          Limit: Number(r.limitAmount),
          'Current Used': Number(r.currentUsed),
          'Forecasted Spend': Number(r.forecastedSpend),
          'Current vs Budget %': Number(r.currentVsBudgetPercent),
          'Threshold Status': r.thresholdStatus,
          'Health Status': r.healthStatus,
        }));
        return res.json(mapped);
      }

      case 'unbudgeted_accounts': {
        const records = await prisma.awsUnbudgetedAccount.findMany({
          where: { reportRunId },
          orderBy: { id: 'asc' },
        });
        const mapped = records.map((r) => ({
          'Account Name': r.accountName,
          'Account ID': r.awsAccountId,
          Status: r.status,
          'Current Month Spend': Number(r.currentMonthSpend),
          'Previous Month Spend': Number(r.previousMonthSpend),
          'MoM Change %': Number(r.momChangePercent),
          'Top Cost Driver': r.topCostDriver,
        }));
        return res.json(mapped);
      }

      case 'governance_summary': {
        const record = await prisma.awsGovernanceSummary.findFirst({
          where: { reportRunId },
        });
        if (!record) return res.json(null);
        return res.json({
          totalAccounts: record.totalAccounts,
          activeAccounts: record.activeAccounts,
          suspendedAccounts: record.suspendedAccounts,
          accountsWithBudget: record.accountsWithBudget,
          accountsWithNoBudget: record.accountsWithNoBudget,
          budgetCoveragePct: Number(record.budgetCoveragePct),
          selectedMonth: record.selectedMonth,
          activeSpendTotal: Number(record.activeSpendTotal),
          spendUnderBudget: Number(record.spendUnderBudget),
          spendWithNoBudget: Number(record.spendWithNoBudget),
          shareSpendUncoveredPct: Number(record.shareSpendUncoveredPct),
          sumBudgetLimits: Number(record.sumBudgetLimits),
          suspendedAccountsChargingCount: record.suspendedAccountsChargingCount,
          suspendedAccountsSpendTotal: Number(record.suspendedAccountsSpendTotal),
          suspendedPeriodLabel: record.suspendedPeriodLabel,
        });
      }

      default:
        return res.status(404).json({ error: `Dataset ${cleanFilename} not found` });
    }
  } catch (err) {
    console.error(`Error serving AWS dataset ${req.params.filename}:`, err.message);
    res.status(500).json({ error: 'DB_QUERY_ERROR', message: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Cost Intelligence API Server running on port ${PORT}`);
});