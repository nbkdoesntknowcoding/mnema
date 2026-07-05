/**
 * Aspect 6 / M3 — ACL-scoped start-brief assembler. At bot-join the bot calls get_meeting_brief
 * (mcp/tools/meeting-brief.ts), which runs this server-side so the heavy work stays off the
 * device. It gathers the episodic record(s) — the last meeting on this project + related
 * meetings — ACL-FILTERS them to the room's shared least-privilege scope, temporally orders,
 * token-caps, and returns plain spoken text. The bot speaks it once at start.
 *
 * G-ACL (hard gate): the brief is spoken aloud to the WHOLE room, so it may surface only what
 * EVERY attendee is entitled to see. A record scoped to a project an attendee can't access (or
 * any unidentified attendee in the room) is excluded — fail-closed.
 * G-DEGRADE: no records pass / no attendees / no meeting → empty brief (the bot falls back to
 * its semantic-only behaviour); never fabricates.
 *
 * NOTE: M3 covers the episodic RECORDS (the gated surface). "Recent shared activity" (task
 * transitions / doc edits) is a bounded follow-up; it does not change the ACL gate.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { meetingRecords, meetings, meetingParticipants } from '../db/schema.js';
import { canAccess } from './iam.js';
import { getWorkspaceRole } from './role.js';

type Rec = typeof meetingRecords.$inferSelect;

/**
 * Is a record's acl_scope visible to the WHOLE room? Fail-closed: any unidentified attendee,
 * or any attendee who can't access the scope, → false. project:<id> → every attendee needs
 * read on the project; workspace:<id> → every attendee must be a workspace member.
 */
export async function roomCanSeeScope(
  db: Database, workspaceId: string, aclScope: string,
  attendeeUserIds: string[], hasUnidentified: boolean,
): Promise<boolean> {
  if (hasUnidentified || attendeeUserIds.length === 0) return false;
  if (aclScope.startsWith('project:')) {
    const projectId = aclScope.slice('project:'.length);
    for (const uid of attendeeUserIds) {
      if (!(await canAccess(db, uid, workspaceId, 'project', projectId, 'read'))) return false;
    }
    return true;
  }
  if (aclScope === `workspace:${workspaceId}`) {
    for (const uid of attendeeUserIds) {
      if (!(await getWorkspaceRole(db, uid, workspaceId))) return false; // '' = not a member
    }
    return true;
  }
  return false; // unknown scope → fail-closed
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function renderRecordLine(r: Rec): string {
  const when = fmtDate(r.endedAt ?? r.startedAt);
  const what = (r.summary && r.summary.trim())
    || (r.decisions.length ? `you decided ${r.decisions.slice(0, 2).join('; ')}` : '')
    || (r.actionItems.length ? `${r.actionItems.length} action items came out of it` : 'nothing was captured');
  const head = r.title || 'a meeting';
  return when ? `${head} on ${when}: ${what}.` : `${head}: ${what}.`;
}

export interface MeetingBrief { text: string; recordCount: number }

/**
 * Assemble the room-safe start brief for `meetingId`. Returns empty when there's nothing the
 * whole room may hear (G-DEGRADE → the bot uses its semantic-only fallback).
 */
export async function assembleMeetingBrief(
  db: Database, workspaceId: string, meetingId: string, opts: { maxRecords?: number; maxChars?: number } = {},
): Promise<MeetingBrief> {
  const empty: MeetingBrief = { text: '', recordCount: 0 };
  const meeting = await db.query.meetings.findFirst({
    where: and(eq(meetings.id, meetingId), eq(meetings.workspaceId, workspaceId)),
  });
  if (!meeting) return empty; // no metadata → no brief

  // Attendees → resolved user ids; any unidentified (or none) → conservative.
  const parts = await db.select({ uid: meetingParticipants.resolvedUserId })
    .from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
  const attendeeUserIds = [...new Set(parts.map((p) => p.uid).filter((x): x is string => !!x))];
  const hasUnidentified = parts.length === 0 || parts.some((p) => !p.uid);
  if (attendeeUserIds.length === 0) return empty;

  // Candidates: last meeting record(s) on this project + records of linked/related meetings.
  const projectRecords = meeting.projectId
    ? await db.select().from(meetingRecords).where(and(
        eq(meetingRecords.workspaceId, workspaceId),
        eq(meetingRecords.projectId, meeting.projectId),
        ne(meetingRecords.meetingId, meetingId),
      )).orderBy(desc(meetingRecords.endedAt)).limit(5)
    : [];
  const linked = (meeting.linkedMeetingIds ?? []).filter((x): x is string => !!x);
  const relatedRecords = linked.length
    ? await db.select().from(meetingRecords).where(and(
        eq(meetingRecords.workspaceId, workspaceId),
        inArray(meetingRecords.meetingId, linked),
      ))
    : [];

  // Dedup by meeting, ACL-filter (the gate), temporally order, token-cap.
  const seen = new Set<string>();
  const candidates = [...projectRecords, ...relatedRecords].filter((r) => {
    if (r.meetingId === meetingId || seen.has(r.meetingId)) return false;
    seen.add(r.meetingId);
    return true;
  });
  const visible: Rec[] = [];
  for (const r of candidates) {
    if (await roomCanSeeScope(db, workspaceId, r.aclScope, attendeeUserIds, hasUnidentified)) visible.push(r);
  }
  if (visible.length === 0) return empty;

  visible.sort((a, b) => (b.endedAt?.getTime() ?? b.startedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? a.startedAt?.getTime() ?? 0));
  const top = visible.slice(0, opts.maxRecords ?? 3);
  const text = `Picking up where we left off. ${top.map(renderRecordLine).join(' ')}`.slice(0, opts.maxChars ?? 700);
  return { text, recordCount: top.length };
}
