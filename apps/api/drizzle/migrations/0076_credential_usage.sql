-- ── Credential usage log ──────────────────────────────────────────────────────
-- Append-only record of when each developer credential (REST API key or MCP
-- token) was last seen, so the Access page can show real "recent activity" and
-- posture (unused key, new-geo hit) instead of only the coarse last_used_at
-- bump. Writes are rate-limited to at most one row per credential per minute in
-- the app layer (see lib/credential-usage.ts), so a busy key can't flood it.
-- Fully additive; idempotent.

CREATE TABLE IF NOT EXISTS credential_usage (
  id              bigserial   PRIMARY KEY,
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credential_type text        NOT NULL,  -- 'api_key' | 'mcp_token'
  credential_id   uuid        NOT NULL,
  ip              text,
  path            text,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

-- Fast "last N for this credential" lookups.
CREATE INDEX IF NOT EXISTS credential_usage_cred_idx
  ON credential_usage (credential_type, credential_id, created_at DESC);

-- RLS: superuser bypass + workspace isolation via the app.tenant_id GUC,
-- matching every other tenant table.
ALTER TABLE credential_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credential_usage' AND policyname = 'credential_usage_superuser') THEN
    CREATE POLICY "credential_usage_superuser" ON credential_usage USING (current_user = 'boppl');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'credential_usage' AND policyname = 'credential_usage_workspace_isolation') THEN
    CREATE POLICY "credential_usage_workspace_isolation"
      ON credential_usage
      USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);
  END IF;
END $$;
