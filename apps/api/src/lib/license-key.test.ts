/**
 * Phase 2 — license-key signature verification. The security-critical property:
 * verifyLicenseKey accepts ONLY keys signed by the baked-in key pair. We can't
 * commit the real private key, so these assert the rejection paths (malformed,
 * foreign-signed, tampered) — the positive roundtrip was proven at keygen time.
 */
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signLicenseKey, verifyLicenseKey, type LicenseKeyPayload } from './license-key.js';

const payload: LicenseKeyPayload = {
  tier: 'team',
  seats: 5,
  workspaces: 10,
  features: ['graph', 'meetings'],
  expiry: null,
  licensee: 'Test Co',
};

function foreignSigningKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
}

describe('verifyLicenseKey', () => {
  it('rejects malformed keys', () => {
    expect(verifyLicenseKey('')).toBeNull();
    expect(verifyLicenseKey('not-a-key')).toBeNull();
    expect(verifyLicenseKey('onlyonepart')).toBeNull();
    expect(verifyLicenseKey('abc.def')).toBeNull();
  });

  it('rejects a key signed by a foreign key pair', () => {
    process.env.LICENSE_SIGNING_KEY = foreignSigningKey();
    const key = signLicenseKey(payload);
    expect(verifyLicenseKey(key)).toBeNull();
    delete process.env.LICENSE_SIGNING_KEY;
  });

  it('rejects a tampered payload', () => {
    process.env.LICENSE_SIGNING_KEY = foreignSigningKey();
    const key = signLicenseKey(payload);
    const sig = key.split('.')[1] ?? '';
    const forged = Buffer.from(JSON.stringify({ ...payload, seats: 9999 })).toString('base64url');
    expect(verifyLicenseKey(`${forged}.${sig}`)).toBeNull();
    delete process.env.LICENSE_SIGNING_KEY;
  });

  it('signLicenseKey throws without a signing key', () => {
    delete process.env.LICENSE_SIGNING_KEY;
    expect(() => signLicenseKey(payload)).toThrow();
  });
});
