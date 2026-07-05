import type {
  DocCreatePayload,
  DocFull,
  DocSavePayload,
  DocSaveResponse,
  DocSummary,
} from '@boppl/shared';

const API_URL =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ?? 'http://localhost:8080';

// ── Auth token store ──────────────────────────────────────────────────────────
// The JWT is httpOnly so JS can't read the cookie cross-origin. Astro SSR pages
// receive the JWT and pass it as a prop. Call setAuthToken() once on mount and
// every apiFetch / authHeaders() call will include Authorization: Bearer.
let _authToken: string | null = null;

export function setAuthToken(token: string): void {
  _authToken = token;
}

/** Returns `{ Authorization: 'Bearer <token>' }` when a token is set, else `{}`. */
export function authHeaders(): Record<string, string> {
  return _authToken ? { Authorization: `Bearer ${_authToken}` } : {};
}

interface FetchOptions extends Omit<RequestInit, 'body' | 'signal'> {
  body?: BodyInit | object;
  /**
   * Optional AbortSignal so callers (autocomplete in Phase 3.3) can cancel
   * in-flight requests on every keystroke. Forwarded to the underlying
   * fetch so the abort propagates through the network stack.
   */
  signal?: AbortSignal;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`API ${status}: ${message}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const isJsonObject =
    opts.body !== undefined &&
    typeof opts.body === 'object' &&
    !(opts.body instanceof FormData) &&
    !(opts.body instanceof Blob) &&
    !(opts.body instanceof ArrayBuffer);

  const init: RequestInit = {
    ...opts,
    credentials: 'include',
    headers: {
      // Only set a JSON content-type when there's actually a body. Sending
      // Content-Type: application/json with an EMPTY body makes Fastify reject
      // the request with a 400 ("Body cannot be empty…") before the route
      // handler runs — which broke every no-body POST (calendar sync, meeting
      // admit/ignore/dispatch).
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(opts.headers ?? {}),
    },
    body: isJsonObject ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),
    // Forward the AbortSignal so .abort() during autocomplete cancels the
    // network call instead of just discarding the resolved promise.
    signal: opts.signal,
  };

  // In the browser use relative paths so requests route through the Astro
  // proxy (pages/api/[...path].ts) which injects the JWT from the sealed
  // session cookie. On the server (SSR) hit API_URL directly.
  const base = typeof window === 'undefined' ? API_URL : '';
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    // Prefer the server's friendly `reason` (e.g. entitlement/cap 402s), then the
    // `error` code, then the raw body — so callers can show a human message.
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { reason?: string; error?: string };
      message = parsed.reason ?? parsed.error ?? message;
    } catch {
      // not JSON — keep the raw text
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Same as apiFetch but targets a same-origin (web) endpoint instead of the
 * API server. Used for endpoints like /auth/switch-workspace that need to
 * touch the web tier's sealed boppl_session cookie.
 */
async function webFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const isJsonObject =
    opts.body !== undefined &&
    typeof opts.body === 'object' &&
    !(opts.body instanceof FormData) &&
    !(opts.body instanceof Blob) &&
    !(opts.body instanceof ArrayBuffer);

  const init: RequestInit = {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
    body: isJsonObject ? JSON.stringify(opts.body) : (opts.body as BodyInit | undefined),
    signal: opts.signal,
  };
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text();
    // Prefer the server's friendly `reason` (e.g. entitlement/cap 402s), then the
    // `error` code, then the raw body — so callers can show a human message.
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { reason?: string; error?: string };
      message = parsed.reason ?? parsed.error ?? message;
    } catch {
      // not JSON — keep the raw text
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  doc_id: string;
}

export interface CompletionResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// Phase 4.1 types — invitations, members, workspaces.
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'editor' | 'viewer';

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
}

export interface MemberRow {
  userId: string;
  role: Role;
  email: string;
  displayName: string | null;
  joinedAt: string;
}

// Stage B5 — per-project access control.
export type ProjectRole = 'viewer' | 'editor' | 'admin';

export interface ProjectMemberRow {
  userId: string;
  role: ProjectRole;
  email: string;
  displayName: string | null;
  joinedAt: string;
}

// Phase B — Org / IAM.
export interface FolderAccess { folder_slug: string; permission: 'read' | 'write' | 'admin' | 'none' }
export interface OrgTeam { id: string; name: string; slug: string; description: string | null; parentTeamId: string | null; color: string | null }
export interface OrgRole { id: string; name: string; slug: string; teamId: string | null; workspaceRole: string; defaultFolderAccess: FolderAccess[] }
export interface OrgPerson { userId: string; displayName: string | null; email: string; displayTitle: string | null; roleSlug: string | null; department: string | null; botDisplayName: string | null }
export interface OrgFolder { id: string; name: string; slug: string | null; folderType: string | null }
export interface OrgGrant { id: string; resourceType: string; resourceId: string; principalType: string; principalId: string; permission: string }
export interface OrgAuditEntry { id: string; actorUserId: string | null; action: string; resourceType: string | null; resourceId: string | null; payload: unknown; createdAt: string }
export interface OrgStructure {
  teams: Array<{ name: string; slug?: string; parent_slug?: string | null; color?: string }>;
  roles: Array<{ name: string; slug?: string; team_slug?: string | null; workspace_role?: string; default_folder_access?: FolderAccess[] }>;
  people: Array<{ name: string; email?: string | null; department?: string | null; job_title?: string | null; manager_email?: string | null; role_slug?: string | null }>;
}

// Phase 2b — meetings + identity mapping.
export interface MeetingRow {
  id: string;
  title: string | null;
  meeting_url: string | null;
  started_at: string;
  ended_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  status: string | null;          // 'scheduled' | 'live' | 'ended' | 'ignored' | …
  admitted: boolean | null;
  calendar_event_id: string | null;
  participant_count: number;
  unresolved_count: number;
  // Whose meeting this is (calendar owner) — drives the per-person filter.
  organizer_user_id?: string | null;
  organizer_name?: string | null;
  // Phase 2 — post-meeting data availability (present after the API redeploys).
  transcript_status?: string | null; // 'none' | 'pending' | 'ready' | 'failed'
  post_meeting_doc_id?: string | null;
  has_summary?: boolean;
}

export interface JoinRequestRow {
  id: string;
  requester_id: string;
  requester_name: string | null;
  requester_email: string;
  created_at: string;
}

export interface MeetingSummary {
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ text: string; owner?: string | null }>;
}

export interface MeetingDetail {
  id: string;
  title: string | null;
  meeting_url: string | null;
  started_at: string;
  ended_at: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  status: string | null;
  admitted: boolean | null;
  summary: MeetingSummary | null;
  transcript_status: string;
  post_meeting_doc_id: string | null;
  pre_meeting_doc_id: string | null;
  meeting_folder_id: string | null;
  project_id: string | null;
  project_name: string | null;
}

export interface ProjectLite {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface MeetingTask {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
}

export interface LinkedMeeting {
  id: string;
  title: string | null;
  started_at: string | null;
  scheduled_start_at: string | null;
}

export interface TranscriptTurn {
  seq: number;
  speaker: string | null;
  text: string;
  tsMs: number | null;
}

export interface MeetingParticipantRow {
  id: string;
  name: string | null;
  email: string | null;
  isHost: boolean;
  resolvedUserId: string | null;
  resolvedEmail: string | null;
  resolvedName: string | null;
}

// ── Internal admin center types ────────────────────────────────────────────────
export interface AdminWorkspace {
  id: string; name: string; slug: string; plan: string; mode: string;
  created_at: string; suspended: boolean | null; members: number; owner_email: string | null; owner_id: string | null;
}
export interface AdminUser {
  id: string; email: string; display_name: string | null;
  created_at: string; last_login_at: string | null; workspaces: number;
}
export interface AdminLicense {
  id: string; workspace_id: string | null; workspace_name: string | null;
  plan_tier: string; seats: number; entitlements: Record<string, unknown>;
  license_key: string | null; status: string; starts_at: string | null;
  expires_at: string | null; redeemed_at: string | null; notes: string | null; created_at: string;
}
export interface AdminAuditEntry {
  id: string; actor_email: string; action: string;
  target_type: string | null; target_id: string | null; payload: unknown; ip: string | null; created_at: string;
}
export interface AdminHealth { db: boolean; queues: Record<string, unknown>; time: string; }
export interface AdminUsage { totals: Record<string, number>; per_workspace: Array<Record<string, unknown>>; }

export const adminApi = {
  workspaces: (): Promise<{ workspaces: AdminWorkspace[] }> => apiFetch('/api/admin/workspaces'),
  users: (): Promise<{ users: AdminUser[] }> => apiFetch('/api/admin/users'),
  suspend: (id: string): Promise<{ ok: boolean; suspended: boolean }> =>
    apiFetch(`/api/admin/workspaces/${id}/suspend`, { method: 'POST' }),
  reactivate: (id: string): Promise<{ ok: boolean; suspended: boolean }> =>
    apiFetch(`/api/admin/workspaces/${id}/reactivate`, { method: 'POST' }),
  health: (): Promise<AdminHealth> => apiFetch('/api/admin/health'),
  usage: (): Promise<AdminUsage> => apiFetch('/api/admin/usage'),
  audit: (): Promise<{ entries: AdminAuditEntry[] }> => apiFetch('/api/admin/audit'),
  licenses: (): Promise<{ licenses: AdminLicense[] }> => apiFetch('/api/admin/licenses'),
  createLicense: (body: {
    plan_tier: string; seats: number; entitlements?: Record<string, unknown>;
    expires_at?: string | null; workspace_id?: string | null; generate_key?: boolean; notes?: string;
  }): Promise<{ license: AdminLicense }> => apiFetch('/api/admin/licenses', { method: 'POST', body }),
  updateLicense: (id: string, body: { status?: string; seats?: number; expires_at?: string | null; notes?: string }):
    Promise<{ license: AdminLicense }> => apiFetch(`/api/admin/licenses/${id}`, { method: 'PATCH', body }),
  assignLicense: (id: string, workspace_id: string): Promise<{ ok: boolean }> =>
    apiFetch(`/api/admin/licenses/${id}/assign`, { method: 'POST', body: { workspace_id } }),
};

export interface AccessRequest {
  id: string;
  doc_id: string;
  doc_title: string | null;
  status: 'pending' | 'approved' | 'denied';
  permission: 'read' | 'write';
  message: string | null;
  created_at: string;
  requester_name: string | null;
  requester_email: string | null;
  owner_name: string | null;
  owner_email: string | null;
}

// Phase 3b — a meeting-proposed decision awaiting human confirm/reject (distinct from AccessRequest).
export interface DecisionApproval {
  id: string;
  decision_node_id: string;
  doc_id: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  created_at: string;
  resolved_at: string | null;
  decision_text: string | null;
  decision_label: string | null;
  meeting_title: string | null;
}

export const api = {
  // Redeem a license key on the current workspace (owner only).
  redeemLicense: (key: string): Promise<{ ok: boolean; plan: string; seats: number }> =>
    apiFetch('/api/licenses/redeem', { method: 'POST', body: { key } }),

  // ── Document access requests ──────────────────────────────────────────────
  requestDocAccess: (docId: string, body: { permission?: 'read' | 'write'; message?: string }): Promise<{ requested: boolean }> =>
    apiFetch(`/api/docs/${docId}/request-access`, { method: 'POST', body }),
  listAccessRequests: (box: 'incoming' | 'outgoing'): Promise<{ box: string; requests: AccessRequest[] }> =>
    apiFetch(`/api/docs/access-requests?box=${box}`),
  resolveAccessRequest: (id: string, body: { action: 'approve' | 'deny'; expiresAt?: string | null }): Promise<{ status: string }> =>
    apiFetch(`/api/docs/access-requests/${id}`, { method: 'PATCH', body }),

  // ── Decision approvals (Phase 3b) — confirm/reject meeting-proposed decisions ──
  listDecisionApprovals: (box: 'incoming' | 'outgoing'): Promise<{ box: string; approvals: DecisionApproval[] }> =>
    apiFetch(`/api/decision-approvals?box=${box}`),
  resolveDecisionApproval: (id: string, body: { action: 'confirm' | 'reject' }): Promise<{ status: string }> =>
    apiFetch(`/api/decision-approvals/${id}`, { method: 'PATCH', body }),
  // Workspace join requests (admin review of same-domain self-join requests).
  listJoinRequests: (): Promise<{ requests: JoinRequestRow[] }> => apiFetch('/api/workspace/join-requests'),
  approveJoinRequest: (id: string, role: 'viewer' | 'editor' | 'admin'): Promise<{ ok: true; granted_role: string }> =>
    apiFetch(`/api/workspace/join-requests/${id}/approve`, { method: 'POST', body: { role } }),
  denyJoinRequest: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/api/workspace/join-requests/${id}/deny`, { method: 'POST', body: {} }),
  listDocs: (): Promise<{ docs: DocSummary[] }> => apiFetch('/api/docs'),
  createDoc: (body: DocCreatePayload): Promise<{ doc: DocFull }> =>
    apiFetch('/api/docs', { method: 'POST', body }),
  getDoc: (id: string): Promise<{ doc: DocFull }> => apiFetch(`/api/docs/${id}`),
  saveDoc: (id: string, body: DocSavePayload): Promise<{ doc: DocSaveResponse }> =>
    apiFetch(`/api/docs/${id}`, { method: 'POST', body }),
  // Phase 3.3: stub backend; Phase 3.4 swaps the path for the SSE endpoint.
  complete: (body: CompletionRequest, signal: AbortSignal): Promise<CompletionResponse> =>
    apiFetch('/api/complete/_stub', { method: 'POST', body, signal }),

  // -------------------------------------------------------------------------
  // Phase 4.1 — workspaces, invitations, members
  // -------------------------------------------------------------------------
  listWorkspaces: (): Promise<{ workspaces: WorkspaceSummary[] }> =>
    apiFetch('/api/auth/workspaces'),
  // Note: switch + create go through the WEB tier (not the API directly).
  // The web endpoint forwards to the API, then re-seals boppl_session with
  // the new tenant_id and JWT — otherwise the server-rendered /app keeps
  // reading the old workspace from the sealed session on next reload.
  switchWorkspace: (
    workspace_id: string,
  ): Promise<{ workspace: { id: string; slug: string; name: string } }> =>
    webFetch('/auth/switch-workspace', { method: 'POST', body: { workspace_id } }),
  createWorkspace: (body: {
    name: string;
    slug?: string;
  }): Promise<{ workspace: { id: string; slug: string; name: string } }> =>
    webFetch('/auth/create-workspace', { method: 'POST', body }),

  listInvitations: (): Promise<{ invitations: InvitationRow[] }> =>
    apiFetch('/api/invitations'),
  createInvitation: (body: {
    email: string;
    role: Role;
    /** Person's name → stored as the invitation's display title. */
    name?: string;
    /** Optional org role; the backend derives the team from it. */
    orgRoleId?: string | null;
    teamId?: string | null;
  }): Promise<{ invitation: { id: string; email: string; role: Role; expires_at: string } }> =>
    apiFetch('/api/invitations', {
      method: 'POST',
      body: {
        email: body.email,
        role: body.role,
        ...(body.name ? { display_title: body.name } : {}),
        ...(body.orgRoleId ? { org_role_id: body.orgRoleId } : {}),
        ...(body.teamId ? { team_id: body.teamId } : {}),
      },
    }),
  revokeInvitation: (id: string): Promise<{ revoked: true }> =>
    apiFetch(`/api/invitations/${id}`, { method: 'DELETE' }),
  acceptInvitation: (token: string): Promise<{ workspace_id: string }> =>
    apiFetch('/api/invitations/accept', { method: 'POST', body: { token } }),

  listMembers: (): Promise<{ members: MemberRow[] }> => apiFetch('/api/members'),
  updateMemberRole: (userId: string, role: Role): Promise<{ member: MemberRow }> =>
    apiFetch(`/api/members/${userId}/role`, { method: 'PATCH', body: { role } }),
  removeMember: (userId: string): Promise<{ removed: true }> =>
    apiFetch(`/api/members/${userId}`, { method: 'DELETE' }),

  // Phase B — Org structure + IAM
  orgStructure: (): Promise<{ teams: OrgTeam[]; roles: OrgRole[]; people: OrgPerson[] }> =>
    apiFetch('/api/org/structure'),
  setOrgPerson: (userId: string, body: { orgRoleId?: string | null; displayTitle?: string | null; department?: string | null; managerUserId?: string | null }): Promise<{ ok: true }> =>
    apiFetch(`/api/org/people/${userId}`, { method: 'PATCH', body }),
  orgTeams: (): Promise<{ teams: OrgTeam[] }> => apiFetch('/api/org/teams'),
  createTeam: (body: { name: string; color?: string }): Promise<{ team: OrgTeam }> =>
    apiFetch('/api/org/teams', { method: 'POST', body }),
  deleteTeam: (id: string): Promise<{ ok: true }> => apiFetch(`/api/org/teams/${id}`, { method: 'DELETE' }),
  orgRoles: (): Promise<{ roles: OrgRole[] }> => apiFetch('/api/org/roles'),
  createOrgRole: (body: { name: string; teamId?: string | null; workspaceRole?: string; defaultFolderAccess?: FolderAccess[] }): Promise<{ role: OrgRole }> =>
    apiFetch('/api/org/roles', { method: 'POST', body }),
  updateOrgRole: (id: string, body: { defaultFolderAccess?: FolderAccess[]; workspaceRole?: string; teamId?: string | null }): Promise<{ role: OrgRole }> =>
    apiFetch(`/api/org/roles/${id}`, { method: 'PATCH', body }),
  deleteOrgRole: (id: string): Promise<{ ok: true }> => apiFetch(`/api/org/roles/${id}`, { method: 'DELETE' }),
  orgFolders: (): Promise<{ folders: OrgFolder[] }> => apiFetch('/api/org/folders'),
  orgAccess: (): Promise<{ grants: OrgGrant[] }> => apiFetch('/api/org/access'),
  setOrgAccess: (body: { principalType: 'user' | 'team' | 'org_role'; principalId: string; resourceType?: string; resourceId: string; permission: string }): Promise<{ ok: true }> =>
    apiFetch('/api/org/access', { method: 'POST', body }),
  orgAudit: (): Promise<{ entries: OrgAuditEntry[] }> => apiFetch('/api/org/audit'),
  orgImportExtract: (body: { type: 'description' | 'image'; text?: string; file_url?: string }): Promise<{ import_id: string; extracted_structure: OrgStructure; valid: boolean }> =>
    apiFetch('/api/org/import/extract', { method: 'POST', body }),
  orgImportApply: (body: { import_id?: string; confirmed_structure: OrgStructure }): Promise<{ ok: true; created: Record<string, number> }> =>
    apiFetch('/api/org/import/apply', { method: 'POST', body }),

  // Phase 2b — meetings + post-meeting identity mapping
  listMeetings: (): Promise<{ meetings: MeetingRow[]; viewer_can_see_all?: boolean; viewer_user_id?: string }> => apiFetch('/api/meetings'),
  getMeeting: (id: string): Promise<{ meeting: MeetingDetail; tasks: MeetingTask[]; linked_meetings: LinkedMeeting[] }> =>
    apiFetch(`/api/meetings/${id}`),
  listMeetingProjects: (): Promise<{ projects: ProjectLite[] }> => apiFetch('/api/projects'),
  setMeetingProject: (id: string, projectId: string | null): Promise<{ ok: true; project_id: string | null }> =>
    apiFetch(`/api/meetings/${id}/project`, { method: 'POST', body: { project_id: projectId } }),
  getMeetingTranscript: (id: string): Promise<{ status: string; turns: TranscriptTurn[] }> =>
    apiFetch(`/api/meetings/${id}/transcript`),
  // Phase C — calendar linking + admit/dispatch
  calendarStatus: (): Promise<{ connected: boolean; configured: boolean }> => apiFetch('/api/calendar/status'),
  calendarSync: (): Promise<{ ok: true; created: number; updated: number; total: number }> =>
    apiFetch('/api/calendar/sync', { method: 'POST' }),
  admitMeeting: (id: string): Promise<{ ok: true; botDispatched: boolean; minutesUntilStart: number | null }> =>
    apiFetch(`/api/meetings/${id}/admit`, { method: 'POST' }),
  ignoreMeeting: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/api/meetings/${id}/ignore`, { method: 'POST' }),
  dispatchMeetingBot: (id: string): Promise<{ ok: true }> =>
    apiFetch(`/api/meetings/${id}/dispatch`, { method: 'POST' }),
  listMeetingParticipants: (
    meetingId: string,
  ): Promise<{ participants: MeetingParticipantRow[] }> =>
    apiFetch(`/api/meetings/${meetingId}/participants`),
  mapMeetingParticipant: (
    meetingId: string,
    participantId: string,
    userId: string,
  ): Promise<{ ok: true }> =>
    apiFetch(`/api/meetings/${meetingId}/participants/${participantId}/identity`, {
      method: 'POST',
      body: { user_id: userId },
    }),

  // Stage B5 — project members / access
  listProjectMembers: (projectId: string): Promise<{ members: ProjectMemberRow[] }> =>
    apiFetch(`/api/projects/${projectId}/members`),
  addProjectMember: (
    projectId: string,
    body: { email: string; role: ProjectRole },
  ): Promise<{ member: ProjectMemberRow }> =>
    apiFetch(`/api/projects/${projectId}/members`, { method: 'POST', body }),
  updateProjectMemberRole: (
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<{ member: ProjectMemberRow }> =>
    apiFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeProjectMember: (projectId: string, userId: string): Promise<{ removed: true }> =>
    apiFetch(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),

  getCurrentWorkspace: (): Promise<{
    workspace: { id: string; slug: string; name: string; plan: string; createdAt: string };
  }> => apiFetch('/api/workspaces/current'),
  updateCurrentWorkspace: (body: {
    name?: string;
    slug?: string;
  }): Promise<{ workspace: { id: string; slug: string; name: string } }> =>
    apiFetch('/api/workspaces/current', { method: 'PATCH', body }),
};
