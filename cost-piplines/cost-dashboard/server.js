import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

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
// Cloudflare R2 S3 Client setup for Form & Login Page
// ─────────────────────────────────────────────────────────────
// Uses dedicated FOR_FORM variables if provided, with fallback to default R2 credentials.
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

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('❌ Missing Cloudflare R2 credentials in .env!');
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

console.log(`\n======================================================`);
console.log(`🚀 [Cloudflare R2] Connected Endpoint: https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
console.log(`🔑 [Cloudflare R2] Using Access Key: ${R2_ACCESS_KEY_ID ? `${R2_ACCESS_KEY_ID.slice(0, 8)}...` : 'None'}`);
console.log(`📦 [Cloudflare R2] Target Form Bucket: "${R2_BUCKET_NAME}"`);
console.log(`======================================================\n`);

// ───────────────────── Cloudflare R2 Direct Helpers ─────────────────────

async function readFromR2(primaryKey, fallbackKey, defaultValue = []) {
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
      console.log(`📥 [Cloudflare R2] Fetched "${key}" (${Array.isArray(parsed) ? parsed.length : 1} items) from bucket "${R2_BUCKET_NAME}"`);
      return { data: parsed, actualKey: key };
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        continue; // Try next key if first one doesn't exist
      }
      if (err.name === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
        console.error(`❌ [Cloudflare R2] Access Denied reading "${key}". Check API Token permissions in Cloudflare.`);
        throw new Error(`Cloudflare R2 Access Denied. Please ensure R2_ACCESS_KEY_ID_FOR_FORM has 'Object Read & Write' permission on bucket "${R2_BUCKET_NAME}".`);
      }
      console.error(`[R2 Read Error] "${key}":`, err.message);
    }
  }

  return { data: defaultValue, actualKey: primaryKey };
}

async function writeToR2(key, data) {
  try {
    const jsonStr = JSON.stringify(data, null, 2);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: jsonStr,
      ContentType: 'application/json',
    });
    await s3Client.send(command);
    console.log(`✅ [Cloudflare R2] Successfully updated "${key}" in bucket "${R2_BUCKET_NAME}"`);
  } catch (err) {
    console.error(`❌ [Cloudflare R2 Write Error] Failed to write "${key}":`, err.message);
    if (err.name === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
      throw new Error(`Cloudflare R2 Access Denied on bucket "${R2_BUCKET_NAME}". Please set R2_ACCESS_KEY_ID_FOR_FORM and R2_SECRET_ACCESS_KEY_FOR_FORM in .env with your Read & Write token.`);
    }
    throw err;
  }
}

// ───────────────────── Authentication Endpoints ─────────────────────

const ADMIN_EMAIL = 'dashboard-admin@coforge.com';
const ADMIN_PASSWORD = '8iie9gb';

// Login Endpoint (Reads strictly from Cloudflare R2 user.json)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Admin Verification
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      if (password === ADMIN_PASSWORD) {
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
        return res.status(401).json({
          error: 'INVALID_ADMIN_CREDENTIALS',
          message: 'Invalid Admin password. Please check your credentials.',
        });
      }
    }

    // 2. Fetch Users strictly from Cloudflare R2
    const { data: users } = await readFromR2('user.json', 'users.json', []);
    const existingUser = users.find(
      (u) => u.email && u.email.toLowerCase() === normalizedEmail
    );

    if (!existingUser) {
      return res.status(404).json({
        error: 'USER_NOT_FOUND',
        message: 'Account not found in R2 database. Please sign up to create a new requester account.',
      });
    }

    if (existingUser.password !== password) {
      return res.status(401).json({
        error: 'INVALID_PASSWORD',
        message: 'Incorrect password for this account.',
      });
    }

    return res.json({
      success: true,
      user: {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        role: 'basic',
        department: existingUser.department || 'Engineering',
        provider: existingUser.provider || 'credentials',
        loginTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'R2_ERROR', message: err.message });
  }
});

// Signup Endpoint (Writes strictly to Cloudflare R2 user.json)
app.post('/api/auth/signup', async (req, res) => {
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

    const { data: users, actualKey } = await readFromR2('user.json', 'users.json', []);
    const exists = users.find((u) => u.email && u.email.toLowerCase() === normalizedEmail);

    if (exists) {
      return res.status(409).json({
        error: 'USER_ALREADY_EXISTS',
        message: 'An account with this email already exists in R2 bucket. Please log in.',
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
    res.status(500).json({ error: 'R2_ERROR', message: err.message });
  }
});

// ───────────────────── Account Requests Endpoints ─────────────────────

// Fetch all requests strictly from Cloudflare R2
app.get('/api/requests', async (req, res) => {
  try {
    const { data: requests } = await readFromR2('accound_request.json', 'account_requests.json', []);
    res.json({ success: true, data: requests });
  } catch (err) {
    res.status(500).json({ error: 'R2_ERROR', message: err.message });
  }
});

// Submit a new request strictly to Cloudflare R2
app.post('/api/requests', async (req, res) => {
  try {
    const requestData = req.body;

    if (!requestData || !requestData.projectName) {
      return res.status(400).json({ error: 'Project name and details are required' });
    }

    const { data: requests, actualKey } = await readFromR2('accound_request.json', 'account_requests.json', []);
    const newRecord = {
      ...requestData,
      id: requestData.id || `req-${Date.now().toString(36)}`,
      submittedAt: requestData.submittedAt || new Date().toISOString(),
      status: requestData.status || 'pending',
    };

    requests.unshift(newRecord);
    await writeToR2(actualKey || 'accound_request.json', requests);

    res.status(201).json({ success: true, data: newRecord });
  } catch (err) {
    res.status(500).json({ error: 'R2_ERROR', message: err.message });
  }
});

// Admin update status (approve, reject, review) strictly in Cloudflare R2
app.put('/api/requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, reviewedBy } = req.body;

    const { data: requests, actualKey } = await readFromR2('accound_request.json', 'account_requests.json', []);
    const index = requests.findIndex((r) => r.id === id);

    if (index === -1) {
      return res.status(404).json({ error: 'Request not found in R2' });
    }

    requests[index] = {
      ...requests[index],
      status: status || requests[index].status,
      adminNotes: adminNotes ?? requests[index].adminNotes,
      reviewedBy: reviewedBy || 'Admin',
      reviewedAt: new Date().toISOString(),
    };

    await writeToR2(actualKey || 'accound_request.json', requests);

    res.json({ success: true, data: requests[index] });
  } catch (err) {
    res.status(500).json({ error: 'R2_ERROR', message: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Cost Intelligence API Server running on port ${PORT}`);
});
