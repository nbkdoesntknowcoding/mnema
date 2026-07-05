import { and, eq, isNull } from 'drizzle-orm';
import { folders } from '../db/schema.js';

/**
 * Returns true if making folderId's parent = newParentId would create a cycle.
 * A cycle exists if newParentId is folderId itself or any descendant of folderId.
 * Walk UP from newParentId toward root — if we encounter folderId, it's a cycle.
 */
export async function wouldCreateCycle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  workspaceId: string,
  folderId: string,
  newParentId: string | null,
): Promise<boolean> {
  if (newParentId === null) return false;      // root is never a cycle
  if (newParentId === folderId) return true;   // self-parent

  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) break; // defensive: stop on existing corruption
    seen.add(cursor);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await db
      .select({ parentFolderId: folders.parentFolderId })
      .from(folders)
      .where(
        and(
          eq(folders.id, cursor),
          eq(folders.workspaceId, workspaceId),
          isNull(folders.deletedAt),
        ),
      )
      .limit(1);
    cursor = rows[0]?.parentFolderId ?? null;
  }
  return false;
}
