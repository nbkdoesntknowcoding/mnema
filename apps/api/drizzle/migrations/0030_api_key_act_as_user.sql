-- 0030_api_key_act_as_user.sql
-- Meeting identity (Phase 1) — a service key may "act as" the asking participant.
--
-- When act_as_user = true, the MCP boundary reads the X-Mnema-Act-As-Email header
-- on each request, resolves it to a workspace user, and sets app.user_id to that
-- user for the call — so per-user RLS (migration 0028/0029) enforces THAT user's
-- access. Unresolved/guest → denied all knowledge. Inert until a key is flagged.
--
-- Idempotent.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS act_as_user boolean NOT NULL DEFAULT false;
