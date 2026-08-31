import { readFromR2, writeToR2, jsonResponse, handleCors } from '../../lib/r2.js';

const ADMIN_EMAIL = 'dashboard-admin@coforge.com';

// Handle CORS preflight
export async function onRequestOptions() {
  return handleCors();
}

// POST /api/auth/signup
export async function onRequestPost(context) {
  const { env } = context;

  try {
    const { name, email, password, department } = await context.request.json();

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const finalName = name?.trim() || normalizedEmail.split('@')[0].replace(/[._-]/g, ' ');

    if (normalizedEmail === ADMIN_EMAIL.toLowerCase()) {
      return jsonResponse({
        error: 'RESERVED_EMAIL',
        message: 'This email is reserved for Admin authentication.',
      }, 400);
    }

    const { data: users, actualKey } = await readFromR2(env, 'user.json', 'users.json', []);
    const exists = users.find(
      (u) => u.email && u.email.toLowerCase() === normalizedEmail
    );

    if (exists) {
      return jsonResponse({
        error: 'USER_ALREADY_EXISTS',
        message: 'An account with this email already exists in R2 bucket. Please log in.',
      }, 409);
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
    await writeToR2(env, actualKey || 'user.json', users);

    return jsonResponse({
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
    }, 201);
  } catch (err) {
    return jsonResponse({ error: 'R2_ERROR', message: err.message }, 500);
  }
}
