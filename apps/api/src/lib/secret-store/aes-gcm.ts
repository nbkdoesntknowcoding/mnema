/**
 * Generic AES-256-GCM with a caller-supplied 32-byte key. Used by the KMS
 * envelope (per-message data key). The legacy env format lives in
 * lib/secret-box.ts and is reused verbatim by EnvKeySecretStore for back-compat;
 * this helper is intentionally separate so its format can carry a scheme prefix
 * without touching the legacy layout.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** iv.tag.enc, all base64url (same field layout as secret-box, minus the fixed key). */
export function aesGcmEncrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function aesGcmDecrypt(key: Buffer, blob: string): string {
  const [ivB, tagB, encB] = blob.split('.');
  if (!ivB || !tagB || !encB) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}
