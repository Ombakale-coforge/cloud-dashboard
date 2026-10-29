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

const DEFAULT_ADMIN_EMAILS = [
  'dashboard-admin@coforge.com',
  'omparashuram.b@coforge.com',
  'jayant.goyal@coforge.com',
  'ankit.a@coforge.com',
];

function getAdminEmails(): Set<string> {
  const raw = [
    ...DEFAULT_ADMIN_EMAILS,
    ...(process.env.ADMIN_EMAIL || '').split(','),
    ...(process.env.ADMIN_EMAILS || '').split(','),
  ];
  return new Set(
    raw
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || 'dashboard-admin@coforge.com').split(',')[0].trim().toLowerCase();
}

function isAdminEmail(email: string): boolean {
  if (!email) return false;
  return getAdminEmails().has(email.trim().toLowerCase());
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || '8iie9gb';
}

function getAzureConfig(req?: Request) {
  const tenantId = (process.env.AZURE_AD_TENANT_ID || process.env.AZURE_TENANT_ID || '').trim();
  const clientId = (process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '').trim();

  const envRedirect = process.env.AZURE_AD_REDIRECT_URI?.trim();
  let redirectUri = envRedirect;

  if (req) {
    const host = String(req.headers['x-forwarded-host'] || req.get('host') || '');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');

    if (isLocal) {
      redirectUri = 'http://localhost:3001/api/auth/azure/callback';
    } else if (!redirectUri || redirectUri.includes('localhost') || redirectUri.includes('127.0.0.1')) {
      const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : req.protocol);
      redirectUri = `${proto}://${host}/api/auth/azure/callback`;
    }
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    redirectUri: redirectUri || 'http://localhost:3001/api/auth/azure/callback',
    isConfigured: !!(tenantId && clientId && clientSecret),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Standard Login Endpoint (Strictly queries SQL Server dbo.users)
// ─────────────────────────────────────────────────────────────────────────────
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
    const envAdminPassword = getAdminPassword();

    // 1. Admin Verification
    if (isAdminEmail(normalizedEmail)) {
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
            email: normalizedEmail,
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. Signup Endpoint (Strictly writes to SQL Server dbo.users)
// ─────────────────────────────────────────────────────────────────────────────
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
        provider: 'credentials',
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

// ─────────────────────────────────────────────────────────────────────────────
// 3. Azure Active Directory / Microsoft Entra SSO Endpoints
// ─────────────────────────────────────────────────────────────────────────────

// Status check: returns whether Azure AD credentials are set
router.get('/azure/status', (req: Request, res: Response) => {
  const { isConfigured, redirectUri } = getAzureConfig(req);
  res.json({
    configured: isConfigured,
    redirectUri,
  });
});

// Initiate Azure SSO redirect
router.get('/azure', (req: Request, res: Response) => {
  const { tenantId, clientId, redirectUri, isConfigured } = getAzureConfig(req);

  if (!isConfigured) {
    return res.status(503).json({
      error: 'AZURE_SSO_NOT_CONFIGURED',
      message: 'Azure AD SSO credentials (AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET) are missing in environment variables.',
    });
  }

  const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : '/login';
  const statePayload = Buffer.from(JSON.stringify({ returnTo, ts: Date.now() })).toString('base64url');

  const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', 'openid profile email User.Read');
  authUrl.searchParams.set('state', statePayload);
  authUrl.searchParams.set('prompt', 'select_account');

  return res.redirect(authUrl.toString());
});

// Azure OAuth2 Callback handler
router.get('/azure/callback', async (req: Request, res: Response) => {
  let returnUrl = '/login';

  try {
    const { code, state, error, error_description } = req.query;

    // Decode state to retrieve return URL
    if (typeof state === 'string') {
      try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
        if (decodedState.returnTo && typeof decodedState.returnTo === 'string') {
          returnUrl = decodedState.returnTo;
        }
      } catch {}
    }

    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : req.protocol);
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${proto}://${host}`;

    if (error) {
      console.error('Azure AD SSO Error from Microsoft:', error, error_description);
      const targetUrl = new URL(returnUrl, baseUrl);
      targetUrl.searchParams.set('sso_error', String(error_description || error));
      return res.redirect(targetUrl.toString());
    }

    if (!code || typeof code !== 'string') {
      const targetUrl = new URL(returnUrl, baseUrl);
      targetUrl.searchParams.set('sso_error', 'No authorization code returned from Microsoft.');
      return res.redirect(targetUrl.toString());
    }

    const { tenantId, clientId, clientSecret, redirectUri, isConfigured } = getAzureConfig(req);
    if (!isConfigured) {
      const targetUrl = new URL(returnUrl, baseUrl);
      targetUrl.searchParams.set('sso_error', 'Azure SSO credentials are not configured on the server.');
      return res.redirect(targetUrl.toString());
    }

    // 1. Exchange code for OAuth2 tokens
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Azure token exchange failed:', tokenData);
      const errMsg = tokenData.error_description || tokenData.error || 'Failed to exchange token with Microsoft.';
      const targetUrl = new URL(returnUrl, baseUrl);
      targetUrl.searchParams.set('sso_error', errMsg);
      return res.redirect(targetUrl.toString());
    }

    // 2. Fetch User Profile from Microsoft Graph
    let graphUser: any = {};
    try {
      const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (graphRes.ok) {
        graphUser = await graphRes.json();
      }
    } catch (gErr: any) {
      console.warn('MS Graph fetch failed, falling back to ID token:', gErr.message);
    }

    // Resolve email (Graph mail -> userPrincipalName -> ID token fallback)
    let email = graphUser.mail || graphUser.userPrincipalName;
    if (!email && tokenData.id_token) {
      try {
        const payloadBase64 = tokenData.id_token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
        email = decoded.email || decoded.preferred_username || decoded.upn;
      } catch {}
    }

    if (!email) {
      const targetUrl = new URL(returnUrl, baseUrl);
      targetUrl.searchParams.set('sso_error', 'Could not retrieve email address from your Microsoft profile.');
      return res.redirect(targetUrl.toString());
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const displayName = graphUser.displayName || normalizedEmail.split('@')[0].replace(/[._-]/g, ' ');
    const department = graphUser.department || graphUser.jobTitle || 'Digital Engineering';
    const isSystemAdmin = isAdminEmail(normalizedEmail);

    // 3. Upsert user in SQL Server dbo.users (with resilient fallback if DB is unreachable)
    let userRecord: any = null;
    if (prisma) {
      try {
        userRecord = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (userRecord) {
          userRecord = await prisma.user.update({
            where: { id: userRecord.id },
            data: {
              lastLoginAt: new Date(),
              provider: 'azure-ad',
              ...(isSystemAdmin ? { role: 'admin' } : {}),
            },
          }).catch(() => userRecord);
        } else {
          userRecord = await prisma.user.create({
            data: {
              name: displayName,
              email: normalizedEmail,
              passwordHash: 'SSO_MANAGED_AZURE_AD',
              passwordAlgo: 'sso',
              department,
              role: isSystemAdmin ? 'admin' : 'basic',
              provider: 'azure-ad',
              lastLoginAt: new Date(),
            },
          }).catch((err: any) => {
            console.error('Failed to create SSO user in SQL Server:', err);
            return null;
          });
        }

        // Log successful login audit
        await prisma.userLoginEvent.create({
          data: {
            userId: userRecord?.id || null,
            emailAttempted: normalizedEmail,
            outcome: 'success',
            userAgent: req.headers['user-agent']?.slice(0, 500) || 'Azure AD SSO',
          },
        }).catch(() => {});
      } catch (dbErr: any) {
        console.warn('⚠️ [SSO] SQL Server is unreachable (VPN may be off). Proceeding with SSO session:', dbErr.message);
      }
    }

    const authPayload = {
      id: userRecord?.id || `sso-${Date.now()}`,
      name: userRecord?.name || displayName,
      email: normalizedEmail,
      role: isSystemAdmin ? 'admin' : (userRecord?.role || 'basic'),
      department: userRecord?.department || department,
      provider: 'azure-ad',
      loginTime: new Date().toISOString(),
    };

    const targetUrl = new URL(returnUrl, baseUrl);
    targetUrl.searchParams.set('sso_user', JSON.stringify(authPayload));
    return res.redirect(targetUrl.toString());
  } catch (err: any) {
    console.error('Azure SSO callback exception:', err);
    const targetUrl = new URL(returnUrl, 'http://localhost');
    targetUrl.searchParams.set('sso_error', err.message || 'SSO authentication error');
    return res.redirect(targetUrl.toString());
  }
});

export default router;
