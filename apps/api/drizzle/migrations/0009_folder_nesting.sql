-- Phase 6.5: Nested folders via self-referential parent_id FK.
ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES folders(id) ON DELETE SET NULL;

-- RLS policy already covers all rows by workspace_id; no new policies needed.
-- Index for efficient subtree queries.
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);
