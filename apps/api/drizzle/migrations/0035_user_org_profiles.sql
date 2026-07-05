-- 0035_user_org_profiles.sql
-- Phase A — one row per (user, workspace): the user's identity inside this org.
CREATE TABLE IF NOT EXISTS user_org_profiles (
  user_id        uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_role_id    uuid REFERENCES org_roles(id)           ON DELETE SET NULL,
  display_title  text,       -- 'Co-Founder', 'Senior Engineer' — free text override
  role_slug      text,       -- mirrors org_roles.slug — denormalised for bot lookup speed
  manager_user_id uuid REFERENCES users(id),
  department     text,       -- mirrors team name — denormalised
  bot_display_name text,
  -- What the meeting bot announces this person as:
  -- 'Jason Joseph D'Silva · Co-Founder'
  -- = '{display_name} · {display_title}'
  -- Computed on insert/update, stored for fast bot lookup
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_uop_workspace   ON user_org_profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_uop_role_slug   ON user_org_profiles(role_slug);

-- grants for app roles (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON user_org_profiles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_org_profiles TO boppl_system;
