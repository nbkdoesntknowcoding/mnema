/**
 * Phase 0 (Open-Core) ASSERT 2 — secret-box is keyed off SECRETBOX_MASTER_KEY.
 *   1. roundtrip: encrypt/decrypt a sample string succeeds under the current key.
 *   2. key isolation: a ciphertext produced under a DIFFERENT scrypt seed fails
 *      to decrypt (GCM auth-tag failure), proving the KDF seed actually gates access.
 */
import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { encryptSecret, decryptSecret } from './secret-box.js';

describe('secret-box (SECRETBOX_MASTER_KEY)', () => {
  it('roundtrips a sample string', () => {
    const plain = 'ya29.a0AfsampleGoogleRefreshTokenValue-1234567890';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('rejects a ciphertext produced under a different KDF seed (key isolation)', () => {
    // Same wire format as secret-box, but keyed off a foreign master secret.
    const foreignKey = scryptSync('a-totally-different-master-key-000000', 'mnema-calendar-enc', 32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', foreignKey, iv);
    const enc = Buffer.concat([cipher.update('secret', 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
    expect(() => decryptSecret(blob)).toThrow();
  });
});
