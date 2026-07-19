import { jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config/env.js';

/**
 * Per-request authentication context resolved from a verified MCP Bearer JWT.
 *
 * The MCP SDK's request handlers don't take an arbitrary context bag — we
 * thread this through the closure of `createMcpServer(ctx)` so every
 * tools/list and tools/call dispatch sees the caller's tenant + scopes.
 */
export interface McpAuthContext {
  user_id: string;
  tenant_id: string;
  email: string;
  scopes: string[];
  jwt_id: string | null;
  /** Phase 1 AgentLens: workspace mode. 'dev_project' enables dev MCP tools. */
  workspaceMode?: string;
  /** Resolved per-request decision on whether the AgentLens dev tools are
   *  registered for this token. Defaults to (workspaceMode === 'dev_project')
   *  but a token's dev_tools_enabled flag overrides it either way. */
  devToolsEnabled?: boolean;
  /** Stage B: set ONLY for a project-scoped API key (the meeting bot). When
   *  present, RLS hard-bounds every tool in this session to that one project. */
  project_id?: string | null;
}

/**
 * 401-class failure: token missing, malformed, expired, signature bad,
 * audience/issuer mismatched, or required claims absent. The route layer
 * translates this into a 401 + WWW-Authenticate challenge.
 */
export class McpUnauthorizedError extends Error {
  constructor(public readonly reason: string) {
    super(`MCP unauthorized: ${reason}`);
    this.name = 'McpUnauthorizedError';
  }
}

const secret = new TextEncoder().encode(config.JWT_SECRET);

interface BopplJwtPayload extends JWTPayload {
  sub: string;
  tenant_id: string;
  email: string;
  scopes: string[];
}

/**
 * Verify a Bearer token presented to the MCP route.
 *
 * Phase 2.2: HS256 against the local JWT_SECRET, accepting either of two
 * audiences (REST + MCP) so a developer can paste their `boppl_jwt` cookie
 * straight into the MCP Inspector. Phase D replaces the local-secret check
 * with WorkOS JWKS verification and narrows the audience set to MCP only.
 */
export async function verifyMcpToken(rawToken: string): Promise<McpAuthContext> {
  let payload: BopplJwtPayload;

  try {
    const verified = await jwtVerify(rawToken, secret, {
      issuer: config.JWT_ISSUER,
      // Accept either audience — see comment on env.ts JWT_AUDIENCE_MCP.
      audience: [config.JWT_AUDIENCE, config.JWT_AUDIENCE_MCP],
    });
    payload = verified.payload as BopplJwtPayload;
  } catch (err) {
    throw new McpUnauthorizedError(
      err instanceof Error ? err.message : 'jwt_verify_failed',
    );
  }

  if (!payload.sub || !payload.tenant_id || !payload.email) {
    throw new McpUnauthorizedError('missing_required_claims');
  }
  if (!Array.isArray(payload.scopes)) {
    throw new McpUnauthorizedError('missing_scopes_claim');
  }

  return {
    user_id: payload.sub,
    tenant_id: payload.tenant_id,
    email: payload.email,
    scopes: payload.scopes,
    jwt_id: typeof payload.jti === 'string' ? payload.jti : null,
  };
}

/**
 * Pull the token out of an `Authorization: Bearer <token>` header.
 * Returns null if the header is missing or shaped wrong — the caller decides
 * whether that's a 401 or a 403.
 */
export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  return match ? match[1]!.trim() : null;
}
