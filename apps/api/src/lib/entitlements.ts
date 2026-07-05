/**
 * Phase 2 (Open-Core) — single entitlement reader. Resolves a workspace's
 * EFFECTIVE entitlements with most-specific-wins precedence:
 *   active license  >  subscription tier (workspaces.plan)  >  free defaults.
 * An expired license degrades everything to read-only (never a data hostage).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { licenses, workspaces } from '../db/schema.js';
import { verifyLicenseKey } from './license-key.js';
import { config } from '../config/env.js';

// A3.1: `history` + `export` are the community unlock set. They are granted to every
// REGISTERED tier (all cloud tiers — cloud signup is registration — plus community and
// every paid self-host tier). The self-host `unregistered` default lacks them.
export type Feature = 'graph' | 'meetings' | 'org' | 'sso' | 'audit' | 'history' | 'export';

export interface EffectiveEntitlements {
  tier: string;
  seats: number;
  workspaces: number;
  features: Set<Feature>;
  /** true when the source license has expired — features degrade to read-only. */
  readOnly: boolean;
  source: 'license' | 'subscription' | 'free';
}

const ALL_FEATURES: readonly Feature[] = ['graph', 'meetings', 'org', 'sso', 'audit', 'history', 'export'];

// Tier → defaults, used when the tier comes from a subscription/plan rather than
// an explicit license entitlements payload. Mirrors the §1 gating matrix.
// Tier keys MUST match the real workspaces.plan slugs the Razorpay webhook writes:
// 'free' | 'individual' | 'team' | 'business' (see razorpay/webhook-handlers.ts).
// 'pro' (a products.ts display slug) and 'company' (the license/self-host tier) are
// mapped too so no paid tier ever falls through to free defaults.
const TIER_FEATURES: Record<string, readonly Feature[]> = {
  // Cloud free gets meetings via BYOK (the monthly meeting cap governs the limit,
  // not this flag). Self-host free gets NO meetings — Phase 6 removes it here via a
  // deploy-mode flag. Graph is gated at every free tier.
  // A3.1: history + export are granted to every registered tier below. `community`
  // is the free self-host registered tier — it unlocks history + export only.
  free: ['meetings', 'history', 'export'],
  community: ['history', 'export'],
  individual: ['graph', 'meetings', 'history', 'export'],
  pro: ['graph', 'meetings', 'history', 'export'],
  team: ['graph', 'meetings', 'org', 'sso', 'audit', 'history', 'export'],
  business: ['graph', 'meetings', 'org', 'sso', 'audit', 'history', 'export'],
  company: ['graph', 'meetings', 'org', 'sso', 'audit', 'history', 'export'],
};
const TIER_SEATS: Record<string, number> = { free: 3, community: 3, individual: 1, pro: 1, team: 5, business: 25, company: 25 };
const TIER_WORKSPACES: Record<string, number> = { free: 1, community: 1, individual: 1, pro: 1, team: 100, business: 100, company: 100 };

function toFeatureSet(raw: readonly string[]): Set<Feature> {
  return new Set(raw.filter((f): f is Feature => (ALL_FEATURES as readonly string[]).includes(f)));
}

function freeDefaults(): EffectiveEntitlements {
  // A3.1 "registered vs unregistered" gate. On cloud (AUTH_PROVIDER=workos) signup
  // itself is registration, so free users get history + export. On self-host the
  // default is `unregistered` and lacks them until a community license is redeemed.
  const registered = config.AUTH_PROVIDER === 'workos';
  return {
    tier: registered ? 'free' : 'unregistered',
    seats: 3,
    workspaces: 1,
    features: registered
      ? new Set<Feature>(['meetings', 'history', 'export'])
      : new Set<Feature>(['meetings']),
    readOnly: false,
    source: 'free',
  };
}

const ACTIVE_LICENSE_STATUSES = ['active', 'trial', 'expiring'];

export async function resolveEntitlements(workspaceId: string): Promise<EffectiveEntitlements> {
  // 1 — Active license (most specific). A verified signed key payload wins; else
  //     the stored entitlements jsonb (admin-granted licenses have no key).
  const licRows = await db
    .select({
      planTier: licenses.planTier,
      seats: licenses.seats,
      entitlements: licenses.entitlements,
      licenseKey: licenses.licenseKey,
      expiresAt: licenses.expiresAt,
    })
    .from(licenses)
    .where(and(eq(licenses.workspaceId, workspaceId), inArray(licenses.status, ACTIVE_LICENSE_STATUSES)))
    .orderBy(desc(licenses.createdAt))
    .limit(1);

  const lic = licRows[0];
  if (lic) {
    const expired = lic.expiresAt != null && new Date(lic.expiresAt).getTime() < Date.now();
    const verified = lic.licenseKey ? verifyLicenseKey(lic.licenseKey) : null;
    const jsonFeatures = (lic.entitlements as { features?: string[] } | null)?.features;
    const tier = verified?.tier ?? lic.planTier;
    const rawFeatures: readonly string[] =
      verified?.features ?? jsonFeatures ?? TIER_FEATURES[tier] ?? [];
    return {
      tier,
      seats: verified?.seats ?? lic.seats,
      workspaces: verified?.workspaces ?? TIER_WORKSPACES[tier] ?? 1,
      features: toFeatureSet(rawFeatures),
      readOnly: expired,
      source: 'license',
    };
  }

  // 2 — Subscription tier (workspaces.plan, kept in sync from Razorpay).
  const wsRows = await db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const plan = wsRows[0]?.plan ?? 'free';
  const planFeatures = TIER_FEATURES[plan];
  if (plan !== 'free' && planFeatures) {
    return {
      tier: plan,
      seats: TIER_SEATS[plan] ?? 1,
      workspaces: TIER_WORKSPACES[plan] ?? 1,
      features: toFeatureSet(planFeatures),
      readOnly: false,
      source: 'subscription',
    };
  }

  // 3 — Free defaults.
  return freeDefaults();
}

/** True if the workspace's effective entitlement includes a feature (and isn't read-only). */
export async function hasFeature(workspaceId: string, feature: Feature): Promise<boolean> {
  const ent = await resolveEntitlements(workspaceId);
  return ent.features.has(feature) && !ent.readOnly;
}
