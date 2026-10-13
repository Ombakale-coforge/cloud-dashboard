import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';

const router = Router();

function toBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === 'yes' || s === 'true' || s === '1';
  }
  if (typeof val === 'number') return val === 1;
  return false;
}

function toDecimal(val: any): number | null {
  if (val == null || val === '') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? null : num;
}

function formatAccountRequest(r: any) {
  return {
    id: r.legacyId || String(r.id),
    sqlId: r.id,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : new Date().toISOString(),
    submitterEmail: r.submitterEmail,
    submitterName: r.submitterName || r.submitterEmail?.split('@')[0] || '',
    status: r.status || 'pending',
    adminNotes: r.adminNotes || '',
    adminComment: r.adminNotes || '',
    reviewedBy: r.reviewedByName || (r.reviewedBy ? r.reviewedBy.name : null) || null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,

    // Step 1 - Project Info
    division: r.division || '',
    projectName: r.projectName || '',
    accountEnvironment:
      r.environments && r.environments.length > 0
        ? r.environments.map((e: any) => e.environment).join(', ')
        : '',
    businessJustification: r.businessJustification || '',
    pointOfContact: r.pointOfContact || '',
    accountManager: r.accountManager || '',

    // Step 2 - Account Config
    adminEmails: r.adminEmails ? r.adminEmails.map((a: any) => a.email) : [],
    managedByCoforge: r.managedByCoforge ? 'Yes' : 'No',
    externalAudienceAccess: r.externalAudienceAccess ? 'Yes' : 'No',
    storesCustomerData: r.storesCustomerData ? 'Yes' : 'No',
    customerDataDetails: r.customerDataDetails || '',
    storesConfidentialData: r.storesConfidentialData ? 'Yes' : 'No',

    // Step 3 - Financials
    estimatedMonthlyCost: r.estimatedMonthlyCost != null ? Number(r.estimatedMonthlyCost).toString() : '0',
    costChargedBack: r.costChargedBack ? 'Yes' : 'No',
    foreseenInBudget: r.foreseenInBudget ? 'Yes' : 'No',
    wbsCode: r.wbsCode || '',
    costCenter: r.costCenter || '',
    awsPartnershipRelated: r.awsPartnershipRelated ? 'Yes' : 'No',
    budgetAlertEmails: r.budgetAlertEmails ? r.budgetAlertEmails.map((b: any) => b.email) : [],
    buFinanceController: r.buFinanceController || '',
    statusHistory: r.statusHistory || [],
  };
}

// 1. Get all account requests
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { status, email } = req.query;
    const where: any = {};
    if (status && typeof status === 'string' && status !== 'all') {
      where.status = status;
    }
    if (email && typeof email === 'string') {
      where.submitterEmail = email.toLowerCase();
    }

    const requests = await prisma.accountRequest.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      include: {
        environments: true,
        adminEmails: true,
        budgetAlertEmails: true,
        submittedBy: {
          select: { id: true, name: true, email: true },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
        statusHistory: {
          orderBy: { changedAt: 'desc' },
        },
      },
    });

    const formatted = requests.map(formatAccountRequest);
    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err: any) {
    console.error('Fetch requests error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 2. Submit a new account request
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const body = req.body;
    const submitterEmail = (body.submitterEmail || body.pointOfContact || '').trim().toLowerCase();

    if (!submitterEmail) {
      return res.status(400).json({ error: 'Submitter email is required.' });
    }

    let submittedByUserId: number | null = null;
    const existingUser = await prisma.user.findUnique({
      where: { email: submitterEmail },
    });
    if (existingUser) {
      submittedByUserId = existingUser.id;
    }

    // Parse environments
    let envList: string[] = [];
    if (Array.isArray(body.accountEnvironment)) {
      envList = body.accountEnvironment.map((e: any) => String(e).trim()).filter(Boolean);
    } else if (typeof body.accountEnvironment === 'string') {
      envList = body.accountEnvironment
        .split(',')
        .map((e: string) => e.trim())
        .filter(Boolean);
    }
    envList = Array.from(new Set(envList));

    // Parse admin emails
    let adminEmailList: string[] = [];
    if (Array.isArray(body.adminEmails)) {
      adminEmailList = body.adminEmails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean);
    } else if (typeof body.adminEmails === 'string') {
      adminEmailList = body.adminEmails.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    }
    adminEmailList = Array.from(new Set(adminEmailList));
    if (adminEmailList.length === 0 && submitterEmail) {
      adminEmailList.push(submitterEmail);
    }

    // Parse budget alert emails
    let budgetEmailList: string[] = [];
    if (Array.isArray(body.budgetAlertEmails)) {
      budgetEmailList = body.budgetAlertEmails.map((e: any) => String(e).trim().toLowerCase()).filter(Boolean);
    } else if (typeof body.budgetAlertEmails === 'string') {
      budgetEmailList = body.budgetAlertEmails.split(',').map((e: string) => e.trim().toLowerCase()).filter(Boolean);
    }
    budgetEmailList = Array.from(new Set(budgetEmailList));

    const legacyId = body.id || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const submitterName = body.submitterName || submitterEmail.split('@')[0];

    const newRequest = await prisma.accountRequest.create({
      data: {
        legacyId,
        submitterEmail,
        submitterName,
        submittedByUserId,
        status: 'pending',
        division: (body.division || 'General').trim(),
        projectName: (body.projectName || 'AWS Account Request').trim(),
        businessJustification: body.businessJustification?.trim() || null,
        pointOfContact: (body.pointOfContact || submitterEmail).trim(),
        accountManager: (body.accountManager || '').trim(),
        managedByCoforge: toBool(body.managedByCoforge),
        externalAudienceAccess: toBool(body.externalAudienceAccess),
        storesCustomerData: toBool(body.storesCustomerData),
        customerDataDetails: body.customerDataDetails?.trim() || null,
        storesConfidentialData: toBool(body.storesConfidentialData),
        estimatedMonthlyCost: toDecimal(body.estimatedMonthlyCost),
        costChargedBack: toBool(body.costChargedBack),
        foreseenInBudget: toBool(body.foreseenInBudget),
        wbsCode: body.wbsCode?.trim() || null,
        costCenter: body.costCenter?.trim() || null,
        awsPartnershipRelated: toBool(body.awsPartnershipRelated),
        buFinanceController: body.buFinanceController?.trim() || null,
        environments: {
          create: envList.map((environment) => ({ environment })),
        },
        adminEmails: {
          create: adminEmailList.map((email) => ({ email })),
        },
        budgetAlertEmails: {
          create: budgetEmailList.map((email) => ({ email })),
        },
        statusHistory: {
          create: {
            toStatus: 'pending',
            note: 'Submitted via portal',
            changedByName: submitterName,
            changedByUserId: submittedByUserId,
          },
        },
      },
      include: {
        environments: true,
        adminEmails: true,
        budgetAlertEmails: true,
        submittedBy: true,
        reviewedBy: true,
        statusHistory: true,
      },
    });

    const formatted = formatAccountRequest(newRequest);
    res.status(201).json({
      success: true,
      message: 'Account request submitted successfully.',
      data: formatted,
    });
  } catch (err: any) {
    console.error('Submit request error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 3. Update request status (Admin approval/rejection)
const handleStatusUpdate = async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const paramId = req.params.id;
    const numId = parseInt(paramId, 10);
    const existing = await prisma.accountRequest.findFirst({
      where: {
        OR: [
          ...(!isNaN(numId) ? [{ id: numId }] : []),
          { legacyId: paramId },
        ],
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: `Request '${paramId}' not found.` });
    }

    const { status, adminNotes, adminComment, reviewedBy, reviewerEmail } = req.body;
    const finalNotes = adminNotes !== undefined ? adminNotes : (adminComment !== undefined ? adminComment : null);
    const reviewerName = reviewedBy || 'Admin';

    let reviewerUserId: number | null = null;
    if (reviewerEmail) {
      const rev = await prisma.user.findUnique({
        where: { email: reviewerEmail.trim().toLowerCase() },
      });
      if (rev) reviewerUserId = rev.id;
    }

    const updated = await prisma.accountRequest.update({
      where: { id: existing.id },
      data: {
        status: status || existing.status,
        adminNotes: finalNotes !== null ? finalNotes : existing.adminNotes,
        reviewedByName: reviewerName,
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
        statusHistory:
          status && status !== existing.status
            ? {
                create: {
                  fromStatus: existing.status,
                  toStatus: status,
                  note: finalNotes,
                  changedByName: reviewerName,
                  changedByUserId: reviewerUserId,
                },
              }
            : undefined,
      },
      include: {
        environments: true,
        adminEmails: true,
        budgetAlertEmails: true,
        submittedBy: true,
        reviewedBy: true,
        statusHistory: true,
      },
    });

    res.json({ success: true, data: formatAccountRequest(updated) });
  } catch (err: any) {
    console.error('Update request status error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
};

router.put('/:id/status', handleStatusUpdate);
router.patch('/:id/status', handleStatusUpdate);
router.put('/:id', handleStatusUpdate);

// 4. Delete a request
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const paramId = req.params.id;
    const numId = parseInt(paramId, 10);
    const existing = await prisma.accountRequest.findFirst({
      where: {
        OR: [
          ...(!isNaN(numId) ? [{ id: numId }] : []),
          { legacyId: paramId },
        ],
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Request not found.' });
    }

    await prisma.accountRequest.delete({
      where: { id: existing.id },
    });

    res.json({ success: true, message: 'Request deleted successfully.' });
  } catch (err: any) {
    console.error('Delete request error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

export default router;
