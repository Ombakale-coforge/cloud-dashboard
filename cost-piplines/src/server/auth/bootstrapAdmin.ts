import { prisma } from '../db.ts';
import { hashPassword, verifyPassword, CURRENT_ALGO } from './password.ts';

/**
 * Replaces the old hardcoded admin credentials.
 *
 * If ADMIN_EMAIL and ADMIN_PASSWORD are set in .env, ensure a matching row exists
 * in dbo.users with role = 'admin' and a hashed password. Safe to run on every boot.
 * Once the admin exists you can remove ADMIN_PASSWORD from .env if you like.
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (!existing) {
      await prisma.user.create({
        data: {
          name: 'Dashboard Administrator',
          email,
          passwordHash: await hashPassword(password),
          passwordAlgo: CURRENT_ALGO,
          department: 'Cloud Governance & FinOps',
          role: 'admin',
        },
      });
      console.log(`[auth] Created admin user ${email}`);
      return;
    }

    const { ok } = await verifyPassword(password, existing.passwordHash, existing.passwordAlgo);
    const needsPassword = !ok || existing.passwordAlgo !== CURRENT_ALGO;
    if (existing.role !== 'admin' || !existing.isActive || needsPassword) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: 'admin',
          isActive: true,
          ...(needsPassword
            ? { passwordHash: await hashPassword(password), passwordAlgo: CURRENT_ALGO }
            : {}),
        },
      });
      console.log(`[auth] Updated admin user ${email}`);
    }
  } catch (err: any) {
    console.error('[auth] Admin bootstrap failed:', err.message);
  }
}
