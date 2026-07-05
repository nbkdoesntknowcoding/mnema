import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/index.js';
import {
  docAcl, meetings, meetingParticipants, projects, users, workspaceMembers, workspaces,
} from '../db/schema.js';
import { createMeetingRecord } from '../lib/meeting-records.js';
import { assembleMeetingBrief, roomCanSeeScope } from '../lib/meeting-brief.js';

/**
 * Aspect 6 / M3 — ACL-scoped start brief. The hard gate (G-ACL): in a mixed-privilege room
 * the brief must EXCLUDE every item outside the room's shared least-privilege scope.
 *
 * Setup: workspace with attendee1 + attendee2 (both members). projectB is DENIED to attendee2
 * (doc_acl 'none'). The current meeting (in projectA, attended by both) is linked to a past
 * meeting in projectA, one in projectB, and one workspace-scoped. The brief must surface the
 * projectA + workspace records and NEVER the projectB one.
 */
let stamp: number;
let wsId: string, a1: string, a2: string, projA: string, projB: string;
let currentId: string, soloMeetingId: string, emptyMeetingId: string;

async function mkMeeting(projectId: string | null, title: string, linked: string[] = []): Promise<string> {
  const [m] = await db.insert(meetings).values({ workspaceId: wsId, projectId, title, linkedMeetingIds: linked }).returning();
  return m!.id;
}

beforeAll(async () => {
  stamp = Date.now();
  const [ws] = await db.insert(workspaces).values({ slug: `mb-${stamp}`, name: 'MB Test' }).returning();
  wsId = ws!.id;
  const [u1] = await db.insert(users).values({ email: `mb-a1-${stamp}@t.test`, displayName: 'Attendee One' }).returning();
  const [u2] = await db.insert(users).values({ email: `mb-a2-${stamp}@t.test`, displayName: 'Attendee Two' }).returning();
  a1 = u1!.id; a2 = u2!.id;
  await db.insert(workspaceMembers).values([
    { workspaceId: wsId, userId: a1, role: 'editor' },
    { workspaceId: wsId, userId: a2, role: 'editor' },
  ]);
  const [pA] = await db.insert(projects).values({ workspaceId: wsId, slug: `mb-a-${stamp}`, name: 'Project A' }).returning();
  const [pB] = await db.insert(projects).values({ workspaceId: wsId, slug: `mb-b-${stamp}`, name: 'Project B' }).returning();
  projA = pA!.id; projB = pB!.id;
  // attendee2 is DENIED project B.
  await db.insert(docAcl).values({
    workspaceId: wsId, resourceType: 'project', resourceId: projB, principalType: 'user', principalId: a2, permission: 'none',
  });

  // Past meetings + their episodic records.
  const pastA = await mkMeeting(projA, 'Alpha sync');
  const pastB = await mkMeeting(projB, 'Bravo sync');
  const wsPast = await mkMeeting(null, 'Town hall');
  await createMeetingRecord(db, wsId, { meetingId: pastA, projectId: projA, title: 'Alpha sync', summary: 'alpha recap text', decisions: ['ship alpha'] });
  await createMeetingRecord(db, wsId, { meetingId: pastB, projectId: projB, title: 'Bravo sync', summary: 'BRAVO-SECRET recap', decisions: ['drop bravo'] });
  await createMeetingRecord(db, wsId, { meetingId: wsPast, projectId: null, title: 'Town hall', summary: 'townhall recap text' });

  // Current meeting (projectA), linked to the other two so all three are candidates.
  currentId = await mkMeeting(projA, 'Today Alpha', [pastB, wsPast]);
  await db.insert(meetingParticipants).values([
    { meetingId: currentId, recallParticipantId: 'p1', name: 'Attendee One', resolvedUserId: a1 },
    { meetingId: currentId, recallParticipantId: 'p2', name: 'Attendee Two', resolvedUserId: a2 },
  ]);

  // A meeting with an UNIDENTIFIED attendee (degrade case).
  soloMeetingId = await mkMeeting(projA, 'Guest meeting', [pastB]);
  await db.insert(meetingParticipants).values({ meetingId: soloMeetingId, recallParticipantId: 'g1', name: 'Guest', resolvedUserId: null });

  // A meeting with attendees but no prior records (degrade case).
  emptyMeetingId = await mkMeeting(null, 'Fresh meeting');
  await db.insert(meetingParticipants).values({ meetingId: emptyMeetingId, recallParticipantId: 'p1', resolvedUserId: a1 });
});

afterAll(async () => { await db.delete(workspaces).where(eq(workspaces.id, wsId)); });

describe('M3 ACL-scoped meeting brief', () => {
  it('roomCanSeeScope: project A allowed, project B denied to attendee2, workspace allowed', async () => {
    const room = [a1, a2];
    expect(await roomCanSeeScope(db, wsId, `project:${projA}`, room, false)).toBe(true);
    expect(await roomCanSeeScope(db, wsId, `project:${projB}`, room, false)).toBe(false); // a2 denied
    expect(await roomCanSeeScope(db, wsId, `workspace:${wsId}`, room, false)).toBe(true);
    expect(await roomCanSeeScope(db, wsId, `project:${projA}`, room, true)).toBe(false);  // unidentified present
    expect(await roomCanSeeScope(db, wsId, 'bogus', room, false)).toBe(false);            // unknown scope fail-closed
  });

  it('G-ACL: brief includes projectA + workspace records, NEVER the denied projectB one', async () => {
    const brief = await assembleMeetingBrief(db, wsId, currentId);
    expect(brief.recordCount).toBeGreaterThan(0);
    expect(brief.text).toContain('Alpha sync');
    expect(brief.text).toContain('Town hall');
    // the hard gate — nothing from project B may ever appear:
    expect(brief.text).not.toContain('Bravo');
    expect(brief.text).not.toContain('BRAVO-SECRET');
    expect(brief.text).not.toContain('drop bravo');
  });

  it('G-DEGRADE: an unidentified attendee → empty brief (never leaks)', async () => {
    const brief = await assembleMeetingBrief(db, wsId, soloMeetingId);
    expect(brief).toEqual({ text: '', recordCount: 0 });
  });

  it('G-DEGRADE: no prior records → empty brief', async () => {
    const brief = await assembleMeetingBrief(db, wsId, emptyMeetingId);
    expect(brief).toEqual({ text: '', recordCount: 0 });
  });
});
