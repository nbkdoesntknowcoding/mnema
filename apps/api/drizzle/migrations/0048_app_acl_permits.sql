-- 0048_app_acl_permits.sql — FIX 2 of Fix_Admin_docACL_AccessRequests.
-- New function: given the current RLS user, check if any positive doc_acl policy
-- grants them access to a resource. Called by app_can_see_project (0049) and by
-- the REST doc-read path (canAccess in iam.ts).
-- NOTE vs source doc: the doc used app_current_tenant()/casts; the real accessors
-- are app_current_tenant_id()/app_current_user_id() and already return uuid.
-- Applied by hand via psql, as boppl. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION app_acl_permits(
  p_resource_type text,
  p_resource_id   uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   uuid := app_current_user_id();
  v_workspace uuid := app_current_tenant_id();
  v_team_ids  uuid[];
  v_role_id   uuid;
BEGIN
  IF v_user_id IS NULL THEN RETURN true; END IF;

  SELECT ARRAY(SELECT team_id FROM team_members WHERE user_id = v_user_id)
    INTO v_team_ids;
  SELECT org_role_id INTO v_role_id
    FROM user_org_profiles
    WHERE user_id = v_user_id AND workspace_id = v_workspace;

  -- Explicit deny at this resource always wins
  IF EXISTS (
    SELECT 1 FROM doc_acl
    WHERE workspace_id  = v_workspace
      AND resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND permission    = 'none'
      AND (
        (principal_type = 'user'     AND principal_id = v_user_id) OR
        (principal_type = 'team'     AND v_team_ids IS NOT NULL AND principal_id = ANY(v_team_ids)) OR
        (principal_type = 'org_role' AND v_role_id IS NOT NULL  AND principal_id = v_role_id)
      )
  ) THEN RETURN false; END IF;

  -- Any positive grant permits
  RETURN EXISTS (
    SELECT 1 FROM doc_acl
    WHERE workspace_id  = v_workspace
      AND resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND permission   != 'none'
      AND (
        (principal_type = 'user'     AND principal_id = v_user_id) OR
        (principal_type = 'team'     AND v_team_ids IS NOT NULL AND principal_id = ANY(v_team_ids)) OR
        (principal_type = 'org_role' AND v_role_id IS NOT NULL  AND principal_id = v_role_id)
      )
  );
END;
$$;
