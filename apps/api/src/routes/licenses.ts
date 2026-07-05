/**
 * License redemption (CORE — ships in the public/self-host build).
 *
 *   POST /api/licenses/redeem  { key }   → owner-only
 *
 * Two redemption paths, so it works on both cloud and self-host:
 *   1. Pre-issued row  — a `licenses` row already carries this key (cloud admin
 *      issued it). Attach the row to the caller's workspace.
 *   2. Offline-signed key — no row exists (the common self-host / community case:
 *      the key was signed offline and emailed, never inserted into this DB). Verify
 *      the Ed25519 signature against the baked-in public key and CREATE the row
 *      from the key's own payload. Zero outbound calls — airgap-friendly.
 *
 * NOTE: this used to live inside routes/admin (ee, carve-stripped), which silently
 * removed redemption from the public build. It belongs in core: a self-hoster who
 * receives a community key must be able to redeem it.
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.js';
import { licenses } from '../db/schema.js';
import { requireRole, RoleError } from '../lib/role.js';
import { verifyLicenseKey } from '../lib/license-key.js';

const REDEEM_BLOCKED_STATUSES = new Set(['revoked', 'expired', 'suspended']);

export const licensesRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/licenses/redeem', async (req, reply) => {
    try {
      await requireRole(req, 'owner');
    } catch (e) {
      if (e instanceof RoleError) return reply.code(e.status).send({ error: e.reason });
      throw e;
    }

    const parsed = z.object({ key: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation' });
    const key = parsed.data.key.trim();
    const tenant = req.auth!.tenant_id;

    // Path 1 — a row already carries this key (cloud pre-issued).
    const [existing] = await db.select().from(licenses).where(eq(licenses.licenseKey, key)).limit(1);
    if (existing) {
      if (REDEEM_BLOCKED_STATUSES.has(existing.status)) {
        return reply.code(400).send({ error: `key_${existing.status}` });
      }
      if (existing.redeemedAt && existing.workspaceId && existing.workspaceId !== tenant) {
        return reply.code(400).send({ error: 'already_redeemed' });
      }
      await db
        .update(licenses)
        .set({ workspaceId: tenant, redeemedBy: req.auth!.sub, redeemedAt: new Date(), status: 'active', updatedAt: new Date() })
        .where(eq(licenses.id, existing.id));
      await applyLicense(tenant, existing.planTier, (existing.entitlements ?? {}) as Record<string, unknown>);
      return reply.send({ ok: true, plan: existing.planTier, seats: existing.seats });
    }

    // Path 2 — no row: verify the offline signature and mint the row from its payload.
    const verified = verifyLicenseKey(key);
    if (!verified) return reply.code(404).send({ error: 'invalid_key' });

    const entitlements = { features: verified.features };
    await db.insert(licenses).values({
      workspaceId: tenant,
      planTier: verified.tier,
      seats: verified.seats,
      entitlements,
      licenseKey: key,
      status: 'active',
      expiresAt: verified.expiry ? new Date(verified.expiry) : null,
      redeemedBy: req.auth!.sub,
      redeemedAt: new Date(),
    });

    await applyLicense(tenant, verified.tier, entitlements);
    return reply.send({ ok: true, plan: verified.tier, seats: verified.seats });
  });
};

/** Push a license's plan + entitlements onto the workspace (the plan/entitlement reader reads these). */
async function applyLicense(workspaceId: string, planTier: string, entitlements: Record<string, unknown>): Promise<void> {
  await db.execute(sql`
    UPDATE workspaces
    SET plan = ${planTier},
        settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{entitlements}', ${JSON.stringify(entitlements)}::jsonb),
        updated_at = now()
    WHERE id = ${workspaceId}::uuid`);
}
