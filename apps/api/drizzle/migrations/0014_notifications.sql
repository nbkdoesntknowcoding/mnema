-- Phase 9.5: Notification Center backing table.
--
-- Notifications are personal (recipient-scoped RLS), distinct from the
-- workspace-tenant pattern used everywhere else. The WRITE path (the
-- notify_members MCP tool) inserts under boppl_system (BYPASSRLS) after
-- validating every recipient is a current workspace member. The READ path
-- gates on app.user_id — a user sees only their own notifications.

CREATE TABLE IF NOT EXISTS notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id  uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id      uuid        NOT NULL REFERENCES users(id),
  kind          text        NOT NULL,
  title         text        NOT NULL,
  body          text,
  link          text,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- A user sees only their own notifications.
-- The write path bypasses RLS (boppl_system role) after validating recipients.
CREATE POLICY notifications_recipient_isolation ON notifications
  USING (recipient_id = current_setting('app.user_id', true)::uuid);
