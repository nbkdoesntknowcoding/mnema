import { config } from '../config/env.js';

/**
 * Single source of truth for MCP-server configuration.
 *
 * Read at startup from validated env. Other modules import the resolved
 * `mcpConfig` object — they should never reach into `process.env` directly.
 *
 * Key URLs:
 *   - resourceUrl                — what the AS-issued token must `aud` to.
 *                                  Per the MCP spec, this is the canonical
 *                                  URL of the MCP endpoint itself.
 *   - protectedResourceMetadataUrl — where claude.ai discovers our metadata
 *                                  (RFC 9728): `${baseUrl}/.well-known/oauth-protected-resource`.
 *   - authorizationServer        — the AS that mints tokens for this resource.
 *                                  Phase 2.1 = placeholder; Phase 2.2 swaps
 *                                  for the WorkOS AuthKit issuer URL.
 *   - mcpBaseUrl                 — externally-visible base of the api process.
 */
const mcpBaseUrl = config.MCP_BASE_URL.replace(/\/+$/, '');
// Phase A: the OAuth AS is now the Mnema API itself (OAUTH_ISSUER).
// Falls back to MCP_AUTHORIZATION_SERVER for backwards compat in non-OAuth envs.
const authorizationServer = config.OAUTH_ISSUER.replace(/\/+$/, '') || config.MCP_AUTHORIZATION_SERVER.replace(/\/+$/, '');
const resourceUrl = `${mcpBaseUrl}/mcp`;

export interface McpConfig {
  readonly protocolVersion: string;
  readonly serverName: string;
  /** Human display name shown by clients/directories (vs the machine `serverName`). */
  readonly serverTitle: string;
  /** One-line server description surfaced as MCP `instructions` and in directories. */
  readonly serverDescription: string;
  readonly serverVersion: string;
  readonly mcpBaseUrl: string;
  readonly resourceUrl: string;
  readonly protectedResourceMetadataUrl: string;
  readonly authorizationServer: string;
  /** Expected `aud` claim on Bearer tokens — equals resourceUrl. */
  readonly expectedAudience: string;
  readonly originAllowlist: readonly string[];
}

export const mcpConfig: McpConfig = {
  protocolVersion: config.MCP_PROTOCOL_VERSION,
  serverName: 'mnema',
  serverTitle: 'Mnema',
  serverDescription:
    'Live context for AI agents — docs, flows, and knowledge your assistant reads in real time.',
  serverVersion: '1.0.0',
  mcpBaseUrl,
  resourceUrl,
  protectedResourceMetadataUrl: `${mcpBaseUrl}/.well-known/oauth-protected-resource`,
  authorizationServer,
  expectedAudience: resourceUrl,
  originAllowlist: config.MCP_ORIGIN_ALLOWLIST.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
