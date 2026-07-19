/**
 * Local KMS client — the reference KmsClient implementation.
 *
 * It performs real envelope semantics (wrap/unwrap a per-message data key) but
 * the "master key" is a local secret (KMS_LOCAL_MASTER_KEY) rather than a cloud
 * HSM. Two uses:
 *   1. A self-hoster who wants envelope encryption + key separation without a
 *      cloud dependency.
 *   2. The exact shape a real cloud adapter (AWS/GCP KMS) must implement — swap
 *      generateDataKey/decryptDataKey for the provider SDK's GenerateDataKey +
 *      Decrypt and nothing else changes.
 *
 * NOTE: because the master key is local, this does not provide the tamper-proof
 * key custody a real KMS does; it is a stepping stone, not the endpoint. For that
 * reason it must be configured with its OWN key, distinct from
 * SECRETBOX_MASTER_KEY, so the two layers aren't collapsed into one secret.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm.js';
import type { KmsClient } from './types.js';

export class LocalKmsClient implements KmsClient {
  readonly id = 'kms:local';
  private readonly masterKey: Buffer;

  constructor(masterKeySeed: string) {
    // Derive a 32-byte wrapping key from the configured seed. Distinct KDF label
    // from secret-box so the same string, if ever reused, yields a different key.
    this.masterKey = scryptSync(masterKeySeed, 'mnema-kms-local-wrap', 32);
  }

  async generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: string }> {
    const plaintextKey = randomBytes(32);
    // "Wrap" = AES-GCM the data key under the master key. base64url of the utf8
    // is fine here since aesGcm works on strings; we encode the key as base64.
    const wrappedKey = aesGcmEncrypt(this.masterKey, plaintextKey.toString('base64'));
    return { plaintextKey, wrappedKey };
  }

  async decryptDataKey(wrappedKey: string): Promise<Buffer> {
    const b64 = aesGcmDecrypt(this.masterKey, wrappedKey);
    return Buffer.from(b64, 'base64');
  }
}
