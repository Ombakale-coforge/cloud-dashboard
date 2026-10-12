/**
 * Password hashing using Node's built-in scrypt (no native deps).
 *
 * Stored format (users.password_hash):  scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
 * users.password_algo is set to 'scrypt'.
 *
 * Legacy rows with password_algo = 'plain' are still accepted so existing users
 * can log in; the login route re-hashes them transparently (needsRehash = true).
 */
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export const CURRENT_ALGO = 'scrypt';

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function safeEqualStrings(a: string, b: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function verifyPassword(
  password: string,
  stored: string,
  algo: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (algo === 'scrypt') {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return { ok: false, needsRehash: false };
    const [, n, r, p, saltB64, hashB64] = parts;
    const expected = Buffer.from(hashB64, 'base64');
    const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
    const ok = key.length === expected.length && timingSafeEqual(key, expected);
    const needsRehash = ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P);
    return { ok, needsRehash };
  }

  if (algo === 'plain') {
    const ok = safeEqualStrings(password, stored);
    return { ok, needsRehash: ok };
  }

  // Unknown algorithm (e.g. 'bcrypt' default with no hashes ever written) – reject.
  return { ok: false, needsRehash: false };
}

/** Burn roughly the same CPU as a real check, to blunt user-enumeration via timing. */
export async function dummyVerify(): Promise<void> {
  await scryptAsync('dummy-password', randomBytes(SALT_LEN), N, R, P);
}
