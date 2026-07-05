-- 0034_teams_org_roles.sql
-- Phase A (Org Structure + IAM) — teams + org_roles. Idempotent.

-- Teams: departments / squads inside a workspace. Supports nesting.
CREATE TABLE IF NOT EXISTS teams (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  slug          text        NOT NULL,               -- 'engineering', 'marketing'
  description   text,
  parent_team_id uuid       REFERENCES teams(id),  -- nullable: top-level teams have null
  color         text        DEFAULT '#6b7280',      -- for UI chips
  created_at    timestamptz DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_teams_parent    ON teams(parent_team_id);

-- Team membership
CREATE TABLE IF NOT EXISTS team_members (
  team_id   uuid NOT NULL REFERENCES teams(id)  ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member',     -- 'member' | 'lead' | 'admin'
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Org roles: named job titles with policy defaults
-- Each org_role belongs to a team and defines a workspace_role ceiling
-- plus a default_folder_access policy applied on user invite
CREATE TABLE IF NOT EXISTS org_roles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id              uuid REFERENCES teams(id) ON DELETE SET NULL,
  name                 text NOT NULL,            -- 'CTO', 'Head of Marketing'
  slug                 text NOT NULL,            -- 'cto', 'head-of-marketing'
  description          text,
  workspace_role       text NOT NULL DEFAULT 'editor',
  -- workspace_role = ceiling this role can never exceed
  -- must be one of: 'viewer' | 'editor' | 'owner'
  default_folder_access jsonb NOT NULL DEFAULT '[]',
  -- Array of: [{folder_slug: 'engineering', permission: 'write'},
  --            {folder_slug: 'strategy', permission: 'read'}]
  -- Applied automatically when a user with this org_role is invited
  created_at           timestamptz DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_org_roles_workspace ON org_roles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_org_roles_team      ON org_roles(team_id);

-- grants for app roles (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON teams, team_members, org_roles TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON teams, team_members, org_roles TO boppl_system;
