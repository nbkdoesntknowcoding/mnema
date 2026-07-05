/**
 * Phase 2 (Open-Core) — Ed25519 offline-verifiable license keys.
 *
 * A key is `base64url(JSON payload) + "." + base64url(ed25519 signature)`. The
 * public verify key is BAKED IN below, so any core install can verify a key
 * fully offline (airgapped, no phone-home). The matching private signing key is
 * held offline by Mnema and injected as LICENSE_SIGNING_KEY only on the issuing
 * side — never shipped to self-host. Rotating the key pair requires a release.
 */
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Ed25519 SPKI public key (DER, base64). Rotated 2026-07-05 (fresh pair; the
// 2026-07-03 private key was unrecoverable, pre-launch, zero keys in the wild).
// Rotate via release. Private signer lives offline as LICENSE_SIGNING_KEY[_PATH].
const LICENSE_PUBLIC_KEY_SPKI_B64 = 'MCowBQYDK2VwAyEAPAScFekhLTHJZP52yikTMnvSne2NNfFLHBiazhh5U0w=';

const PUBLIC_KEY = createPublicKey({
  key: Buffer.from(LICENSE_PUBLIC_KEY_SPKI_B64, 'base64'),
  format: 'der',
  type: 'spki',
});

/** Canonical typed entitlements carried inside a signed license key. */
export interface LicenseKeyPayload {
  /** free | individual | team | company */
  tier: string;
  seats: number;
  /** max workspaces the license permits (1 = single-workspace). */
  workspaces: number;
  /** subset of ['graph','meetings','org','sso','audit']. */
  features: string[];
  /** ISO-8601 expiry, or null for perpetual. */
  expiry: string | null;
  /** who the key was issued to (name / email / org). */
  licensee: string;
}

/**
 * Verify a license key's signature against the baked-in public key and return
 * its typed payload, or null if the format/signature is invalid. Does NOT check
 * expiry — that's a policy decision left to the entitlement reader.
 */
export function verifyLicenseKey(key: string): LicenseKeyPayload | null {
  const [payloadB64, sigB64] = key.trim().split('.');
  if (!payloadB64 || !sigB64) return null;
  try {
    const payloadBytes = Buffer.from(payloadB64, 'base64url');
    const ok = edVerify(null, payloadBytes, PUBLIC_KEY, Buffer.from(sigB64, 'base64url'));
    if (!ok) return null;
    return JSON.parse(payloadBytes.toString('utf8')) as LicenseKeyPayload;
  } catch {
    return null;
  }
}

/**
 * Sign a license payload into an offline-verifiable key. Requires the private
 * signing key in LICENSE_SIGNING_KEY (PEM) — only present on the issuing side;
 * throws elsewhere. Used by the admin issue flow / a CLI, never by self-host.
 */
export function signLicenseKey(payload: LicenseKeyPayload): string {
  const pem = readSigningKeyPem();
  const privateKey = createPrivateKey(pem);
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = edSign(null, Buffer.from(payloadB64, 'base64url'), privateKey);
  return `${payloadB64}.${sig.toString('base64url')}`;
}

/**
 * Resolve the private signing PEM from the environment. Two forms, both
 * issuing-side only (never present on self-host):
 *   LICENSE_SIGNING_KEY_PATH — path to a mounted .pem (preferred; mirrors
 *     OAUTH_PRIVATE_KEY_PATH, so the multi-line key rides as a file, not env).
 *   LICENSE_SIGNING_KEY — inline PEM; literal "\n" escapes are un-escaped so a
 *     single env line survives docker env_file (which can't hold real newlines).
 */
function readSigningKeyPem(): string {
  const path = process.env.LICENSE_SIGNING_KEY_PATH;
  if (path) return readFileSync(path, 'utf8');
  const inline = process.env.LICENSE_SIGNING_KEY;
  if (inline) return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
  throw new Error('LICENSE_SIGNING_KEY[_PATH] is not set (license issuing is issuing-side only)');
}
