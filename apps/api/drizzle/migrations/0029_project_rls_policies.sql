-- 0029_project_rls_policies.sql
-- Stage B — replace the workspace-only RLS policies on the project-scoped tables
-- with project-aware ones: workspace isolation AND app_can_see_project(project_id).
--
-- SAFE BY DEFAULT: with no app.user_id and no app.project_scope set,
-- app_can_see_project() returns true for every row, so this is identical to the
-- current workspace-only behavior. Restriction only kicks in when:
--   • a project-scoped key sets app.project_scope (the bot → one project), or
--   • app.user_id is set for a non-admin member (per-user project membership).
-- Idempotent: DROP POLICY IF EXISTS then CREATE.

-- Defensive: this policy set references project_id on every table below. If the
-- column-adding migrations (0022/0025) were applied out of order or skipped, the
-- CREATE POLICY statements would fail AFTER the DROPs ran, leaving a FORCE-RLS
-- table with no policy (= all access denied). Guarantee the columns exist first.
ALTER TABLE docs        ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE embeddings  ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE folders     ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE tasks       ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS project_id uuid;

-- ── docs (ENABLE + FORCE) ───────────────────────────────────────────────────
DROP POLICY IF EXISTS docs_tenant_select ON docs;
DROP POLICY IF EXISTS docs_tenant_insert ON docs;
DROP POLICY IF EXISTS docs_tenant_update ON docs;
DROP POLICY IF EXISTS docs_tenant_delete ON docs;
CREATE POLICY docs_tenant_select ON docs FOR SELECT
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY docs_tenant_insert ON docs FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY docs_tenant_update ON docs FOR UPDATE
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id))
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY docs_tenant_delete ON docs FOR DELETE
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));

-- ── embeddings (ENABLE + FORCE) ─────────────────────────────────────────────
DROP POLICY IF EXISTS emb_tenant_all ON embeddings;
CREATE POLICY emb_tenant_all ON embeddings
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id))
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));

-- ── folders (ENABLE + FORCE) ────────────────────────────────────────────────
DROP POLICY IF EXISTS folders_tenant_select ON folders;
DROP POLICY IF EXISTS folders_tenant_insert ON folders;
DROP POLICY IF EXISTS folders_tenant_update ON folders;
DROP POLICY IF EXISTS folders_tenant_delete ON folders;
CREATE POLICY folders_tenant_select ON folders FOR SELECT
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY folders_tenant_insert ON folders FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY folders_tenant_update ON folders FOR UPDATE
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id))
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));
CREATE POLICY folders_tenant_delete ON folders FOR DELETE
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));

-- ── tasks (ENABLE + FORCE) — was raw current_setting; switch to helpers ──────
DROP POLICY IF EXISTS tasks_workspace_isolation ON tasks;
CREATE POLICY tasks_workspace_isolation ON tasks
  USING (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id))
  WITH CHECK (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id));

-- ── graph_nodes (ENABLE, NOT FORCE) — keep the bypass_rls escape hatch ───────
DROP POLICY IF EXISTS graph_nodes_workspace_isolation ON graph_nodes;
CREATE POLICY graph_nodes_workspace_isolation ON graph_nodes
  USING (
    (workspace_id = app_current_tenant_id() AND app_can_see_project(project_id))
    OR current_setting('app.bypass_rls', true) = 'on'
  );

-- NOTE: graph_edges / graph_communities / graph_reports have no project_id and stay
-- workspace-scoped. Edges only carry node ids; the node CONTENT they point to is
-- filtered by the graph_nodes policy above, so a project-scoped key still cannot
-- read another project's node data. Tightening edge visibility is a later refinement.
