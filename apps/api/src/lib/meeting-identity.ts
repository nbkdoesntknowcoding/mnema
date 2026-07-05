/**
 * Resolve a meeting attendee to a Mnema user, the same way the live MCP boundary
 * does: email (calendar match) → saved name alias → null (unmapped / guest).
 * Bounded to a single workspace. Shared by the bot-capture and the verified Recall
 * webhook so both compute resolution identically.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { participantAliases, users, workspaceMembers } from '../db/schema.js';

export async function resolveAttendee(
  workspaceId: string,
  email: string | null,
  name: string | null,
): Promise<string | null> {
  if (email && email.trim()) {
    const rows = await db
      .select({ userId: users.id })
      .from(users)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, users.id),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .where(eq(users.email, email.trim()))
      .limit(1);
    if (rows[0]?.userId) return rows[0].userId;
  }
  if (name && name.trim()) {
    const rows = await db
      .select({ userId: participantAliases.userId })
      .from(participantAliases)
      .where(
        and(
          eq(participantAliases.workspaceId, workspaceId),
          eq(participantAliases.displayName, name.trim()),
        ),
      )
      .limit(1);
    if (rows[0]?.userId) return rows[0].userId;
  }
  return null;
}
