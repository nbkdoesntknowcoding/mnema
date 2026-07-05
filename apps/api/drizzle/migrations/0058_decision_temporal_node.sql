-- 0058_decision_temporal_node.sql
-- Decision Memory MD1 / STEP 1 — complete the `decision` graph entity into a temporal node.
--
-- Today a `decision` graph_nodes row is a bare label-node (written only by the meeting
-- extractor): no date, no status, no supersede link. This migration ADDS the temporal fields
-- so a decision becomes a first-class, dated, supersede-aware node. It is purely ADDITIVE:
--   • new columns live on graph_nodes (generic table) and are NULL for every non-decision node;
--   • meeting_records.decisions (the string[]) is left completely untouched;
--   • idempotent (ADD COLUMN IF NOT EXISTS), safe to re-apply.
--
-- Modeling note (flagged in STEP 0): the supersede LINK is also drawn as the native
-- graph_edges 'supersedes' edge (it already exists in the edgeType set) for traversal; these
-- node columns carry the same relationship for direct, index-friendly lookup. Both, by design.

ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS decided_at    timestamptz;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS status        text;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS supersedes    uuid;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS decision_text text;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS decided_in    uuid;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS acl_scope     text;

-- status is current|historical for decision nodes, NULL for everything else (so a DB default
-- isn't used — the record_decision tool + meeting path always write 'current' on a decision;
-- the CHECK permits NULL for non-decision rows).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_status_chk') THEN
    ALTER TABLE graph_nodes
      ADD CONSTRAINT graph_nodes_status_chk
      CHECK (status IS NULL OR status IN ('current','historical'));
  END IF;
END $$;

-- supersede links are node refs → keep them referentially clean (null on delete).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_supersedes_fk') THEN
    ALTER TABLE graph_nodes
      ADD CONSTRAINT graph_nodes_supersedes_fk
      FOREIGN KEY (supersedes) REFERENCES graph_nodes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_superseded_by_fk') THEN
    ALTER TABLE graph_nodes
      ADD CONSTRAINT graph_nodes_superseded_by_fk
      FOREIGN KEY (superseded_by) REFERENCES graph_nodes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_decided_in_fk') THEN
    ALTER TABLE graph_nodes
      ADD CONSTRAINT graph_nodes_decided_in_fk
      FOREIGN KEY (decided_in) REFERENCES meetings(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index to fetch the CURRENT decisions quickly (partial — only decision rows).
CREATE INDEX IF NOT EXISTS graph_nodes_decision_status_idx
  ON graph_nodes (workspace_id, status)
  WHERE entity_type = 'decision';

-- Backfill existing decision nodes so they "read back" cleanly (the STEP 1 gate): give them a
-- date from created_at, mark them current (none are superseded yet), and copy their label into
-- decision_text. Non-decision nodes are untouched.
UPDATE graph_nodes
  SET decided_at    = COALESCE(decided_at, created_at),
      status        = COALESCE(status, 'current'),
      decision_text = COALESCE(decision_text, label)
  WHERE entity_type = 'decision'
    AND (decided_at IS NULL OR status IS NULL OR decision_text IS NULL);
