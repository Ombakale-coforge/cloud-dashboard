import { Router, Request, Response } from 'express';
import {
  type CloudProvider,
  type EnrichedAccountBudget,
  deleteBudget,
  enrichBudgetWithUsage,
  evaluateAndNotifyAllAccountBudgets,
  getCloudAccountsUsage,
  getEnrichedBudgets,
  listRawBudgets,
  markManualEmailSent,
  markThresholdNotified,
  matchAccountUsage,
  normalizeEmailList,
  resolveAccountSpecificTopServices,
  sendAccountUsageEmail,
  shouldSendThresholdAlert,
  upsertBudget,
} from '../services/accountBudgetService.ts';

const router = Router();

const VALID_PROVIDERS = new Set<CloudProvider>(['aws', 'azure', 'gcp']);

function parseProvider(raw: unknown): CloudProvider | null {
  const val = String(raw || '').trim().toLowerCase();
  return VALID_PROVIDERS.has(val as CloudProvider) ? (val as CloudProvider) : null;
}

// 1. Discover all accounts across AWS, Azure, GCP with live spend and attached manual budget
router.get('/cloud-accounts', async (req: Request, res: Response) => {
  try {
    const providerParam = String(req.query.provider || 'all').toLowerCase();
    const monthParam = req.query.month ? String(req.query.month).trim() : undefined;

    const [accounts, rawBudgets] = await Promise.all([
      getCloudAccountsUsage(providerParam, monthParam),
      listRawBudgets(providerParam),
    ]);

    const budgetsByAccountKey: Record<string, EnrichedAccountBudget> = {};
    for (const b of rawBudgets) {
      const matched = matchAccountUsage(b, accounts);
      const enriched = enrichBudgetWithUsage(b, matched, monthParam);
      budgetsByAccountKey[`${b.cloudProvider}:${b.accountId.toLowerCase()}`] = enriched;
    }

    const accountsWithBudgets = accounts.map((acc) => {
      const key = `${acc.cloudProvider}:${acc.accountId.toLowerCase()}`;
      const matchedBudget =
        budgetsByAccountKey[key] ||
        Object.values(budgetsByAccountKey).find(
          (b) =>
            b.cloudProvider === acc.cloudProvider &&
            b.accountName.toLowerCase() === acc.accountName.toLowerCase()
        ) ||
        null;
      return {
        ...acc,
        manualBudget: matchedBudget,
      };
    });

    return res.json({
      accounts: accountsWithBudgets,
      budgetsByAccountKey,
    });
  } catch (err: any) {
    console.error('Error fetching multi-cloud accounts:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 2. List configured manual account budgets enriched with live usage
router.get('/', async (req: Request, res: Response) => {
  try {
    const providerParam = String(req.query.provider || 'all').toLowerCase();
    const monthParam = req.query.month ? String(req.query.month).trim() : undefined;
    const enriched = await getEnrichedBudgets(providerParam, monthParam);
    return res.json(enriched);
  } catch (err: any) {
    console.error('Error fetching manual budgets:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 3. Create or update a manual account budget (auto-notifies if threshold crossed)
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      cloudProvider,
      accountId,
      accountName,
      parentAccountId,
      monthlyBudget,
      billingCurrency,
      alertEmail,
      alertEmails,
      contactName,
      isActive,
      month,
      notifyImmediatelyIfBreached,
    } = req.body || {};

    const provider = parseProvider(cloudProvider);
    if (!provider) {
      return res.status(400).json({
        error: 'INVALID_PROVIDER',
        message: 'cloudProvider must be one of aws, azure, or gcp.',
      });
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return res.status(400).json({ error: 'INVALID_ACCOUNT_ID', message: 'Account ID is required.' });
    }
    const resolvedAccountName =
      typeof accountName === 'string' && accountName.trim() ? accountName.trim() : accountId.trim();

    const budgetNum = Number(monthlyBudget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({
        error: 'INVALID_BUDGET',
        message: 'Monthly budget must be a positive number.',
      });
    }

    const validEmails = normalizeEmailList(alertEmails ?? alertEmail ?? '');
    if (validEmails.length === 0) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: 'At least one valid concerned person email address is required.',
      });
    }

    const currency =
      String(billingCurrency || '').toUpperCase() === 'INR'
        ? 'INR'
        : String(billingCurrency || '').toUpperCase() === 'USD'
        ? 'USD'
        : provider === 'azure'
        ? 'INR'
        : 'USD';

    const saved = await upsertBudget({
      cloudProvider: provider,
      accountId: accountId.trim(),
      accountName: resolvedAccountName,
      parentAccountId: parentAccountId ? String(parentAccountId).trim() : null,
      monthlyBudget: budgetNum,
      billingCurrency: currency,
      alertEmail: validEmails.join(', '),
      contactName: contactName ? String(contactName).trim() : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    const usageList = await getCloudAccountsUsage(provider, month ? String(month) : undefined);
    const matchedUsage = matchAccountUsage(saved, usageList);
    const enriched = await resolveAccountSpecificTopServices(
      enrichBudgetWithUsage(saved, matchedUsage, month ? String(month) : undefined)
    );

    let emailNotification: any = null;
    if (
      notifyImmediatelyIfBreached !== false &&
      enriched.isActive &&
      shouldSendThresholdAlert(
        enriched.thresholdCrossed,
        enriched.evaluationMonth,
        enriched.lastNotifiedThreshold,
        enriched.lastNotifiedMonth
      )
    ) {
      try {
        emailNotification = await sendAccountUsageEmail(enriched, 'threshold');
        if (emailNotification.sent && enriched.thresholdCrossed) {
          await markThresholdNotified(saved.id, enriched.thresholdCrossed, enriched.evaluationMonth);
          enriched.lastNotifiedThreshold = enriched.thresholdCrossed;
          enriched.lastNotifiedMonth = enriched.evaluationMonth;
          enriched.lastNotifiedAt = new Date().toISOString();
        }
      } catch (mailErr: any) {
        emailNotification = { sent: false, error: mailErr.message };
      }
    }

    return res.status(201).json({
      success: true,
      budget: enriched,
      emailNotification,
    });
  } catch (err: any) {
    console.error('Error saving manual budget:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 4. Delete a manual account budget
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Valid budget id is required.' });
    }
    const deleted = await deleteBudget(id);
    if (!deleted) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Budget not found.' });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting manual budget:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 5. Instant email button: send current usage details for a saved manual budget
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Valid budget id is required.' });
    }

    const monthParam = req.body?.month || req.query.month;
    const rawOverride = req.body?.emails ?? req.body?.email;
    const hasOverride =
      Array.isArray(rawOverride)
        ? rawOverride.length > 0
        : typeof rawOverride === 'string' && rawOverride.trim().length > 0;
    const overrideEmails = hasOverride ? normalizeEmailList(rawOverride) : [];
    if (hasOverride && overrideEmails.length === 0) {
      return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Provided override email(s) are invalid.' });
    }

    const enrichedList = await getEnrichedBudgets('all', monthParam ? String(monthParam) : undefined);
    const target = enrichedList.find((b) => b.id === id);
    if (!target) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Budget not found.' });
    }

    const emailResult = await sendAccountUsageEmail(
      target,
      'instant',
      overrideEmails.length > 0 ? overrideEmails : undefined
    );
    if (emailResult.sent) {
      await markManualEmailSent(id);
      target.lastManualEmailAt = new Date().toISOString();
    }

    return res.json({
      success: true,
      emailResult,
      budget: target,
    });
  } catch (err: any) {
    console.error('Error sending instant budget usage email:', err.message);
    return res.status(500).json({ error: 'EMAIL_ERROR', message: err.message });
  }
});

// 6. Instant email button directly from any cloud account row (AWS, Azure, or GCP)
router.post('/send-account-email', async (req: Request, res: Response) => {
  try {
    const {
      cloudProvider,
      accountId,
      accountName,
      alertEmail,
      alertEmails,
      contactName,
      monthlyBudget,
      billingCurrency,
      month,
    } = req.body || {};

    const provider = parseProvider(cloudProvider);
    if (!provider) {
      return res.status(400).json({
        error: 'INVALID_PROVIDER',
        message: 'cloudProvider must be aws, azure, or gcp.',
      });
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return res.status(400).json({ error: 'INVALID_ACCOUNT_ID', message: 'accountId is required.' });
    }

    const [usageList, existingBudgets] = await Promise.all([
      getCloudAccountsUsage(provider, month ? String(month) : undefined),
      listRawBudgets(provider),
    ]);

    const cleanId = accountId.trim();
    const cleanName = typeof accountName === 'string' && accountName.trim() ? accountName.trim() : cleanId;

    const saved = existingBudgets.find(
      (b) =>
        b.accountId.toLowerCase() === cleanId.toLowerCase() ||
        b.accountName.toLowerCase() === cleanName.toLowerCase()
    );

    const rawTargetEmails = alertEmails ?? alertEmail ?? saved?.alertEmails ?? saved?.alertEmail ?? '';
    const validEmails = normalizeEmailList(rawTargetEmails);
    if (validEmails.length === 0) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: 'Please provide at least one valid recipient email address.',
      });
    }

    const matchedUsage = matchAccountUsage(
      { cloudProvider: provider, accountId: cleanId, accountName: cleanName },
      usageList
    );

    const resolvedLimit =
      Number(monthlyBudget) > 0 ? Number(monthlyBudget) : saved ? saved.monthlyBudget : 0;
    const resolvedCurrency: 'USD' | 'INR' =
      String(billingCurrency || '').toUpperCase() === 'INR'
        ? 'INR'
        : String(billingCurrency || '').toUpperCase() === 'USD'
        ? 'USD'
        : saved?.billingCurrency || matchedUsage?.billingCurrency || (provider === 'azure' ? 'INR' : 'USD');

    const nowIso = new Date().toISOString();
    const pseudoStored = {
      id: saved?.id || 0,
      cloudProvider: provider,
      accountId: cleanId,
      accountName: matchedUsage?.accountName || cleanName,
      parentAccountId: matchedUsage?.parentAccountId || saved?.parentAccountId || null,
      monthlyBudget: resolvedLimit,
      billingCurrency: resolvedCurrency,
      alertEmail: validEmails.join(', '),
      alertEmails: validEmails,
      contactName: contactName ? String(contactName).trim() : saved?.contactName || null,
      isActive: true,
      lastNotifiedThreshold: saved?.lastNotifiedThreshold || null,
      lastNotifiedMonth: saved?.lastNotifiedMonth || null,
      lastNotifiedAt: saved?.lastNotifiedAt || null,
      lastManualEmailAt: saved?.lastManualEmailAt || null,
      createdAt: saved?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const enriched = await resolveAccountSpecificTopServices(
      enrichBudgetWithUsage(
        pseudoStored,
        matchedUsage,
        month ? String(month) : undefined
      )
    );
    if (resolvedLimit <= 0) {
      enriched.percentUsed = 0;
      enriched.remainingBudget = 0;
      enriched.overBudgetAmount = 0;
      enriched.status = 'NORMAL';
      enriched.thresholdCrossed = null;
    }

    const emailResult = await sendAccountUsageEmail(enriched, 'instant', validEmails.join(', '));
    if (saved && emailResult.sent) {
      await markManualEmailSent(saved.id);
      enriched.lastManualEmailAt = new Date().toISOString();
    }

    return res.json({
      success: true,
      emailResult,
      account: enriched,
    });
  } catch (err: any) {
    console.error('Error sending instant account usage email:', err.message);
    return res.status(500).json({ error: 'EMAIL_ERROR', message: err.message });
  }
});

// 7. Evaluate all active manual budgets and send threshold emails (50%, 75%, 100%, OVER_BUDGET)
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const providerParam = String(req.body?.provider || req.query.provider || 'all').toLowerCase();
    const monthParam = req.body?.month || req.query.month;
    const summary = await evaluateAndNotifyAllAccountBudgets({
      provider: providerParam,
      month: monthParam ? String(monthParam) : undefined,
    });
    return res.json({
      success: true,
      ...summary,
    });
  } catch (err: any) {
    console.error('Error evaluating manual budgets:', err.message);
    return res.status(500).json({ error: 'EVALUATION_ERROR', message: err.message });
  }
});

export default router;
