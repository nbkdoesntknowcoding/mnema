-- Phase 4.2 — comments + doc-versions UI surface
--
-- 1) Replace the Phase-1.2 single-table `comments` (block_id / parent_id)
--    with a two-table model: comment_threads (carry the Yjs anchor and
--    resolved state, scoped to a workspace) + comments (replies under a
--    thread). The old shape was scaffolded but never wired into any code
--    path; a grep over apps/api/src finds no inserts or selects against it.
-- 2) Add doc_read_state for the "unread comments" indicator in the doc list.
-- 3) Enable RLS on all three. comments has no workspace_id column directly;
--    its policy joins through comment_threads to enforce isolation. Using
--    EXISTS over IN/=ANY because the planner is more reliable about pushing
--    the indexed equality from the subquery without materializing.

-- Drop the old comments table (and its trigger + index).
DROP TRIGGER IF EXISTS comments_updated_at ON comments;
DROP INDEX IF EXISTS comments_doc_idx;
DROP TABLE IF EXISTS comments;

-- comment_threads
CREATE TABLE comment_threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc_id        UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  anchor_start  BYTEA NOT NULL,
  anchor_end    BYTEA NOT NULL,
  resolved      BOOLEAN NOT NULL DEFAULT false,
  resolved_by   UUID REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comment_threads_doc_idx ON comment_threads(doc_id, resolved);
CREATE TRIGGER comment_threads_updated_at BEFORE UPDATE ON comment_threads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE comment_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_threads FORCE  ROW LEVEL SECURITY;
CREATE POLICY comment_threads_tenant_select ON comment_threads FOR SELECT
  USING (workspace_id = app_current_tenant_id());
CREATE POLICY comment_threads_tenant_insert ON comment_threads FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY comment_threads_tenant_update ON comment_threads FOR UPDATE
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY comment_threads_tenant_delete ON comment_threads FOR DELETE
  USING (workspace_id = app_current_tenant_id());

-- comments (replies under a thread)
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  author_id   UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ
);
CREATE INDEX comments_thread_idx ON comments(thread_id, created_at);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments FORCE  ROW LEVEL SECURITY;
-- Scope via the parent thread's workspace_id; indexed join is fast.
CREATE POLICY comments_via_thread_select ON comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM comment_threads ct
    WHERE ct.id = comments.thread_id
    AND ct.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY comments_via_thread_insert ON comments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM comment_threads ct
    WHERE ct.id = comments.thread_id
    AND ct.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY comments_via_thread_update ON comments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM comment_threads ct
    WHERE ct.id = comments.thread_id
    AND ct.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY comments_via_thread_delete ON comments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM comment_threads ct
    WHERE ct.id = comments.thread_id
    AND ct.workspace_id = app_current_tenant_id()
  ));

-- doc_read_state: (user_id, doc_id) composite PK, with workspace_id for RLS.
CREATE TABLE doc_read_state (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id        UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, doc_id)
);
CREATE INDEX doc_read_state_doc_idx ON doc_read_state(doc_id);

ALTER TABLE doc_read_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_read_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY doc_read_state_tenant_select ON doc_read_state FOR SELECT
  USING (workspace_id = app_current_tenant_id());
CREATE POLICY doc_read_state_tenant_insert ON doc_read_state FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY doc_read_state_tenant_update ON doc_read_state FOR UPDATE
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
