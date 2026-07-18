-- ── Flow node comments ────────────────────────────────────────────────────────
-- Human comment threads anchored to a flow node (client_node_id). Separate from
-- doc comment_threads, which are Yjs-anchored to a document's text range.
-- Fully additive; idempotent.

CREATE TABLE IF NOT EXISTS flow_comments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  flow_id        uuid        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  client_node_id text        NOT NULL,
  author_id      uuid        NOT NULL REFERENCES users(id),
  body           text        NOT NULL,
  resolved       boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flow_comments_flow_node_idx
  ON flow_comments (flow_id, client_node_id, created_at);

-- RLS: superuser bypass + workspace isolation via the app.tenant_id GUC.
ALTER TABLE flow_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flow_comments' AND policyname = 'flow_comments_superuser') THEN
    CREATE POLICY "flow_comments_superuser" ON flow_comments USING (current_user = 'boppl');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'flow_comments' AND policyname = 'flow_comments_workspace_isolation') THEN
    CREATE POLICY "flow_comments_workspace_isolation"
      ON flow_comments
      USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);
  END IF;
END $$;
