-- 0041_calendar_phase_c.sql — Phase C: Google Calendar linking + scheduled meetings.
-- Relaxes the bot-centric meetings schema so calendar-synced (not-yet-joined)
-- meetings can exist, and stores the per-user calendar refresh token.

ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS calendar_refresh_token text;

-- Scheduled meetings have no Recall bot yet; allow NULL (UNIQUE still permits many NULLs).
ALTER TABLE meetings ALTER COLUMN recall_bot_id DROP NOT NULL;

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS title              text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_end_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start ON meetings(scheduled_start_at);
