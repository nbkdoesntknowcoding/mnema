/**
 * Secret-store factory. Every at-rest secret (OAuth refresh tokens, BYOK keys)
 * goes through getSecretStore(); which concrete provider backs it is a
 * deployment choice, not a code change.
 *
 *   SECRET_STORE_PROVIDER=env   (default) — AES-256-GCM under SECRETBOX_MASTER_KEY.
 *                                            Self-host friendly, no extra infra.
 *   SECRET_STORE_PROVIDER=kms              — envelope encryption via a KmsClient
 *                                            chosen by KMS_PROVIDER:
 *       KMS_PROVIDER=local  — LocalKmsClient under KMS_LOCAL_MASTER_KEY (real
 *                             envelope semantics, local master key).
 *       KMS_PROVIDER=aws|gcp — reserved: construct the cloud adapter here once
 *                             its SDK is bundled. Throws until then so a
 *                             misconfigured prod fails fast instead of silently
 *                             falling back to a weaker provider.
 *
 * A KMS store always keeps an env fallback so pre-existing env ciphertext keeps
 * decrypting after a switch to KMS (new writes upgrade to envelopes).
 */
import { config } from '../../config/env.js';
import { EnvKeySecretStore } from './env-key-store.js';
import { KmsSecretStore } from './kms-store.js';
import { LocalKmsClient } from './local-kms-client.js';
import type { KmsClient, SecretStore } from './types.js';

export type { SecretStore, KmsClient } from './types.js';

let singleton: SecretStore | null = null;

function buildKmsClient(): KmsClient {
  switch (config.KMS_PROVIDER) {
    case 'local': {
      if (!config.KMS_LOCAL_MASTER_KEY) {
        throw new Error('KMS_PROVIDER=local requires KMS_LOCAL_MASTER_KEY (32+ chars, distinct from SECRETBOX_MASTER_KEY)');
      }
      return new LocalKmsClient(config.KMS_LOCAL_MASTER_KEY);
    }
    case 'aws':
    case 'gcp':
      throw new Error(
        `KMS_PROVIDER=${config.KMS_PROVIDER} is reserved: bundle the ${config.KMS_PROVIDER} KMS SDK and construct its adapter in secret-store/index.ts before enabling it`,
      );
    default:
      throw new Error(`unknown KMS_PROVIDER '${config.KMS_PROVIDER}'`);
  }
}

function build(): SecretStore {
  if (config.SECRET_STORE_PROVIDER === 'kms') {
    return new KmsSecretStore(buildKmsClient(), new EnvKeySecretStore());
  }
  return new EnvKeySecretStore();
}

/** The process-wide secret store (built once, lazily). */
export function getSecretStore(): SecretStore {
  if (!singleton) singleton = build();
  return singleton;
}

/** Test-only: reset the memoised singleton so a new config takes effect. */
export function __resetSecretStoreForTests(): void {
  singleton = null;
}
