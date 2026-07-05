-- 0025_project_scoping.sql
-- Workspace → Project → Folder → Doc hierarchy (Stage A).
-- Adds a denormalized project_id to docs, embeddings, and graph_nodes so search and
-- graph queries can be scoped to a project (and the upcoming project-level RLS can key
-- off it). The source of truth stays folders.project_id; these are kept in sync by the
-- app on doc create/move and folder↔project changes.
--
-- Backfill note: docs/embeddings/graph_nodes are RLS-ENABLE but NOT FORCE, so this
-- migration (run as the table owner) sees all rows. We intentionally do NOT join the
-- FORCE-protected `tasks` table here; the graph builder sets task-node project_id on its
-- next rebuild.

ALTER TABLE "docs"        ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "embeddings"  ADD COLUMN IF NOT EXISTS "project_id" uuid;
ALTER TABLE "graph_nodes" ADD COLUMN IF NOT EXISTS "project_id" uuid;

DO $$ BEGIN
  ALTER TABLE "docs" ADD CONSTRAINT "docs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "docs_project_idx"        ON "docs" ("project_id");
CREATE INDEX IF NOT EXISTS "embeddings_project_idx"  ON "embeddings" ("project_id");
CREATE INDEX IF NOT EXISTS "graph_nodes_project_idx" ON "graph_nodes" ("project_id");

-- Backfill: docs inherit their folder's project.
UPDATE "docs" d SET "project_id" = f."project_id"
  FROM "folders" f
  WHERE d."folder_id" = f."id" AND f."project_id" IS NOT NULL AND d."project_id" IS NULL;

-- Backfill: embeddings inherit their doc's project.
UPDATE "embeddings" e SET "project_id" = d."project_id"
  FROM "docs" d
  WHERE e."doc_id" = d."id" AND d."project_id" IS NOT NULL AND e."project_id" IS NULL;

-- Backfill: graph nodes — doc nodes from their doc; project nodes are themselves.
UPDATE "graph_nodes" n SET "project_id" = d."project_id"
  FROM "docs" d
  WHERE n."entity_type" = 'doc' AND n."entity_id" = d."id"
    AND d."project_id" IS NOT NULL AND n."project_id" IS NULL;

UPDATE "graph_nodes" n SET "project_id" = n."entity_id"
  WHERE n."entity_type" = 'project' AND n."project_id" IS NULL;
