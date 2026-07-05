-- 0057_meeting_records.sql — Aspect 6 / M1: episodic meeting-record store.
-- The structured, timestamped unit the M2 consolidation worker writes and the M3 start-brief
-- assembler reads (distinct from meetings.summary; the graph is the semantic store).
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS meeting_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  meeting_id    uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  title         text,
  participants  jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at    timestamptz,
  ended_at      timestamptz,
  summary       text,
  decisions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_items  jsonb NOT NULL DEFAULT '[]'::jsonb,
  commitments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  acl_scope     text NOT NULL,
  source_refs   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One episodic record per meeting (M2 consolidation is idempotent on this).
CREATE UNIQUE INDEX IF NOT EXISTS meeting_records_meeting_uq   ON meeting_records (meeting_id);
CREATE INDEX        IF NOT EXISTS meeting_records_workspace_idx ON meeting_records (workspace_id);
CREATE INDEX        IF NOT EXISTS meeting_records_project_idx   ON meeting_records (project_id);
