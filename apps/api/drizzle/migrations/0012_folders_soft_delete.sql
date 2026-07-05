-- Phase 9.3: Folder soft-delete support
-- Adds deleted_at / deleted_by columns to folders so trash_folder can
-- use the same soft-delete pattern as trash_doc. Also enforces FORCE ROW
-- LEVEL SECURITY so the role=boppl_system bypass is explicit.

ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;

-- Recreate partial indexes so they exclude trashed rows.
DROP INDEX IF EXISTS folders_workspace_idx;
CREATE INDEX IF NOT EXISTS folders_workspace_idx
  ON folders (workspace_id) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS folders_parent_idx;
CREATE INDEX IF NOT EXISTS folders_parent_idx
  ON folders (parent_id) WHERE deleted_at IS NULL;

-- Docs folder index (also partial to exclude trashed docs).
DROP INDEX IF EXISTS docs_folder_idx;
CREATE INDEX IF NOT EXISTS docs_folder_idx
  ON docs (folder_id) WHERE deleted_at IS NULL;

-- Enforce RLS so boppl_system must explicitly bypass rather than silently
-- skip the policy. Already enabled in 0008; FORCE is additive.
ALTER TABLE folders FORCE ROW LEVEL SECURITY;
