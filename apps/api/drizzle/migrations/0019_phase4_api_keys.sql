-- Phase 4: Personal API Keys for multi-AI connectivity
-- Every AI application authenticates with a workspace-scoped API key.

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  key_hash      TEXT        NOT NULL UNIQUE,
  key_prefix    TEXT        NOT NULL,
  scopes        TEXT[]      NOT NULL DEFAULT '{read}',
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_workspace_idx ON api_keys(workspace_id);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx      ON api_keys(key_hash);

-- RLS: workspace members can manage API keys in their workspace
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_tenant_isolation ON api_keys
  USING (
    workspace_id = current_setting('app.tenant_id', true)::uuid
  );

-- Phase 4: budget_configs task notification columns
ALTER TABLE budget_configs
  ADD COLUMN IF NOT EXISTS notify_on_task_complete BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_on_blocker        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_on_retry          BOOLEAN NOT NULL DEFAULT FALSE;
