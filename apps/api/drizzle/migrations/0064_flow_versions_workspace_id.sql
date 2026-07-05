-- 0064 — add flow_versions.workspace_id (ORM/migration drift fix).
--
-- schema.ts declares flow_versions.workspace_id NOT NULL with an FK to workspaces,
-- and the example-flow seed + code write it, but no earlier migration added the
-- column (0006_flows_v1 created the table without it). Fresh self-host bring-ups
-- 500'd on signup ("column workspace_id of relation flow_versions does not exist").
-- Idempotent: add, backfill from the parent flow, enforce NOT NULL, FK, index.

ALTER TABLE "flow_versions" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;

UPDATE "flow_versions" fv SET workspace_id = f.workspace_id
  FROM "flows" f WHERE f.id = fv.flow_id AND fv.workspace_id IS NULL;

ALTER TABLE "flow_versions" ALTER COLUMN "workspace_id" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "flow_versions"
    ADD CONSTRAINT "flow_versions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "flow_versions_workspace_idx"
  ON "flow_versions" USING btree ("workspace_id");
