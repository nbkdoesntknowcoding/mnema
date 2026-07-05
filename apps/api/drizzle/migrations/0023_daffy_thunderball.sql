-- DOCX + PDF support: attachments table + docs.source_attachment_id
-- Chunk A of the DOCX/PDF ingestion & export feature.

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"   uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "doc_id"         uuid REFERENCES "docs"("id") ON DELETE SET NULL,
  "type"           text NOT NULL,
  "format"         text NOT NULL,
  "original_name"  text,
  "r2_key"         text NOT NULL,
  "size_bytes"     integer,
  "mime_type"      text,
  "status"         text NOT NULL DEFAULT 'pending',
  "error_message"  text,
  "page_count"     integer,
  "used_ocr"       boolean NOT NULL DEFAULT false,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "attachments_workspace_idx" ON "attachments"("workspace_id");
CREATE INDEX IF NOT EXISTS "attachments_doc_idx"       ON "attachments"("doc_id");
CREATE INDEX IF NOT EXISTS "attachments_status_idx"    ON "attachments"("status");

-- Add source_attachment_id to docs (nullable, FK to attachments)
ALTER TABLE "docs"
  ADD COLUMN IF NOT EXISTS "source_attachment_id" uuid
  REFERENCES "attachments"("id") ON DELETE SET NULL;

-- RLS: workspace-scoped, same pattern as other tables
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments_workspace_isolation"
  ON "attachments"
  USING (
    workspace_id = current_setting('app.tenant_id', true)::uuid
    OR current_setting('app.bypass_rls', true) = 'on'
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "attachments" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "attachments" TO boppl_system;