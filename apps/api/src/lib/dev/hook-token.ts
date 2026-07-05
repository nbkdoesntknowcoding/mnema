import crypto from 'node:crypto';

/**
 * Generates a new hook token.
 *
 * Format: `mnema_hook_` + 32 random hex chars (64 hex bytes total prefix + body).
 *
 * The plaintext is returned once for display to the user and NEVER stored.
 * Only the SHA-256 hash is persisted in workspaces.hook_token.
 */
export function generateHookToken(): { plaintext: string; hash: string } {
  const random = crypto.randomBytes(32).toString('hex');
  const plaintext = `mnema_hook_${random}`;
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

/**
 * Constant-time comparison of a plaintext token against a stored SHA-256 hash.
 * Returns true if the plaintext's hash matches storedHash.
 */
export function verifyHookToken(plaintext: string, storedHash: string): boolean {
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  // timingSafeEqual requires same-length buffers
  if (hash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash));
}
