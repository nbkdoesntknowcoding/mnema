-- Knowledge Graph: 4 new tables
-- graph_nodes, graph_edges, graph_communities, graph_reports

CREATE TABLE IF NOT EXISTS "graph_nodes" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"          uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "entity_type"           text NOT NULL,
  "entity_id"             uuid NOT NULL,
  "label"                 text NOT NULL,
  "summary"               text,
  "degree"                integer NOT NULL DEFAULT 0,
  "betweenness_centrality" double precision DEFAULT 0,
  "is_god_node"           boolean NOT NULL DEFAULT false,
  "community_id"          integer,
  "community_label"       text,
  "extraction_pass"       text NOT NULL DEFAULT 'structural',
  "last_extracted_at"     timestamp with time zone,
  "created_at"            timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "graph_nodes_entity_idx"
  ON "graph_nodes"("workspace_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "graph_nodes_workspace_idx"  ON "graph_nodes"("workspace_id");
CREATE INDEX IF NOT EXISTS "graph_nodes_god_node_idx"   ON "graph_nodes"("is_god_node");
CREATE INDEX IF NOT EXISTS "graph_nodes_community_idx"  ON "graph_nodes"("community_id");

ALTER TABLE "graph_nodes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "graph_nodes_workspace_isolation" ON "graph_nodes"
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid
      OR current_setting('app.bypass_rls', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_nodes" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_nodes" TO boppl_system;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "graph_edges" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"     uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "from_node_id"     uuid NOT NULL REFERENCES "graph_nodes"("id") ON DELETE CASCADE,
  "to_node_id"       uuid NOT NULL REFERENCES "graph_nodes"("id") ON DELETE CASCADE,
  "edge_type"        text NOT NULL,
  "provenance"       text NOT NULL,
  "confidence_score" double precision NOT NULL DEFAULT 1.0,
  "weight"           double precision NOT NULL DEFAULT 1.0,
  "rationale"        text,
  "extracted_from"   text,
  "is_directed"      boolean NOT NULL DEFAULT true,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "graph_edges_unique_idx"
  ON "graph_edges"("from_node_id", "to_node_id", "edge_type");
CREATE INDEX IF NOT EXISTS "graph_edges_from_idx"      ON "graph_edges"("from_node_id");
CREATE INDEX IF NOT EXISTS "graph_edges_to_idx"        ON "graph_edges"("to_node_id");
CREATE INDEX IF NOT EXISTS "graph_edges_workspace_idx" ON "graph_edges"("workspace_id");

ALTER TABLE "graph_edges" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "graph_edges_workspace_isolation" ON "graph_edges"
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid
      OR current_setting('app.bypass_rls', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_edges" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_edges" TO boppl_system;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "graph_communities" (
  "id"                  integer NOT NULL,
  "workspace_id"        uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "label"               text NOT NULL,
  "description"         text,
  "node_count"          integer NOT NULL DEFAULT 0,
  "suggested_questions" text[],
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("id", "workspace_id")
);

CREATE INDEX IF NOT EXISTS "graph_communities_workspace_idx" ON "graph_communities"("workspace_id");

ALTER TABLE "graph_communities" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "graph_communities_workspace_isolation" ON "graph_communities"
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid
      OR current_setting('app.bypass_rls', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_communities" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_communities" TO boppl_system;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "graph_reports" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"     uuid NOT NULL UNIQUE REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "doc_id"           uuid REFERENCES "docs"("id") ON DELETE SET NULL,
  "total_nodes"      integer NOT NULL DEFAULT 0,
  "total_edges"      integer NOT NULL DEFAULT 0,
  "total_communities" integer NOT NULL DEFAULT 0,
  "god_node_count"   integer NOT NULL DEFAULT 0,
  "last_built_at"    timestamp with time zone,
  "status"           text NOT NULL DEFAULT 'pending',
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "graph_reports" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "graph_reports_workspace_isolation" ON "graph_reports"
  USING (workspace_id = current_setting('app.tenant_id', true)::uuid
      OR current_setting('app.bypass_rls', true) = 'on');
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_reports" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "graph_reports" TO boppl_system;
