-- 0037_iam_audit_log.sql
-- Phase A — every IAM policy change is logged. Immutable. HR admin can read.
CREATE TABLE IF NOT EXISTS iam_audit_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces(id),
  actor_user_id  uuid        REFERENCES users(id),
  action         text        NOT NULL,
  -- 'policy.created' | 'policy.updated' | 'policy.deleted'
  -- 'team.created' | 'team.member.added' | 'team.member.removed'
  -- 'org_role.created' | 'user.invited' | 'user.role.changed'
  resource_type  text,       -- what was changed
  resource_id    uuid,
  payload        jsonb,      -- before/after state
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iam_audit_workspace ON iam_audit_log(workspace_id, created_at DESC);

-- grants for app roles (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON iam_audit_log TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam_audit_log TO boppl_system;
