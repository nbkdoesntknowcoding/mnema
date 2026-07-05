-- 0047_admin.sql — internal admin center: licenses + admin audit log.
-- Additive + idempotent (applied by hand via psql, as boppl).
CREATE TABLE IF NOT EXISTS licenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  plan_tier     text NOT NULL DEFAULT 'free',
  seats         integer NOT NULL DEFAULT 1,
  entitlements  jsonb NOT NULL DEFAULT '{}'::jsonb,
  license_key   text UNIQUE,
  status        text NOT NULL DEFAULT 'active',   -- active|trial|expiring|expired|suspended|revoked
  starts_at     timestamptz,
  expires_at    timestamptz,
  issued_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  redeemed_at   timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licenses_workspace_idx ON licenses(workspace_id);
CREATE INDEX IF NOT EXISTS licenses_status_idx ON licenses(status);

-- Append-only record of every admin action (no UI delete path).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email   text NOT NULL,
  action        text NOT NULL,
  target_type   text,
  target_id     text,
  payload       jsonb,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_log(created_at DESC);
