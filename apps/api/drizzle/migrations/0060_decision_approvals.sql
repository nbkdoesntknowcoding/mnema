-- 0060 — Phase 3b: the decision confirm/reject loop.
--
-- (a) Widen the decision-node status CHECK to allow 'rejected' (a confirmed-rejected decision is a
--     tombstone: status='rejected' + its doc soft-deleted, invisible to retrieval).
-- (b) Create decision_approvals — a SIBLING table to doc_access_requests. doc_access_requests / the
--     ACL path is left BYTE-UNCHANGED (no discriminator, no shared-table entanglement).
-- Idempotent: drop-then-add for the CHECK, IF NOT EXISTS for the table/indexes.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'graph_nodes_status_chk') THEN
    ALTER TABLE graph_nodes DROP CONSTRAINT graph_nodes_status_chk;
  END IF;
  ALTER TABLE graph_nodes
    ADD CONSTRAINT graph_nodes_status_chk
    CHECK (status IS NULL OR status IN ('current', 'historical', 'proposed', 'rejected'));
END $$;

CREATE TABLE IF NOT EXISTS decision_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  decision_node_id  uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  doc_id            uuid REFERENCES docs(id) ON DELETE SET NULL,
  proposer_id       uuid REFERENCES users(id),
  meeting_id        uuid REFERENCES meetings(id) ON DELETE SET NULL,
  supersedes_target uuid REFERENCES graph_nodes(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  resolved_by       uuid REFERENCES users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- At most ONE pending approval per decision node (idempotent re-consolidation); resolved rows are
-- unconstrained so a re-propose after reject never collides.
CREATE UNIQUE INDEX IF NOT EXISTS decision_approvals_pending_uq
  ON decision_approvals (decision_node_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS decision_approvals_proposer_idx ON decision_approvals (proposer_id, status);
CREATE INDEX IF NOT EXISTS decision_approvals_workspace_idx ON decision_approvals (workspace_id);
