-- 0028_project_rls_functions.sql
-- Stage B — RLS helper functions for per-user + project-scoped access.
-- Pure functions; no policy changes here (those land in 0029), so this is inert
-- until the policies + GUC-setting code use them.
--
-- GUC contract (all transaction-local, set by withTenant):
--   app.tenant_id      — current workspace (already set today)
--   app.user_id        — current user (REST sub / OAuth user / key creator)
--   app.project_scope  — set ONLY for project-scoped API keys (the meeting bot);
--                        when set, the session is hard-bounded to that one project.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_current_project_scope() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.project_scope', true), '')::uuid
$$ LANGUAGE SQL STABLE;

-- Is the current user an owner/admin/editor of the current workspace? Such users
-- see every project in the workspace (the explicit, intentional admin bypass).
CREATE OR REPLACE FUNCTION app_is_workspace_admin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.user_id = app_current_user_id()
      AND wm.workspace_id = app_current_tenant_id()
      AND wm.role IN ('owner', 'admin', 'editor')
  )
$$ LANGUAGE SQL STABLE;

-- The projects the current user may access in the current workspace (membership).
-- (Admins/owners are handled separately via app_is_workspace_admin so they see all.)
CREATE OR REPLACE FUNCTION app_accessible_projects() RETURNS SETOF uuid AS $$
  SELECT pm.project_id FROM project_members pm
  WHERE pm.user_id = app_current_user_id()
    AND pm.workspace_id = app_current_tenant_id()
$$ LANGUAGE SQL STABLE;

-- The single predicate every project-scoped table uses. Given a row's project_id
-- (which may be NULL = unfiled / workspace-wide), can the current session see it?
--
--   • project-scoped key (bot): app.project_scope set  → ONLY that exact project,
--     never unfiled, never anything else. This is the "don't blabber" hard bound.
--   • no user context (legacy/system tx where app.user_id is unset) → no extra
--     restriction beyond the workspace (preserves today's behavior — SAFE DEFAULT).
--   • workspace owner/admin/editor → everything in the workspace.
--   • otherwise (a scoped member) → unfiled rows OR projects they're a member of.
CREATE OR REPLACE FUNCTION app_can_see_project(row_project_id uuid) RETURNS boolean AS $$
  SELECT CASE
    WHEN app_current_project_scope() IS NOT NULL
      THEN row_project_id = app_current_project_scope()
    WHEN app_current_user_id() IS NULL
      THEN true
    WHEN app_is_workspace_admin()
      THEN true
    ELSE (
      row_project_id IS NULL
      OR row_project_id IN (SELECT app_accessible_projects())
    )
  END
$$ LANGUAGE SQL STABLE;
