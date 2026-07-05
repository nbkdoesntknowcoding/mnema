-- MCP API tokens — long-lived Bearer credentials for Claude Desktop / claude.ai.
-- Each row represents one issued token. The JWT itself is never stored;
-- only the jti (JWT ID) is kept so individual tokens can be revoked.
-- Row-level security is enforced via workspace_id matching set_config('app.tenant_id', ...).

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT        NOT NULL,
  name         TEXT        NOT NULL DEFAULT 'Claude Desktop',
  jti          UUID        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  scopes       TEXT[]      NOT NULL DEFAULT ARRAY['docs:read','flows:read'],
  expires_at   TIMESTAMPTZ,                      -- NULL = never expires
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tokens_workspace_idx ON mcp_tokens(workspace_id);
CREATE INDEX IF NOT EXISTS mcp_tokens_jti_idx       ON mcp_tokens(jti);
