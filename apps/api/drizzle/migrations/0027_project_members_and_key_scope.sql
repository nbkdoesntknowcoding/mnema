-- 0027_project_members_and_key_scope.sql
-- Stage B (project-level authorization) — foundation, additive only.
--
-- project_members mirrors workspace_members (tenant-isolated via RLS). api_keys
-- gains a nullable project_id: a project-scoped key restricts its session to that
-- one project regardless of creator — this is what hard-bounds the meeting bot.
-- No behavior change yet: the GUCs + project-scoped RLS policies that consume
-- these land in the next migration (0028).

CREATE TABLE IF NOT EXISTS "project_members" (
  "project_id"   uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "role"         "workspace_role" NOT NULL DEFAULT 'viewer',
  "joined_at"    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("project_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "project_members_user_idx"      ON "project_members" ("user_id");
CREATE INDEX IF NOT EXISTS "project_members_workspace_idx" ON "project_members" ("workspace_id");

-- Tenant isolation (same shape as workspace_members / docs / invitations).
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "project_members_tenant_isolation" ON "project_members"
    USING (workspace_id = app_current_tenant_id())
    WITH CHECK (workspace_id = app_current_tenant_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Project-scoped API keys.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "project_id" uuid;
DO $$ BEGIN
  ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "api_keys_project_idx" ON "api_keys" ("project_id");
