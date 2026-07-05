-- Phase 1: AgentLens Task Layer
--
-- Adds:
--   1. workspaces.mode   — 'knowledge' | 'dev_project' (default 'knowledge')
--   2. workspaces.hook_token — SHA-256 hash of hook bearer token (nullable, unique)
--   3. tasks table       — core Kanban unit for dev_project workspaces
--   4. agent_sessions table — stub for Phase 2 session tracking
--   5. Three indexes on tasks (workspace_id, status, board_order)
--
-- No DROP statements. No destructive changes. Fully additive.

-- ── 1. Extend workspaces ────────────────────────────────────────────────────

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS mode       text NOT NULL DEFAULT 'knowledge',
  ADD COLUMN IF NOT EXISTS hook_token text;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_hook_token_unique
  ON workspaces (hook_token)
  WHERE hook_token IS NOT NULL;

-- ── 2. Tasks table ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
  id                   uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid            NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc_id               uuid            REFERENCES docs(id) ON DELETE SET NULL,

  title                text            NOT NULL,
  description          text,
  status               text            NOT NULL DEFAULT 'backlog',
  -- Values: 'backlog' | 'in_progress' | 'review' | 'audit_fix' | 'done'

  priority             text            NOT NULL DEFAULT 'medium',
  -- Values: 'low' | 'medium' | 'high' | 'critical'

  estimated_cost_usd   double precision,
  assigned_member_id   uuid            REFERENCES users(id) ON DELETE SET NULL,

  github_pr_url        text,
  github_pr_status     text,
  -- Values: 'open' | 'merged' | 'closed' | NULL

  blocker_description  text,
  retry_count          integer         NOT NULL DEFAULT 0,
  retry_fix_hint       text,

  board_order          integer         NOT NULL DEFAULT 0,
  tags                 text[],

  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now(),
  completed_at         timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_workspace_id_idx ON tasks (workspace_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx       ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_board_order_idx  ON tasks (board_order);

-- Enable RLS (workspace member isolation — read path gates via app.tenant_id)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY tasks_workspace_isolation ON tasks
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid);

-- ── 3. Agent sessions table (Phase 2 stub) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id       uuid        REFERENCES tasks(id) ON DELETE SET NULL,
  developer_id  text        NOT NULL,
  -- Matches MNEMA_DEVELOPER_ID env var on the agent's machine
  agent         text        NOT NULL DEFAULT 'claude_code',
  -- Values: 'claude_code' | 'cursor' | 'aider' | 'cline' | 'generic'
  status        text        NOT NULL DEFAULT 'active',
  -- Values: 'active' | 'completed' | 'failed' | 'stalled'
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  -- Phase 2 will add cost/token columns via additive migration
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_sessions_workspace_idx ON agent_sessions (workspace_id);
CREATE INDEX IF NOT EXISTS agent_sessions_task_idx      ON agent_sessions (task_id);

-- Enable RLS
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_sessions_workspace_isolation ON agent_sessions
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid);
