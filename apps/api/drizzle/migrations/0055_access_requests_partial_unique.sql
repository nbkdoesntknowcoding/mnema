-- 0055_access_requests_partial_unique.sql — M5 of Fix_IAM_Audit_Remediation.
-- The full UNIQUE(doc_id, requester_id, status) collided on a SECOND denial for the
-- same (doc, requester) — request -> deny -> re-request -> deny again threw 23505 -> 500.
-- Replace it with a PARTIAL unique that only constrains OPEN (pending) requests, so a
-- person can have at most one pending request per doc but unlimited resolved history.
-- Applied by hand via psql, as boppl. Idempotent.

ALTER TABLE doc_access_requests
  DROP CONSTRAINT IF EXISTS doc_access_requests_open_uq;

CREATE UNIQUE INDEX IF NOT EXISTS doc_access_requests_pending_uq
  ON doc_access_requests(doc_id, requester_id)
  WHERE status = 'pending';
