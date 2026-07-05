-- AgentLens Phase 3: Intelligence Layer
-- Migration 0018

-- ── optimization_findings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS optimization_findings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
  rule         TEXT NOT NULL,
  description  TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  roi_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
  applied      BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at   TIMESTAMP,
  dismissed    BOOLEAN NOT NULL DEFAULT FALSE,
  metadata     JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS findings_workspace_idx ON optimization_findings(workspace_id);
CREATE INDEX IF NOT EXISTS findings_rule_idx       ON optimization_findings(rule);
CREATE INDEX IF NOT EXISTS findings_applied_idx    ON optimization_findings(applied);

-- ── fix_history ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fix_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL,
  blocker_description TEXT NOT NULL,
  fix_prompt          TEXT,
  fix_prompt_model    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  scheduled_at  TIMESTAMP NOT NULL,
  dispatched_at TIMESTAMP,
  resolved_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fix_history_task_idx ON fix_history(task_id);

-- ── FTS: tasks ────────────────────────────────────────────────────────────────
-- Note: array_to_string is not IMMUTABLE so tags are excluded from the
-- generated column. Tags can still be searched via a separate GIN index.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS fts_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS tasks_fts_idx ON tasks USING GIN(fts_vector);

-- ── FTS: agent_sessions ───────────────────────────────────────────────────────
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS fts_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(developer_id, '') || ' ' ||
      coalesce(git_branch, '') || ' ' ||
      coalesce(agent, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS sessions_fts_idx ON agent_sessions USING GIN(fts_vector);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE optimization_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fix_history            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "optimization_findings_superuser" ON optimization_findings USING (current_user = 'boppl');
CREATE POLICY "fix_history_superuser"            ON fix_history            USING (current_user = 'boppl');

CREATE POLICY "optimization_findings_workspace_isolation"
  ON optimization_findings
  USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);

CREATE POLICY "fix_history_workspace_isolation"
  ON fix_history
  USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);
