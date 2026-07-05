-- 0042_flow_share.sql — share a flow with any Mnema account via a link token.
ALTER TABLE flows ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE flows ADD COLUMN IF NOT EXISTS shared_at   timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_flows_share_token ON flows(share_token) WHERE share_token IS NOT NULL;
