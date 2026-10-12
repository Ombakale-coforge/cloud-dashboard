import { Router, Request, Response } from 'express';
import { prisma } from '../db.ts';
import { verifyPassword } from '../auth/password.ts';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const router = Router();

function getAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'dashboard-admin@coforge.com').trim().toLowerCase();
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || '8iie9gb';
}

// Login Endpoint (Strictly queries SQL Server dbo.users)
router.post('/login', async (req: Request, res: Response) => {
  try {
    if (!prisma) {
      return res.status(503).json({ error: 'DB_ERROR', message: 'SQL Server database is not connected.' });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminEmail = getAdminEmail();
    const envAdminPassword = getAdminPassword();

    // 1. Admin Verification
    if (normalizedEmail === adminEmail) {
      let isMatch = password === envAdminPassword || password === envAdminPassword.trim();

      // Also check fallback to legacy password
      if (!isMatch && password === '8iie9gb') {
        isMatch = true;
      }

      // If not matched by env password, check if admin user exists in SQL Server dbo.users
      let dbUser: any = null;
      if (!isMatch && prisma) {
        try {
          dbUser = await prisma.user.findUnique({
            where: { email: normalizedEmail },
          });
          if (dbUser && dbUser.role === 'admin') {
            const { ok } = await verifyPassword(password, dbUser.passwordHash, dbUser.passwordAlgo);
            if (ok || dbUser.passwordHash === password) {
              isMatch = true;
            }
          }
        } catch {
          // Ignore DB lookup error and proceed to failure
        }
      }

      if (isMatch) {
        await prisma.userLoginEvent.create({
          data: {
            emailAttempted: normalizedEmail,
            outcome: 'success',
          },
        }).catch(() => {});

        return res.json({
          success: true,
          user: {
            id: dbUser?.id || 'admin-01',
            name: dbUser?.name || 'Dashboard Administrator',
            email: adminEmail,
            role: 'admin',
            department: dbUser?.department || 'Cloud Governance & FinOps',
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

    const { ok: passwordMatches } = await verifyPassword(
      password,
      user.passwordHash,
      user.passwordAlgo
    );

    if (!passwordMatches && user.passwordHash !== password) {
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
  } catch (err: any) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

// Signup Endpoint (Strictly writes to SQL Server dbo.users)
router.post('/signup', async (req: Request, res: Response) => {
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

    if (normalizedEmail === getAdminEmail()) {
      return res.status(400).json({
        error: 'RESERVED_EMAIL',
        message: 'This email is reserved for Admin authentication.',
      });
    }

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
      },
    });

    return res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department,
        provider: 'credentials',
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'DB_ERROR', message: err.message });
  }
});

export default router;
