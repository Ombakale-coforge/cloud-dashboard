/**
 * Minimal HS256 JWT sign/verify using Node's crypto (no external deps).
 * Only HS256 is accepted – the header `alg` is checked so "alg: none" or
 * algorithm-confusion tokens are rejected.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export interface TokenPayload {
  sub: string;          // user id
  email: string;
  name: string;
  role: 'admin' | 'basic';
  department?: string | null;
  iat: number;
  exp: number;
}

let devFallbackSecret: string | null = null;

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (min 32 chars) in production.');
  }
  if (!devFallbackSecret) {
    devFallbackSecret = randomBytes(48).toString('hex');
    console.warn(
      '[auth] JWT_SECRET missing or shorter than 32 chars – using a random dev secret. ' +
        'All sessions will be invalidated when the server restarts.'
    );
  }
  return devFallbackSecret;
}

export function getTokenTtlSeconds(): number {
  const hours = Number(process.env.JWT_TTL_HOURS || 8);
  return Math.max(1, Math.floor((Number.isFinite(hours) ? hours : 8) * 3600));
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function hmac(data: string): Buffer {
  return createHmac('sha256', getSecret()).update(data).digest();
}

export function signToken(claims: Omit<TokenPayload, 'iat' | 'exp'>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { ...claims, iat: now, exp: now + getTokenTtlSeconds() };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(`${header}.${body}`));
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  try {
    const h = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (h.alg !== 'HS256') return null;

    const expected = hmac(`${header}.${body}`);
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.role !== 'admin' && payload.role !== 'basic') return null;
    return payload;
  } catch {
    return null;
  }
}
