/**
 * RS256 JWT issuance and verification for OAuth 2.1 access tokens.
 *
 * Every token is bound to (user, workspace, scope, audience). The `aud`
 * claim is the resource indicator (RFC 8707) — equals `<OAUTH_ISSUER>/mcp`.
 * Validating `aud` on every request is the primary confused-deputy defence.
 *
 * DO NOT use HS256 here. Asymmetric keys allow future JWKS-based
 * verification by external parties without sharing a secret.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config/env.js';
import { loadKeyPair } from './keys.js';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

export interface OAuthJwtPayload extends JWTPayload {
  iss: string;
  sub: string;          // user_id (UUID)
  aud: string;          // resource indicator
  exp: number;
  iat: number;
  jti: string;
  scope: string;        // space-separated
  workspace_id: string;
  client_id: string;
}

export async function signOAuthAccessToken(args: {
  userId: string;
  workspaceId: string;
  clientId: string;
  scope: string;
  resource: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const { privateKey, kid, alg } = await loadKeyPair();
  const iss = config.OAUTH_ISSUER;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_SECONDS;
  const jti = crypto.randomUUID();

  const token = await new SignJWT({
    scope: args.scope,
    workspace_id: args.workspaceId,
    client_id: args.clientId,
  } satisfies Partial<OAuthJwtPayload>)
    .setProtectedHeader({ alg, kid })
    .setIssuer(iss)
    .setSubject(args.userId)
    .setAudience(args.resource)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(privateKey);

  return { token, expiresAt: new Date(exp * 1000) };
}

export type VerifyOAuthResult =
  | { valid: true; payload: OAuthJwtPayload }
  | { valid: false; reason: 'invalid_signature' | 'expired' | 'wrong_issuer' | 'wrong_audience' | 'malformed'; detail?: string };

export async function verifyOAuthAccessToken(
  token: string,
  expectedAudience: string,
): Promise<VerifyOAuthResult> {
  const { publicKey } = await loadKeyPair();
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: config.OAUTH_ISSUER,
      audience: expectedAudience,
      algorithms: ['RS256'],
    });
    // Reject if alg header is not RS256 (alg confusion attack)
    return { valid: true, payload: payload as OAuthJwtPayload };
  } catch (err: unknown) {
    const e = err as { code?: string; claim?: string; message?: string };
    if (e.code === 'ERR_JWT_EXPIRED') return { valid: false, reason: 'expired' };
    if (e.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      if (e.claim === 'iss') return { valid: false, reason: 'wrong_issuer' };
      if (e.claim === 'aud') return { valid: false, reason: 'wrong_audience' };
    }
    if (e.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return { valid: false, reason: 'invalid_signature' };
    }
    return { valid: false, reason: 'malformed', detail: e.message };
  }
}
