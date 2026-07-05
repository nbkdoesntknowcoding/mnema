/**
 * Scope utilities for the OAuth 2.1 AS.
 */

export const SUPPORTED_SCOPES = new Set([
  'workspace:read',
  'workspace:write',  // Phase 9 — write tools
  'offline_access',   // triggers refresh token issuance
]);

/** Parse a space-separated scope string into an array of known scopes. */
export function parseScopes(scopeStr: string): string[] {
  return scopeStr
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Validate that all requested scopes are supported. Returns unknown scopes. */
export function unknownScopes(requested: string[]): string[] {
  return requested.filter((s) => !SUPPORTED_SCOPES.has(s));
}

/** Normalise a scope list back to a canonical string. */
export function scopeString(scopes: string[]): string {
  return [...new Set(scopes)].sort().join(' ');
}

/** Map a scope to a human-readable description for the consent screen. */
export function scopeLabel(scope: string): string {
  switch (scope) {
    case 'workspace:read': return 'Read your docs and walk your flows';
    case 'workspace:write': return 'Create, update, and delete docs and flows';
    case 'offline_access': return 'Stay connected without re-authorising each session';
    default: return scope;
  }
}
