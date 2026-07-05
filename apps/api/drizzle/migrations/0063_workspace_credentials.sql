-- 0063 — Workspace BYOK credentials (Open-Core Phase 1, cloud free tier).
--
-- Per-workspace bring-your-own-key storage. v1 holds the meeting-agent LLM key
-- only (provider 'llm', OpenAI-compatible); Deepgram STT + Inworld TTS stay on
-- our keys, and the monthly meeting cap covers our STT/TTS/Recall cost. The api
-- key is stored ENCRYPTED (lib/secret-box.ts, SECRETBOX_MASTER_KEY) — plaintext
-- never hits the DB. base_url/model let a workspace target any OpenAI-compatible
-- endpoint.
--
-- Enforcement is app-layer (sibling to workspace_join_requests, 0062): every read
-- filters by workspace_id; the meeting-end worker and the internal
-- /api/_internal/meeting-llm-key endpoint resolve the row server-side; settings
-- routes require workspace admin. No RLS policy. Idempotent.

CREATE TABLE IF NOT EXISTS workspace_credentials (
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  encrypted_key  text NOT NULL,
  base_url       text,
  model          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);
