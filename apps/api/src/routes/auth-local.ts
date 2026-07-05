/**
 * Phase 4 (Open-Core) — built-in email+password auth (self-host, AUTH_PROVIDER='password').
 *
 *   POST /api/_internal/password-login    — verify password vs users.password_hash, bootstrap.
 *   POST /api/_internal/password-register  — create a built-in account, bootstrap.
 *
 * Called server-side by the web login/signup pages with API_INTERNAL_SECRET (never
 * the browser), mirroring the WorkOS set-session flow: both converge on
 * bootstrapUserAndWorkspace → a signed session JWT. No WorkOS involved.
 */
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { users, workspaceMembers } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';
import { signJwt } from '../lib/jwt.js';
import { scopesForRole } from '../lib/scopes.js';
import { bootstrapUserAndWorkspace } from '../lib/workspace.js';

const loginSchema = z.object({
  internal_secret: z.string(),
  email: z.string().email(),
  password: z.string().min(1),
});
const registerSchema = z.object({
  internal_secret: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
  display_name: z.string().nullable().optional(),
});
const federatedSchema = z.object({
  internal_secret: z.string(),
  email: z.string().email(),
  display_name: z.string().nullable().optional(),
});

async function mintSession(userId: string, tenantId: string, email: string): Promise<string> {
  const memberRows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, tenantId)))
    .limit(1);
  const role = memberRows[0]?.role ?? 'viewer';
  return signJwt({ sub: userId, tenant_id: tenantId, scopes: scopesForRole(role), email });
}

export const authLocalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/_internal/password-login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) return reply.code(403).send({ error: 'forbidden' });
    if (config.AUTH_PROVIDER !== 'password') return reply.code(400).send({ error: 'password_auth_disabled' });

    const email = parsed.data.email.trim().toLowerCase();
    const rows = await db
      .select({ id: users.id, passwordHash: users.passwordHash, displayName: users.displayName })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const bootstrap = await bootstrapUserAndWorkspace({ email, displayName: user.displayName, skipDomainCheck: false });
    if (bootstrap.type === 'needs_workspace_choice') {
      return { needs_workspace_choice: true, user_id: bootstrap.user_id, email, domain_workspaces: bootstrap.domain_workspaces };
    }
    const jwt = await mintSession(bootstrap.user_id, bootstrap.tenant_id, email);
    return { user_id: bootstrap.user_id, tenant_id: bootstrap.tenant_id, jwt };
  });

  app.post('/api/_internal/password-register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) return reply.code(403).send({ error: 'forbidden' });
    if (config.AUTH_PROVIDER !== 'password') return reply.code(400).send({ error: 'password_auth_disabled' });

    const email = parsed.data.email.trim().toLowerCase();
    const displayName = parsed.data.display_name?.trim() || null;
    const existing = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]?.passwordHash) return reply.code(409).send({ error: 'account_exists' });

    const passwordHash = hashPassword(parsed.data.password);
    if (existing[0]) {
      await db.update(users).set({ passwordHash, displayName }).where(eq(users.id, existing[0].id));
    } else {
      await db.insert(users).values({ email, displayName, passwordHash });
    }

    const bootstrap = await bootstrapUserAndWorkspace({ email, displayName, skipDomainCheck: true });
    if (bootstrap.type === 'needs_workspace_choice') {
      return { needs_workspace_choice: true, user_id: bootstrap.user_id, email, domain_workspaces: bootstrap.domain_workspaces };
    }
    const jwt = await mintSession(bootstrap.user_id, bootstrap.tenant_id, email);
    return { user_id: bootstrap.user_id, tenant_id: bootstrap.tenant_id, jwt };
  });

  // Federated login (OIDC): the web layer has already verified the id_token, so
  // we bootstrap by the verified email — no password, no WorkOS id.
  app.post('/api/_internal/federated-login', async (req, reply) => {
    const parsed = federatedSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) return reply.code(403).send({ error: 'forbidden' });
    if (config.AUTH_PROVIDER !== 'oidc') return reply.code(400).send({ error: 'oidc_disabled' });

    const email = parsed.data.email.trim().toLowerCase();
    const bootstrap = await bootstrapUserAndWorkspace({ email, displayName: parsed.data.display_name ?? null, skipDomainCheck: true });
    if (bootstrap.type === 'needs_workspace_choice') {
      return { needs_workspace_choice: true, user_id: bootstrap.user_id, email, domain_workspaces: bootstrap.domain_workspaces };
    }
    const jwt = await mintSession(bootstrap.user_id, bootstrap.tenant_id, email);
    return { user_id: bootstrap.user_id, tenant_id: bootstrap.tenant_id, jwt };
  });
};
