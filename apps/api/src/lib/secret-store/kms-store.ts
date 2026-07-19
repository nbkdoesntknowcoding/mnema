/**
 * Envelope-encryption secret store, KMS-backed.
 *
 * On encrypt: ask the KmsClient for a fresh 32-byte data key, AES-256-GCM the
 * plaintext under it, and store `kms1:<wrappedDataKey>:<iv.tag.enc>`. The data
 * key exists in memory only for that one operation; only its KMS-wrapped form is
 * persisted, so a database dump alone can never decrypt anything.
 *
 * On decrypt: `kms1:` values are un-enveloped via the KmsClient; anything else is
 * a legacy env blob and is delegated to the injected env fallback. That fallback
 * is what makes env → kms a zero-downtime migration — old rows keep working while
 * new writes upgrade to envelopes.
 */
import { aesGcmDecrypt, aesGcmEncrypt } from './aes-gcm.js';
import { KMS_SCHEME, type KmsClient, type SecretStore } from './types.js';

export { KMS_SCHEME };

export class KmsSecretStore implements SecretStore {
  readonly id: string;

  constructor(
    private readonly kms: KmsClient,
    /** Reads legacy (pre-KMS) env-encrypted rows during migration. */
    private readonly legacyFallback: SecretStore,
  ) {
    this.id = kms.id;
  }

  async encrypt(plaintext: string): Promise<string> {
    const { plaintextKey, wrappedKey } = await this.kms.generateDataKey();
    try {
      const payload = aesGcmEncrypt(plaintextKey, plaintext);
      return `${KMS_SCHEME}:${wrappedKey}:${payload}`;
    } finally {
      plaintextKey.fill(0); // scrub the data key from memory ASAP
    }
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext.startsWith(`${KMS_SCHEME}:`)) {
      // Legacy env blob written before this workspace moved to KMS.
      return this.legacyFallback.decrypt(ciphertext);
    }
    const rest = ciphertext.slice(KMS_SCHEME.length + 1);
    const sep = rest.indexOf(':');
    if (sep < 0) throw new Error('malformed KMS ciphertext');
    const wrappedKey = rest.slice(0, sep);
    const payload = rest.slice(sep + 1);
    const dataKey = await this.kms.decryptDataKey(wrappedKey);
    try {
      return aesGcmDecrypt(dataKey, payload);
    } finally {
      dataKey.fill(0);
    }
  }
}
