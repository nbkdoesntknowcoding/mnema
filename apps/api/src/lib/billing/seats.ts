/**
 * Billable seat counting.
 *
 * Only "writer" roles count toward the billable seat total.
 * Roles: owner, admin, editor → billable (can create/edit content)
 *        viewer              → free
 *
 * This is the single source of truth used when creating or updating
 * a Razorpay subscription's quantity.
 */

import { eq, inArray, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceMembers } from '../../db/schema.js';

/** Roles that are billed as writer seats. */
export const WRITER_ROLES = ['owner', 'admin', 'editor'] as const satisfies readonly ('owner' | 'admin' | 'editor' | 'viewer')[];
export type WriterRole = (typeof WRITER_ROLES)[number];

/**
 * Count the billable (writer) seats in a workspace.
 * Minimum of 1 — a workspace always has at least one billable member.
 */
export async function countBillableSeats(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ id: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.role, [...WRITER_ROLES]),
      ),
    );

  return Math.max(1, rows.length);
}
