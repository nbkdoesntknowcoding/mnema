/**
 * Pluggable secret store — the single seam through which at-rest secrets
 * (OAuth refresh tokens, BYOK LLM keys) are encrypted and decrypted.
 *
 * The interface is async because a real cloud KMS is a network call. The default
 * provider (env-key, see env-key-store.ts) resolves synchronously under the hood
 * but still presents the async contract so call sites don't change when a
 * deployment switches to KMS.
 *
 * Back-compat is a hard requirement: existing ciphertext in the database was
 * written by the legacy secret-box AES-GCM helper (format `iv.tag.enc`, no
 * scheme prefix). Every provider's `decrypt` MUST be able to read those legacy
 * blobs, so a workspace can move from env → KMS without a data migration
 * (new writes get the new format; old rows still decrypt via the env fallback).
 */
/** Scheme prefix on KMS-envelope ciphertext. Legacy env blobs carry no prefix. */
export const KMS_SCHEME = 'kms1';

export interface SecretStore {
  /** Short identifier for logging/telemetry, e.g. 'env' or 'kms:local'. */
  readonly id: string;
  /** Encrypt UTF-8 plaintext → an opaque, self-describing ciphertext string. */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a ciphertext produced by this store OR a legacy env blob. */
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Envelope-encryption client, modelled on AWS KMS / GCP KMS. A concrete cloud
 * adapter implements these two calls; KmsSecretStore does the data-key envelope
 * around them. Kept deliberately tiny so an adapter is a thin wrapper over the
 * provider SDK (e.g. AWS GenerateDataKey + Decrypt).
 */
export interface KmsClient {
  /** Short id for the SecretStore.id, e.g. 'kms:aws'. */
  readonly id: string;
  /**
   * Ask the KMS for a fresh 32-byte data key. Returns the plaintext key (used
   * once, in memory) plus the KMS-wrapped form to persist alongside the payload.
   */
  generateDataKey(): Promise<{ plaintextKey: Buffer; wrappedKey: string }>;
  /** Unwrap a previously wrapped data key. */
  decryptDataKey(wrappedKey: string): Promise<Buffer>;
}
