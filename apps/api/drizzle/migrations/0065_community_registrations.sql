-- 0065 — CL-1 community-license registrations (email → free community key).
-- Written only by the hosted licensing service (ee/cloud); the table is shared so
-- the migration applies everywhere, but the issuing route is stripped from public.
-- Idempotent.

CREATE TABLE IF NOT EXISTS "community_registrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "version_reported" text,
  "unsub_token" text NOT NULL,
  "unsubscribed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_registrations" ADD CONSTRAINT "community_registrations_email_unique" UNIQUE ("email");
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "community_registrations" ADD CONSTRAINT "community_registrations_unsub_token_unique" UNIQUE ("unsub_token");
EXCEPTION WHEN duplicate_object THEN null; END $$;
