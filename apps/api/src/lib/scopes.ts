/**
 * Shared scope helpers for JWT minting across the auth and OAuth paths.
 *
 * Phase 9.1: workspace:write is granted to owner/admin/editor roles.
 * Viewers and unauthenticated callers receive docs:read only.
 */

/** Roles that may receive workspace:write in their JWT. */
const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);

/**
 * Returns the JWT scopes for a given workspace role.
 * Always includes 'docs:read'; adds 'workspace:write' for write-capable roles.
 */
export function scopesForRole(role: string): string[] {
  const base: string[] = ['docs:read'];
  if (WRITE_ROLES.has(role)) {
    base.push('workspace:write');
  }
  return base;
}
