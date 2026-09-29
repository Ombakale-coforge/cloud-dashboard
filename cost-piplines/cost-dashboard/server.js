import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import {
  getUserByEmail,
  createUser,
  recordLoginEvent,
  verifyPassword,
  getAccountRequests,
  createAccountRequest,
  updateAccountRequestStatus,
  getAwsAccountsMetadata,
  queryAwsTableData,
} from './server-db.js';

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
// Cloudflare R2 S3 Client setup (Fallback support)
// ─────────────────────────────────────────────────────────────
const R2_ACCOUNT_ID =
  process.env.R2_ACCOUNT_ID_FOR_FORM ||
  process.env.r2_account_id_for_form ||
  process.env.R2_ACCOUNT_ID ||
  '';

const R2_ACCESS_KEY_ID =
  process.env.R2_ACCESS_KEY_ID_FOR_FORM ||
  process.env.r2_access_key_id_for_form ||
  process.env.R2_ACCESS_KEY_FOR_FORM ||
  process.env.R2_ACCESS_KEY_ID ||
  '';

const R2_SECRET_ACCESS_KEY =
  process.env.R2_SECRET_ACCESS_KEY_FOR_FORM ||
  process.env.r2_secret_access_key_for_form ||
  process.env.R2_SECRET_KEY_FOR_FORM ||
  process.env.R2_SECRET_ACCESS_KEY ||
  '';

const R2_BUCKET_NAME =
  process.env.R2_BUCKET_NAME_FOR_FORM ||
  process.env.r2_bucket_name_for_form ||
  'cost-dashboard-data';

let s3Client = null;
if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

async function readFromR2(primaryKey, fallbackKey, defaultValue = []) {
  if (!s3Client) return { data: defaultValue, actualKey: primaryKey };
  const keysToTry = [primaryKey, fallbackKey].filter(Boolean);

  for (const key of keysToTry) {
    try {
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      const response = await s3Client.send(command);
      const str = await response.Body.transformToString();
      const parsed = JSON.parse(str);
      return { data: parsed, actualKey: key };
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        continue;
      }
      console.warn(`[R2 Fallback Warning] "${key}":`, err.message);
    }
  }

  return { data: defaultValue, actualKey: primaryKey };
}

async function writeToR2(key, data) {
  if (!s3Client) return;
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: jsonStr,
      ContentType: 'application/json',
    });
    await s3Client.send(command);
  } catch (err) {
    console.warn(`[R2 Fallback Write Warning] Failed to write "${key}":`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Authentication Endpoints (Direct SQL Server with R2 Fallback)
// ─────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'dashboard-admin@coforge.com';
const ADMIN_PASSWORD = '8iie9gb';

// Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Admin Verification
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      if (password === ADMIN_PASSWORD) {
        await recordLoginEvent({
          userId: 1,
          ipAddress: clientIp,
          userAgent,
          eventType: 'login',
          success: true,
        });

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
        await recordLoginEvent({
          userId: null,
          ipAddress: clientIp,
          userAgent,
          eventType: 'login_failed',
          success: false,
          failureReason: 'Invalid Admin Password',
        });

        return res.status(401).json({
          error: 'INVALID_ADMIN_CREDENTIALS',
          message: 'Invalid Admin password. Please check your credentials.',
        });
      }
    }

    // 2. Fetch User from SQL Server
    try {
      const user = await getUserByEmail(normalizedEmail);
      if (user) {
        if (!user.is_active) {
          return res.status(403).json({
            error: 'ACCOUNT_INACTIVE',
            message: 'Your account has been deactivated. Please contact administrator.',
          });
        }

        const isMatch = verifyPassword(password, user.password_hash);
        if (!isMatch) {
          await recordLoginEvent({
            userId: user.id,
            ipAddress: clientIp,
            userAgent,
            eventType: 'login_failed',
            success: false,
            failureReason: 'Invalid Password',
          });

          return res.status(401).json({
            error: 'INVALID_PASSWORD',
            message: 'Incorrect password for this account.',
          });
        }

        await recordLoginEvent({
          userId: user.id,
          ipAddress: clientIp,
          userAgent,
          eventType: 'login',
          success: true,
        });

        return res.json({
          success: true,
          user: {
            id: `usr-${user.id}`,
            name: user.name,
            email: user.email,
            role: user.role || 'basic',
            department: user.department || 'Engineering',
            provider: 'credentials',
            loginTime: new Date().toISOString(),
          },
        });
      }
    } catch (dbErr) {
      console.warn(`[Auth DB Notice]: ${dbErr.message}. Attempting R2 fallback.`);
    }

    // 3. Fallback: Check Cloudflare R2
    const { data: r2Users } = await readFromR2('user.json', 'users.json', []);
    const existingR2User = r2Users.find(
      (u) => u.email && u.email.toLowerCase() === normalizedEmail
    );

    if (!existingR2User) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Account not found. Please sign up to create a new requester account.',
      });
    }

    if (existingR2User.password !== password) {
      return res.status(401).json({
        error: 'INVALID_PASSWORD',
        message: 'Incorrect password for this account.',
      });
    }

    return res.json({
      success: true,
      user: {
        id: existingR2User.id,
        name: existingR2User.name,
        email: existingR2User.email,
        role: existingR2User.role || 'basic',
        department: existingR2User.department || 'Engineering',
        provider: existingR2User.provider || 'credentials',
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'AUTH_ERROR', message: err.message });
  }
});

// Signup Endpoint
app.post('/api/auth/signup', async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  try {
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

    // 1. Try SQL Server
    try {
      const existing = await getUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({
          error: 'USER_ALREADY_EXISTS',
          message: 'An account with this email already exists. Please log in.',
        });
      }

      const created = await createUser({
        name: finalName,
        email: normalizedEmail,
        password,
        department,
        role: 'basic',
      });

      await recordLoginEvent({
        userId: created.id,
        ipAddress: clientIp,
        userAgent,
        eventType: 'signup',
        success: true,
      });

      return res.status(201).json({
        success: true,
        user: {
          id: `usr-${created.id}`,
          name: created.name,
          email: created.email,
          role: created.role,
          department: created.department,
          provider: 'credentials',
          loginTime: new Date().toISOString(),
        },
      });
    } catch (dbErr) {
      console.warn(`[Signup DB Notice]: ${dbErr.message}. Attempting R2 fallback.`);
    }

    // 2. Fallback to Cloudflare R2
    const { data: users, actualKey } = await readFromR2('user.json', 'users.json', []);
    const exists = users.find((u) => u.email && u.email.toLowerCase() === normalizedEmail);

    if (exists) {
      return res.status(409).json({
        error: 'USER_ALREADY_EXISTS',
        message: 'An account with this email already exists. Please log in.',
      });
    }

    const newUser = {
      id: `usr-${Date.now().toString(36)}`,
      name: finalName,
      email: normalizedEmail,
      password: password,
      department: department?.trim() || 'Digital Engineering',
      role: 'basic',
      provider: 'credentials',
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    await writeToR2(actualKey || 'user.json', users);

    return res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: 'basic',
        department: newUser.department,
        provider: 'credentials',
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'SIGNUP_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Account Requests Endpoints (SQL Server with R2 Fallback)
// ─────────────────────────────────────────────────────────────

// Fetch all requests
app.get('/api/requests', async (req, res) => {
  try {
    try {
      const requests = await getAccountRequests();
      return res.json({ success: true, data: requests });
    } catch (dbErr) {
      console.warn(`[Requests DB Notice]: ${dbErr.message}. Falling back to R2.`);
      const { data: requests } = await readFromR2('accound_request.json', 'account_requests.json', []);
      return res.json({ success: true, data: requests });
    }
  } catch (err) {
    res.status(500).json({ error: 'REQUESTS_FETCH_ERROR', message: err.message });
  }
});

// Submit a new request
app.post('/api/requests', async (req, res) => {
  try {
    const requestData = req.body;

    if (!requestData || !requestData.projectName) {
      return res.status(400).json({ error: 'Project name and details are required' });
    }

    try {
      const created = await createAccountRequest(requestData);
      return res.status(201).json({ success: true, data: created });
    } catch (dbErr) {
      console.warn(`[Create Request DB Notice]: ${dbErr.message}. Falling back to R2.`);
      const { data: requests, actualKey } = await readFromR2('accound_request.json', 'account_requests.json', []);
      const newRecord = {
        ...requestData,
        id: requestData.id || `req-${Date.now().toString(36)}`,
        submittedAt: requestData.submittedAt || new Date().toISOString(),
        status: requestData.status || 'pending',
      };
      requests.unshift(newRecord);
      await writeToR2(actualKey || 'accound_request.json', requests);
      return res.status(201).json({ success: true, data: newRecord });
    }
  } catch (err) {
    res.status(500).json({ error: 'CREATE_REQUEST_ERROR', message: err.message });
  }
});

// Admin update status
app.put('/api/requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, reviewedBy } = req.body;

    try {
      const updated = await updateAccountRequestStatus(id, { status, adminNotes, reviewedBy });
      return res.json({ success: true, data: updated });
    } catch (dbErr) {
      console.warn(`[Update Request DB Notice]: ${dbErr.message}. Falling back to R2.`);
      const { data: requests, actualKey } = await readFromR2('accound_request.json', 'account_requests.json', []);
      const index = requests.findIndex((r) => r.id === id);

      if (index === -1) {
        return res.status(404).json({ error: 'Request not found' });
      }

      requests[index] = {
        ...requests[index],
        status: status || requests[index].status,
        adminNotes: adminNotes ?? requests[index].adminNotes,
        reviewedBy: reviewedBy || 'Admin',
        reviewedAt: new Date().toISOString(),
      };

      await writeToR2(actualKey || 'accound_request.json', requests);
      return res.json({ success: true, data: requests[index] });
    }
  } catch (err) {
    res.status(500).json({ error: 'UPDATE_STATUS_ERROR', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AWS Cost Analytics Data Endpoints (Direct SQL Server)
// ─────────────────────────────────────────────────────────────

// Accounts metadata
async function handleAccountsMetadata(req, res) {
  try {
    const accounts = await getAwsAccountsMetadata();
    if (accounts && accounts.length > 0) {
      return res.json(accounts);
    }
  } catch (err) {
    console.warn(`[Accounts Metadata DB Warning]: ${err.message}`);
  }

  // Fallback to static file if DB has not yet been populated
  const localFile = path.resolve(__dirname, 'public/data/accounts.json');
  if (fs.existsSync(localFile)) {
    return res.sendFile(localFile);
  }

  res.json([
    { id: 'account-1', name: 'Coforge Limited (5131-6780-3309)', path: '/data' },
    { id: 'account-2', name: 'Coforge OICL (0068-5003-1580)', path: '/data/accounts/account-2' },
  ]);
}

app.get('/data/accounts.json', handleAccountsMetadata);
app.get('/api/data/accounts', handleAccountsMetadata);
app.get('/data/accounts/accounts.json', handleAccountsMetadata);

// Serve static Azure data files directly (Azure FOCUS pipeline stays 100% untouched)
app.use('/data/azure', express.static(path.resolve(__dirname, 'public/data/azure')));

// Query AWS Report data handler
async function handleAwsDataRequest(req, res) {
  const accountId = req.params.accountId || 'account-1';
  const filename = req.params.filename;

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }

  try {
    const data = await queryAwsTableData(accountId, filename);
    if (data !== null) {
      return res.json(data);
    }
  } catch (dbErr) {
    console.warn(`[AWS DB Query Notice for ${accountId}/${filename}]: ${dbErr.message}`);
  }

  // Fallback to static public file if DB query returned null or was unavailable
  let candidatePath = '';
  if (accountId === 'account-1') {
    candidatePath = path.resolve(__dirname, 'public/data', filename);
  } else {
    candidatePath = path.resolve(__dirname, 'public/data/accounts', accountId, filename);
  }

  if (fs.existsSync(candidatePath)) {
    return res.sendFile(candidatePath);
  }

  res.status(404).json({ error: 'DATA_NOT_FOUND', message: `Data for ${filename} not found in database or static storage.` });
}

// Map both direct /data paths and /api/data paths
app.get('/data/accounts/:accountId/:filename', handleAwsDataRequest);
app.get('/api/data/accounts/:accountId/:filename', handleAwsDataRequest);
app.get('/data/:filename', handleAwsDataRequest);
app.get('/api/data/:filename', handleAwsDataRequest);

// Serve any other static assets from public
app.use(express.static(path.resolve(__dirname, 'public')));

// Start Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Cost Intelligence API Server running on port ${PORT}`);
<<<<<<< Updated upstream
});
=======
  console.log(`   Database-backed endpoints active for Auth, Requests & AWS`);
  console.log(`======================================================\n`);
});
>>>>>>> Stashed changes
