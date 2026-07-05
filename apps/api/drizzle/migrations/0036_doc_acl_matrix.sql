-- 0036_doc_acl_matrix.sql
-- Phase A — activate doc_acl with full resource + principal matrix + the RLS
-- resolution function. The old dormant doc_acl (doc_id/user_id/can_read/can_write)
-- is dropped and recreated. Idempotent.

DROP TABLE IF EXISTS doc_acl;

CREATE TABLE doc_acl (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- WHAT is being controlled
  resource_type  text NOT NULL,
  -- 'doc' | 'folder' | 'project'
  resource_id    uuid NOT NULL,

  -- WHO the policy applies to
  principal_type text NOT NULL,
  -- 'user' | 'team' | 'org_role'
  principal_id   uuid NOT NULL,

  -- WHAT they can do
  permission     text NOT NULL,
  -- 'read' | 'write' | 'admin' | 'none'
  -- 'none' = explicit deny, overrides any allow

  -- AUDIT
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),

  UNIQUE(resource_type, resource_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_acl_resource  ON doc_acl(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_doc_acl_principal ON doc_acl(principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_doc_acl_workspace ON doc_acl(workspace_id);

-- The resolution function: given a user + resource, return effective permission
-- Priority: doc > folder > project. Explicit 'none' always wins.
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

  -- Check explicit DENY first (none = deny, highest priority)
  -- Check at doc level, then folder, then project
  -- User-level deny
  IF EXISTS (
    SELECT 1 FROM doc_acl
    WHERE resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND principal_type = 'user'
      AND principal_id   = p_user_id
      AND permission     = 'none'
  ) THEN RETURN 'none'; END IF;

  -- Team-level deny
  IF v_team_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM doc_acl
    WHERE resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND principal_type = 'team'
      AND principal_id   = ANY(v_team_ids)
      AND permission     = 'none'
  ) THEN RETURN 'none'; END IF;

  -- Collect best positive permission across all principal types at this resource
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
  ORDER BY
    CASE permission WHEN 'admin' THEN 3 WHEN 'write' THEN 2 WHEN 'read' THEN 1 END DESC
  LIMIT 1;

  RETURN COALESCE(v_permission, NULL); -- NULL = no explicit policy, fall through to workspace_role
END;
$$;

-- grants for app roles (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_acl TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON doc_acl TO boppl_system;
