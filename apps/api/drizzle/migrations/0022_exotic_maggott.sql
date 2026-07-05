-- Chunk C: Projects table + nullable project_id FK on tasks and folders
-- Projects are available in both knowledge and dev_project workspace modes.
-- project_id is nullable everywhere — existing workspaces with no projects
-- continue to work exactly as before.

CREATE TABLE IF NOT EXISTS "projects" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id"     uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name"             text NOT NULL,
  "slug"             text NOT NULL,
  "description"      text,
  "color"            text NOT NULL DEFAULT '#52525b',
  "icon"             text NOT NULL DEFAULT 'folder',
  "github_repo_url"  text,
  "status"           text NOT NULL DEFAULT 'active',
  "board_order"      integer NOT NULL DEFAULT 0,
  "created_by"       uuid,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_workspace_idx"
  ON "projects" ("slug", "workspace_id");

CREATE INDEX IF NOT EXISTS "projects_workspace_idx"
  ON "projects" ("workspace_id");

-- Add nullable project_id to folders
ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "folders_project_idx"
  ON "folders" ("project_id");

-- Add nullable project_id to tasks
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "tasks_project_idx"
  ON "tasks" ("project_id");