-- Phase 6.4: Real user-created folders
--
-- Adds a workspace-scoped `folders` table and a nullable `folder_id` FK
-- on `docs` so docs can be organised into named folders (like macOS Finder).
--
-- RLS mirrors the workspace-isolation pattern from 0004.

CREATE TABLE IF NOT EXISTS folders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid       NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  created_by  uuid        REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS folders_workspace_idx ON folders(workspace_id);

ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS docs_folder_idx ON docs(folder_id)
  WHERE folder_id IS NOT NULL;

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY folders_tenant_select ON folders FOR SELECT
  USING (workspace_id = app_current_tenant_id());
CREATE POLICY folders_tenant_insert ON folders FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY folders_tenant_update ON folders FOR UPDATE
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY folders_tenant_delete ON folders FOR DELETE
  USING (workspace_id = app_current_tenant_id());
