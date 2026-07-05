-- 0052_effective_permission_expiry.sql — M2 of Fix_IAM_Audit_Remediation.
-- app_effective_permission (0036) had no expires_at filter, so the REST defense-in-depth
-- path (canAccess -> resolvePermission) still honored EXPIRED doc_acl grants until the
-- hourly cron deleted them — disagreeing with app_acl_permits (RLS, 0050) which already
-- filters expiry. This re-creates the function with the same expiry guard on every
-- doc_acl clause (deny + permit), so both permission engines agree on expiry.
-- Applied by hand via psql, as boppl. Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION app_effective_permission(
  p_user_id       uuid,
  p_workspace_id  uuid,
  p_resource_type text,  -- 'doc'
  p_resource_id   uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_permission text := NULL;
  v_team_ids   uuid[];
  v_role_id    uuid;
  v_folder_id  uuid;
  v_project_id uuid;
BEGIN
  -- Get user's teams and org_role in this workspace
  SELECT ARRAY(SELECT team_id FROM team_members WHERE user_id = p_user_id) INTO v_team_ids;
  SELECT org_role_id INTO v_role_id
    FROM user_org_profiles
    WHERE user_id = p_user_id AND workspace_id = p_workspace_id;

  -- Check explicit DENY first (none = deny, highest priority). Expired rows ignored.
  -- User-level deny
  IF EXISTS (
    SELECT 1 FROM doc_acl
    WHERE resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND principal_type = 'user'
      AND principal_id   = p_user_id
      AND permission     = 'none'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN 'none'; END IF;

  -- Team-level deny
  IF v_team_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM doc_acl
    WHERE resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND principal_type = 'team'
      AND principal_id   = ANY(v_team_ids)
      AND permission     = 'none'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN 'none'; END IF;

  -- Collect best positive, non-expired permission across all principal types
  SELECT permission INTO v_permission
  FROM doc_acl
  WHERE resource_type = p_resource_type
    AND resource_id   = p_resource_id
    AND (
      (principal_type = 'user'     AND principal_id = p_user_id) OR
      (principal_type = 'team'     AND principal_id = ANY(v_team_ids)) OR
      (principal_type = 'org_role' AND principal_id = v_role_id)
    )
    AND permission != 'none'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 END DESC
  LIMIT 1;

  RETURN COALESCE(v_permission, NULL); -- NULL = no explicit policy, fall through to workspace_role
END;
$$;
