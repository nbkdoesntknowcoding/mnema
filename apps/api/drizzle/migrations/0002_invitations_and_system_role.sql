-- ===========================================================================
-- Phase 4.1 — Invitations table + boppl_system role
-- ===========================================================================

-- ----------------------------------------------------------------------------
-- 1. invitations table
-- ----------------------------------------------------------------------------
-- Each invitation is paired with a signed JWT. token_jti links the JWT's `jti`
-- claim back to this row so the accept-flow can validate (signature) AND
-- (not revoked, not already accepted, not expired) in a single lookup.
--
-- All timestamps are timestamptz. accepted_at/revoked_at NULL means "still
-- pending". The unique constraint on token_jti makes JWT-replay attacks
-- impossible — a JWT signature can't be paired with a different invitation row.

CREATE TABLE IF NOT EXISTS "invitations" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"   uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email"          citext NOT NULL,
  "role"           workspace_role NOT NULL,
  "invited_by"     uuid NOT NULL REFERENCES "users"("id"),
  "token_jti"      text NOT NULL UNIQUE,
  "expires_at"     timestamptz NOT NULL,
  "accepted_at"    timestamptz,
  "accepted_by"    uuid REFERENCES "users"("id"),
  "revoked_at"     timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "invitations_workspace_idx" ON "invitations" ("workspace_id");
CREATE INDEX IF NOT EXISTS "invitations_email_idx"     ON "invitations" ("email");
-- Partial index: only PENDING invitations. Keeps the per-workspace
-- "show me unaccepted invites" query O(log N) over pending rows only.
CREATE INDEX IF NOT EXISTS "invitations_pending_idx"   ON "invitations" ("workspace_id", "email")
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. RLS — tenant-scoped just like docs, embeddings, etc.
-- ----------------------------------------------------------------------------
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;

-- Standard tenant-isolation policy. Same shape as the docs/embeddings policies.
-- The accept-flow does NOT see this policy — it switches to boppl_system role
-- below, which has BYPASSRLS. That's intentional: an unauthenticated joiner
-- has no tenant context yet, so the only safe path is a deliberate, narrowly-
-- scoped system role.
CREATE POLICY "invitations_tenant_isolation" ON "invitations"
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());

-- ----------------------------------------------------------------------------
-- 3. boppl_system role for cross-tenant system operations
-- ----------------------------------------------------------------------------
-- Used by withSystemPrivilege() ONLY for:
--   (a) Looking up an invitation by token (accepter has no tenant yet)
--   (b) Accepting an invitation (inserting the new workspace_members row)
--   (c) Creating a workspace (user may have no current tenant)
--   (d) The WorkOS bootstrap path that creates the initial users row
--
-- Every call site must be reviewed. Adding a 5th caller requires a written
-- justification.
--
-- The role is BYPASSRLS NOINHERIT. NOINHERIT means: granting boppl_system
-- to boppl does NOT auto-give boppl the BYPASSRLS attribute — boppl gets it
-- only via an explicit `SET LOCAL ROLE boppl_system`. That ensures we never
-- accidentally cross tenants by forgetting the role switch.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boppl_system') THEN
    CREATE ROLE boppl_system BYPASSRLS NOINHERIT;
  END IF;
END$$;

-- Same table grants as app_user, so withSystemPrivilege can read/write
-- everything but only does so for the documented system operations.
GRANT USAGE ON SCHEMA public TO boppl_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO boppl_system;
GRANT USAGE,  SELECT, UPDATE                          ON ALL SEQUENCES IN SCHEMA public TO boppl_system;
GRANT EXECUTE                                         ON ALL FUNCTIONS IN SCHEMA public TO boppl_system;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO boppl_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,  SELECT, UPDATE         ON SEQUENCES TO boppl_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE                        ON FUNCTIONS TO boppl_system;

-- Allow boppl (the connection role) to SET ROLE to boppl_system.
GRANT boppl_system TO boppl;
