-- Migration: Add billing tier columns to subscriptions table
-- Supports multi-tier (individual/team/business), dual currency (INR/USD),
-- per-seat billing, access-until date, and alert tracking flags.

ALTER TABLE "subscriptions"
  ADD COLUMN IF NOT EXISTS "currency"              text        NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "cycle"                 text        NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS "billable_seats"         integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "access_until"           timestamptz,
  ADD COLUMN IF NOT EXISTS "payment_failure_count"  integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "trial_alert_sent"       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "renewal_alert_sent"     boolean     NOT NULL DEFAULT false;
