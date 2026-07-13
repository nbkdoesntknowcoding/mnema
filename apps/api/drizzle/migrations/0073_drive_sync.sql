-- 0073 — Google Drive folder sync (Phase 10, core).
-- Adds a per-member encrypted Drive refresh token and two tables:
--   drive_folder_links   — a Mnema folder ⇄ Google Drive folder pairing + settings
--   drive_file_mappings  — per-file idempotency + conflict tracking
-- Core migration (folders/docs/attachments are core tables) — applies on self-host.
-- Idempotent (IF NOT EXISTS everywhere); a re-run on restart is safe.

-- Per-member encrypted Google Drive refresh token (mirrors calendar_refresh_token).
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "drive_refresh_token" text;

CREATE TABLE IF NOT EXISTS "drive_folder_links" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"             uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "folder_id"                uuid NOT NULL REFERENCES "folders"("id") ON DELETE CASCADE,
  "drive_folder_id"          text NOT NULL,
  "drive_folder_name"        text,
  "connected_by"             uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "direction"                text NOT NULL DEFAULT 'both',
  "accepted_types"           text[] NOT NULL DEFAULT ARRAY[]::text[],
  "conflict_policy"          text NOT NULL DEFAULT 'manual',
  "last_synced_at"           timestamptz,
  "status"                   text NOT NULL DEFAULT 'active',
  "error_message"            text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "drive_links_workspace_idx" ON "drive_folder_links" ("workspace_id");
CREATE UNIQUE INDEX IF NOT EXISTS "drive_links_folder_unique" ON "drive_folder_links" ("folder_id");
CREATE UNIQUE INDEX IF NOT EXISTS "drive_links_ws_drivefolder_unique" ON "drive_folder_links" ("workspace_id", "drive_folder_id");

CREATE TABLE IF NOT EXISTS "drive_file_mappings" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "link_id"           uuid NOT NULL REFERENCES "drive_folder_links"("id") ON DELETE CASCADE,
  "drive_file_id"     text NOT NULL,
  "drive_name"        text,
  "doc_id"            uuid REFERENCES "docs"("id") ON DELETE SET NULL,
  "attachment_id"     uuid REFERENCES "attachments"("id") ON DELETE SET NULL,
  "drive_md5"         text,
  "content_hash"      text,
  "drive_modified_at" timestamptz,
  "mnema_modified_at" timestamptz,
  "sync_state"        text NOT NULL DEFAULT 'synced',
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  "updated_at"        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "drive_map_link_idx" ON "drive_file_mappings" ("link_id");
CREATE UNIQUE INDEX IF NOT EXISTS "drive_map_link_file_unique" ON "drive_file_mappings" ("link_id", "drive_file_id");
CREATE INDEX IF NOT EXISTS "drive_map_doc_idx" ON "drive_file_mappings" ("doc_id");
CREATE INDEX IF NOT EXISTS "drive_map_attachment_idx" ON "drive_file_mappings" ("attachment_id");
