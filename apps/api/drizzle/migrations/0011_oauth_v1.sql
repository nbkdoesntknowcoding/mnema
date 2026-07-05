-- =========================================================================
-- OAuth 2.1 Authorization Server Tables  (Phase A)
-- =========================================================================

-- ----------------------------------------------------------------
-- oauth_clients: registered MCP clients (Claude.ai, etc.)
-- Populated by Dynamic Client Registration (RFC 7591).
-- ----------------------------------------------------------------
CREATE TABLE oauth_clients (
  id                         text        PRIMARY KEY,
  client_secret_hash         text,
  client_name                text        NOT NULL,
  redirect_uris              text[]      NOT NULL,
  grant_types                text[]      NOT NULL DEFAULT ARRAY['authorization_code', 'refresh_token'],
  response_types             text[]      NOT NULL DEFAULT ARRAY['code'],
  scope                      text        NOT NULL DEFAULT 'workspace:read',
  token_endpoint_auth_method text        NOT NULL DEFAULT 'none',
  application_type           text        NOT NULL DEFAULT 'web',
  registered_via             text        NOT NULL DEFAULT 'dynamic',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  last_used_at               timestamptz,
  metadata                   jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX oauth_clients_last_used_idx ON oauth_clients (last_used_at DESC);

-- ----------------------------------------------------------------
-- oauth_pending_auth_requests: in-flight authorize params while
-- the user authenticates / sees the consent screen.
-- ----------------------------------------------------------------
CREATE TABLE oauth_pending_auth_requests (
  id                    text        PRIMARY KEY,
  client_id             text        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri          text        NOT NULL,
  scope                 text        NOT NULL,
  state                 text        NOT NULL,
  code_challenge        text        NOT NULL,
  code_challenge_method text        NOT NULL DEFAULT 'S256',
  resource              text,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_pending_auth_requests_expires_idx
  ON oauth_pending_auth_requests (expires_at);

-- ----------------------------------------------------------------
-- oauth_authorization_codes: short-lived codes exchanged for tokens
-- ----------------------------------------------------------------
CREATE TABLE oauth_authorization_codes (
  code                  text        PRIMARY KEY,
  client_id             text        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id               uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id          uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  redirect_uri          text        NOT NULL,
  scope                 text        NOT NULL,
  resource              text,
  code_challenge        text        NOT NULL,
  code_challenge_method text        NOT NULL DEFAULT 'S256',
  expires_at            timestamptz NOT NULL,
  used_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_authorization_codes_expires_idx
  ON oauth_authorization_codes (expires_at)
  WHERE used_at IS NULL;

-- ----------------------------------------------------------------
-- oauth_refresh_tokens: long-lived tokens, rotated on each use
-- ----------------------------------------------------------------
CREATE TABLE oauth_refresh_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text        NOT NULL UNIQUE,
  client_id       text        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope           text        NOT NULL,
  resource        text,
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  rotated_to_id   uuid        REFERENCES oauth_refresh_tokens(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_refresh_tokens_user_idx
  ON oauth_refresh_tokens (user_id, workspace_id);
CREATE INDEX oauth_refresh_tokens_active_idx
  ON oauth_refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------
-- oauth_consents: persisted user approvals to skip repeat consent
-- ----------------------------------------------------------------
CREATE TABLE oauth_consents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id    text        NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scope        text        NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  UNIQUE (user_id, workspace_id, client_id, scope)
);

CREATE INDEX oauth_consents_active_idx
  ON oauth_consents (user_id, workspace_id, client_id)
  WHERE revoked_at IS NULL;
