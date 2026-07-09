import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// citext: case-insensitive text. Postgres extension `citext` is enabled in 0000_initial_schema.sql.
const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

// bytea: binary data column for Yjs state and updates.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
  toDriver(value: Uint8Array): Buffer {
    return Buffer.from(value);
  },
  fromDriver(value: Buffer): Uint8Array {
    return new Uint8Array(value);
  },
});

// tsvector: full-text search vector. Generated column managed by Postgres.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// vector(N): pgvector embedding column.
const vector = (dim: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value.slice(1, -1).split(',').map(Number);
    },
  });

export const workspaceRole = pgEnum('workspace_role', [
  'owner',
  'admin',
  'editor',
  'viewer',
]);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('free'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  // Phase 1 — AgentLens Task Layer
  // 'knowledge' = existing Mnema behaviour
  // 'dev_project' = knowledge + AgentLens task layer + dev MCP tools
  mode: text('mode').notNull().default('knowledge'),
  // SHA-256 hash of the hook token. Plaintext never stored.
  hookToken: text('hook_token').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: citext('email').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull().default('editor'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    // Phase C — encrypted Google Calendar refresh token (per member).
    calendarRefreshToken: text('calendar_refresh_token'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
  }),
);

/**
 * Phase 1 (Open-Core BYOK) — per-workspace bring-your-own-key credentials for
 * the cloud free tier. v1 stores the meeting-agent LLM key only (provider
 * 'llm', OpenAI-compatible); Deepgram STT + Inworld TTS stay on our keys. The
 * key is encrypted at rest via lib/secret-box.ts (SECRETBOX_MASTER_KEY).
 * base_url/model let a workspace point at any OpenAI-compatible endpoint.
 * Enforcement is app-layer (like workspace_join_requests, 0062): every access
 * path filters by workspace_id and settings routes require workspace admin;
 * no RLS policy (the meeting worker + internal key endpoint read it from
 * non-tenant service connections). Plaintext keys never leave the server.
 */
export const workspaceCredentials = pgTable(
  'workspace_credentials',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    baseUrl: text('base_url'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.provider] }),
  }),
);

/**
 * Pending or historical workspace invitations.
 *
 * Each invitation is paired with a signed JWT (token_jti = the JWT's jti
 * claim). The JWT carries the data inline (workspace_id, role, email,
 * inviter); this row is the revocation/acceptance/expiry audit trail.
 * The accept flow validates BOTH the JWT signature AND the row state
 * (not revoked, not already accepted, not expired) before granting access.
 *
 * RLS is enabled in the 0002 migration. The `invitations_pending_idx`
 * partial index makes the per-workspace "show me pending invites" query
 * O(log N) over pending rows only.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: workspaceRole('role').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    tokenJti: text('token_jti').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Phase B (migration 0040): optional org-role onboarding. FK constraints live in
    // the DB; declared as plain uuids here because org_roles/teams are defined later.
    orgRoleId:    uuid('org_role_id'),
    teamId:       uuid('team_id'),
    displayTitle: text('display_title'),
  },
  (table) => ({
    workspaceIdx: index('invitations_workspace_idx').on(table.workspaceId),
    emailIdx: index('invitations_email_idx').on(table.email),
    pendingIdx: index('invitations_pending_idx')
      .on(table.workspaceId, table.email)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
  }),
);

/**
 * Pre-launch waitlist. The public landing page writes here (via the internal
 * waitlist endpoint) so we can capture interest before the LinkedIn launch. The
 * live WorkOS sign-up flow is intentionally NOT gated by this table — approval is
 * manual: flip `status` → 'approved' and send the person the /login link. Global
 * table (no workspace scope, no RLS); written only by the internal endpoint.
 */
export const waitlist = pgTable(
  'waitlist',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: citext('email').notNull().unique(),
    name: text('name'),
    company: text('company'),
    // pending | approved | invited
    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('landing'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (table) => ({
    statusIdx: index('waitlist_status_idx').on(table.status),
  }),
);

// Phase 6.4 / 9.3: User-created folders for organising docs.
// Phase 9.3 adds soft-delete columns (deleted_at, deleted_by) and renames
// parent_id → parent_folder_id for consistency with the MCP API surface.
// The DB column remains `parent_id` for backwards compatibility; the
// TypeScript field is parentFolderId.
// ── Projects (Chunk C — MCP Universal Compatibility + Project Management) ─────
// A project is a named initiative with its own folder structure and task board.
// Available in BOTH knowledge and dev_project workspace modes.
// project_id is nullable on tasks and folders — existing workspaces without
// projects continue to work exactly as before.
export const projects = pgTable(
  'projects',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    workspaceId:  uuid('workspace_id').notNull()
                  .references(() => workspaces.id, { onDelete: 'cascade' }),
    name:         text('name').notNull(),
    slug:         text('slug').notNull(),
    // Auto-generated: lowercase + hyphens, e.g. "BOPPL Context Engine" → "boppl-context-engine"
    description:  text('description'),
    color:        text('color').notNull().default('#52525b'),
    // Lucide icon name: 'folder'|'code'|'rocket'|'brain'|'bolt'|'layers'
    icon:         text('icon').notNull().default('folder'),
    githubRepoUrl: text('github_repo_url'),
    status:       text('status').notNull().default('active'),
    // Values: 'active' | 'paused' | 'completed' | 'archived'
    boardOrder:   integer('board_order').notNull().default(0),
    createdBy:    uuid('created_by').references(() => workspaceMembers.userId, { onDelete: 'set null' }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugWorkspaceUniq: unique('projects_slug_workspace_idx').on(table.slug, table.workspaceId),
    workspaceIdx:      index('projects_workspace_idx').on(table.workspaceId),
  }),
);

/**
 * Per-project membership (Stage B — project-level authorization).
 * Accessible projects for a user = projects they're a member of ∪ (all projects,
 * when they're a workspace owner/admin/editor). `workspace_id` is denormalized so
 * the RLS tenant-isolation policy matches the convention of the other tables.
 * role: viewer | editor | admin (reuses the workspace_role enum).
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId:   uuid('project_id').notNull()
                 .references(() => projects.id, { onDelete: 'cascade' }),
    userId:      uuid('user_id').notNull()
                 .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull()
                 .references(() => workspaces.id, { onDelete: 'cascade' }),
    role:        workspaceRole('role').notNull().default('viewer'),
    joinedAt:    timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk:          primaryKey({ columns: [table.projectId, table.userId] }),
    userIdx:     index('project_members_user_idx').on(table.userId),
    workspaceIdx: index('project_members_workspace_idx').on(table.workspaceId),
  }),
);

/**
 * Meeting identity (Phase 2) — a saved mapping from a meeting participant's
 * display NAME to a Mnema user, within a workspace. Used as the fallback when a
 * meeting attendee has no resolvable email (no calendar link): the bot asserts
 * the speaker's name (X-Mnema-Act-As-Name) and the MCP boundary resolves it here.
 * Rows are created when an organizer maps an unrecognized attendee post-meeting.
 * display_name is citext → the unique index is case-insensitive per workspace.
 */
export const participantAliases = pgTable(
  'participant_aliases',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull()
                 .references(() => workspaces.id, { onDelete: 'cascade' }),
    displayName: citext('display_name').notNull(),
    userId:      uuid('user_id').notNull()
                 .references(() => users.id, { onDelete: 'cascade' }),
    createdBy:   uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueName:  unique('participant_aliases_ws_name_uq').on(table.workspaceId, table.displayName),
    workspaceIdx: index('participant_aliases_workspace_idx').on(table.workspaceId),
  }),
);

/**
 * A meeting the bot attended (Phase 2b capture). Keyed by the Recall bot id so the
 * bot can upsert it. organizer_user_id = the act-as key's creator (who the host
 * resolves to). Used to surface unrecognized attendees for post-meeting mapping.
 */
/** Extracted post-meeting summary stored on meetings.summary (Phase 2). */
export interface MeetingSummary {
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{ text: string; owner?: string | null }>;
}

export const meetings = pgTable(
  'meetings',
  {
    id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:     uuid('workspace_id').notNull()
                     .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Nullable: calendar-synced meetings (Phase C) exist before any bot joins.
    recallBotId:     text('recall_bot_id').unique(),
    organizerUserId: uuid('organizer_user_id').references(() => users.id, { onDelete: 'set null' }),
    meetingUrl:      text('meeting_url'),
    startedAt:       timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt:         timestamp('ended_at', { withTimezone: true }),
    // Phase C — calendar-scheduled meeting metadata (migration 0041)
    title:            text('title'),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    scheduledEndAt:   timestamp('scheduled_end_at', { withTimezone: true }),
    // Phase A additions (migration 0038)
    projectId:        uuid('project_id').references(() => projects.id),
    calendarEventId:  text('calendar_event_id'),
    calendarProvider: text('calendar_provider').default('google'),
    admitted:         boolean('admitted').default(false),
    meetingFolderId:  uuid('meeting_folder_id'),
    linkedMeetingIds: uuid('linked_meeting_ids').array().default(sql`'{}'`),
    postMeetingDocId: uuid('post_meeting_doc_id'),
    preMeetingDocId:  uuid('pre_meeting_doc_id'),
    status:           text('status').default('scheduled'),
    // Phase 2 (migration 0045) — post-meeting transcript + extracted summary.
    summary:          jsonb('summary').$type<MeetingSummary>(),
    // 'none' (default) | 'pending' | 'ready' | 'failed'
    transcriptStatus: text('transcript_status').default('none'),
  },
  (table) => ({
    workspaceIdx:   index('meetings_workspace_idx').on(table.workspaceId),
    calendarIdx:    index('idx_meetings_calendar').on(table.calendarEventId),
    projectIdx:     index('idx_meetings_project').on(table.projectId),
    wsStatusIdx:    index('idx_meetings_workspace_status').on(table.workspaceId, table.status),
  }),
);

/**
 * One attendee seen in a meeting (Phase 2b). resolved_user_id = the Mnema user the
 * bot resolved them to (via email or saved alias) at capture time; NULL = the
 * organizer still needs to map them. Mapping writes a [[participant_aliases]] row
 * and back-fills this column.
 */
export const meetingParticipants = pgTable(
  'meeting_participants',
  {
    id:                 uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    meetingId:          uuid('meeting_id').notNull()
                        .references(() => meetings.id, { onDelete: 'cascade' }),
    recallParticipantId: text('recall_participant_id').notNull(),
    name:               text('name'),
    email:              text('email'),
    isHost:             boolean('is_host').notNull().default(false),
    // Phase 4: true only when this roster entry came from Recall's signature-verified
    // webhook (tamper-proof). The MCP boundary validates act-as identities against
    // verified rows only. false = best-effort, bot-reported (UI/capture only).
    verified:           boolean('verified').notNull().default(false),
    resolvedUserId:     uuid('resolved_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => ({
    uniqueParticipant: unique('meeting_participants_uq').on(table.meetingId, table.recallParticipantId),
    meetingIdx:        index('meeting_participants_meeting_idx').on(table.meetingId),
  }),
);

/**
 * Post-meeting transcript turns (Phase 2, migration 0045). One row per utterance,
 * ordered by `seq`. Populated by the meeting-end worker from Recall's async
 * transcript. `speaker` is the Recall display name; `participantId` links to the
 * resolved roster row when we can match it.
 */
export const meetingTranscripts = pgTable(
  'meeting_transcripts',
  {
    id:            uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    meetingId:     uuid('meeting_id').notNull()
                   .references(() => meetings.id, { onDelete: 'cascade' }),
    seq:           integer('seq').notNull(),
    speaker:       text('speaker'),
    participantId: uuid('participant_id').references(() => meetingParticipants.id, { onDelete: 'set null' }),
    text:          text('text').notNull(),
    tsMs:          bigint('ts_ms', { mode: 'number' }),
    createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingSeqUq: unique('meeting_transcripts_meeting_seq_uq').on(table.meetingId, table.seq),
    meetingIdx:   index('meeting_transcripts_meeting_idx').on(table.meetingId),
  }),
);

/**
 * Aspect 6 / M1 — Episodic meeting record (migration 0057). The structured, explicitly
 * TIMESTAMPED unit the consolidation worker (M2) writes and the start-brief assembler (M3)
 * reads. Distinct from `meetings.summary`: this is the durable episodic store (the graph is
 * the semantic store). acl_scope is the least-privilege scope the record's spoken content
 * may surface in (project else workspace); set on write. source_refs link back to the
 * transcript / notes doc. Deleting a record cascades + its linked decision graph nodes are
 * removed (right-to-be-forgotten) by deleteMeetingRecord (lib/meeting-records.ts).
 */
export interface MeetingCommitment { who: string; what: string }

export const meetingRecords = pgTable(
  'meeting_records',
  {
    id:           uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    meetingId:    uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
    projectId:    uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title:        text('title'),
    participants: jsonb('participants').$type<Array<{ name?: string | null; email?: string | null; userId?: string | null }>>().notNull().default(sql`'[]'::jsonb`),
    startedAt:    timestamp('started_at', { withTimezone: true }),
    endedAt:      timestamp('ended_at', { withTimezone: true }),
    summary:      text('summary'),
    decisions:    jsonb('decisions').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    actionItems:  jsonb('action_items').$type<Array<{ text: string; owner?: string | null }>>().notNull().default(sql`'[]'::jsonb`),
    commitments:  jsonb('commitments').$type<MeetingCommitment[]>().notNull().default(sql`'[]'::jsonb`),
    // 'project:<uuid>' | 'workspace:<uuid>' — least-privilege scope, set on write.
    aclScope:     text('acl_scope').notNull(),
    sourceRefs:   jsonb('source_refs').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingUq:    unique('meeting_records_meeting_uq').on(table.meetingId),
    workspaceIdx: index('meeting_records_workspace_idx').on(table.workspaceId),
    projectIdx:   index('meeting_records_project_idx').on(table.projectId),
  }),
);

// ── Org Structure + IAM (Phase A, migrations 0034–0039) ─────────────────────────

/** Teams: departments / squads inside a workspace. Supports nesting (0034). */
export const teams = pgTable(
  'teams',
  {
    id:           uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name:         text('name').notNull(),
    slug:         text('slug').notNull(),
    description:  text('description'),
    parentTeamId: uuid('parent_team_id'),
    color:        text('color').default('#6b7280'),
    createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueSlug:   unique('teams_workspace_slug_uq').on(table.workspaceId, table.slug),
    workspaceIdx: index('idx_teams_workspace').on(table.workspaceId),
    parentIdx:    index('idx_teams_parent').on(table.parentTeamId),
  }),
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId:   uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId:   uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role:     text('role').notNull().default('member'), // 'member' | 'lead' | 'admin'
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.teamId, table.userId] }) }),
);

/** Named job titles with policy defaults applied on invite (0034). */
export const orgRoles = pgTable(
  'org_roles',
  {
    id:                  uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:         uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    teamId:              uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    name:                text('name').notNull(),
    slug:                text('slug').notNull(),
    description:         text('description'),
    workspaceRole:       text('workspace_role').notNull().default('editor'),
    defaultFolderAccess: jsonb('default_folder_access').notNull().default(sql`'[]'::jsonb`),
    createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueSlug:   unique('org_roles_workspace_slug_uq').on(table.workspaceId, table.slug),
    workspaceIdx: index('idx_org_roles_workspace').on(table.workspaceId),
    teamIdx:      index('idx_org_roles_team').on(table.teamId),
  }),
);

/** One row per (user, workspace): the user's identity inside this org (0035). */
export const userOrgProfiles = pgTable(
  'user_org_profiles',
  {
    userId:        uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId:   uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    orgRoleId:     uuid('org_role_id').references(() => orgRoles.id, { onDelete: 'set null' }),
    displayTitle:  text('display_title'),
    roleSlug:      text('role_slug'),
    managerUserId: uuid('manager_user_id').references(() => users.id),
    department:    text('department'),
    botDisplayName: text('bot_display_name'),
  },
  (table) => ({
    pk:           primaryKey({ columns: [table.userId, table.workspaceId] }),
    workspaceIdx: index('idx_uop_workspace').on(table.workspaceId),
    roleSlugIdx:  index('idx_uop_role_slug').on(table.roleSlug),
  }),
);

/** Immutable IAM audit trail (0037). */
export const iamAuditLog = pgTable(
  'iam_audit_log',
  {
    id:           uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id),
    actorUserId:  uuid('actor_user_id').references(() => users.id),
    action:       text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId:   uuid('resource_id'),
    payload:      jsonb('payload'),
    createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({ workspaceIdx: index('idx_iam_audit_workspace').on(table.workspaceId, table.createdAt) }),
);

/** Org-chart import tracking (0038). */
export const orgChartImports = pgTable(
  'org_chart_imports',
  {
    id:                 uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:        uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    importType:         text('import_type').notNull(),
    sourceFileUrl:      text('source_file_url'),
    extractedStructure: jsonb('extracted_structure'),
    confirmedStructure: jsonb('confirmed_structure'),
    status:             text('status').default('pending'),
    appliedAt:          timestamp('applied_at', { withTimezone: true }),
    createdBy:          uuid('created_by').references(() => users.id),
    createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Nullable FK to projects — null means the folder is not part of a project.
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    // Self-referential FK for nested folders. Null = root folder.
    // FK constraint lives in the DB (migration 0009/0012); Drizzle doesn't
    // handle self-references cleanly so we declare it as a plain uuid column.
    parentFolderId: uuid('parent_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Phase 9.3: soft-delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
    // Phase A additions (migration 0039): system folders that users can't delete,
    // team-root + meeting-docs linkage, and a slug for IAM default_folder_access lookup.
    folderType:  text('folder_type').default('user'), // 'user'|'team_root'|'meeting_docs'|'system'
    teamId:      uuid('team_id').references(() => teams.id),
    meetingId:   uuid('meeting_id').references(() => meetings.id),
    isDeletable: boolean('is_deletable').default(true),
    slug:        text('slug'),
  },
  (table) => ({
    workspaceIdx: index('folders_workspace_idx').on(table.workspaceId),
    parentIdx:    index('folders_parent_idx').on(table.parentFolderId),
    projectIdx:   index('folders_project_idx').on(table.projectId),
    slugIdx:      index('idx_folders_workspace_slug').on(table.workspaceId, table.slug),
  }),
);

export const docs = pgTable(
  'docs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Phase 6.4: nullable FK → folders. Null = unfiled (top-level).
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    // Hierarchy (Workspace→Project→Folder→Doc): denormalized project link; source of
    // truth is the doc's folder.projectId. Null = unfiled / workspace-wide. Kept in sync
    // on doc create/move and folder↔project changes; powers project-scoped search + RLS.
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    path: text('path').notNull(),
    title: text('title').notNull(),
    // Phase 5: content type. 'doc' is freeform markdown (existing
    // contract). The other three are reserved for Phase 8 templated
    // content. CHECK constraint lives in migration 0005.
    type: text('type').notNull().default('doc'),
    markdown: text('markdown').notNull().default(''),
    yjsState: bytea('yjs_state').notNull(),
    yjsStateVector: bytea('yjs_state_vector'),
    contentHash: text('content_hash'),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    tsv: tsvector('tsv'),
    // Phase sharing: public reader link
    isPublic:    boolean('is_public').notNull().default(false),
    publicToken: uuid('public_token').unique(),
    // DOCX/PDF support: set when this doc was created by ingesting an uploaded file.
    // FK to attachments.id is defined in migration SQL (circular ref workaround).
    sourceAttachmentId: uuid('source_attachment_id'),
  },
  (table) => ({
    workspacePathUnique: unique().on(table.workspaceId, table.path),
    workspaceIdx: index('docs_workspace_idx').on(table.workspaceId),
    workspaceUpdatedIdx: index('docs_workspace_updated').on(
      table.workspaceId,
      table.updatedAt.desc(),
    ),
    folderIdx: index('docs_folder_idx').on(table.folderId),
    projectIdx: index('docs_project_idx').on(table.projectId),
  }),
);

export const docVersions = pgTable(
  'doc_versions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    markdown: text('markdown').notNull(),
    yjsState: bytea('yjs_state').notNull(),
    yjsUpdate: bytea('yjs_update'),
    authorId: uuid('author_id').references(() => users.id),
    /** 'human' = manual Save or auto-snapshot; 'ai' = MCP write tool. */
    authorKind: text('author_kind').notNull().default('human'),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docVersionUnique: unique().on(table.docId, table.version),
    docIdx: index('doc_versions_doc_idx').on(table.docId, table.version.desc()),
  }),
);

/**
 * Phase 4.2 comments model.
 *
 * Threads carry the Yjs anchor (start + end RelativePositions serialized as
 * BYTEA), the resolved/unresolved state, and the workspace_id used for RLS.
 * Individual replies live in the `comments` table below and are scoped to a
 * thread; the comments policy joins through to comment_threads for tenant
 * isolation rather than duplicating workspace_id on every row.
 *
 * The original Phase-1.2 single-table comments shape (with block_id /
 * parent_id) was scaffolded but never wired into any code path; migration
 * 0004 drops it before recreating these.
 */
export const commentThreads = pgTable(
  'comment_threads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    anchorStart: bytea('anchor_start').notNull(),
    anchorEnd: bytea('anchor_end').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docIdx: index('comment_threads_doc_idx').on(table.docId, table.resolved),
  }),
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => commentThreads.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => ({
    threadIdx: index('comments_thread_idx').on(table.threadId, table.createdAt),
  }),
);

/**
 * Per-user last-seen timestamp for a doc. Drives the "unread comments" dot
 * in the doc list: a doc is unread if there's a comment newer than this
 * row's last_seen_at and authored by someone other than the user.
 */
export const docReadState = pgTable(
  'doc_read_state',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.docId] }),
  }),
);

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    workspaceNameUnique: unique().on(table.workspaceId, table.name),
  }),
);

export const docTags = pgTable(
  'doc_tags',
  {
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.docId, table.tagId] }),
    tagIdx: index('doc_tags_tag_idx').on(table.tagId),
  }),
);

export const embeddings = pgTable(
  'embeddings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    // Denormalized from the doc for project-scoped semantic search. Null = workspace-wide.
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    chunkIndex: integer('chunk_index').notNull(),
    chunkText: text('chunk_text').notNull(),
    tokenCount: integer('token_count'),
    headingPath: text('heading_path'),
    embedding: vector(1024)('embedding').notNull(),
    model: text('model').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chunkUnique: unique().on(table.docId, table.chunkIndex, table.model),
    docIdx: index('embeddings_doc_idx').on(table.docId),
    workspaceIdx: index('embeddings_workspace_idx').on(table.workspaceId),
    projectIdx: index('embeddings_project_idx').on(table.projectId),
  }),
);

/**
 * Phase A (migration 0036) — activated doc_acl: full resource × principal × permission
 * matrix. resource_type doc|folder|project; principal_type user|team|org_role;
 * permission read|write|admin|none ('none' = explicit deny). Resolved by the
 * app_effective_permission() SQL function (doc > folder > project; deny wins).
 */
export const docAcl = pgTable(
  'doc_acl',
  {
    id:            uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:   uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceType:  text('resource_type').notNull(), // 'doc' | 'folder' | 'project'
    resourceId:    uuid('resource_id').notNull(),
    principalType: text('principal_type').notNull(), // 'user' | 'team' | 'org_role'
    principalId:   uuid('principal_id').notNull(),
    permission:    text('permission').notNull(),     // 'read' | 'write' | 'admin' | 'none'
    createdBy:     uuid('created_by').references(() => users.id),
    expiresAt:     timestamp('expires_at', { withTimezone: true }), // FIX 6: NULL = permanent
    createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    uniqueGrant:  unique('doc_acl_resource_principal_uq').on(
                    table.resourceType, table.resourceId, table.principalType, table.principalId),
    resourceIdx:  index('idx_doc_acl_resource').on(table.resourceType, table.resourceId),
    principalIdx: index('idx_doc_acl_principal').on(table.principalType, table.principalId),
    workspaceIdx: index('idx_doc_acl_workspace').on(table.workspaceId),
  }),
);

/** FIX 6 — a person's request for access to a doc they can't see (0050). */
export const docAccessRequests = pgTable(
  'doc_access_requests',
  {
    id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:     uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    docId:           uuid('doc_id').notNull().references(() => docs.id, { onDelete: 'cascade' }),
    requesterId:     uuid('requester_id').notNull().references(() => users.id),
    requestedFromId: uuid('requested_from_id').references(() => users.id),
    message:         text('message'),
    permission:      text('permission').notNull().default('read'), // 'read' | 'write'
    expiresAt:       timestamp('expires_at', { withTimezone: true }), // set by approver; NULL = permanent
    status:          text('status').notNull().default('pending'),  // 'pending' | 'approved' | 'denied'
    resolvedBy:      uuid('resolved_by').references(() => users.id),
    resolvedAt:      timestamp('resolved_at', { withTimezone: true }),
    createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    // M5 fix: partial unique — at most one PENDING request per (doc, requester);
    // resolved (approved/denied) rows are unconstrained so re-requests never collide.
    pendingUq:     uniqueIndex('doc_access_requests_pending_uq')
                     .on(table.docId, table.requesterId)
                     .where(sql`status = 'pending'`),
    workspaceIdx:  index('idx_access_requests_workspace').on(table.workspaceId),
    pendingIdx:    index('idx_access_requests_pending').on(table.requestedFromId, table.status)
                     .where(sql`status = 'pending'`),
  }),
);

// Phase 3b — confirm/reject loop for meeting-proposed decisions. SIBLING to doc_access_requests
// (the ACL path is byte-unchanged). One pending approval per decision node; confirm flips the
// decision proposed→current + applies the deferred supersede, reject tombstones it.
export const decisionApprovals = pgTable(
  'decision_approvals',
  {
    id:               uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:      uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    decisionNodeId:   uuid('decision_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
    docId:            uuid('doc_id').references(() => docs.id, { onDelete: 'set null' }),
    proposerId:       uuid('proposer_id').references(() => users.id),   // who may confirm
    meetingId:        uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    supersedesTarget: uuid('supersedes_target').references(() => graphNodes.id, { onDelete: 'set null' }), // mirrors stashed node.supersedes
    status:           text('status').notNull().default('pending'), // 'pending' | 'confirmed' | 'rejected'
    resolvedBy:       uuid('resolved_by').references(() => users.id),
    resolvedAt:       timestamp('resolved_at', { withTimezone: true }),
    createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // at most one PENDING approval per decision node (idempotent re-consolidation)
    pendingUq:    uniqueIndex('decision_approvals_pending_uq').on(table.decisionNodeId).where(sql`status = 'pending'`),
    proposerIdx:  index('decision_approvals_proposer_idx').on(table.proposerId, table.status),
    workspaceIdx: index('decision_approvals_workspace_idx').on(table.workspaceId),
  }),
);

// Approval-gated same-domain self-join (migration 0062). A same-domain user requesting to
// join a workspace lands here as 'pending'; an owner/admin approves (choosing granted_role,
// which creates the membership) or denies. Sibling to decision_approvals — app-layer enforced.
export const workspaceJoinRequests = pgTable(
  'workspace_join_requests',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status:      text('status').notNull().default('pending'), // 'pending' | 'approved' | 'denied'
    grantedRole: text('granted_role'),                        // role chosen at approval: viewer|editor|admin
    reviewedBy:  uuid('reviewed_by').references(() => users.id),
    reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendingUq:    uniqueIndex('workspace_join_requests_pending_uq').on(table.workspaceId, table.requesterId).where(sql`status = 'pending'`),
    workspaceIdx: index('workspace_join_requests_workspace_idx').on(table.workspaceId, table.status),
    requesterIdx: index('workspace_join_requests_requester_idx').on(table.requesterId, table.status),
  }),
);

export const toolAudit = pgTable(
  'tool_audit',
  {
    id: bigserial('id', { mode: 'number' }).notNull(),
    workspaceId: uuid('workspace_id'),
    userId: uuid('user_id'),
    agentId: text('agent_id'),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').notNull(),
    resultSummary: jsonb('result_summary'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceTimeIdx: index('tool_audit_ws_time_idx').on(
      table.workspaceId,
      table.createdAt.desc(),
    ),
    toolIdx: index('tool_audit_tool_idx').on(table.toolName, table.createdAt.desc()),
  }),
);

// ============================================================================
// Phase 6.1 — Flows
// ============================================================================
// A flow is a workspace-scoped DAG of content nodes. flow_versions captures
// each save (draft vs published). flow_nodes + flow_edges hold the graph
// shape. CHECK constraints and RLS live in migration 0006.

export const flows = pgTable(
  'flows',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    // FK to flow_versions(id) added via ALTER in migration 0006 because of
    // the circular reference (flow_versions.flow_id → flows.id).
    publishedVersionId: uuid('published_version_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Phase: flow sharing (0042) — when set, any authenticated Mnema user with
    // the link can view the published flow read-only.
    shareToken: text('share_token'),
    sharedAt:   timestamp('shared_at', { withTimezone: true }),
    // Community Flows (0072) — set to the hub listing slug when this flow has
    // been published to the community hub; null when not published.
    communitySlug: text('community_slug'),
  },
  (table) => ({
    workspaceSlugUnique: unique('flows_workspace_id_slug_key').on(table.workspaceId, table.slug),
    workspaceIdx: index('flows_workspace_idx').on(table.workspaceId),
  }),
);

export const flowVersions = pgTable(
  'flow_versions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    isPublished: boolean('is_published').notNull().default(false),
    createdBy: uuid('created_by')
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishMessage: text('publish_message'),
  },
  (table) => ({
    flowVersionUnique: unique('flow_versions_flow_id_version_number_key').on(
      table.flowId,
      table.versionNumber,
    ),
    flowIdx: index('flow_versions_flow_idx').on(table.flowId),
  }),
);

export const flowNodes = pgTable(
  'flow_nodes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersions.id, { onDelete: 'cascade' }),
    // Stable client-issued id (kebab-case). Edges reference this, not `id`.
    clientNodeId: text('client_node_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    positionX: real('position_x').notNull().default(0),
    positionY: real('position_y').notNull().default(0),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionClientUnique: unique('flow_nodes_flow_version_id_client_node_id_key').on(
      table.flowVersionId,
      table.clientNodeId,
    ),
    versionIdx: index('flow_nodes_version_idx').on(table.flowVersionId),
  }),
);

// MCP API tokens — long-lived Bearer credentials for Claude Desktop / claude.ai.
// The JWT itself is never stored; only the jti (JWT ID) is kept for revocation.
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull().default('Claude Desktop'),
    jti: uuid('jti').notNull().default(sql`gen_random_uuid()`).unique(),
    scopes: text('scopes').array().notNull().default(sql`ARRAY['docs:read','flows:read']`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('mcp_tokens_workspace_idx').on(table.workspaceId),
    jtiIdx: index('mcp_tokens_jti_idx').on(table.jti),
  }),
);

export const flowEdges = pgTable(
  'flow_edges',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersions.id, { onDelete: 'cascade' }),
    fromNodeId: text('from_node_id').notNull(),
    toNodeId: text('to_node_id').notNull(),
    fromSocket: text('from_socket').notNull().default('default'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    edgeUnique: unique('flow_edges_unique').on(
      table.flowVersionId,
      table.fromNodeId,
      table.toNodeId,
      table.fromSocket,
    ),
    versionIdx: index('flow_edges_version_idx').on(table.flowVersionId),
    fromIdx: index('flow_edges_from_idx').on(table.flowVersionId, table.fromNodeId),
    toIdx: index('flow_edges_to_idx').on(table.flowVersionId, table.toNodeId),
  }),
);

export const flowRuns = pgTable(
  'flow_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id, { onDelete: 'cascade' }),
    flowVersionId: uuid('flow_version_id').references(() => flowVersions.id, { onDelete: 'set null' }),
    flowSlug: text('flow_slug').notNull(),
    flowName: text('flow_name').notNull(),
    totalSteps: integer('total_steps').notNull().default(0),
    capturedCount: integer('captured_count').notNull().default(0),
    status: text('status').notNull().default('running'),
    startedBy: uuid('started_by').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    flowIdx: index('flow_runs_flow_idx').on(table.flowId, table.startedAt),
    workspaceIdx: index('flow_runs_workspace_idx').on(table.workspaceId, table.startedAt),
  }),
);

/** What the model was served at a step (the "input" tab of the execution view). */
export interface FlowRunStepInput {
  instruction?: string;
  content?: string;
  content_type?: string;
  source?: Record<string, unknown> | null;
  /** For decision nodes: the branch options presented. */
  branches?: { label: string; target_step_index: number }[];
}

/** What the model produced at a step (the "output" tab of the execution view). */
export interface FlowRunStepOutput {
  /** Free-text summary of what the model did (answer given, action taken). */
  summary?: string;
  /** For decision nodes: which branch label the model took. */
  branch_taken?: string;
  /** For capture nodes: the doc it wrote. */
  doc_id?: string;
  doc_title?: string;
}

export const flowRunSteps = pgTable(
  'flow_run_steps',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => flowRuns.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    nodeId: text('node_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('pending'),
    capturedDocId: uuid('captured_doc_id'),
    capturedTitle: text('captured_title'),
    // n8n-parity execution data: `input` = what the model was served at this step
    // (instruction text, doc content, decision question); `output` = what it produced
    // (answer, chosen branch, action summary, or captured-doc ref). Null until recorded.
    input: jsonb('input').$type<FlowRunStepInput | null>(),
    output: jsonb('output').$type<FlowRunStepOutput | null>(),
    error: text('error'),
    durationMs: integer('duration_ms'),
    visitedAt: timestamp('visited_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
  },
  (table) => ({
    runStepUnique: unique('flow_run_steps_run_step_key').on(table.runId, table.stepIndex),
  }),
);

// ============================================================================
// Phase A — OAuth 2.1 Authorization Server
// ============================================================================

export const oauthClients = pgTable(
  'oauth_clients',
  {
    id: text('id').primaryKey(),
    clientSecretHash: text('client_secret_hash'),
    clientName: text('client_name').notNull(),
    redirectUris: text('redirect_uris').array().notNull(),
    grantTypes: text('grant_types').array().notNull().default(sql`ARRAY['authorization_code','refresh_token']::text[]`),
    responseTypes: text('response_types').array().notNull().default(sql`ARRAY['code']::text[]`),
    scope: text('scope').notNull().default('workspace:read'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
    applicationType: text('application_type').notNull().default('web'),
    registeredVia: text('registered_via').notNull().default('dynamic'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    lastUsedIdx: index('oauth_clients_last_used_idx').on(table.lastUsedAt),
  }),
);

export const oauthPendingAuthRequests = pgTable(
  'oauth_pending_auth_requests',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    state: text('state').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    resource: text('resource'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    expiresIdx: index('oauth_pending_auth_requests_expires_idx').on(table.expiresAt),
  }),
);

export const oauthAuthorizationCodes = pgTable(
  'oauth_authorization_codes',
  {
    code: text('code').primaryKey(),
    clientId: text('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    resource: text('resource'),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    expiresIdx: index('oauth_authorization_codes_expires_idx').on(table.expiresAt),
  }),
);

export const oauthRefreshTokens = pgTable(
  'oauth_refresh_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tokenHash: text('token_hash').notNull().unique(),
    clientId: text('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    resource: text('resource'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    rotatedToId: uuid('rotated_to_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('oauth_refresh_tokens_user_idx').on(table.userId, table.workspaceId),
    activeIdx: index('oauth_refresh_tokens_active_idx').on(table.expiresAt),
  }),
);

export const oauthConsents = pgTable(
  'oauth_consents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull().references(() => oauthClients.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    activeIdx: index('oauth_consents_active_idx').on(table.userId, table.workspaceId, table.clientId),
    uniqueGrant: unique('oauth_consents_unique').on(table.userId, table.workspaceId, table.clientId, table.scope),
  }),
);

// ── Billing / Razorpay ─────────────────────────────────────────────────────
// These tables were created via raw SQL migrations (not tracked in the Drizzle
// journal) so we declare them here to give the ORM typed access.

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    razorpaySubscriptionId: text('razorpay_subscription_id').notNull().unique(),
    razorpayCustomerId: text('razorpay_customer_id'),
    status: text('status').notNull(),
    planId: text('plan_id').notNull(),
    planKey: text('plan_key').notNull(),
    quantity: integer('quantity').notNull().default(1),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    // Billing tier columns (added for multi-tier + dual-currency support)
    currency: text('currency').notNull().default('INR'),       // 'USD' | 'INR'
    cycle: text('cycle').notNull().default('monthly'),         // 'monthly' | 'annual'
    billableSeats: integer('billable_seats').notNull().default(1),
    accessUntil: timestamp('access_until', { withTimezone: true }),       // set on cancellation
    paymentFailureCount: integer('payment_failure_count').notNull().default(0),
    trialAlertSent: boolean('trial_alert_sent').notNull().default(false),
    renewalAlertSent: boolean('renewal_alert_sent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('subscriptions_workspace_idx').on(table.workspaceId),
  }),
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: text('event_id').notNull().unique(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    typeIdx: index('webhook_events_type_idx').on(table.eventType, table.createdAt),
  }),
);

export const razorpayPlanIds = pgTable(
  'razorpay_plan_ids',
  {
    planKey: text('plan_key').notNull(),
    environment: text('environment').notNull(),
    razorpayPlanId: text('razorpay_plan_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.planKey, table.environment] }),
  }),
);

// ============================================================================
// Phase 1 — AgentLens Task Layer
// ============================================================================

// Tasks: the core Kanban unit. Each task belongs to a dev_project workspace
// and may optionally be linked to a Mnema doc (e.g. a spec in the PRD folder).
export const tasks = pgTable(
  'tasks',
  {
    id:                 uuid('id').primaryKey().defaultRandom(),
    workspaceId:        uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    docId:              uuid('doc_id').references(() => docs.id, { onDelete: 'set null' }),
    // Nullable — task can exist as a standalone Kanban card OR linked to a Mnema doc

    title:              text('title').notNull(),
    description:        text('description'),
    status:             text('status').notNull().default('backlog'),
    // Values: 'backlog' | 'in_progress' | 'review' | 'audit_fix' | 'done'

    priority:           text('priority').notNull().default('medium'),
    // Values: 'low' | 'medium' | 'high' | 'critical'

    estimatedCostUsd:   doublePrecision('estimated_cost_usd'),
    // assignedMemberId references users.id (a workspace member user)
    assignedMemberId:   uuid('assigned_member_id').references(() => users.id, { onDelete: 'set null' }),

    githubPrUrl:        text('github_pr_url'),
    githubPrStatus:     text('github_pr_status'),
    // Values: 'open' | 'merged' | 'closed' | null

    blockerDescription: text('blocker_description'),
    // Set by log_blocker MCP tool, cleared on re-claim

    retryCount:         integer('retry_count').notNull().default(0),
    retryFixHint:       text('retry_fix_hint'),
    // AI-generated fix hint stored by retry engine (Phase 2)

    boardOrder:         integer('board_order').notNull().default(0),
    // Sort order within the status column. Lower = higher on the board.

    tags:               text('tags').array(),
    // Simple string array, no separate tags table for Phase 1

    // Nullable FK to projects — tasks can exist without a project.
    projectId:          uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),

    // Phase 3 (migration 0046): set when this task was auto-created from a meeting's
    // action items. Powers meeting → task graph edges + "tasks from this meeting".
    meetingId:          uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),

    createdAt:          timestamp('created_at').notNull().defaultNow(),
    updatedAt:          timestamp('updated_at').notNull().defaultNow(),
    completedAt:        timestamp('completed_at'),
  },
  (table) => ({
    workspaceIdx: index('tasks_workspace_id_idx').on(table.workspaceId),
    statusIdx:    index('tasks_status_idx').on(table.status),
    orderIdx:     index('tasks_board_order_idx').on(table.boardOrder),
    projectIdx:   index('tasks_project_idx').on(table.projectId),
  }),
);

// Human comments on Kanban tasks — review notes and audit-fix guidance that
// don't belong in the task description (which agents treat as the spec).
export const taskComments = pgTable(
  'task_comments',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId:      uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    authorId:    uuid('author_id').notNull().references(() => users.id),
    body:        text('body').notNull(),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskIdx: index('task_comments_task_idx').on(table.taskId, table.createdAt),
  }),
);

// Agent sessions: created when an agent claims a task. Phase 1 stub —
// Phase 2 adds cost, token, and event columns via additive migration.
export const agentSessions = pgTable('agent_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  taskId:       uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  developerId:  text('developer_id').notNull(),
  // String matching MNEMA_DEVELOPER_ID env var on the agent's machine
  agent:        text('agent').notNull().default('claude_code'),
  // Values: 'claude_code' | 'cursor' | 'aider' | 'cline' | 'generic'
  status:       text('status').notNull().default('active'),
  // Values: 'active' | 'completed' | 'failed' | 'stalled'
  startedAt:    timestamp('started_at').notNull().defaultNow(),
  endedAt:      timestamp('ended_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  // ── Phase 2: execution tracking columns ──────────────────────────────────
  totalInputTokens:     integer('total_input_tokens').notNull().default(0),
  totalOutputTokens:    integer('total_output_tokens').notNull().default(0),
  totalCacheReadTokens: integer('total_cache_read_tokens').notNull().default(0),
  totalCostUsd:         doublePrecision('total_cost_usd').notNull().default(0),
  totalToolCalls:       integer('total_tool_calls').notNull().default(0),
  model:                text('model'),
  gitBranch:            text('git_branch'),
  gitCommitBefore:      text('git_commit_before'),
  gitCommitAfter:       text('git_commit_after'),
  filesModifiedCount:   integer('files_modified_count').notNull().default(0),
});

// ── Phase 2: tool_calls ───────────────────────────────────────────────────────
export const toolCalls = pgTable(
  'tool_calls',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    sessionId:    uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    toolName:     text('tool_name').notNull(),
    inputJson:    jsonb('input_json'),
    outputJson:   jsonb('output_json'),
    truncated:    boolean('truncated').notNull().default(false),
    filePath:     text('file_path'),
    durationMs:   integer('duration_ms'),
    exitCode:     integer('exit_code'),
    isError:      boolean('is_error').notNull().default(false),
    errorMessage: text('error_message'),
    inputTokens:       integer('input_tokens').default(0),
    outputTokens:      integer('output_tokens').default(0),
    cacheReadTokens:   integer('cache_read_tokens').default(0),
    cacheWriteTokens:  integer('cache_write_tokens').default(0),
    costUsd:           doublePrecision('cost_usd').default(0),
    timestamp:    timestamp('timestamp').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx:      index('tool_calls_session_idx').on(table.sessionId),
    workspaceIdx:    index('tool_calls_workspace_idx').on(table.workspaceId),
    timestampIdx:    index('tool_calls_timestamp_idx').on(table.timestamp),
    filePathIdx:     index('tool_calls_file_path_idx').on(table.filePath),
    sessionTimeIdx:  index('tool_calls_session_time_idx').on(table.sessionId, table.timestamp),
  }),
);

// ── Phase 2: file_diffs ───────────────────────────────────────────────────────
export const fileDiffs = pgTable(
  'file_diffs',
  {
    id:           uuid('id').primaryKey().defaultRandom(),
    sessionId:    uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
    workspaceId:  uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    toolCallId:   uuid('tool_call_id').references(() => toolCalls.id, { onDelete: 'set null' }),
    filePath:     text('file_path').notNull(),
    diffContent:  text('diff_content'),
    truncated:    boolean('truncated').notNull().default(false),
    linesAdded:   integer('lines_added').default(0),
    linesRemoved: integer('lines_removed').default(0),
    timestamp:    timestamp('timestamp').notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index('file_diffs_session_idx').on(table.sessionId),
  }),
);

// ── Phase 2: model_pricing ────────────────────────────────────────────────────
export const modelPricing = pgTable('model_pricing', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  modelId:                   text('model_id').notNull().unique(),
  provider:                  text('provider').notNull(),
  inputPricePerMillion:      doublePrecision('input_price_per_million').notNull(),
  outputPricePerMillion:     doublePrecision('output_price_per_million').notNull(),
  cacheReadPricePerMillion:  doublePrecision('cache_read_price_per_million').default(0),
  cacheWritePricePerMillion: doublePrecision('cache_write_price_per_million').default(0),
  isActive:                  boolean('is_active').notNull().default(true),
  updatedAt:                 timestamp('updated_at').notNull().defaultNow(),
});

// ── Phase 2: budget_configs ───────────────────────────────────────────────────
export const budgetConfigs = pgTable('budget_configs', {
  id:                uuid('id').primaryKey().defaultRandom(),
  workspaceId:       uuid('workspace_id').notNull().unique().references(() => workspaces.id, { onDelete: 'cascade' }),
  dailyBudgetUsd:    doublePrecision('daily_budget_usd'),
  monthlyBudgetUsd:  doublePrecision('monthly_budget_usd'),
  alertThresholdPct: integer('alert_threshold_pct').notNull().default(80),
  slackWebhookUrl:   text('slack_webhook_url'),
  discordWebhookUrl: text('discord_webhook_url'),
  lastAlertSentAt:   timestamp('last_alert_sent_at'),
  // Phase 4: task notification toggles
  notifyOnTaskComplete: boolean('notify_on_task_complete').notNull().default(true),
  notifyOnBlocker:      boolean('notify_on_blocker').notNull().default(true),
  notifyOnRetry:        boolean('notify_on_retry').notNull().default(false),
  createdAt:         timestamp('created_at').notNull().defaultNow(),
  updatedAt:         timestamp('updated_at').notNull().defaultNow(),
});

// ── Phase 4: workspace_session_stats (materialized view) ──────────────────────
// Read-only Drizzle wrapper for the materialized view created in migration 0020.
// Drizzle doesn't natively model MAT VIEWs, so we use pgTable with the same
// column names — it produces correct SELECT queries at runtime.
export const workspaceSessionStats = pgTable('workspace_session_stats', {
  workspaceId:        uuid('workspace_id').notNull(),
  sessionCount:       integer('session_count').notNull(),
  medianCostUsd:      doublePrecision('median_cost_usd'),
  avgCostUsd:         doublePrecision('avg_cost_usd'),
  medianInputTokens:  doublePrecision('median_input_tokens'),
  avgInputTokens:     doublePrecision('avg_input_tokens'),
  maxCostUsd:         doublePrecision('max_cost_usd'),
  firstSessionAt:     timestamp('first_session_at', { withTimezone: true }),
  lastSessionAt:      timestamp('last_session_at',  { withTimezone: true }),
});

// ── Phase 4: api_keys ─────────────────────────────────────────────────────────
export const apiKeys = pgTable(
  'api_keys',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull()
                 .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdBy:   uuid('created_by').notNull()
                 .references(() => users.id, { onDelete: 'cascade' }),
    // Stage B: a project-scoped key restricts its session to exactly this project
    // (regardless of creator) — this is what hard-bounds the meeting bot. NULL =
    // workspace-wide key (acts as its creator's access).
    projectId:   uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    // Meeting identity (Phase 1): when true, this key may assert the asking
    // principal per request via the X-Mnema-Act-As-Email header. The server
    // resolves that email → a workspace user and enforces THAT user's access for
    // the call — how the meeting bot answers scoped to whoever is speaking. A
    // guest (no matching Mnema user) is denied all knowledge. Pairs with a NULL
    // projectId (per-user identity, not a single fixed project).
    actAsUser:   boolean('act_as_user').notNull().default(false),
    name:        text('name').notNull(),
    // SHA-256 of plaintext key. Format: mnema_api_ + 48 random hex chars.
    keyHash:     text('key_hash').notNull().unique(),
    // First 16 chars of plaintext for display: "mnema_api_a3b2c1"
    keyPrefix:   text('key_prefix').notNull(),
    scopes:      text('scopes').array().notNull().default(sql`'{read}'`),
    lastUsedAt:  timestamp('last_used_at', { withTimezone: true }),
    expiresAt:   timestamp('expires_at', { withTimezone: true }),
    revokedAt:   timestamp('revoked_at', { withTimezone: true }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    apiKeysWorkspaceIdx: index('api_keys_workspace_idx').on(table.workspaceId),
    apiKeysHashIdx:      index('api_keys_hash_idx').on(table.keyHash),
  }),
);

// ── Phase 3: optimization_findings ───────────────────────────────────────────
export const optimizationFindings = pgTable(
  'optimization_findings',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull()
                 .references(() => workspaces.id, { onDelete: 'cascade' }),
    sessionId:   uuid('session_id')
                 .references(() => agentSessions.id, { onDelete: 'set null' }),
    taskId:      uuid('task_id')
                 .references(() => tasks.id, { onDelete: 'set null' }),
    rule:        text('rule').notNull(),
    // Values: 'stall' | 'high_retry' | 'cost_overrun' | 'parallel' | 'token_bloat' | 'context_wide'
    description:     text('description').notNull(),
    suggestedAction: text('suggested_action').notNull(),
    roiScore:        doublePrecision('roi_score').notNull().default(0),
    applied:    boolean('applied').notNull().default(false),
    appliedAt:  timestamp('applied_at'),
    dismissed:  boolean('dismissed').notNull().default(false),
    metadata:   jsonb('metadata'),
    createdAt:  timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    findingsWorkspaceIdx: index('findings_workspace_idx').on(table.workspaceId),
    findingsRuleIdx:      index('findings_rule_idx').on(table.rule),
    findingsAppliedIdx:   index('findings_applied_idx').on(table.applied),
  }),
);

// ── Phase 3: fix_history ──────────────────────────────────────────────────────
export const fixHistory = pgTable(
  'fix_history',
  {
    id:          uuid('id').primaryKey().defaultRandom(),
    taskId:      uuid('task_id').notNull()
                 .references(() => tasks.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id').notNull()
                 .references(() => workspaces.id, { onDelete: 'cascade' }),
    attemptNumber:      integer('attempt_number').notNull(),
    blockerDescription: text('blocker_description').notNull(),
    fixPrompt:          text('fix_prompt'),
    fixPromptModel:     text('fix_prompt_model'),
    status: text('status').notNull().default('pending'),
    // Values: 'pending' | 'dispatched' | 'succeeded' | 'exhausted'
    scheduledAt:  timestamp('scheduled_at').notNull(),
    dispatchedAt: timestamp('dispatched_at'),
    resolvedAt:   timestamp('resolved_at'),
    createdAt:    timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    fixHistoryTaskIdx: index('fix_history_task_idx').on(table.taskId),
  }),
);

// ── Phase 9.5: Notification Center ───────────────────────────────────────────
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').notNull().references(() => users.id),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recipientIdx: index('notifications_recipient_idx').on(table.recipientId, table.createdAt),
  }),
);

// ── DOCX / PDF attachments ────────────────────────────────────────────────────
// Stores metadata for uploaded source files (DOCX/PDF ingested as docs) and
// generated export files (DOCX/PDF rendered on demand). Binary content lives
// in R2; only the key and metadata are stored here.
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // docId = null for standalone attachments; set after ingestion creates the doc
    docId: uuid('doc_id').references(() => docs.id, { onDelete: 'set null' }),

    // 'source' = uploaded by user (DOCX/PDF ingested)
    // 'export' = generated on demand (DOCX/PDF rendered from a Mnema doc)
    type: text('type').notNull(),

    // 'docx' | 'pdf'
    format: text('format').notNull(),

    originalName: text('original_name'),

    // R2 object key: attachments/{workspaceId}/{uuid}.{ext}
    r2Key: text('r2_key').notNull(),

    sizeBytes: integer('size_bytes'),
    mimeType:  text('mime_type'),

    // 'pending' | 'processing' | 'ready' | 'failed'
    status:       text('status').notNull().default('pending'),
    errorMessage: text('error_message'),

    // Extraction metadata
    pageCount: integer('page_count'),
    usedOcr:   boolean('used_ocr').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('attachments_workspace_idx').on(table.workspaceId),
    docIdx:       index('attachments_doc_idx').on(table.docId),
    statusIdx:    index('attachments_status_idx').on(table.status),
  }),
);

// ─── KNOWLEDGE GRAPH ──────────────────────────────────────────────────────────

export const graphNodes = pgTable(
  'graph_nodes',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    // 'doc'|'flow'|'flow_step'|'task'|'session'|'concept'|'decision'|'project'|'rationale'
    entityType:  text('entity_type').notNull(),
    // Source/dedup key: a doc/project UUID for structural nodes, OR a synthetic
    // text key (e.g. "<ws>-<concept-slug>") for semantic concept nodes — so text,
    // not uuid (migration 0043).
    entityId:    text('entity_id').notNull(),
    // Denormalized project scope (from the referenced entity's doc/task project) for
    // project-filtered graph queries. Null = workspace-wide. Set by the graph builder.
    projectId:   uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    label:       text('label').notNull(),
    summary:     text('summary'),
    degree:                integer('degree').notNull().default(0),
    betweennessCentrality: doublePrecision('betweenness_centrality').default(0),
    isGodNode:             boolean('is_god_node').notNull().default(false),
    communityId:           integer('community_id'),
    communityLabel:        text('community_label'),
    // 'structural' | 'semantic'
    extractionPass: text('extraction_pass').notNull().default('structural'),
    lastExtractedAt: timestamp('last_extracted_at', { withTimezone: true }),
    // ── Decision Memory MD1 (temporal decision node; NULL for every non-decision node) ──
    decidedAt:    timestamp('decided_at', { withTimezone: true }),  // when the decision was made
    status:       text('status'),                                   // 'current' | 'historical' (decisions only)
    supersedes:   uuid('supersedes'),                               // → the decision this one replaces
    supersededBy: uuid('superseded_by'),                            // → the decision that replaced this one
    decisionText: text('decision_text'),                            // the full decision statement
    decidedIn:    uuid('decided_in'),                               // → meeting it was decided in (if any)
    aclScope:     text('acl_scope'),                                // project:<id> | workspace:<id>
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx:     unique('graph_nodes_entity_idx').on(table.workspaceId, table.entityType, table.entityId),
    workspaceIdx:  index('graph_nodes_workspace_idx').on(table.workspaceId),
    godNodeIdx:    index('graph_nodes_god_node_idx').on(table.isGodNode),
    communityIdx:  index('graph_nodes_community_idx').on(table.communityId),
    projectIdx:    index('graph_nodes_project_idx').on(table.projectId),
  }),
);

export const graphEdges = pgTable(
  'graph_edges',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    fromNodeId:  uuid('from_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
    toNodeId:    uuid('to_node_id').notNull().references(() => graphNodes.id,   { onDelete: 'cascade' }),
    // references|implements|depends_on|informs|contradicts|supersedes|
    // rationale_for|semantically_similar_to|part_of|preceded_by|belongs_to|claims|completes
    edgeType:    text('edge_type').notNull(),
    // 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
    provenance:      text('provenance').notNull(),
    confidenceScore: doublePrecision('confidence_score').notNull().default(1.0),
    // cross-type edges (doc->flow, task->concept) get weight=1.5
    weight:          doublePrecision('weight').notNull().default(1.0),
    // required for INFERRED/AMBIGUOUS
    rationale:     text('rationale'),
    // source text span for EXTRACTED
    extractedFrom: text('extracted_from'),
    isDirected:    boolean('is_directed').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueEdge:  unique('graph_edges_unique_idx').on(table.fromNodeId, table.toNodeId, table.edgeType),
    fromIdx:     index('graph_edges_from_idx').on(table.fromNodeId),
    toIdx:       index('graph_edges_to_idx').on(table.toNodeId),
    workspaceIdx: index('graph_edges_workspace_idx').on(table.workspaceId),
  }),
);

export const graphCommunities = pgTable(
  'graph_communities',
  {
    id:          integer('id').notNull(),
    workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    label:       text('label').notNull(),
    description: text('description'),
    nodeCount:   integer('node_count').notNull().default(0),
    suggestedQuestions: text('suggested_questions').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk:           primaryKey({ columns: [table.id, table.workspaceId] }),
    workspaceIdx: index('graph_communities_workspace_idx').on(table.workspaceId),
  }),
);

export const graphReports = pgTable(
  'graph_reports',
  {
    id:               uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:      uuid('workspace_id').notNull().unique().references(() => workspaces.id, { onDelete: 'cascade' }),
    docId:            uuid('doc_id').references(() => docs.id, { onDelete: 'set null' }),
    totalNodes:       integer('total_nodes').notNull().default(0),
    totalEdges:       integer('total_edges').notNull().default(0),
    totalCommunities: integer('total_communities').notNull().default(0),
    godNodeCount:     integer('god_node_count').notNull().default(0),
    lastBuiltAt:      timestamp('last_built_at', { withTimezone: true }),
    // 'pending' | 'building' | 'ready' | 'failed'
    status:    text('status').notNull().default('pending'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

/** CL-1 — community-license registrations (email → free community key). Written
 *  only by the hosted licensing service (ee, cloud). Present in core schema so the
 *  migration is shared; the issuing route is stripped from the public build. */
export const communityRegistrations = pgTable('community_registrations', {
  id:              uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email:           text('email').notNull().unique(),
  issuedAt:        timestamp('issued_at', { withTimezone: true }).notNull().default(sql`now()`),
  versionReported: text('version_reported'),
  unsubToken:      text('unsub_token').notNull().unique(),
  unsubscribedAt:  timestamp('unsubscribed_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

/* ── Community Flows hub (migration 0071) ─────────────────────────────────────
 * CENTRAL, cross-instance catalog of shareable flow templates. Unlike almost
 * everything else, these tables are NOT workspace-scoped and carry NO RLS — the
 * hub is cross-instance by design and is read via the superuser `db` client
 * (mirrors the /api/docs/public pattern). Populated only on the SaaS hub (EE);
 * inert empty tables on self-host installs. template_json holds the portable
 * PortableFlowTemplate (lib/flows/portability.ts) with all workspace ids stripped. */
export const communityFlows = pgTable(
  'community_flows',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    templateJson: jsonb('template_json').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    // Publisher identity derived from the validated community-license key.
    publisherEmail: text('publisher_email').notNull(),
    publisherHandle: text('publisher_handle'),
    sourceVersion: text('source_version'),
    nodeCount: integer('node_count').notNull().default(0),
    edgeCount: integer('edge_count').notNull().default(0),
    importCount: integer('import_count').notNull().default(0),
    // listed | unlisted | removed
    status: text('status').notNull().default('listed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('community_flows_status_idx').on(table.status),
    publisherIdx: index('community_flows_publisher_idx').on(table.publisherEmail),
    popularityIdx: index('community_flows_popularity_idx').on(table.importCount),
    // one listing per (publisher, name) — re-publishing updates in place.
    publisherNameUnique: unique('community_flows_publisher_name_key').on(
      table.publisherEmail,
      table.name,
    ),
  }),
);

export const communityFlowReports = pgTable(
  'community_flow_reports',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    communityFlowId: uuid('community_flow_id')
      .notNull()
      .references(() => communityFlows.id, { onDelete: 'cascade' }),
    // spam | malicious | inappropriate | broken | other
    reason: text('reason').notNull(),
    detail: text('detail'),
    reporterFingerprint: text('reporter_fingerprint'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (table) => ({
    flowIdx: index('community_flow_reports_flow_idx').on(table.communityFlowId),
    unresolvedIdx: index('community_flow_reports_unresolved_idx').on(table.resolvedAt),
  }),
);

// ── Internal admin center (migration 0047) ──────────────────────────────────────

/** A license: a plan tier + seats + entitlements, optionally bound to a workspace
 *  and/or carrying a redeemable key. Admin-managed. */
export const licenses = pgTable(
  'licenses',
  {
    id:           uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId:  uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    planTier:     text('plan_tier').notNull().default('free'),
    seats:        integer('seats').notNull().default(1),
    entitlements: jsonb('entitlements').notNull().default(sql`'{}'::jsonb`),
    licenseKey:   text('license_key').unique(),
    // active | trial | expiring | expired | suspended | revoked
    status:       text('status').notNull().default('active'),
    startsAt:     timestamp('starts_at', { withTimezone: true }),
    expiresAt:    timestamp('expires_at', { withTimezone: true }),
    issuedBy:     uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedBy:   uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedAt:   timestamp('redeemed_at', { withTimezone: true }),
    notes:        text('notes'),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('licenses_workspace_idx').on(table.workspaceId),
    statusIdx:    index('licenses_status_idx').on(table.status),
  }),
);

/** Append-only record of every admin action (license changes, suspensions,
 *  impersonations, log views). No delete path. */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail:  text('actor_email').notNull(),
    action:      text('action').notNull(),
    targetType:  text('target_type'),
    targetId:    text('target_id'),
    payload:     jsonb('payload'),
    ip:          text('ip'),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index('admin_audit_created_idx').on(table.createdAt),
  }),
);
