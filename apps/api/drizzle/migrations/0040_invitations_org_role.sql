-- 0040_invitations_org_role.sql
-- Phase B — invitations can carry an org_role (and team). When present, accepting
-- the invite provisions the user's org profile, team membership, and IAM policies.
-- Nullable → existing plain role-only invitations are unaffected. Idempotent.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS org_role_id uuid REFERENCES org_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_id     uuid REFERENCES teams(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS display_title text;
