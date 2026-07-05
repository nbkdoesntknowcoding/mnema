-- 0033_meeting_participant_verified.sql
-- Meeting identity (Phase 4) — mark roster entries that came from Recall's
-- signature-verified webhook as trusted. The MCP boundary validates act-as
-- identities against verified=true rows only (tamper-proof anti-impersonation).
-- Bot-reported rows stay verified=false (UI/capture, best-effort). Idempotent.
ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
