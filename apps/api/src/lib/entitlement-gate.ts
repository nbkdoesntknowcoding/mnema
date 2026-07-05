/**
 * Phase 2 (Open-Core) — entitlement gate, wired at the four seams (graph-build,
 * meeting-admit, member-add, workspace-create).
 *
 * REPORT-ONLY by default: when ENFORCE_ENTITLEMENTS is false (the default), a
 * gate that WOULD block instead logs `[entitlement] would block …` and allows
 * through — so we can watch prod and grant licenses before anything is enforced.
 * When ENFORCE_ENTITLEMENTS is true it returns allowed:false and the caller
 * sends 402.
 */
import { config } from '../config/env.js';
import { resolveEntitlements, hasFeature, type Feature } from './entitlements.js';

export interface GateResult {
  allowed: boolean;
  /** true when the gate would block but report-only mode let it through. */
  wouldBlock?: boolean;
  reason?: string;
}

/** Feature gate — e.g. requireFeature(ws, 'graph', 'graph-build'). */
export async function requireFeature(workspaceId: string, feature: Feature, ctx = ''): Promise<GateResult> {
  const ent = await resolveEntitlements(workspaceId);
  if (ent.features.has(feature) && !ent.readOnly) return { allowed: true };
  const reason = ent.readOnly
    ? `Your license has expired — ${feature} is read-only until renewed.`
    : `Your ${ent.tier} plan does not include ${feature}.`;
  return decide(feature, workspaceId, ent.tier, ent.source, reason, ctx);
}

/** Seat gate for member-add — allowed while current members < entitled seats. */
export async function requireSeat(workspaceId: string, currentMembers: number, ctx = ''): Promise<GateResult> {
  const ent = await resolveEntitlements(workspaceId);
  if (currentMembers < ent.seats) return { allowed: true };
  const reason = `Seat limit reached (${ent.seats}) on the ${ent.tier} plan.`;
  return decide('seat', workspaceId, ent.tier, ent.source, reason, ctx);
}

/** Workspace-count gate for workspace-create — allowed while existing < entitled. */
export async function requireWorkspaceSlot(workspaceId: string, existingWorkspaces: number, ctx = ''): Promise<GateResult> {
  const ent = await resolveEntitlements(workspaceId);
  if (existingWorkspaces < ent.workspaces) return { allowed: true };
  const reason = `Workspace limit reached (${ent.workspaces}) on the ${ent.tier} plan.`;
  return decide('workspace', workspaceId, ent.tier, ent.source, reason, ctx);
}

function decide(
  what: string,
  workspaceId: string,
  tier: string,
  source: string,
  reason: string,
  ctx: string,
): GateResult {
  const detail = `${what}${ctx ? ` @ ${ctx}` : ''} for ws=${workspaceId} (tier=${tier}, source=${source})`;
  if (!config.ENFORCE_ENTITLEMENTS) {
    // eslint-disable-next-line no-console
    console.warn(`[entitlement] would block ${detail} — report-only`);
    return { allowed: true, wouldBlock: true, reason };
  }
  // eslint-disable-next-line no-console
  console.warn(`[entitlement] BLOCKED ${detail} — enforced (402)`);
  return { allowed: false, reason };
}

/**
 * A3.1 registration gate for the community unlock set (`history`, `export`).
 * Unlike requireFeature, this ALWAYS enforces — it is a pre-launch product
 * definition (registered vs unregistered), not the cautious ENFORCE_ENTITLEMENTS
 * rollout for graph/meetings. Returns a 402-ready result pointing at registration.
 */
export async function requireRegisteredFeature(workspaceId: string, feature: Feature): Promise<GateResult> {
  if (await hasFeature(workspaceId, feature)) return { allowed: true };
  const label = feature === 'history' ? 'Version history' : feature === 'export' ? 'Document export' : feature;
  return {
    allowed: false,
    reason: `${label} is included free with a community license — register in Settings → "Get your free community license".`,
  };
}
