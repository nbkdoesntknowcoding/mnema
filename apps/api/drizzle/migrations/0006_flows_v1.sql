-- =========================================================================
-- Mnema Flow Schema v1 (Phase 6.1)
-- =========================================================================
-- A flow is a workspace-scoped DAG of content nodes. Claude walks the DAG
-- via MCP. This migration adds the four core tables, RLS policies, and
-- helper indexes. Branching semantics (decision nodes with multi-output
-- routing) are deferred to a later migration; decision nodes exist in the
-- schema structurally but topological walk in Phase 6.1 treats them as
-- ordinary linear nodes.
--
-- RLS pattern matches the existing project convention:
--   - The GUC is `app.tenant_id` (set by withTenant() in app code).
--   - Per-operation policies (SELECT/INSERT/UPDATE/DELETE), not a single
--     blanket USING clause. Lets us tighten WITH CHECK independently per op.
--   - workspace_id direct comparison where possible; subquery EXISTS for
--     descendant tables (versions/nodes/edges) that don't carry workspace_id.
-- =========================================================================

-- ------------------------------------------------------------
-- flows
-- ------------------------------------------------------------
CREATE TABLE flows (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug                  TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  description           TEXT,
  -- published_version_id is added in a later ALTER (forward reference to
  -- flow_versions, which doesn't exist yet at this point in the migration).
  published_version_id  UUID,
  created_by            UUID        NOT NULL REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  UNIQUE (workspace_id, slug),

  -- Slug format: kebab-case, alphanumeric + hyphens, no leading/trailing
  -- hyphens, between 1 and 64 chars. Enforced at API too but cheap here.
  CONSTRAINT flows_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 1 AND 64)
);

CREATE INDEX flows_workspace_idx
  ON flows (workspace_id);
CREATE INDEX flows_active_idx
  ON flows (workspace_id)
  WHERE deleted_at IS NULL;
CREATE INDEX flows_published_version_idx
  ON flows (published_version_id)
  WHERE published_version_id IS NOT NULL;

CREATE TRIGGER flows_updated_at BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- flow_versions
-- ------------------------------------------------------------
-- Every save creates a row. The "draft" is the most-recent version with
-- is_published=false; the "published" is the row pointed at by
-- flows.published_version_id.
-- ------------------------------------------------------------
CREATE TABLE flow_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         UUID        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version_number  INT         NOT NULL,
  is_published    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by      UUID        NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_message TEXT,

  UNIQUE (flow_id, version_number)
);

CREATE INDEX flow_versions_flow_idx
  ON flow_versions (flow_id);
CREATE INDEX flow_versions_published_idx
  ON flow_versions (flow_id, is_published)
  WHERE is_published = TRUE;

-- Now safe to wire the forward FK.
ALTER TABLE flows
  ADD CONSTRAINT flows_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES flow_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ------------------------------------------------------------
-- flow_nodes
-- ------------------------------------------------------------
-- One row per node in a flow_version. Variant-specific fields live in
-- `data` JSONB; the discriminator is `kind`. The client picks
-- `client_node_id` as a stable kebab-case identifier so edges can
-- reference nodes by a string the UI controls.
-- ------------------------------------------------------------
CREATE TABLE flow_nodes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id  UUID        NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  client_node_id   TEXT        NOT NULL,
  kind             TEXT        NOT NULL,
  title            TEXT        NOT NULL,
  position_x       REAL        NOT NULL DEFAULT 0,
  position_y       REAL        NOT NULL DEFAULT 0,
  data             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (flow_version_id, client_node_id),
  CONSTRAINT flow_nodes_kind_check
    CHECK (kind IN ('doc', 'docs', 'instruction', 'decision')),
  CONSTRAINT flow_nodes_client_id_format
    CHECK (client_node_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(client_node_id) BETWEEN 1 AND 64)
);

CREATE INDEX flow_nodes_version_idx ON flow_nodes (flow_version_id);

-- ------------------------------------------------------------
-- flow_edges
-- ------------------------------------------------------------
-- Directed edges between nodes within a flow_version. `from_socket` is
-- forward-compat for decision-node multi-output routing (Phase 6.4); in
-- 6.1 it's always 'default'.
-- ------------------------------------------------------------
CREATE TABLE flow_edges (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_version_id  UUID        NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  from_node_id     TEXT        NOT NULL,
  to_node_id       TEXT        NOT NULL,
  from_socket      TEXT        NOT NULL DEFAULT 'default',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (flow_version_id, from_node_id, to_node_id, from_socket),

  CHECK (from_node_id <> to_node_id)
);

CREATE INDEX flow_edges_version_idx ON flow_edges (flow_version_id);
CREATE INDEX flow_edges_from_idx    ON flow_edges (flow_version_id, from_node_id);
CREATE INDEX flow_edges_to_idx      ON flow_edges (flow_version_id, to_node_id);

-- =========================================================================
-- Row-Level Security
-- =========================================================================

ALTER TABLE flows         ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_nodes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_edges    ENABLE ROW LEVEL SECURITY;

ALTER TABLE flows         FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_nodes    FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_edges    FORCE ROW LEVEL SECURITY;

-- flows: direct workspace comparison
CREATE POLICY flows_tenant_select ON flows FOR SELECT
  USING (workspace_id = app_current_tenant_id());
CREATE POLICY flows_tenant_insert ON flows FOR INSERT
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY flows_tenant_update ON flows FOR UPDATE
  USING (workspace_id = app_current_tenant_id())
  WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY flows_tenant_delete ON flows FOR DELETE
  USING (workspace_id = app_current_tenant_id());

-- flow_versions: scoped through parent flow
CREATE POLICY flow_versions_tenant_select ON flow_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = flow_versions.flow_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_versions_tenant_insert ON flow_versions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = flow_versions.flow_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_versions_tenant_update ON flow_versions FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = flow_versions.flow_id
      AND flows.workspace_id = app_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = flow_versions.flow_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_versions_tenant_delete ON flow_versions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM flows
    WHERE flows.id = flow_versions.flow_id
      AND flows.workspace_id = app_current_tenant_id()
  ));

-- flow_nodes: scoped through flow_version → flow → workspace
CREATE POLICY flow_nodes_tenant_select ON flow_nodes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_nodes.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_nodes_tenant_insert ON flow_nodes FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_nodes.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_nodes_tenant_update ON flow_nodes FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_nodes.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_nodes.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_nodes_tenant_delete ON flow_nodes FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_nodes.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));

-- flow_edges: same scoping path as flow_nodes
CREATE POLICY flow_edges_tenant_select ON flow_edges FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_edges.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_edges_tenant_insert ON flow_edges FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_edges.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_edges_tenant_update ON flow_edges FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_edges.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_edges.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
CREATE POLICY flow_edges_tenant_delete ON flow_edges FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM flow_versions
    JOIN flows ON flows.id = flow_versions.flow_id
    WHERE flow_versions.id = flow_edges.flow_version_id
      AND flows.workspace_id = app_current_tenant_id()
  ));
