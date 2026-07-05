-- 0045_meeting_transcripts_summary.sql
-- Phase 2 of the meetings redesign: persist a per-meeting transcript and an
-- extracted summary (key points / decisions / action items) so the Meetings
-- page can show them. Additive + idempotent (this repo applies migrations by
-- hand via psql). Apply as boppl.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary jsonb;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS transcript_status text DEFAULT 'none';

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id     uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  speaker        text,
  participant_id uuid REFERENCES meeting_participants(id) ON DELETE SET NULL,
  text           text NOT NULL,
  ts_ms          bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_transcripts_meeting_seq_uq ON meeting_transcripts(meeting_id, seq);
CREATE INDEX IF NOT EXISTS meeting_transcripts_meeting_idx ON meeting_transcripts(meeting_id);
