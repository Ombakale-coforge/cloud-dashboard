import type { Request, Response, NextFunction } from 'express';
import { verifyToken, getTokenTtlSeconds, type TokenPayload } from './jwt.ts';

export const SESSION_COOKIE = 'cd_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function isSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge: getTokenTtlSeconds() * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isSecureCookie(), sameSite: 'lax', path: '/' });
}

/** Token from the httpOnly cookie, or `Authorization: Bearer <jwt>` for scripts/tools. */
export function readToken(req: Request): string | null {
  const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const payload = verifyToken(readToken(req));
  if (!payload) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please log in to continue.' });
  }
  req.user = payload;
  next();
}

export function requireRole(...roles: Array<TokenPayload['role']>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please log in to continue.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not have permission to do this.' });
    }
    next();
  };
}
