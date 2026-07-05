-- 0031_participant_aliases.sql
-- Meeting identity (Phase 2a) — name→user fallback for meeting attendees with no
-- resolvable email. The MCP boundary resolves X-Mnema-Act-As-Name against this
-- table when no email matches; organizers populate it by mapping unrecognized
-- attendees post-meeting. citext display_name → case-insensitive per workspace.
-- Idempotent.
CREATE TABLE IF NOT EXISTS participant_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name citext NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS participant_aliases_ws_name_uq
  ON participant_aliases (workspace_id, display_name);
CREATE INDEX IF NOT EXISTS participant_aliases_workspace_idx
  ON participant_aliases (workspace_id);
