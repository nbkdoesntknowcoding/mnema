-- 0050_doc_access_requests.sql — FIX 6 of Fix_Admin_docACL_AccessRequests.
-- Access-request flow: a person can request access to a doc they can't see; the
-- owner/recipient approves (optionally time-limited) → writes a doc_acl grant.
-- Also adds doc_acl.expires_at and re-creates app_acl_permits() to ignore expired
-- grants. Applied by hand via psql, as boppl. Idempotent.

-- 1. Access requests table
CREATE TABLE IF NOT EXISTS doc_access_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc_id            uuid        NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  requester_id      uuid        NOT NULL REFERENCES users(id),
  requested_from_id uuid        REFERENCES users(id),
  message           text,
  permission        text        NOT NULL DEFAULT 'read',   -- 'read' | 'write'
  expires_at        timestamptz,                           -- NULL = permanent
  status            text        NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
  resolved_by       uuid        REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT doc_access_requests_open_uq UNIQUE (doc_id, requester_id, status)
);

CREATE INDEX IF NOT EXISTS idx_access_requests_workspace ON doc_access_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_pending   ON doc_access_requests(requested_from_id, status)
  WHERE status = 'pending';

-- 2. Time-limited grants on doc_acl
ALTER TABLE doc_acl
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;  -- NULL = permanent

-- 3. Re-create app_acl_permits() so expired grants are ignored (both deny + permit).
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

  -- Explicit (non-expired) deny at this resource always wins
  IF EXISTS (
    SELECT 1 FROM doc_acl
    WHERE workspace_id  = v_workspace
      AND resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND permission    = 'none'
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        (principal_type = 'user'     AND principal_id = v_user_id) OR
        (principal_type = 'team'     AND v_team_ids IS NOT NULL AND principal_id = ANY(v_team_ids)) OR
        (principal_type = 'org_role' AND v_role_id IS NOT NULL  AND principal_id = v_role_id)
      )
  ) THEN RETURN false; END IF;

  -- Any positive, non-expired grant permits
  RETURN EXISTS (
    SELECT 1 FROM doc_acl
    WHERE workspace_id  = v_workspace
      AND resource_type = p_resource_type
      AND resource_id   = p_resource_id
      AND permission   != 'none'
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        (principal_type = 'user'     AND principal_id = v_user_id) OR
        (principal_type = 'team'     AND v_team_ids IS NOT NULL AND principal_id = ANY(v_team_ids)) OR
        (principal_type = 'org_role' AND v_role_id IS NOT NULL  AND principal_id = v_role_id)
      )
  );
END;
$$;
