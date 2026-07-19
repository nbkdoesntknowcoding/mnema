/**
 * Default secret store: symmetric AES-256-GCM under the SECRETBOX_MASTER_KEY
 * env var. This is byte-identical to the legacy secret-box helper — it simply
 * delegates to it — so every ciphertext already in the database decrypts
 * unchanged and new writes keep the same on-disk format. No new infrastructure;
 * the right default for self-hosting.
 *
 * A ciphertext produced here has NO scheme prefix (legacy `iv.tag.enc`). If this
 * store is ever asked to decrypt a KMS-scheme blob (only possible after a
 * kms → env downgrade), it fails loudly rather than returning garbage.
 */
import { decryptSecret, encryptSecret } from '../secret-box.js';
import { KMS_SCHEME, type SecretStore } from './types.js';

export class EnvKeySecretStore implements SecretStore {
  readonly id = 'env';

  async encrypt(plaintext: string): Promise<string> {
    return encryptSecret(plaintext);
  }

  async decrypt(ciphertext: string): Promise<string> {
    if (ciphertext.startsWith(`${KMS_SCHEME}:`)) {
      throw new Error(
        'env secret store cannot decrypt a KMS-encrypted value — SECRET_STORE_PROVIDER was downgraded from kms to env while KMS ciphertext still exists',
      );
    }
    return decryptSecret(ciphertext);
  }
}
