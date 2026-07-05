-- 0061 — Charting Phase 2, Sprint 4: dataset store for unbounded chart data.
--
-- Large/unbounded tabular data can't live in Claude's context or a doc block. It lives here:
--   datasets      = metadata (inferred schema + row count) per ingested CSV/table.
--   dataset_rows  = the actual rows, one jsonb object per row. The RAW data lives ONLY here —
--                   never in Claude's context, never in a doc. Charts reference a dataset_id and
--                   (Sprint 5) render a server-side AGGREGATION, not the raw rows.
--
-- Reuses the existing Postgres + RLS infra (no new DB tech). Tenant-isolated like every table.
-- Idempotent: IF NOT EXISTS throughout; policies guarded by pg_policies checks.

CREATE TABLE IF NOT EXISTS datasets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  columns      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ "name": string, "type": "number|string|boolean|date" }]
  row_count    integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS datasets_workspace_idx ON datasets(workspace_id);

CREATE TABLE IF NOT EXISTS dataset_rows (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id   uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  row_index    integer NOT NULL,
  data         jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS dataset_rows_dataset_idx ON dataset_rows(dataset_id);

ALTER TABLE datasets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE datasets     FORCE  ROW LEVEL SECURITY;
ALTER TABLE dataset_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_rows FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'datasets' AND policyname = 'datasets_tenant_isolation') THEN
    CREATE POLICY datasets_tenant_isolation ON datasets
      USING (workspace_id = app_current_tenant_id())
      WITH CHECK (workspace_id = app_current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dataset_rows' AND policyname = 'dataset_rows_tenant_isolation') THEN
    CREATE POLICY dataset_rows_tenant_isolation ON dataset_rows
      USING (workspace_id = app_current_tenant_id())
      WITH CHECK (workspace_id = app_current_tenant_id());
  END IF;
END $$;
