import { describe, expect, it } from 'vitest';
import { EnvKeySecretStore } from './env-key-store.js';
import { KmsSecretStore } from './kms-store.js';
import { LocalKmsClient } from './local-kms-client.js';
import { encryptSecret } from '../secret-box.js';
import { KMS_SCHEME } from './types.js';

const env = new EnvKeySecretStore();
const kms = new KmsSecretStore(new LocalKmsClient('a-local-kms-master-key-that-is-32+chars'), env);

describe('EnvKeySecretStore', () => {
  it('round-trips and stays legacy-compatible (no scheme prefix)', async () => {
    const ct = await env.encrypt('hunter2');
    expect(ct.startsWith(`${KMS_SCHEME}:`)).toBe(false);
    expect(await env.decrypt(ct)).toBe('hunter2');
  });

  it('decrypts a value written directly by the legacy secret-box helper', async () => {
    const legacy = encryptSecret('ya29.a0-refresh-token');
    expect(await env.decrypt(legacy)).toBe('ya29.a0-refresh-token');
  });

  it('refuses to decrypt a KMS-scheme blob (downgrade guard)', async () => {
    const kct = await kms.encrypt('secret');
    await expect(env.decrypt(kct)).rejects.toThrow(/cannot decrypt a KMS/);
  });
});

describe('KmsSecretStore (envelope over LocalKmsClient)', () => {
  it('round-trips, tagging ciphertext with the scheme + a wrapped data key', async () => {
    const ct = await kms.encrypt('super-secret');
    expect(ct.startsWith(`${KMS_SCHEME}:`)).toBe(true);
    // kms1:<wrappedKey>:<iv.tag.enc> — three colon-separated segments.
    expect(ct.split(':').length).toBe(3);
    expect(await kms.decrypt(ct)).toBe('super-secret');
  });

  it('uses a fresh data key per message (two encryptions differ)', async () => {
    const a = await kms.encrypt('same');
    const b = await kms.encrypt('same');
    expect(a).not.toBe(b);
    expect(await kms.decrypt(a)).toBe('same');
    expect(await kms.decrypt(b)).toBe('same');
  });

  it('MIGRATION: transparently decrypts pre-existing legacy env blobs', async () => {
    const legacy = encryptSecret('old-token-from-before-kms');
    expect(await kms.decrypt(legacy)).toBe('old-token-from-before-kms');
  });

  it('fails on a tampered envelope', async () => {
    const ct = await kms.encrypt('secret');
    const tampered = ct.slice(0, -2) + (ct.endsWith('AA') ? 'BB' : 'AA');
    await expect(kms.decrypt(tampered)).rejects.toThrow();
  });
});
