/**
 * Phase A (A2) — IAM resolution middleware.
 *
 * Resolves effective permission for a user on any resource. Called from doc fetch,
 * folder list, and any data access path. Returns 'admin' | 'write' | 'read' | 'none'
 * | null; null = no explicit policy → fall through to workspace_role check.
 *
 * (Adapted to our stack: postgres-js `db.execute` returns a row array directly, so
 *  we read `result[0]`, not `result.rows[0]`.)
 */
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { docs } from '../db/schema.js';
import { getWorkspaceRole } from './role.js';

type DB = Database;
type Permission = 'admin' | 'write' | 'read' | 'none';

export async function resolvePermission(
  db: DB,
  userId: string,
  workspaceId: string,
  resourceType: 'doc' | 'folder' | 'project',
  resourceId: string,
): Promise<Permission | null> {
  const result = await db.execute(sql`
    SELECT app_effective_permission(
      ${userId}::uuid,
      ${workspaceId}::uuid,
      ${resourceType},
      ${resourceId}::uuid
    )
  `);
  const row = (result as unknown as Array<{ app_effective_permission: Permission | null }>)[0];
  return row?.app_effective_permission ?? null;
}

// The full access check used at every API boundary:
// 1. Workspace membership check (RLS — already enforced)
// 2. doc_acl check at doc level
// 3. doc_acl check at folder level (if doc has parent folder)
// 4. doc_acl check at project level (if doc is in a project)
// Most restrictive wins. 'none' at any level = denied.

export async function canAccess(
  db: DB,
  userId: string,
  workspaceId: string,
  resourceType: 'doc' | 'folder' | 'project',
  resourceId: string,
  required: 'read' | 'write' | 'admin',
): Promise<boolean> {
  // First: check for explicit deny at this resource
  const direct = await resolvePermission(db, userId, workspaceId, resourceType, resourceId);
  if (direct === 'none') return false;

  // If doc: also check folder and project chain
  if (resourceType === 'doc') {
    const doc = await db.query.docs.findFirst({ where: eq(docs.id, resourceId) });
    if (doc?.folderId) {
      const folderPerm = await resolvePermission(db, userId, workspaceId, 'folder', doc.folderId);
      if (folderPerm === 'none') return false;
    }
    if (doc?.projectId) {
      const projectPerm = await resolvePermission(db, userId, workspaceId, 'project', doc.projectId);
      if (projectPerm === 'none') return false;
    }
  }

  // Collect effective permission
  const permRank: Record<Permission, number> = { admin: 3, write: 2, read: 1, none: 0 };
  const requiredRank = permRank[required];

  // If explicit policy exists, use it ('none' already returned above)
  if (direct) {
    return permRank[direct] >= requiredRank;
  }

  // Fall through to workspace_role
  const wsRole = await getWorkspaceRole(db, userId, workspaceId);
  // H1 fix: 'admin' must rank with 'owner' (full access), matching the RLS
  // app_is_workspace_admin() bypass. Omitting it 403'd admins on every doc.
  const wsRoleMap: Record<string, number> = { owner: 3, admin: 3, editor: 2, viewer: 1 };
  return (wsRoleMap[wsRole] ?? 0) >= requiredRank;
}
