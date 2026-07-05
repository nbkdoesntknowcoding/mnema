import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../config/env.js';

/**
 * Invitation tokens — signed JWTs with a 7-day expiry.
 *
 * Why JWTs and not opaque UUIDs:
 *   - The signature pre-validates the token before any DB hit
 *   - All the data the accept-flow needs (workspace, role, email,
 *     inviter) lives in the token itself — fewer roundtrips
 *   - `exp` is built into the standard so we don't have to track it
 *
 * The downside is revocation. We mitigate by writing a row to the
 * `invitations` table at issue time and looking it up by `jti` at accept
 * time. The JWT proves "have it / signed"; the row proves "still valid /
 * not consumed". Both must pass.
 *
 * Audience is `{JWT_AUDIENCE}/invite` so an invitation token can't be
 * reused as an app-login JWT or vice versa — `aud` is checked at verify.
 */

const secret = new TextEncoder().encode(config.JWT_SECRET);
const INVITE_AUDIENCE = `${config.JWT_AUDIENCE}/invite`;

export interface InvitationClaims {
  jti: string;
  workspace_id: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  invited_by: string;
}

export interface InvitationTokenInput {
  workspace_id: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  invited_by: string;
}

export async function signInvitationToken(
  input: InvitationTokenInput,
): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({
    workspace_id: input.workspace_id,
    email: input.email.toLowerCase(),
    role: input.role,
    invited_by: input.invited_by,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(config.JWT_ISSUER)
    .setAudience(INVITE_AUDIENCE)
    .setSubject(input.email.toLowerCase())
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  return { token, jti };
}

export async function verifyInvitationToken(token: string): Promise<InvitationClaims> {
  const { payload } = await jwtVerify(token, secret, {
    issuer: config.JWT_ISSUER,
    audience: INVITE_AUDIENCE,
  });
  if (
    typeof payload.jti !== 'string' ||
    typeof payload.workspace_id !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string' ||
    typeof payload.invited_by !== 'string'
  ) {
    throw new Error('invitation token missing required claims');
  }
  const role = payload.role as InvitationClaims['role'];
  if (role !== 'owner' && role !== 'editor' && role !== 'viewer') {
    throw new Error(`invitation token has invalid role: ${role}`);
  }
  return {
    jti: payload.jti,
    workspace_id: payload.workspace_id as string,
    email: payload.email as string,
    role,
    invited_by: payload.invited_by as string,
  };
}
