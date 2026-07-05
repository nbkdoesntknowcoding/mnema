-- Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

-- App-level GUC accessor used by RLS policies
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID
$$ LANGUAGE SQL STABLE;

-- updated_at trigger helper
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- workspaces
CREATE TABLE workspaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free',
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- users
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TYPE workspace_role AS ENUM ('owner','admin','editor','viewer');

CREATE TABLE workspace_members (
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role          workspace_role NOT NULL DEFAULT 'editor',
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- docs
CREATE TABLE docs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path              TEXT NOT NULL,
  title             TEXT NOT NULL,
  markdown          TEXT NOT NULL DEFAULT '',
  yjs_state         BYTEA NOT NULL,
  yjs_state_vector  BYTEA,
  content_hash      TEXT,
  created_by        UUID REFERENCES users(id),
  updated_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  tsv               TSVECTOR GENERATED ALWAYS AS (
                       setweight(to_tsvector('english', coalesce(title,'')),    'A') ||
                       setweight(to_tsvector('english', coalesce(markdown,'')), 'B')
                     ) STORED,
  UNIQUE (workspace_id, path)
);
CREATE INDEX docs_workspace_idx      ON docs(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX docs_workspace_updated  ON docs(workspace_id, updated_at DESC);
CREATE INDEX docs_tsv_idx            ON docs USING GIN (tsv);
CREATE INDEX docs_path_trgm_idx      ON docs USING GIN (path  gin_trgm_ops);
CREATE INDEX docs_title_trgm_idx     ON docs USING GIN (title gin_trgm_ops);
CREATE TRIGGER docs_updated_at BEFORE UPDATE ON docs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS on docs
ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs FORCE  ROW LEVEL SECURITY;
CREATE POLICY docs_tenant_select ON docs FOR SELECT USING (workspace_id = app_current_tenant_id());
CREATE POLICY docs_tenant_insert ON docs FOR INSERT WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY docs_tenant_update ON docs FOR UPDATE USING (workspace_id = app_current_tenant_id())
                                            WITH CHECK (workspace_id = app_current_tenant_id());
CREATE POLICY docs_tenant_delete ON docs FOR DELETE USING (workspace_id = app_current_tenant_id());

-- doc_versions
CREATE TABLE doc_versions (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  version     INT  NOT NULL,
  markdown    TEXT NOT NULL,
  yjs_state   BYTEA NOT NULL,
  yjs_update  BYTEA,
  author_id   UUID REFERENCES users(id),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version)
);
CREATE INDEX doc_versions_doc_idx ON doc_versions(doc_id, version DESC);

-- comments
CREATE TABLE comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  block_id    TEXT,
  parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_doc_idx ON comments(doc_id, created_at DESC);
CREATE TRIGGER comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- tags
CREATE TABLE tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,
  UNIQUE (workspace_id, name)
);

CREATE TABLE doc_tags (
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (doc_id, tag_id)
);
CREATE INDEX doc_tags_tag_idx ON doc_tags(tag_id);

-- embeddings
CREATE TABLE embeddings (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  doc_id        UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  chunk_index   INT  NOT NULL,
  chunk_text    TEXT NOT NULL,
  token_count   INT,
  heading_path  TEXT,
  embedding     VECTOR(1024) NOT NULL,
  model         TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, chunk_index, model)
);
CREATE INDEX embeddings_hnsw_cos ON embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m=16, ef_construction=64);
CREATE INDEX embeddings_doc_idx       ON embeddings(doc_id);
CREATE INDEX embeddings_workspace_idx ON embeddings(workspace_id);

ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings FORCE  ROW LEVEL SECURITY;
CREATE POLICY emb_tenant_all ON embeddings USING (workspace_id = app_current_tenant_id())
                                          WITH CHECK (workspace_id = app_current_tenant_id());

-- doc-level ACLs
CREATE TABLE doc_acl (
  doc_id    UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_read  BOOLEAN NOT NULL DEFAULT true,
  can_write BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (doc_id, user_id)
);

-- tool audit log (partitioned)
CREATE TABLE tool_audit (
  id             BIGSERIAL,
  workspace_id   UUID,
  user_id        UUID,
  agent_id       TEXT,
  tool_name      TEXT NOT NULL,
  args           JSONB NOT NULL,
  result_summary JSONB,
  latency_ms     INT,
  status         TEXT NOT NULL,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE tool_audit_default PARTITION OF tool_audit DEFAULT;
CREATE INDEX tool_audit_ws_time_idx ON tool_audit(workspace_id, created_at DESC);
CREATE INDEX tool_audit_tool_idx    ON tool_audit(tool_name,    created_at DESC);
