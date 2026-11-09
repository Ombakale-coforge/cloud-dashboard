import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';
import { ClientSecretCredential } from '@azure/identity';

const router = Router();

async function sendRequestNotificationEmail(reqData: any) {
  try {
    const tenantId = process.env.AZURE_TENANT_ID || process.env.AZURE_AD_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      console.warn('⚠️ [Email] Azure credentials missing. Skipping automated notification.');
      return;
    }

    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const { token } = await credential.getToken('https://graph.microsoft.com/.default');

    const sender = process.env.SENDER_EMAIL?.trim() || 'omparashuram.b@coforge.com';
    const recipients = ['ankit.a@coforge.com'];
    const subject = `AWS Account Provisioning Request: ${reqData.projectName} (${reqData.division})`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 24px; color: #ffffff;">
          <h2 style="margin: 0 0 6px 0; font-size: 20px;">AWS Account Provisioning Request</h2>
          <p style="margin: 0; font-size: 13px; opacity: 0.9;">Cloud Cost Intelligence &amp; FinOps Governance Portal</p>
        </div>
        
        <div style="padding: 24px;">
          <p style="margin-top: 0; font-size: 15px; font-weight: bold;">Dear Ankit,</p>
          <p style="font-size: 14px; line-height: 1.5; color: #475569;">
            A new AWS Account Request has been submitted by <strong>${reqData.submitterName || reqData.submitterEmail}</strong> (<code>${reqData.submitterEmail}</code>).
          </p>

          <table style="width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 10px; color: #475569;" colspan="2">1. Project &amp; Department Information</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b; width: 40%;">Division / BU:</td><td style="padding: 8px 10px; font-weight: bold;">${reqData.division}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Project / Dept:</td><td style="padding: 8px 10px; font-weight: bold;">${reqData.projectName}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Environments:</td><td style="padding: 8px 10px;">${reqData.accountEnvironment || 'DEV, UAT, PROD'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Point of Contact:</td><td style="padding: 8px 10px;">${reqData.pointOfContact}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Account Manager:</td><td style="padding: 8px 10px;">${reqData.accountManager || 'N/A'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Business Justification:</td><td style="padding: 8px 10px;">${reqData.businessJustification || 'N/A'}</td></tr>
            </tbody>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 10px; color: #475569;" colspan="2">2. Account Configuration &amp; Governance</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b; width: 40%;">Admin Emails:</td><td style="padding: 8px 10px; font-weight: bold;">${Array.isArray(reqData.adminEmails) ? reqData.adminEmails.join(', ') : reqData.adminEmails}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Managed By Coforge:</td><td style="padding: 8px 10px;">${reqData.managedByCoforge ? 'Yes' : 'No'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">External Audiences:</td><td style="padding: 8px 10px;">${reqData.externalAudienceAccess ? 'Yes' : 'No'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Customer / Conf Data:</td><td style="padding: 8px 10px;">${reqData.storesCustomerData ? 'Yes' : 'No'} / ${reqData.storesConfidentialData ? 'Yes' : 'No'}</td></tr>
            </tbody>
          </table>

          <table style="width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; text-align: left;">
                <th style="padding: 10px; color: #475569;" colspan="2">3. Financials &amp; Budget</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b; width: 40%;">Estimated Monthly Cost:</td><td style="padding: 8px 10px; font-size: 14px; font-weight: bold; color: #16a34a;">$${Number(reqData.estimatedMonthlyCost || 0).toLocaleString()} USD</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">WBS Code:</td><td style="padding: 8px 10px;">${reqData.wbsCode || 'N/A'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">Cost Center:</td><td style="padding: 8px 10px;">${reqData.costCenter || 'N/A'}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 10px; color: #64748b;">BU Finance Controller:</td><td style="padding: 8px 10px;">${reqData.buFinanceController || 'N/A'}</td></tr>
            </tbody>
          </table>

          <div style="margin-top: 24px; padding: 14px; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; text-align: center;">
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #3730a3; font-weight: bold;">Review and approve this request directly in the FinOps Admin Command Center.</p>
            <p style="margin: 0; font-size: 11px; color: #6366f1;">Request ID: ${reqData.id || reqData.legacyId || 'New'} &bull; Submitted: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    `;

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlContent },
            toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          },
          saveToSentItems: true,
        }),
      }
    );

    if (res.status === 202) {
      console.log('📧 [Automated Email] Request email dispatched via Microsoft Graph to:', recipients.join(', '));
    } else {
      const errText = await res.text();
      console.warn(`⚠️ [Automated Email] Graph sendMail returned status ${res.status}:`, errText);
    }
  } catch (emailErr: any) {
    console.error('⚠️ [Automated Email] Failed to send email via Graph:', emailErr.message);
  }
}

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
    const submitterDisplayName = (body.submitterName || submitterEmail.split('@')[0].replace(/[._-]/g, ' ')).trim();
    const existingUser = await prisma.user.findUnique({
      where: { email: submitterEmail },
    });
    if (existingUser) {
      submittedByUserId = existingUser.id;
    } else {
      const createdSsoUser = await prisma.user.create({
        data: {
          name: submitterDisplayName,
          email: submitterEmail,
          passwordHash: 'SSO_MANAGED_AZURE_AD',
          passwordAlgo: 'sso',
          department: (body.division || 'Digital Engineering').trim(),
          role: 'basic',
          provider: 'azure-ad',
          lastLoginAt: new Date(),
        },
      }).catch(() => null);
      if (createdSsoUser) {
        submittedByUserId = createdSsoUser.id;
      }
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

    // Automatically send email to ankit.a@coforge.com & omparashuram.b@coforge.com via Microsoft Graph
    sendRequestNotificationEmail(formatted).catch((e) =>
      console.error('Background notification error:', e.message)
    );

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
