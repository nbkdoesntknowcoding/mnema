-- 0038_meeting_schema_additions.sql
-- Phase A — meeting columns (calendar/admit/folder linkage) + org_chart_imports.
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS project_id          uuid REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS calendar_event_id   text,
  ADD COLUMN IF NOT EXISTS calendar_provider   text DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS admitted            boolean DEFAULT false,
  -- admitted = user confirmed this meeting should be tracked in Mnema
  ADD COLUMN IF NOT EXISTS meeting_folder_id   uuid,
  -- FK added after folders migration: REFERENCES folders(id)
  ADD COLUMN IF NOT EXISTS linked_meeting_ids  uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS post_meeting_doc_id uuid,
  ADD COLUMN IF NOT EXISTS pre_meeting_doc_id  uuid,
  ADD COLUMN IF NOT EXISTS status              text DEFAULT 'scheduled';
  -- 'scheduled' | 'live' | 'ended' | 'processing' | 'done'

CREATE INDEX IF NOT EXISTS idx_meetings_calendar     ON meetings(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project      ON meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_workspace_status ON meetings(workspace_id, status);

-- Org chart imports tracking
CREATE TABLE IF NOT EXISTS org_chart_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  import_type         text NOT NULL,   -- 'image' | 'excel' | 'manual' | 'description'
  source_file_url     text,
  extracted_structure jsonb,           -- AI-extracted hierarchy before confirmation
  confirmed_structure jsonb,           -- what HR confirmed/edited
  status              text DEFAULT 'pending',
  -- 'pending' | 'confirmed' | 'applied' | 'failed'
  applied_at          timestamptz,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz DEFAULT now()
);

-- grants for app roles (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON org_chart_imports TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_chart_imports TO boppl_system;
