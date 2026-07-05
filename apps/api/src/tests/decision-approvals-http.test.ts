/**
 * Phase 3b — HTTP integration test for the proposer-only authz on the decision confirm/reject
 * endpoint. Exercises the REAL route + REAL auth middleware via app.inject (a minimal Fastify app
 * registering authPlugin + decisionApprovalsRoutes — same plugins as server.ts), with Bearer JWTs
 * minted by the real signJwt for two identities: the proposer (A) and a non-proposer who is even a
 * workspace ADMIN (B). Proves the 403 boundary that verify-decision-approvals.ts (DB/logic level)
 * does not cover.
 *
 * TEST-ONLY — no endpoint/authz/schema change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces, users, workspaceMembers, graphNodes, docs, decisionApprovals } from '../db/schema.js';
import { recordDecision } from '../lib/decisions.js';
import { signJwt } from '../lib/jwt.js';
import { authPlugin } from '../plugins/auth.js';
import { decisionApprovalsRoutes } from '../routes/decision-approvals.js';

const NONEXISTENT = '00000000-0000-0000-0000-000000000000';

let app: FastifyInstance;
let wsId = '', userA = '', userB = '', tokenA = '', tokenB = '';
let apprConfirm = '', apprReject = '';
let baseNodeId = '', propNodeId = '', rejectNodeId = '', rejectDocId = '';

const node = (id: string) => db.query.graphNodes.findFirst({ where: eq(graphNodes.id, id) });
const appr = (id: string) => db.query.decisionApprovals.findFirst({ where: eq(decisionApprovals.id, id) });
const docRow = (id: string) => db.query.docs.findFirst({ where: eq(docs.id, id) });
const tok = (sub: string) => signJwt({ sub, tenant_id: wsId, scopes: ['workspace:read', 'workspace:write'], email: `${sub}@t.dev` });

beforeAll(async () => {
  const s = Date.now();
  const [ws] = await db.insert(workspaces).values({ slug: `da-${s}`, name: 'DA HTTP Test' }).returning();
  wsId = ws!.id;
  const [a] = await db.insert(users).values({ email: `a-${s}@test.dev`, displayName: 'Proposer A' }).returning();
  const [b] = await db.insert(users).values({ email: `b-${s}@test.dev`, displayName: 'Admin Outsider B' }).returning();
  userA = a!.id; userB = b!.id;
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: userA, role: 'owner' });
  await db.insert(workspaceMembers).values({ workspaceId: wsId, userId: userB, role: 'admin' }); // admin, but NOT the proposer
  tokenA = await tok(userA); tokenB = await tok(userB);

  app = Fastify();
  await app.register(authPlugin);
  await app.register(decisionApprovalsRoutes);
  await app.ready();

  // proposed decision superseding a current one + its approval (proposer = A)
  const base = await recordDecision(wsId, { decisionText: `[DA-TEST ${s}] base current` });
  baseNodeId = base.nodeId;
  const prop = await recordDecision(wsId, { decisionText: `[DA-TEST ${s}] proposed superseding base`, status: 'proposed', supersedes: base.nodeId });
  propNodeId = prop.nodeId;
  const [c] = await db.insert(decisionApprovals).values({
    workspaceId: wsId, decisionNodeId: prop.nodeId, docId: prop.docId, proposerId: userA, supersedesTarget: base.nodeId, status: 'pending',
  }).returning();
  apprConfirm = c!.id;

  // a separate proposed decision for the reject happy-path
  const prop2 = await recordDecision(wsId, { decisionText: `[DA-TEST ${s}] proposed to reject`, status: 'proposed' });
  rejectNodeId = prop2.nodeId; rejectDocId = prop2.docId;
  const [r] = await db.insert(decisionApprovals).values({
    workspaceId: wsId, decisionNodeId: prop2.nodeId, docId: prop2.docId, proposerId: userA, status: 'pending',
  }).returning();
  apprReject = r!.id;
});

afterAll(async () => {
  await app?.close();
  await db.delete(workspaces).where(eq(workspaces.id, wsId)); // cascades members/approvals/nodes/docs
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
});

const patch = (id: string, action: string, bearer?: string) => app.inject({
  method: 'PATCH', url: `/api/decision-approvals/${id}`,
  headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  payload: { action },
});

describe('PATCH /api/decision-approvals/:id — proposer-only authz', () => {
  // ── STEP 2: the 403 boundary (a non-proposer, even an admin, is denied + mutates nothing) ──
  it('403: a non-proposer (workspace ADMIN) cannot confirm — and nothing mutates', async () => {
    const res = await patch(apprConfirm, 'confirm', tokenB);
    expect(res.statusCode).toBe(403);
    expect((await node(propNodeId))?.status).toBe('proposed');     // not flipped
    expect((await node(baseNodeId))?.status).toBe('current');      // no supersede applied
    expect((await appr(apprConfirm))?.status).toBe('pending');     // approval untouched
  });

  it('403: a non-proposer cannot reject — decision not rejected, doc not soft-deleted', async () => {
    const res = await patch(apprReject, 'reject', tokenB);
    expect(res.statusCode).toBe(403);
    expect((await node(rejectNodeId))?.status).toBe('proposed');
    expect((await docRow(rejectDocId))?.deletedAt).toBeFalsy();
  });

  // ── STEP 4: unauth + edge cases ──
  it('401: unauthenticated (no token)', async () => {
    const res = await patch(apprConfirm, 'confirm');
    expect(res.statusCode).toBe(401);
  });

  it('400: bad action', async () => {
    const res = await patch(apprConfirm, 'nope', tokenA);
    expect(res.statusCode).toBe(400);
  });

  it('404: proposer, non-existent approval id (not a 500)', async () => {
    const res = await patch(NONEXISTENT, 'confirm', tokenA);
    expect(res.statusCode).toBe(404);
  });

  // ── STEP 3: the happy path (proposer succeeds) ──
  it('200: the PROPOSER confirms → proposed→current + deferred supersede applied', async () => {
    const res = await patch(apprConfirm, 'confirm', tokenA);
    expect(res.statusCode).toBe(200);
    expect((await node(propNodeId))?.status).toBe('current');
    expect((await node(baseNodeId))?.status).toBe('historical');   // applySupersede ran
    expect((await appr(apprConfirm))?.status).toBe('confirmed');
  });

  it('double-confirm is a clean no-op (NOT a second supersede) — already-resolved is non-pending', async () => {
    const res = await patch(apprConfirm, 'confirm', tokenA);
    expect(res.statusCode).not.toBe(200);     // 404: the route only resolves pending rows
    expect((await node(baseNodeId))?.status).toBe('historical');   // unchanged — no double-flip
    expect((await appr(apprConfirm))?.status).toBe('confirmed');   // still confirmed once
  });

  it('200: the PROPOSER rejects a separate decision → rejected + doc SOFT-deleted (row survives)', async () => {
    const res = await patch(apprReject, 'reject', tokenA);
    expect(res.statusCode).toBe(200);
    expect((await node(rejectNodeId))?.status).toBe('rejected');
    const d = await docRow(rejectDocId);
    expect(d).toBeTruthy();                    // tombstone, not hard-deleted
    expect(d?.deletedAt).toBeTruthy();         // soft-deleted → invisible to retrieval
    expect((await appr(apprReject))?.status).toBe('rejected');
  });
});
