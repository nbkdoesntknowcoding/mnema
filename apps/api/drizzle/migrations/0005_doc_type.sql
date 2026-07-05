-- Phase 5 — content types
--
-- Every doc gains a `type` so the in-app sidebar can filter content into
-- Engineering / Instructions / Snippets buckets. The default keeps the
-- existing freeform-markdown contract; the check constraint locks the
-- enum tight so older code paths that ignore the column can't insert
-- bad values.
--
-- Phase 8 will give these types behavioral differences (templates,
-- defaults, MCP hinting). For now they're filterable labels.

ALTER TABLE docs
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'doc';

ALTER TABLE docs
  DROP CONSTRAINT IF EXISTS docs_type_check;

ALTER TABLE docs
  ADD CONSTRAINT docs_type_check
  CHECK (type IN ('doc', 'engineering', 'instruction', 'snippet'));

CREATE INDEX IF NOT EXISTS docs_workspace_type_idx
  ON docs (workspace_id, type);
