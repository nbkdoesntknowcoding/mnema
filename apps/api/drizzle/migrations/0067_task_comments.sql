-- ── Task comments ─────────────────────────────────────────────────────────────
-- Human comments on Kanban tasks (review notes, audit-fix guidance). Kept
-- separate from tasks.description, which agents treat as the task spec.
-- Fully additive; idempotent.

CREATE TABLE IF NOT EXISTS task_comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id      uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id    uuid        NOT NULL REFERENCES users(id),
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_comments_task_idx
  ON task_comments (task_id, created_at);

-- RLS: same pattern as the other dev_project tables (superuser bypass +
-- workspace isolation via the app.tenant_id GUC).
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_comments' AND policyname = 'task_comments_superuser') THEN
    CREATE POLICY "task_comments_superuser" ON task_comments USING (current_user = 'boppl');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'task_comments' AND policyname = 'task_comments_workspace_isolation') THEN
    CREATE POLICY "task_comments_workspace_isolation"
      ON task_comments
      USING (workspace_id = (current_setting('app.tenant_id', true))::uuid);
  END IF;
END $$;
