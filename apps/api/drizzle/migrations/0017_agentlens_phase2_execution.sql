-- AgentLens Phase 2: Execution Tracking
-- Migration 0017

-- ── Extend agent_sessions with Phase 2 cost/token columns ────────────────────
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS total_input_tokens     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_output_tokens    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cost_usd         DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tool_calls       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model                  TEXT,
  ADD COLUMN IF NOT EXISTS git_branch             TEXT,
  ADD COLUMN IF NOT EXISTS git_commit_before      TEXT,
  ADD COLUMN IF NOT EXISTS git_commit_after       TEXT,
  ADD COLUMN IF NOT EXISTS files_modified_count   INTEGER NOT NULL DEFAULT 0;

-- ── tool_calls ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tool_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id     UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_name        TEXT NOT NULL,
  input_json       JSONB,
  output_json      JSONB,
  truncated        BOOLEAN NOT NULL DEFAULT FALSE,
  file_path        TEXT,
  duration_ms      INTEGER,
  exit_code        INTEGER,
  is_error         BOOLEAN NOT NULL DEFAULT FALSE,
  error_message    TEXT,
  input_tokens     INTEGER DEFAULT 0,
  output_tokens    INTEGER DEFAULT 0,
  cache_read_tokens  INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  cost_usd         DOUBLE PRECISION DEFAULT 0,
  timestamp        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tool_calls_session_idx      ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS tool_calls_workspace_idx    ON tool_calls(workspace_id);
CREATE INDEX IF NOT EXISTS tool_calls_timestamp_idx    ON tool_calls(timestamp);
CREATE INDEX IF NOT EXISTS tool_calls_file_path_idx    ON tool_calls(file_path);
CREATE INDEX IF NOT EXISTS tool_calls_session_time_idx ON tool_calls(session_id, timestamp);

-- ── file_diffs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS file_diffs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool_call_id   UUID REFERENCES tool_calls(id) ON DELETE SET NULL,
  file_path      TEXT NOT NULL,
  diff_content   TEXT,
  truncated      BOOLEAN NOT NULL DEFAULT FALSE,
  lines_added    INTEGER DEFAULT 0,
  lines_removed  INTEGER DEFAULT 0,
  timestamp      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS file_diffs_session_idx ON file_diffs(session_id);

-- ── model_pricing ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_pricing (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id                    TEXT NOT NULL UNIQUE,
  provider                    TEXT NOT NULL,
  input_price_per_million     DOUBLE PRECISION NOT NULL,
  output_price_per_million    DOUBLE PRECISION NOT NULL,
  cache_read_price_per_million  DOUBLE PRECISION DEFAULT 0,
  cache_write_price_per_million DOUBLE PRECISION DEFAULT 0,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── budget_configs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_configs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  daily_budget_usd    DOUBLE PRECISION,
  monthly_budget_usd  DOUBLE PRECISION,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  slack_webhook_url   TEXT,
  discord_webhook_url TEXT,
  last_alert_sent_at  TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RLS: tool_calls and file_diffs inherit workspace-level access
ALTER TABLE tool_calls   ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_diffs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_configs ENABLE ROW LEVEL SECURITY;

-- Superuser bypass (same pattern as Phase 1)
CREATE POLICY "tool_calls_superuser"    ON tool_calls    USING (current_user = 'boppl');
CREATE POLICY "file_diffs_superuser"    ON file_diffs    USING (current_user = 'boppl');
CREATE POLICY "model_pricing_superuser" ON model_pricing USING (current_user = 'boppl');
CREATE POLICY "budget_configs_superuser" ON budget_configs USING (current_user = 'boppl');

-- Workspace isolation for app_user (tenant-scoped access via GUC)
CREATE POLICY "tool_calls_workspace_isolation"
  ON tool_calls
  USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);

CREATE POLICY "file_diffs_workspace_isolation"
  ON file_diffs
  USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);

CREATE POLICY "model_pricing_read_all"
  ON model_pricing
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "budget_configs_workspace_isolation"
  ON budget_configs
  USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);
