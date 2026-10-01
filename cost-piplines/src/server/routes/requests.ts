import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';

const router = Router();

// 1. Get all access/account requests
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { status, email } = req.query;
    const where: any = {};
    if (status && typeof status === 'string') {
      where.status = status;
    }
    if (email && typeof email === 'string') {
      where.requesterEmail = email.toLowerCase();
    }

    const requests = await prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        requesterUser: {
          select: { id: true, name: true, email: true, department: true },
        },
        reviewerUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const formatted = requests.map((r) => ({
      id: r.id,
      requestType: r.requestType,
      requesterName: r.requesterName,
      requesterEmail: r.requesterEmail,
      department: r.department,
      justification: r.justification,
      status: r.status,
      requestedAccountId: r.requestedAccountId,
      requestedAccountName: r.requestedAccountName,
      requestedRole: r.requestedRole,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      adminComment: r.adminComment,
      metaJson: r.metaJson ? JSON.parse(r.metaJson) : null,
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (err: any) {
    console.error('Fetch requests error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 2. Submit a new access request
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const {
      requestType = 'account_onboarding',
      requesterName,
      requesterEmail,
      department,
      justification,
      requestedAccountId,
      requestedAccountName,
      requestedRole,
      meta,
    } = req.body;

    if (!requesterEmail) {
      return res.status(400).json({ error: 'Requester email is required' });
    }

    let requesterUserId: number | null = null;
    const existingUser = await prisma.user.findUnique({
      where: { email: requesterEmail.trim().toLowerCase() },
    });
    if (existingUser) {
      requesterUserId = existingUser.id;
    }

    const newRequest = await prisma.accessRequest.create({
      data: {
        requestType,
        requesterUserId,
        requesterName: requesterName?.trim() || requesterEmail.split('@')[0],
        requesterEmail: requesterEmail.trim().toLowerCase(),
        department: department?.trim() || 'Engineering',
        justification: justification?.trim() || 'Access requested for cost analysis',
        status: 'pending',
        requestedAccountId: requestedAccountId || null,
        requestedAccountName: requestedAccountName || null,
        requestedRole: requestedRole || 'requester',
        metaJson: meta ? JSON.stringify(meta) : null,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Access request submitted successfully.',
      data: newRequest,
    });
  } catch (err: any) {
    console.error('Submit request error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// 3. Update request status (Admin approval/rejection)
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const requestId = parseInt(req.params.id, 10);
    if (isNaN(requestId)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const { status, adminComment, reviewerEmail } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved, rejected, or pending.' });
    }

    let reviewerUserId: number | null = null;
    if (reviewerEmail) {
      const rev = await prisma.user.findUnique({
        where: { email: reviewerEmail.trim().toLowerCase() },
      });
      if (rev) reviewerUserId = rev.id;
    }

    const updated = await prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        status,
        adminComment: adminComment || null,
        reviewerUserId,
        resolvedAt: status !== 'pending' ? new Date() : null,
      },
    });

    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('Update request status error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

export default router;
