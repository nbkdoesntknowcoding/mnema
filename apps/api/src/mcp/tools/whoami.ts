/**
 * whoami — identity + org role of the user the request is acting as.
 *
 * The meeting bot resolves the speaker to a Mnema user (act-as); this lets it (and any
 * MCP client) answer "who am I / what's my role / what can I access" with the real org
 * profile — title, role, team, department, and workspace-level access — instead of just a
 * name. Read-only; bounded to the acting user in the current workspace.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users, userOrgProfiles, orgRoles, teams, workspaceMembers } from '../../db/schema.js';
import type { McpAuthContext } from '../auth.js';

export const WHOAMI_TOOL = {
  name: 'whoami',
  description: [
    'Identity of the person you are currently talking to: their name, job title, org role,',
    'team, department and workspace access. Call this when someone asks who they are, what',
    'their role/title/team is, or what they can access. Available in all workspace modes.',
  ].join('\n'),
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, title: 'Who am I' },
};

const ACCESS_NOTE: Record<string, string> = {
  owner: 'full access to everything in the workspace',
  editor: 'can view and edit across the workspace',
  viewer: 'read-only access to the projects they are a member of',
};

export async function whoami(ctx: McpAuthContext) {
  const userId = ctx.user_id;
  if (!userId) {
    return { content: "I don't have you identified in this workspace yet, so I can't share a role.", structuredContent: { identified: false } };
  }

  const [u] = await db.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db
    .select({ title: userOrgProfiles.displayTitle, roleSlug: userOrgProfiles.roleSlug, department: userOrgProfiles.department, orgRoleId: userOrgProfiles.orgRoleId })
    .from(userOrgProfiles)
    .where(and(eq(userOrgProfiles.userId, userId), eq(userOrgProfiles.workspaceId, ctx.tenant_id)))
    .limit(1);
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, ctx.tenant_id)))
    .limit(1);

  let roleName: string | null = null;
  let teamName: string | null = null;
  if (profile?.orgRoleId) {
    const [r] = await db.select({ name: orgRoles.name, teamId: orgRoles.teamId }).from(orgRoles).where(eq(orgRoles.id, profile.orgRoleId)).limit(1);
    roleName = r?.name ?? null;
    if (r?.teamId) {
      const [t] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, r.teamId)).limit(1);
      teamName = t?.name ?? null;
    }
  }

  const name = u?.name || u?.email || 'this person';
  const title = profile?.title || roleName || null;
  const wsRole = member?.role ?? null;

  const parts: string[] = [`You are ${name}`];
  if (title) parts.push(title);
  if (teamName) parts.push(`on the ${teamName} team`);
  if (profile?.department) parts.push(`in ${profile.department}`);
  let content = parts.join(', ') + '.';
  if (wsRole) content += ` As a workspace ${wsRole}, you have ${ACCESS_NOTE[wsRole] ?? 'your assigned access'}.`;

  return {
    content,
    structuredContent: {
      identified: true,
      name, email: u?.email ?? null,
      title, role: roleName, role_slug: profile?.roleSlug ?? null,
      team: teamName, department: profile?.department ?? null,
      workspace_role: wsRole,
    },
  };
}
