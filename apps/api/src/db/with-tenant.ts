import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { db } from './index.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Per-request scope (set once at the MCP/auth boundary). Any withTenant() call
 * made inside `tenantScopeStore.run(scope, …)` automatically inherits userId +
 * projectScope, so we don't have to thread them through every tool. REST routes
 * that don't establish a scope simply get null → no project restriction (today's
 * behavior). This is how the meeting bot's project-scoped key bounds every tool.
 */
export const tenantScopeStore = new AsyncLocalStorage<TenantScope>();

/**
 * Runs `fn` inside a transaction with:
 *   1. SET LOCAL ROLE app_user — drops superuser so RLS actually applies.
 *   2. set_config('app.tenant_id', $1, true) — transaction-local tenant GUC
 *      that the RLS policies key off via app_current_tenant_id().
 *
 * The third arg to set_config is `true` (transaction-local). Session-local
 * would leak across pooled connections.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return await withTenantScoped(tenantId, {}, fn);
}

/**
 * Like withTenant, but also sets the Stage B GUCs (transaction-local):
 *   userId       → app.user_id       (per-user project-membership RLS)
 *   projectScope → app.project_scope (set ONLY for project-scoped API keys; when
 *                  present the whole session is hard-bounded to that one project —
 *                  this is what stops the meeting bot reaching other projects).
 * When a value is unset/null the corresponding GUC is left empty, and the project
 * RLS predicate is a no-op (identical to plain withTenant / today's behavior).
 */
export interface TenantScope {
  userId?: string | null;
  projectScope?: string | null;
}

export async function withTenantScoped<T>(
  tenantId: string,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  // Explicit scope wins; otherwise inherit the request-scoped store (set at the
  // MCP/auth boundary). Plain withTenant() passes {} so it picks up the store.
  const ambient = tenantScopeStore.getStore();
  const userId = scope.userId ?? ambient?.userId ?? null;
  const projectScope = scope.projectScope ?? ambient?.projectScope ?? null;
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    if (userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    if (projectScope) {
      await tx.execute(sql`SELECT set_config('app.project_scope', ${projectScope}, true)`);
    }
    return await fn(tx);
  });
}
