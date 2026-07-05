import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import { graphNodes, meetingRecords, meetings, projects, workspaces } from '../db/schema.js';
import {
  createMeetingRecord, getMeetingRecord, deleteMeetingRecord, deriveAclScope, recordInputFromSummary,
} from '../lib/meeting-records.js';

/**
 * Aspect 6 / M1 — episodic meeting-record store. Covers the gate: a record persists, is
 * retrievable, is ACL-scoped, is graph-linked (discrete decision nodes), idempotent on
 * re-consolidation, and right-to-be-forgotten removes the linked semantic nodes.
 */
let stamp: number;
let wsId: string;
let projectId: string;
let meetingId: string;        // workspace-scoped meeting (no project)
let projMeetingId: string;    // project-scoped meeting

beforeAll(async () => {
  stamp = Date.now();
  const [ws] = await db.insert(workspaces).values({ slug: `mr-${stamp}`, name: 'MR Test' }).returning();
  wsId = ws!.id;
  const [proj] = await db.insert(projects).values({ workspaceId: wsId, slug: `mr-proj-${stamp}`, name: 'MR Project' }).returning();
  projectId = proj!.id;
  const [m1] = await db.insert(meetings).values({ workspaceId: wsId, title: 'Standup' }).returning();
  meetingId = m1!.id;
  const [m2] = await db.insert(meetings).values({ workspaceId: wsId, projectId, title: 'Project sync' }).returning();
  projMeetingId = m2!.id;
});

afterAll(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, wsId)); // cascades records/meetings/projects
});

describe('M1 meeting records', () => {
  it('deriveAclScope: project else workspace', () => {
    expect(deriveAclScope('p1', 'w1')).toBe('project:p1');
    expect(deriveAclScope(null, 'w1')).toBe('workspace:w1');
  });

  it('M2 recordInputFromSummary: maps summary, derives commitments from owned action items', () => {
    const m = { id: 'm1', projectId: null, title: 'Standup', startedAt: new Date(), endedAt: new Date(), postMeetingDocId: 'doc-9' };
    const inp = recordInputFromSummary(
      m,
      { keyPoints: ['shipped', 'reviewed'], decisions: ['ship Friday'],
        actionItems: [{ text: 'email the deck', owner: 'Nischay' }, { text: 'tidy backlog', owner: null }] },
      [{ name: 'Nischay' }],
    );
    expect(inp.summary).toBe('shipped reviewed');
    expect(inp.decisions).toEqual(['ship Friday']);
    expect(inp.commitments).toEqual([{ who: 'Nischay', what: 'email the deck' }]); // only the owned one
    expect(inp.sourceRefs).toMatchObject({ postMeetingDocId: 'doc-9' });
    // null summary degrades, not "unknown"
    expect(recordInputFromSummary(m, null, []).summary).toBeNull();
  });

  it('writes a record, reads it back, with timestamps + acl_scope + decisions', async () => {
    const started = new Date('2026-06-25T10:00:00Z');
    const ended = new Date('2026-06-25T10:30:00Z');
    const { recordId: id } = await createMeetingRecord(db, wsId, {
      meetingId, title: 'Standup', startedAt: started, endedAt: ended,
      summary: 'Quick standup.', decisions: ['Ship Friday', 'Drop the v1 flag'],
      actionItems: [{ text: 'email the deck', owner: 'Nischay' }],
      commitments: [{ who: 'Nischay', what: 'email the deck' }],
      sourceRefs: { transcriptDocId: 'doc-1' },
    });
    const rec = await getMeetingRecord(db, wsId, { id });
    expect(rec).toBeTruthy();
    expect(rec!.startedAt?.toISOString()).toBe(started.toISOString());
    expect(rec!.endedAt?.toISOString()).toBe(ended.toISOString());
    expect(rec!.aclScope).toBe(`workspace:${wsId}`);   // no project
    expect(rec!.decisions).toEqual(['Ship Friday', 'Drop the v1 flag']);
    expect(rec!.commitments).toEqual([{ who: 'Nischay', what: 'email the deck' }]);
    // read by meetingId too
    expect((await getMeetingRecord(db, wsId, { meetingId }))!.id).toBe(id);
  });

  it('creates discrete decision graph nodes (one per decision), PROPOSED (Phase 3a human-verify gate)', async () => {
    // Converged onto recordDecision: nodes are content-hash keyed (decision:<hash>) + linked to the
    // meeting via decided_in, and land 'proposed' (not 'current') until a human confirms.
    const nodes = await db.select().from(graphNodes).where(and(
      eq(graphNodes.workspaceId, wsId), eq(graphNodes.entityType, 'decision'),
      eq(graphNodes.decidedIn, meetingId),
    ));
    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.label).sort()).toEqual(['Drop the v1 flag', 'Ship Friday']);
    expect(nodes.every((n) => n.status === 'proposed')).toBe(true);
  });

  it('project-scoped meeting → acl_scope project:<id>', async () => {
    const { recordId: id } = await createMeetingRecord(db, wsId, { meetingId: projMeetingId, projectId, title: 'Project sync', decisions: [] });
    expect((await getMeetingRecord(db, wsId, { id }))!.aclScope).toBe(`project:${projectId}`);
  });

  it('is idempotent on meeting_id (re-consolidation updates the record, never duplicates)', async () => {
    await createMeetingRecord(db, wsId, { meetingId, title: 'Standup', decisions: ['Ship Friday'] }); // was 2 decisions → now 1
    const rows = await db.select().from(meetingRecords).where(eq(meetingRecords.meetingId, meetingId));
    expect(rows.length).toBe(1);                       // not duplicated
    expect(rows[0]!.decisions).toEqual(['Ship Friday']);
  });

  it('right-to-be-forgotten: delete removes the record AND its converged decision nodes', async () => {
    const rec = await getMeetingRecord(db, wsId, { meetingId });
    expect(await deleteMeetingRecord(db, wsId, rec!.id)).toBe(true);
    expect(await getMeetingRecord(db, wsId, { meetingId })).toBeNull();
    const decNodes = await db.select().from(graphNodes).where(and(
      eq(graphNodes.workspaceId, wsId), eq(graphNodes.entityType, 'decision'),
      eq(graphNodes.decidedIn, meetingId),
    ));
    expect(decNodes.length).toBe(0);
  });
});
