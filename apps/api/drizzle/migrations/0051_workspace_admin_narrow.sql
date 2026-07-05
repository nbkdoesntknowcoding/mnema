-- 0051_workspace_admin_narrow.sql — makes FIX 3 (0049) actually take effect.
--
-- Until now app_is_workspace_admin() returned true for editors too, so the editor
-- doc_acl branch in app_can_see_project() (0049) was unreachable dead code: editors
-- got blanket visibility before the check ran. Narrowing to ('owner','admin') means
-- editors are NO LONGER workspace admins for visibility — they now see a filed
-- project only if they are a project member OR hold a doc_acl grant on it (0049
-- steps 4-6). Owners and admins are unaffected (still full visibility).
--
-- BEHAVIOUR CHANGE: existing editors lose access to project-FILED docs they are not
-- a member of / not granted. Unfiled docs (project_id NULL) stay visible to all
-- workspace members. app_is_workspace_admin() is only consumed by app_can_see_project,
-- so the blast radius is project visibility only.
--
-- Applied by hand via psql, as boppl. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION app_is_workspace_admin() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members wm
    WHERE wm.user_id = app_current_user_id()
      AND wm.workspace_id = app_current_tenant_id()
      AND wm.role IN ('owner', 'admin')
  )
$$ LANGUAGE SQL STABLE;
