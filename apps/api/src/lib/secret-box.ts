/**
 * Small symmetric crypto helpers for Phase C calendar linking:
 *   - encryptSecret / decryptSecret: AES-256-GCM for the Google refresh token
 *     stored in workspace_members.calendar_refresh_token (encrypted at rest).
 *   - signState / verifySignedState: HMAC-signed, short-lived OAuth `state` so the
 *     Google redirect can be tied back to (workspace, user) without relying on the
 *     auth cookie surviving the cross-site redirect.
 *
 * Key material is derived from SECRETBOX_MASTER_KEY (a dedicated 32+ char secret).
 * Phase 0 (Open-Core) split this off WORKOS_COOKIE_PASSWORD — same AES-256-GCM,
 * same 12-byte IV scheme, same ciphertext layout; only the KDF seed changed.
 * Ciphertexts written under the old seed are migrated by scripts/rekey-secret-box.ts.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

const ENC_KEY = scryptSync(config.SECRETBOX_MASTER_KEY, 'mnema-calendar-enc', 32);
const MAC_KEY = scryptSync(config.SECRETBOX_MASTER_KEY, 'mnema-calendar-mac', 32);

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  const [ivB, tagB, encB] = blob.split('.');
  if (!ivB || !tagB || !encB) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}

function hmac(payload: string): string {
  return createHmac('sha256', MAC_KEY).update(payload).digest('base64url');
}

/** Sign {sub, tenant} into a state token valid for `ttlSec` seconds (default 10 min). */
export function signState(data: { sub: string; tenant: string }, ttlSec = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString('base64url');
  return `${payload}.${hmac(payload)}`;
}

export function verifySignedState(token: string): { sub: string; tenant: string } | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string; tenant: string; exp: number };
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: data.sub, tenant: data.tenant };
  } catch {
    return null;
  }
}
