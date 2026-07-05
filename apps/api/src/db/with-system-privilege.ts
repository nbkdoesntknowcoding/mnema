import { sql } from 'drizzle-orm';
import { db } from './index.js';

/**
 * Runs `fn` in a transaction under the `boppl_system` Postgres role,
 * which has `BYPASSRLS NOINHERIT`. All RLS policies are inert for the
 * duration of the callback — the transaction can read and write across
 * tenant boundaries.
 *
 * Use ONLY for system operations that legitimately cannot scope by
 * tenant_id, which means:
 *
 *   1. Invitation lookup — the accepter is unauthenticated against any
 *      workspace until they accept; we must find the row by token JTI
 *      with no tenant context.
 *   2. Invitation accept — inserting the new workspace_members row + the
 *      invitation update both straddle "no tenant" → "joined tenant".
 *   3. Workspace creation — the new workspace doesn't exist yet; the
 *      creator may have no current tenant at all (first sign-up).
 *   4. (Phase 0.2 callback already done) WorkOS bootstrap creating the
 *      initial users row before any membership exists.
 *
 * Adding a 5th caller in a future PR MUST come with a written
 * justification in the PR description. Every new use is a place tenant
 * isolation could regress, so we want a tight audit trail.
 *
 * The role reverts automatically when the transaction ends — `SET LOCAL`
 * is scoped to the transaction.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withSystemPrivilege<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction(async (tx) => {
    // SET LOCAL ROLE: scoped to this transaction. boppl_system has
    // BYPASSRLS NOINHERIT, so we get RLS-exempt access for exactly this
    // unit of work and nothing else.
    await tx.execute(sql`SET LOCAL ROLE boppl_system`);
    return await fn(tx);
  });
}
