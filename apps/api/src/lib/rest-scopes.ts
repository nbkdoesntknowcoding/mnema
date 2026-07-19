/**
 * REST public-API scope model — pure, no I/O.
 *
 * Kept dependency-free (no db/env imports) so it can be unit-tested in isolation
 * and reasoned about on its own. Consumed by the public v1 API's requireScope()
 * and by api-keys.ts (which re-exports validateScopes for key creation).
 */

// Fine-grained REST scopes, plus the three legacy coarse scopes. Coarse scopes
// stay valid and expand (see expandRestScopes) to exactly the fine scopes they
// used to grant, so no existing key changes behaviour.
const FINE_REST_SCOPES = ['docs:read', 'docs:write', 'flows:read', 'flows:write', 'tasks:read', 'tasks:write'];
const VALID_SCOPES = new Set<string>(['read', 'write', 'tasks', ...FINE_REST_SCOPES]);

export function validateScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return ['read'];
  const valid = scopes.filter((s): s is string => typeof s === 'string' && VALID_SCOPES.has(s));
  return valid.length > 0 ? valid : ['read'];
}

/**
 * Behaviour-preserving coarse→fine expansion for the REST v1 API's per-route
 * requireScope() check. The legacy coarse scopes map to EXACTLY the routes they
 * granted before finer scopes existed, so every existing key keeps the same
 * access and no new access:
 *   read  → docs:read, flows:read     (GET docs/folders/flows)
 *   write → docs:write                (POST/PATCH/append docs)
 *   tasks → tasks:read, tasks:write   (all /tasks/*)
 * Fine scopes are also returned verbatim, so a key created directly with e.g.
 * ['docs:read'] can read docs but NOT flows.
 */
const REST_COARSE_EXPANSION: Record<string, string[]> = {
  read:  ['docs:read', 'flows:read'],
  write: ['docs:write'],
  tasks: ['tasks:read', 'tasks:write'],
};

export function expandRestScopes(scopes: string[]): Set<string> {
  const out = new Set<string>();
  for (const s of scopes) {
    out.add(s);
    for (const fine of REST_COARSE_EXPANSION[s] ?? []) out.add(fine);
  }
  return out;
}
