-- 0049_rls_doc_acl.sql — FIX 3 of Fix_Admin_docACL_AccessRequests.
-- Patch app_can_see_project() so editors gain visibility to a project when an
-- explicit doc_acl grant permits it (via app_acl_permits, 0048). Owner/admin keep
-- the full bypass; viewers are unchanged. Replaces the SQL-CASE form with plpgsql.
-- NOTE vs source doc: uses app_current_tenant_id() (the real accessor).
-- Applied by hand via psql, as boppl. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION app_can_see_project(row_project_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_role text;
BEGIN
  -- 1. Hard project lock (project-bound keys, guest-deny)
  IF app_current_project_scope() IS NOT NULL THEN
    RETURN row_project_id = app_current_project_scope();
  END IF;

  -- 2. No user = unrestricted in tenant (trusted server context)
  IF app_current_user_id() IS NULL THEN RETURN true; END IF;

  -- 3. Owner/admin: full visibility, no further checks
  --    (app_is_workspace_admin already includes admin per the live DB — no change needed)
  IF app_is_workspace_admin() THEN RETURN true; END IF;

  -- 4. Get the user's workspace role for the editor check
  SELECT role INTO v_role
    FROM workspace_members
    WHERE workspace_id = app_current_tenant_id()
      AND user_id      = app_current_user_id();

  -- 5. Editor: check doc_acl at project level if a project exists.
  --    If doc_acl explicitly grants -> permit.
  --    If doc_acl explicitly denies -> block.
  --    If no doc_acl row -> fall through to project membership (same as viewer).
  IF v_role = 'editor' AND row_project_id IS NOT NULL THEN
    IF app_acl_permits('project', row_project_id) THEN RETURN true; END IF;
  END IF;

  -- 6. Viewer + editor fallthrough: unfiled docs visible workspace-wide;
  --    filed docs require project membership.
  RETURN row_project_id IS NULL
    OR row_project_id IN (SELECT app_accessible_projects());
END;
$$;
