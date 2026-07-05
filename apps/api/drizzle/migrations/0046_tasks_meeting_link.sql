-- 0046_tasks_meeting_link.sql
-- Phase 3: link tasks auto-created from a meeting back to that meeting, so the
-- knowledge graph can draw meeting → task edges and the UI can list "tasks from
-- this meeting". Additive + idempotent (applied by hand via psql, as boppl).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tasks_meeting_idx ON tasks(meeting_id);
