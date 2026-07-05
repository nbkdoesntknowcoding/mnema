-- ===========================================================================
-- Phase 4.1 — workspace_members RLS (closes a pre-existing gap)
-- ===========================================================================
--
-- `workspace_members` was created in the initial schema WITHOUT row-level
-- security. That means a tenant-scoped query through Drizzle would only be
-- safe if the caller manually filtered by workspace_id — which is what
-- the existing handlers do via explicit `WHERE workspace_id = ?` clauses.
--
-- Phase 4.1's GET /api/members handler relies on RLS to filter (it calls
-- `withTenant(...)` then runs a bare `SELECT FROM workspace_members`).
-- Without an RLS policy, that returns ALL rows, cross-tenant. Bug.
--
-- Fix: enable + force RLS with the same shape as docs/embeddings/invitations.
-- All four tenant-scoped tables now share the policy convention.

ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_members" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_tenant_isolation" ON "workspace_members"
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
