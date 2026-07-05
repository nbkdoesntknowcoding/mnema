-- 0026_waitlist.sql
-- Pre-launch waitlist capture (additive, non-breaking). The public landing form
-- writes here via the internal waitlist endpoint; the live WorkOS sign-up/sign-in
-- flow is unchanged and ungated. No RLS — this is a global table written only by
-- the internal endpoint (acts-as-owner), never exposed to tenant queries.

CREATE TABLE IF NOT EXISTS "waitlist" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"       citext NOT NULL UNIQUE,
  "name"        text,
  "company"     text,
  "status"      text NOT NULL DEFAULT 'pending',
  "source"      text NOT NULL DEFAULT 'landing',
  "notes"       text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "waitlist_status_idx" ON "waitlist" ("status");
