-- Phase 9.3 follow-up: tag doc_versions rows by author kind so AI-written
-- versions are distinguishable from human-saved ones in the UI and API.
--
-- 'human' — saved by the Save Version button or the 50-store auto-snapshot
-- 'ai'    — auto-created by an MCP write tool (append, replace, create)

ALTER TABLE doc_versions
  ADD COLUMN IF NOT EXISTS author_kind text NOT NULL DEFAULT 'human';
