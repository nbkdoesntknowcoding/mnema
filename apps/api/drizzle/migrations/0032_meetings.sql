-- 0032_meetings.sql
-- Meeting identity (Phase 2b) — capture meetings + their attendees so the organizer
-- can map unrecognized people post-meeting. Keyed by the Recall bot id (the bot
-- upserts). resolved_user_id = who the attendee resolved to at capture; NULL = needs
-- mapping. Idempotent.
CREATE TABLE IF NOT EXISTS meetings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recall_bot_id     text NOT NULL UNIQUE,
  organizer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  meeting_url       text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz
);
CREATE INDEX IF NOT EXISTS meetings_workspace_idx ON meetings (workspace_id);

CREATE TABLE IF NOT EXISTS meeting_participants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id           uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  recall_participant_id text NOT NULL,
  name                 text,
  email                text,
  is_host              boolean NOT NULL DEFAULT false,
  resolved_user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT meeting_participants_uq UNIQUE (meeting_id, recall_participant_id)
);
CREATE INDEX IF NOT EXISTS meeting_participants_meeting_idx ON meeting_participants (meeting_id);
