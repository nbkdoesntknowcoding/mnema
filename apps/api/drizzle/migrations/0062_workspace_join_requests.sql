-- 0062 — Workspace join requests (approval-gated same-domain self-join).
--
-- Before this, a same-domain user clicking "Request to join" was IMMEDIATELY added as an
-- editor (routes/_internal/join-workspace.ts) with no approval and no notification — any
-- in-domain user could self-add to any workspace. This table turns that into a real request:
-- a pending row an owner/admin approves (choosing the role) or denies. Membership is created
-- only on approval.
--
-- Sibling to decision_approvals: app-layer enforcement (requireRole + explicit workspace_id
-- filter), no RLS policy. Idempotent.

CREATE TABLE IF NOT EXISTS workspace_join_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  granted_role  text CHECK (granted_role IN ('viewer', 'editor', 'admin')),
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- At most ONE pending request per (workspace, requester); resolved rows are unconstrained so a
-- re-request after a denial never collides.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_join_requests_pending_uq
  ON workspace_join_requests (workspace_id, requester_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS workspace_join_requests_workspace_idx ON workspace_join_requests (workspace_id, status);
CREATE INDEX IF NOT EXISTS workspace_join_requests_requester_idx ON workspace_join_requests (requester_id, status);
