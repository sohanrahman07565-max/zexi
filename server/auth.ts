import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// Get session secret from environment, with an in-memory random fallback
export function getSessionSecret(): string {
  return (process.env.SESSION_SECRET || '').trim() || EPHEMERAL_SESSION_SECRET;
}

// Password hashing
export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(String(plainText).trim(), 10);
}

// Password verification
export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  if (!plainText || !hash) return false;
  return bcrypt.compare(String(plainText).trim(), hash);
}

// Sign a session token using HMAC-SHA256 and SESSION_SECRET
export function signSessionToken(rawToken: string): string {
  const secret = getSessionSecret();
  const signature = crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
  return `${rawToken}.${signature}`;
}

// Verify a signed session token
export function verifySessionToken(signedToken: string): string | null {
  if (!signedToken || !signedToken.includes('.')) return null;
  const [rawToken, signature] = signedToken.split('.');
  if (!rawToken || !signature) return null;

  const secret = getSessionSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(rawToken).digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return null;

  if (crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return rawToken;
  }
  return null;
}
