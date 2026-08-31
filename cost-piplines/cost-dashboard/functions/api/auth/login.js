import { readFromR2, writeToR2, jsonResponse, handleCors } from '../../lib/r2.js';

const ADMIN_EMAIL = 'dashboard-admin@coforge.com';
const ADMIN_PASSWORD = '8iie9gb';

// Handle CORS preflight
export async function onRequestOptions() {
  return handleCors();
}

// POST /api/auth/login
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const { email, password } = await context.request.json();

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Admin verification
    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      if (password === ADMIN_PASSWORD) {
        return jsonResponse({
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
        return jsonResponse({
          error: 'INVALID_ADMIN_CREDENTIALS',
          message: 'Invalid Admin password. Please check your credentials.',
        }, 401);
      }
    }

    // 2. Fetch users from R2
    const { data: users } = await readFromR2(env, 'user.json', 'users.json', []);
    const existingUser = users.find(
      (u) => u.email && u.email.toLowerCase() === normalizedEmail
    );

    if (!existingUser) {
      return jsonResponse({
        error: 'USER_NOT_FOUND',
        message: 'Account not found in R2 database. Please sign up to create a new requester account.',
      }, 404);
    }

    if (existingUser.password !== password) {
      return jsonResponse({
        error: 'INVALID_PASSWORD',
        message: 'Incorrect password for this account.',
      }, 401);
    }

    return jsonResponse({
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
    return jsonResponse({ error: 'R2_ERROR', message: err.message }, 500);
  }
}
