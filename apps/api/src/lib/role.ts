import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { db } from '../db/index.js';
import { projectMembers, workspaceMembers } from '../db/schema.js';

/**
 * Application-layer role enforcement for `/api/*` route handlers.
 *
 * RLS doesn't know about roles — it only knows about `tenant_id`. Role
 * gating is therefore application-layer, called explicitly at each
 * protected endpoint. The surface is small (a few mutation endpoints in
 * 4.1, plus settings) so explicit > implicit.
 *
 * Strict ordering:
 *   viewer < editor < owner
 *
 * The `admin` enum value is reserved (Phase 5 may slot it between editor
 * and owner) but we never check for it in 4.1.
 */

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export class RoleError extends Error {
  constructor(
    public readonly reason: 'not_authenticated' | 'not_a_member' | string,
    public readonly status: number,
  ) {
    super(reason);
    this.name = 'RoleError';
  }
}

/**
 * Phase A (IAM) — the user's workspace role as a bare string for the IAM fall-through
 * (lib/iam.ts), '' when not a member. Takes `db` to match the IAM call signature;
 * resolution itself uses the shared client via getUserRole.
 */
export async function getWorkspaceRole(
  _db: unknown,
  userId: string,
  workspaceId: string,
): Promise<string> {
  return (await getUserRole(userId, workspaceId)) ?? '';
}

export async function getUserRole(
  userId: string,
  workspaceId: string,
): Promise<Role | null> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const r = rows[0]?.role;
  if (!r) return null;
  // All four workspace roles are now first-class (admin slots between editor and owner).
  if (r === 'owner' || r === 'admin' || r === 'editor' || r === 'viewer') return r;
  // Anything unexpected → treat as not a member for safety.
  return null;
}

/**
 * Throws RoleError if the request is unauthenticated, the user isn't a
 * member of the active tenant, or their role is below `minimumRole`.
 * Returns the actual role on success so callers can branch on it.
 */
export async function requireRole(
  req: FastifyRequest,
  minimumRole: Role,
): Promise<Role> {
  if (!req.auth) throw new RoleError('not_authenticated', 401);
  const role = await getUserRole(req.auth.sub, req.auth.tenant_id);
  if (!role) throw new RoleError('not_a_member', 403);
  if (ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
    throw new RoleError(`requires_${minimumRole}`, 403);
  }
  return role;
}

// ── Stage B5: per-project roles ────────────────────────────────────────────
//
// Mirrors the workspace helpers above but for `project_members`. The effective
// model matches the RLS predicate `app_can_see_project` (migrations 0049/0051):
//   • workspace owner/admin are workspace admins → they implicitly have the
//     highest project role on EVERY project, even without a project_members row.
//     (Editors were narrowed OUT of this bypass in 0051 — they are now
//     project-bounded and gain a project only via membership or a doc_acl grant.)
//   • otherwise the role comes from the user's project_members row (if any).
// Project roles are a 3-rung ladder: viewer < editor < admin.

export type ProjectRole = 'viewer' | 'editor' | 'admin';

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, admin: 2 };

/** True for workspace roles that see/manage every project (the RLS admin bypass).
 *  Mirrors the DB `app_is_workspace_admin()` predicate, narrowed to `IN ('owner','admin')`
 *  in 0051 so editors are project-bounded (FIX 3). Editors now resolve their project
 *  role from project_members / doc_acl, not a blanket bypass. */
function isWorkspaceAdminRole(role: Role | null): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * The user's effective role on a project, or null if they can't access it.
 * Workspace admins resolve to 'admin' on any project in their workspace.
 */
export async function getProjectRole(
  userId: string,
  workspaceId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  // Workspace-level admins bypass project membership entirely.
  const wsRole = await getUserRole(userId, workspaceId);
  if (isWorkspaceAdminRole(wsRole)) return 'admin';

  const rows = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  const r = rows[0]?.role;
  if (r === 'admin' || r === 'editor' || r === 'viewer') return r;
  // 'owner' isn't a valid project role; treat anything else as no access.
  return null;
}

/**
 * Throws RoleError if the request is unauthenticated, the user can't access
 * `projectId` in the active tenant, or their effective project role is below
 * `minimumRole`. Returns the effective role on success.
 */
export async function requireProjectRole(
  req: FastifyRequest,
  projectId: string,
  minimumRole: ProjectRole,
): Promise<ProjectRole> {
  if (!req.auth) throw new RoleError('not_authenticated', 401);
  const role = await getProjectRole(req.auth.sub, req.auth.tenant_id, projectId);
  if (!role) throw new RoleError('not_a_project_member', 403);
  if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK[minimumRole]) {
    throw new RoleError(`requires_project_${minimumRole}`, 403);
  }
  return role;
}
