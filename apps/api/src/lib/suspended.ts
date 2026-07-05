/**
 * Suspended-workspace enforcement.
 *
 * Admins can suspend a workspace (sets settings.suspended). The auth plugin calls
 * isWorkspaceSuspended() on every authenticated request to actually block that
 * workspace's users — not just flag it cosmetically. The set of suspended ids is
 * cached in-process with a short TTL so this costs ~one query per 30s, not one per
 * request. Suspend/reactivate handlers call bustSuspendedCache() for instant effect.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';

let cache = new Set<string>();
let loadedAt = 0;
const TTL_MS = 30_000;

async function refresh(): Promise<void> {
  try {
    const rows = (await db.execute(
      sql`SELECT id FROM workspaces WHERE (settings->>'suspended')::boolean IS TRUE`,
    )) as unknown as Array<{ id: string }>;
    cache = new Set(rows.map((r) => r.id));
    loadedAt = Date.now();
  } catch {
    // On error keep the stale cache (fail-open is acceptable — suspension is an
    // operator action, not a security boundary, and a DB blip shouldn't lock users out).
  }
}

export async function isWorkspaceSuspended(workspaceId: string): Promise<boolean> {
  if (Date.now() - loadedAt > TTL_MS) await refresh();
  return cache.has(workspaceId);
}

/** Force the next check to re-query (call after suspend/reactivate). */
export function bustSuspendedCache(): void {
  loadedAt = 0;
}
