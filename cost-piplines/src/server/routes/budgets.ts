import { Router, Request, Response } from 'express';
import {
  type CloudProvider,
  type EnrichedAccountBudget,
  type StoredAccountBudget,
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
  seedAllAccountBudgetsFromLastMonthSpend,
  computeBudgetEvaluation,
} from '../services/accountBudgetService.ts';
import { requireAuth } from '../auth/middleware.ts';
import {
  findOwnedAccount,
  getOwnedCloudAccounts,
  normalizeSubscriptionId,
  type OwnedCloudAccount,
} from '../services/accountOwnershipService.ts';

const router = Router();

const VALID_PROVIDERS = new Set<CloudProvider>(['aws', 'azure', 'gcp']);

function parseProvider(raw: unknown): CloudProvider | null {
  const val = String(raw || '').trim().toLowerCase();
  return VALID_PROVIDERS.has(val as CloudProvider) ? (val as CloudProvider) : null;
}

function matchesOwnedAccountIdOrName(
  provider: CloudProvider,
  candidateId: string,
  candidateName: string,
  owned: OwnedCloudAccount
): boolean {
  if (provider !== owned.cloudProvider) return false;
  if (provider === 'azure') {
    if (normalizeSubscriptionId(candidateId) === owned.accountId) return true;
  } else if (candidateId.trim().toLowerCase() === owned.accountId.toLowerCase()) {
    return true;
  }
  return candidateName.trim().toLowerCase() === owned.accountName.toLowerCase();
}

async function enrichAndNotifySavedBudget(
  saved: StoredAccountBudget,
  month?: string,
  notifyImmediatelyIfBreached: boolean = true
): Promise<{ enriched: EnrichedAccountBudget; emailNotification: any }> {
  const usageList = await getCloudAccountsUsage(saved.cloudProvider, month);
  const matchedUsage = matchAccountUsage(saved, usageList);
  const enriched = await resolveAccountSpecificTopServices(
    enrichBudgetWithUsage(saved, matchedUsage, month)
  );

  let emailNotification: any = null;
  if (
    notifyImmediatelyIfBreached &&
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

  return { enriched, emailNotification };
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

      const lastSpend = acc.previousSpend > 0 ? acc.previousSpend : acc.currentSpend;
      const defaultBudgetLimit = acc.suggestedBudget || (lastSpend > 0 ? Math.round(lastSpend * 1.05 * 100) / 100 : 100);

      const effectiveBudget = matchedBudget || {
        id: -1,
        cloudProvider: acc.cloudProvider,
        accountId: acc.accountId,
        accountName: acc.accountName,
        parentAccountId: acc.parentAccountId || null,
        monthlyBudget: defaultBudgetLimit,
        billingCurrency: acc.billingCurrency,
        alertEmail: acc.ownerEmail || 'finops@company.com',
        alertEmails: acc.ownerEmail ? [acc.ownerEmail] : ['finops@company.com'],
        contactName: acc.ownerName || `${acc.accountName} Team`,
        isActive: true,
        ...computeBudgetEvaluation(acc.currentSpend, defaultBudgetLimit),
        currentSpend: acc.currentSpend,
        previousSpend: acc.previousSpend,
        momChangePercent: acc.momChangePercent,
        evaluationMonth: acc.evaluationMonth,
        topCostDriver: acc.topCostDriver,
        topServices: acc.topServices,
        nativeCurrency: acc.billingCurrency,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        ...acc,
        suggestedBudget: defaultBudgetLimit,
        manualBudget: effectiveBudget,
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

// Seed default budget (last month spend + 5%) for all accounts in AWS, Azure, GCP
router.post('/seed-default-budgets', async (req: Request, res: Response) => {
  try {
    const margin = typeof req.body?.marginPercent === 'number' ? req.body.marginPercent : 5;
    const result = await seedAllAccountBudgetsFromLastMonthSpend(margin);
    return res.json({
      success: true,
      message: `Seeded default budgets (last month spend + ${margin}%) for all accounts.`,
      ...result,
    });
  } catch (err: any) {
    console.error('Error seeding default budgets:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 1b. Self-service: list accounts owned by the authenticated user + their budgets & live spend
router.get('/my-accounts', requireAuth, async (req: Request, res: Response) => {
  try {
    const requestedEmail =
      req.user!.role === 'admin' && typeof req.query.email === 'string' && req.query.email.trim()
        ? req.query.email.trim().toLowerCase()
        : req.user!.email.toLowerCase();
    const forceRefresh = req.query.refresh === 'true';
    const monthParam = req.query.month ? String(req.query.month).trim() : undefined;

    const ownedAccounts = await getOwnedCloudAccounts(requestedEmail, { forceRefresh });
    const [usageList, rawBudgets] = await Promise.all([
      getCloudAccountsUsage('all', monthParam),
      listRawBudgets('all'),
    ]);

    const accounts = ownedAccounts.map((owned) => {
      const matchedUsage = usageList.find((u) =>
        matchesOwnedAccountIdOrName(u.cloudProvider, u.accountId, u.accountName, owned)
      );
      const matchedBudgetRow = rawBudgets.find((b) =>
        matchesOwnedAccountIdOrName(b.cloudProvider, b.accountId, b.accountName, owned)
      );
      const manualBudget = matchedBudgetRow
        ? enrichBudgetWithUsage(matchedBudgetRow, matchedUsage, monthParam)
        : null;

      return {
        cloudProvider: owned.cloudProvider,
        accountId: owned.accountId,
        accountName: owned.accountName,
        parentAccountId: matchedUsage?.parentAccountId || owned.parentAccountId || null,
        state: owned.state || matchedUsage?.status || 'ACTIVE',
        ownershipSources: owned.ownershipSources,
        projectCode: owned.projectCode || null,
        costCode: owned.costCode || null,
        evaluationMonth: matchedUsage?.evaluationMonth || monthParam || new Date().toISOString().slice(0, 7),
        currentSpend: matchedUsage?.currentSpend ?? 0,
        previousSpend: matchedUsage?.previousSpend ?? 0,
        momChangePercent: matchedUsage?.momChangePercent ?? 0,
        billingCurrency: matchedUsage?.billingCurrency || (owned.cloudProvider === 'azure' ? 'INR' : 'USD'),
        topCostDriver: matchedUsage?.topCostDriver || (owned.cloudProvider === 'azure' ? 'Azure Services' : 'AWS Services'),
        topServices: matchedUsage?.topServices || [],
        manualBudget,
      };
    });

    return res.json({
      userEmail: requestedEmail,
      totalOwned: accounts.length,
      accounts,
    });
  } catch (err: any) {
    console.error('Error fetching owner accounts:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 1c. Self-service: create or update a manual budget for an account owned by the caller
router.post('/my-accounts/budget', requireAuth, async (req: Request, res: Response) => {
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
    if (!provider || provider === 'gcp') {
      return res.status(400).json({
        error: 'INVALID_PROVIDER',
        message: 'cloudProvider must be azure or aws.',
      });
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      return res.status(400).json({ error: 'INVALID_ACCOUNT_ID', message: 'Account ID is required.' });
    }

    const budgetNum = Number(monthlyBudget);
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      return res.status(400).json({
        error: 'INVALID_BUDGET',
        message: 'Monthly budget must be a positive number.',
      });
    }

    const callerEmail = req.user!.email.toLowerCase();
    const owned = await findOwnedAccount(callerEmail, provider, accountId, accountName);
    if (!owned && req.user!.role !== 'admin') {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You are not listed as an owner of this account.',
      });
    }

    const rawEmails = alertEmails ?? alertEmail ?? callerEmail;
    const validEmails = normalizeEmailList(rawEmails);
    if (validEmails.length === 0) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: 'At least one valid alert email address is required.',
      });
    }

    const currency: 'USD' | 'INR' =
      String(billingCurrency || '').toUpperCase() === 'INR'
        ? 'INR'
        : 'USD';

    const canonicalId = owned?.accountId || accountId.trim();
    const canonicalName =
      owned?.accountName || (typeof accountName === 'string' && accountName.trim() ? accountName.trim() : canonicalId);

    const saved = await upsertBudget({
      cloudProvider: provider,
      accountId: canonicalId,
      accountName: canonicalName,
      parentAccountId: owned?.parentAccountId || (parentAccountId ? String(parentAccountId).trim() : null),
      monthlyBudget: budgetNum,
      billingCurrency: currency,
      alertEmail: validEmails.join(', '),
      contactName: contactName ? String(contactName).trim() : req.user!.name || null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    });

    const { enriched, emailNotification } = await enrichAndNotifySavedBudget(
      saved,
      month ? String(month) : undefined,
      notifyImmediatelyIfBreached !== false
    );

    return res.status(201).json({
      success: true,
      budget: enriched,
      emailNotification,
    });
  } catch (err: any) {
    console.error('Error saving self-service account budget:', err.message);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
});

// 1d. Self-service: delete a manual budget for an account owned by the caller
router.delete('/my-accounts/budget/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'Valid budget id is required.' });
    }

    const rawBudgets = await listRawBudgets('all');
    const existing = rawBudgets.find((b) => b.id === id);
    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Budget not found.' });
    }

    if (req.user!.role !== 'admin') {
      const owned = await findOwnedAccount(
        req.user!.email.toLowerCase(),
        existing.cloudProvider,
        existing.accountId,
        existing.accountName
      );
      if (!owned) {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You are not listed as an owner of this account.',
        });
      }
    }

    await deleteBudget(id);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting self-service account budget:', err.message);
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

    const { enriched, emailNotification } = await enrichAndNotifySavedBudget(
      saved,
      month ? String(month) : undefined,
      notifyImmediatelyIfBreached !== false
    );

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
        : saved?.billingCurrency || (provider === 'azure' ? 'USD' : matchedUsage?.billingCurrency || 'USD');

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
