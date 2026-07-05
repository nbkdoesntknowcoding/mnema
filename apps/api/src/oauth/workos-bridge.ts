/**
 * WorkOS AuthKit bridge for the OAuth 2.1 authorize flow.
 *
 * The MCP OAuth AS doesn't own user authentication — WorkOS AuthKit does.
 * This module wraps the existing WorkOS SDK helpers to:
 *   1. Redirect unauthenticated users to WorkOS login with a callback
 *      pointing back to the API server's /oauth/callback.
 *   2. Complete the WorkOS callback and return the resolved user identity.
 *
 * The callback URL is WORKOS_REDIRECT_URI_OAUTH (e.g.
 * https://YOUR-TUNNEL/oauth/callback), distinct from the web app's
 * /auth/callback. Both must be registered in the WorkOS dashboard.
 */
import type { FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { workos } from '../plugins/workos.js';

/**
 * Build the WorkOS AuthKit login URL (does NOT redirect — caller decides).
 */
export function getWorkOSLoginUrl(opts: { requestId: string }): string {
  return workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: config.WORKOS_CLIENT_ID,
    redirectUri: config.WORKOS_REDIRECT_URI_OAUTH,
    // Carry the request_id through WorkOS's state param so the callback
    // can resume the correct pending authorize request.
    state: opts.requestId,
  });
}

/**
 * Redirect an unauthenticated user to WorkOS AuthKit login.
 * The `state` param carries the OAuth request_id so the callback
 * knows which pending authorize request to resume.
 */
export async function redirectToWorkOSLogin(
  reply: FastifyReply,
  opts: { requestId: string },
): Promise<void> {
  reply.redirect(getWorkOSLoginUrl(opts), 302);
}

export interface WorkOSIdentity {
  workosUserId: string;
  email: string;
}

/**
 * Complete the WorkOS callback: exchange the code for a user identity.
 * Returns null if the exchange fails (revoked code, etc.).
 */
export async function completeWorkOSCallback(
  code: string,
): Promise<WorkOSIdentity | null> {
  try {
    const { user } = await workos.userManagement.authenticateWithCode({
      code,
      clientId: config.WORKOS_CLIENT_ID,
    });
    return { workosUserId: user.id, email: user.email };
  } catch {
    return null;
  }
}
