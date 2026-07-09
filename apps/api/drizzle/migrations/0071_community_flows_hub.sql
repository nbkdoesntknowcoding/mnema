-- 0071 — Community Flows hub. A CENTRAL, cross-instance catalog of shareable
-- flow templates (n8n-style). Populated only on the SaaS hub (EE); inert empty
-- tables on self-host. Deliberately NOT workspace-scoped and NO RLS — the hub
-- serves cross-instance reads via the superuser db client (mirrors docs.public).
-- Idempotent (drizzle ledger is behind — apply via psql).

CREATE TABLE IF NOT EXISTS "community_flows" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"             text NOT NULL,
  "name"             text NOT NULL,
  "description"      text,
  "tags"             text[] NOT NULL DEFAULT ARRAY[]::text[],
  "template_json"    jsonb NOT NULL,
  "schema_version"   integer NOT NULL DEFAULT 1,
  "publisher_email"  text NOT NULL,
  "publisher_handle" text,
  "source_version"   text,
  "node_count"       integer NOT NULL DEFAULT 0,
  "edge_count"       integer NOT NULL DEFAULT 0,
  "import_count"     integer NOT NULL DEFAULT 0,
  "status"           text NOT NULL DEFAULT 'listed',
  "created_at"       timestamptz NOT NULL DEFAULT now(),
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "community_flows" ADD CONSTRAINT "community_flows_slug_key" UNIQUE ("slug");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "community_flows"
    ADD CONSTRAINT "community_flows_publisher_name_key" UNIQUE ("publisher_email", "name");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "community_flows_status_idx"     ON "community_flows" ("status");
CREATE INDEX IF NOT EXISTS "community_flows_publisher_idx"  ON "community_flows" ("publisher_email");
CREATE INDEX IF NOT EXISTS "community_flows_popularity_idx" ON "community_flows" ("import_count");
CREATE INDEX IF NOT EXISTS "community_flows_tags_gin"       ON "community_flows" USING gin ("tags");

CREATE TABLE IF NOT EXISTS "community_flow_reports" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "community_flow_id"    uuid NOT NULL REFERENCES "community_flows"("id") ON DELETE CASCADE,
  "reason"               text NOT NULL,
  "detail"               text,
  "reporter_fingerprint" text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "resolved_at"          timestamptz,
  "resolved_by"          text
);

CREATE INDEX IF NOT EXISTS "community_flow_reports_flow_idx"
  ON "community_flow_reports" ("community_flow_id");
CREATE INDEX IF NOT EXISTS "community_flow_reports_unresolved_idx"
  ON "community_flow_reports" ("resolved_at");
