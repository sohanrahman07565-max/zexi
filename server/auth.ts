import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

// Get session secret from environment, with a secure fallback
export function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'tg-admin-secure-session-secret-key-32chars';
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
  
  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return rawToken;
  }
  return null;
}
