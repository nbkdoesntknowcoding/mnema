/**
 * PKCE (RFC 7636) challenge verification.
 *
 * OAuth 2.1 requires PKCE for all authorization code flows.
 * Only S256 is accepted — `plain` is forbidden per spec.
 */
import { createHash } from 'node:crypto';

/**
 * Verify a PKCE code_verifier against the stored code_challenge.
 *
 * S256: code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 *
 * Returns false for ANY invalid input — never throws.
 */
export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  // S256 only — OAuth 2.1 forbids 'plain'
  if (method !== 'S256') return false;

  // Verifier must be 43-128 unreserved chars (RFC 7636 §4.1)
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;

  const computed = createHash('sha256').update(verifier).digest('base64url');
  return computed === challenge;
}
