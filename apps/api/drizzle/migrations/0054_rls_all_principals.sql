-- 0054_rls_all_principals.sql — M1 of Fix_IAM_Audit_Remediation.
-- app_can_see_project only consulted doc_acl for editors (IF v_role='editor'), so a
-- VIEWER / org_role / team principal with an explicit project-level 'read' grant was
-- still denied. Drop the editor gate: a positive project ACL grant now grants
-- visibility to ANY non-admin principal, exactly as app_acl_permits already models.
-- (owner/admin still short-circuit above via app_is_workspace_admin.)
-- Applied by hand via psql, as boppl. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION app_can_see_project(row_project_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  -- 1. Hard project lock (project-bound keys, guest-deny)
  IF app_current_project_scope() IS NOT NULL THEN
    RETURN row_project_id = app_current_project_scope();
  END IF;

  -- 2. No user = unrestricted in tenant (trusted server context)
  IF app_current_user_id() IS NULL THEN RETURN true; END IF;

  -- 3. Owner/admin: full visibility (app_is_workspace_admin = owner|admin per 0051)
  IF app_is_workspace_admin() THEN RETURN true; END IF;

  -- 4. Explicit project-level doc_acl grant for ANY non-admin principal
  --    (viewer, editor, org_role, team) — app_acl_permits is deny-first + expiry-aware.
  IF row_project_id IS NOT NULL AND app_acl_permits('project', row_project_id) THEN
    RETURN true;
  END IF;

  -- 5. Fallthrough: unfiled docs visible workspace-wide; filed docs require membership.
  RETURN row_project_id IS NULL
    OR row_project_id IN (SELECT app_accessible_projects());
END;
$$;
