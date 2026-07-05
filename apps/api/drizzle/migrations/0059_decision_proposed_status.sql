-- 0059 — allow status='proposed' on decision nodes (Phase 3a, human-verify gate).
--
-- Meeting-extracted decisions are INFERRED by gpt-4o-mini off a transcript, so they must NOT
-- silently become 'current' or supersede a real decision. They land as 'proposed': recorded,
-- embedded, bridged, attributed — but never current, never superseding, never spoken as settled —
-- until a human confirms (Phase 3b). This only WIDENS the existing CHECK; current/historical rows
-- are untouched. Idempotent: drop-then-add.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_status_chk') THEN
    ALTER TABLE graph_nodes DROP CONSTRAINT graph_nodes_status_chk;
  END IF;
  ALTER TABLE graph_nodes
    ADD CONSTRAINT graph_nodes_status_chk
    CHECK (status IS NULL OR status IN ('current', 'historical', 'proposed'));
END $$;
