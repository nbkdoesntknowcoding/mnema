-- 0039_folders_system_type.sql
-- Phase A — folders need a type so system folders (meeting docs, team root) cannot
-- be deleted by users.
ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS folder_type  text DEFAULT 'user',
  -- 'user' | 'team_root' | 'meeting_docs' | 'system'
  ADD COLUMN IF NOT EXISTS team_id      uuid REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS meeting_id   uuid REFERENCES meetings(id),
  ADD COLUMN IF NOT EXISTS is_deletable boolean DEFAULT true;

-- team_root folders: auto-created per team, is_deletable = false
-- meeting_docs:      auto-created per meeting, is_deletable = false
-- system:            workspace-level system folders, is_deletable = false

-- Required addition (spec gap): A3 iam-policy-factory resolves default_folder_access
-- entries by folder_slug → folders.slug. The base folders table has no slug, so add
-- it here. Lookup is (workspace_id, slug); existing folders keep NULL until slugged.
ALTER TABLE folders ADD COLUMN IF NOT EXISTS slug text;
CREATE INDEX IF NOT EXISTS idx_folders_workspace_slug ON folders(workspace_id, slug);
