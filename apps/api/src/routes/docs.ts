import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeMarkdownIntoLiveDoc } from '../collab/writeback.js';
import { db } from '../db/index.js';
import { attachments, docAccessRequests, docAcl, docs, folders, notifications, users } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { canAccess } from '../lib/iam.js';
import { getUserRole } from '../lib/role.js';
import { contentHash, emptyYjsState } from '../lib/yjs.js';
import { enforceFreeDocLimit } from '../plugins/free-limits.js';

const UUID_RE_DOCS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOC_TYPE = z.enum(['doc', 'engineering', 'instruction', 'snippet']);

const createSchema = z.object({
  title: z.string().min(1).max(200).default('Untitled'),
  markdown: z.string().default(''),
  // Phase 5: content type. Defaults to 'doc' (freeform markdown) so
  // existing clients that don't send the field stay valid.
  type: DOC_TYPE.default('doc'),
  // Phase 6.4: optional folder placement on creation.
  folder_id: z.string().uuid().nullable().optional(),
});

// 1.2: title and markdown are both optional but at least one must be present.
// Title-only updates skip the writeback path; body changes try writeback first
// (so connected clients see the change immediately) and fall through to a
// direct row write if no collab session is loaded for the doc.
const saveSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    markdown: z.string().optional(),
  })
  .refine((d) => d.title !== undefined || d.markdown !== undefined, {
    message: 'Provide at least one of title or markdown',
  });

interface DocRow {
  id: string;
  path: string;
  title: string;
  markdown: string;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}
function shapeForResponse(row: DocRow): {
  id: string;
  path: string;
  title: string;
  markdown: string;
  content_hash: string | null;
  created_at: Date;
  updated_at: Date;
} {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    markdown: row.markdown,
    content_hash: row.contentHash,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export const docsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/docs', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const q = (req.query as Record<string, unknown> | null) ?? {};

    // Phase 5: optional ?type= filter for the sidebar's typed views.
    const typeFilter = DOC_TYPE.safeParse(q.type);

    // Phase 6.4: optional ?folder_id= filter. 'null' string → unfiled docs.
    const rawFolder = q.folder_id as string | undefined;
    const folderFilter =
      rawFolder === 'null' ? 'null' :
      rawFolder && UUID_RE_DOCS.test(rawFolder) ? rawFolder :
      undefined;

    // Hierarchy: optional ?project_id= filter. 'null' string → unfiled/workspace docs.
    const rawProject = q.project_id as string | undefined;
    const projectFilter =
      rawProject === 'null' ? 'null' :
      rawProject && UUID_RE_DOCS.test(rawProject) ? rawProject :
      undefined;

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      const conditions = [isNull(docs.deletedAt)];
      if (typeFilter.success) conditions.push(eq(docs.type, typeFilter.data));
      if (folderFilter === 'null') conditions.push(isNull(docs.folderId));
      else if (folderFilter) conditions.push(eq(docs.folderId, folderFilter));
      if (projectFilter === 'null') conditions.push(isNull(docs.projectId));
      else if (projectFilter) conditions.push(eq(docs.projectId, projectFilter));
      return await tx
        .select({
          id: docs.id,
          path: docs.path,
          title: docs.title,
          type: docs.type,
          folder_id: docs.folderId,
          created_at: docs.createdAt,
          updated_at: docs.updatedAt,
          source_attachment_format: attachments.format,
        })
        .from(docs)
        .leftJoin(attachments, eq(docs.sourceAttachmentId, attachments.id))
        .where(and(...conditions))
        .orderBy(desc(docs.updatedAt))
        .limit(100);
    });

    // M4 fix: doc_acl post-filter as a SINGLE batch query (was an N+1 of per-doc
    // canAccess). RLS already narrowed the set; this only drops docs where the caller
    // holds an explicit, non-expired user-level 'none' deny (which RLS does not honor
    // against project membership). Folder/project/team denies are still enforced on the
    // single-doc GET path via canAccess.
    const docIds = rows.map((d) => d.id);
    let visible = rows;
    if (docIds.length) {
      const denied = await db
        .select({ resourceId: docAcl.resourceId })
        .from(docAcl)
        .where(and(
          eq(docAcl.workspaceId, req.auth.tenant_id),
          eq(docAcl.resourceType, 'doc'),
          inArray(docAcl.resourceId, docIds),
          eq(docAcl.principalType, 'user'),
          eq(docAcl.principalId, req.auth.sub),
          eq(docAcl.permission, 'none'),
          or(isNull(docAcl.expiresAt), gt(docAcl.expiresAt, new Date())),
        ));
      if (denied.length) {
        const deniedIds = new Set(denied.map((r) => r.resourceId));
        visible = rows.filter((d) => !deniedIds.has(d.id));
      }
    }

    return { docs: visible };
  });

  // Phase 5: counts per content type. Lets the sidebar hide filter chips
  // for types the workspace doesn't have yet. One small query per shell
  // mount, cached client-side.
  app.get('/api/content/type-counts', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    const rows = await withTenant(req.auth.tenant_id, async (tx) => {
      return await tx.execute(
        sql`SELECT type, COUNT(*)::int AS count
            FROM docs
            WHERE deleted_at IS NULL
            GROUP BY type`,
      );
    });

    // postgres-js returns the execute() result as the array of rows directly
    // (it's not wrapped in `{ rows: [] }` the way `pg` does it).
    const counts: Record<string, number> = { doc: 0, engineering: 0, instruction: 0, snippet: 0 };
    const rowList = rows as unknown as Array<{ type: string; count: number }>;
    for (const row of rowList) {
      counts[row.type] = Number(row.count) || 0;
    }
    return { counts };
  });

  app.post('/api/docs', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });

    // Enforce free plan doc limit (no-op for paid workspaces).
    if (await enforceFreeDocLimit(req, reply, req.auth.tenant_id)) return;

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const auth = req.auth;
    const path = `${nanoid(10)}.md`;

    const created = await withTenant(auth.tenant_id, async (tx) => {
      // Hierarchy: a doc inherits its folder's project (null if unfiled).
      let projectId: string | null = null;
      if (parsed.data.folder_id) {
        const f = await tx
          .select({ projectId: folders.projectId })
          .from(folders)
          .where(eq(folders.id, parsed.data.folder_id))
          .limit(1);
        projectId = f[0]?.projectId ?? null;
      }
      const inserted = await tx
        .insert(docs)
        .values({
          workspaceId: auth.tenant_id,
          folderId: parsed.data.folder_id ?? null,
          projectId,
          path,
          title: parsed.data.title,
          type: parsed.data.type,
          markdown: parsed.data.markdown,
          yjsState: emptyYjsState(),
          contentHash: contentHash(parsed.data.markdown),
          createdBy: auth.sub,
          updatedBy: auth.sub,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('Failed to create doc');
      return row;
    });

    return reply.code(201).send({
      doc: {
        id: created.id,
        path: created.path,
        title: created.title,
        markdown: created.markdown,
        content_hash: created.contentHash,
        created_at: created.createdAt,
        updated_at: created.updatedAt,
      },
    });
  });

  // GET /api/docs/public/:token — no auth required; must be registered before /:id
  // so Fastify's radix tree can favour the static 'public' segment.
  app.get<{ Params: { token: string } }>('/api/docs/public/:token', async (req, reply) => {
    const { token } = req.params;
    if (!isUuid(token)) return reply.code(400).send({ error: 'bad_token' });

    // Query without row-level security (no tenant context needed)
    const rows = await db
      .select({
        id: docs.id,
        path: docs.path,
        title: docs.title,
        markdown: docs.markdown,
        contentHash: docs.contentHash,
        isPublic: docs.isPublic,
        createdAt: docs.createdAt,
        updatedAt: docs.updatedAt,
      })
      .from(docs)
      .where(and(eq(docs.publicToken, token), eq(docs.isPublic, true), isNull(docs.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'not_found' });

    return {
      doc: {
        id: row.id,
        path: row.path,
        title: row.title,
        markdown: row.markdown,
        content_hash: row.contentHash,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      },
    };
  });

  app.get<{ Params: { id: string } }>('/api/docs/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const result = await withTenant(req.auth.tenant_id, async (tx) => {
      const rows = await tx
        .select({
          doc: docs,
          attachmentId:       attachments.id,
          attachmentFormat:   attachments.format,
          attachmentName:     attachments.originalName,
          attachmentSize:     attachments.sizeBytes,
          folderId:           folders.id,
          folderName:         folders.name,
          folderParentId:     folders.parentFolderId,
        })
        .from(docs)
        .leftJoin(attachments, eq(docs.sourceAttachmentId, attachments.id))
        .leftJoin(folders, eq(docs.folderId, folders.id))
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .limit(1);
      return rows[0];
    });

    if (!result) return reply.code(404).send({ error: 'not_found' });
    const { doc: row } = result;

    // FIX 4: doc_acl enforcement at the REST layer (defence in depth — RLS catches
    // DB reads, this catches an explicit doc-level deny). Returns a stub so the UI
    // can offer "Request access" instead of a blank error.
    const permitted = await canAccess(db, req.auth.sub, req.auth.tenant_id, 'doc', id, 'read');
    if (!permitted) {
      return reply.code(403).send({
        error: 'access_denied',
        stub: { id: row.id, title: row.title, owner_id: row.createdBy, created_at: row.createdAt },
      });
    }

    return {
      doc: {
        id: row.id,
        path: row.path,
        title: row.title,
        markdown: row.markdown,
        content_hash: row.contentHash,
        is_public: row.isPublic,
        public_token: row.publicToken,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        folder: result.folderId ? {
          id:       result.folderId,
          name:     result.folderName,
          parentId: result.folderParentId ?? null,
        } : null,
        sourceAttachment: result.attachmentId ? {
          id:           result.attachmentId,
          format:       result.attachmentFormat as 'docx' | 'pdf',
          originalName: result.attachmentName,
          sizeBytes:    result.attachmentSize,
        } : null,
      },
    };
  });

  // POST /api/docs/:id/share — toggle public link on/off.
  // Body: { enable: boolean }
  // Returns: { is_public, public_token, share_url }
  app.post<{ Params: { id: string } }>('/api/docs/:id/share', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const parsed = z.object({ enable: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request' });

    const { enable } = parsed.data;
    const auth = req.auth;

    const updated = await withTenant(auth.tenant_id, async (tx) => {
      // Fetch current row to get or create publicToken
      const current = await tx
        .select({ publicToken: docs.publicToken, isPublic: docs.isPublic })
        .from(docs)
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .limit(1);
      if (!current[0]) return null;

      const token = enable ? (current[0].publicToken ?? randomUUID()) : current[0].publicToken;
      const rows = await tx
        .update(docs)
        .set({ isPublic: enable, publicToken: token ?? undefined })
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .returning({ id: docs.id, isPublic: docs.isPublic, publicToken: docs.publicToken });
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });

    const shareUrl = updated.publicToken
      ? `https://mnema.example.com/share/${updated.publicToken}`
      : null;

    return { is_public: updated.isPublic, public_token: updated.publicToken, share_url: shareUrl };
  });

  app.post<{ Params: { id: string } }>('/api/docs/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const { id } = req.params;
    if (!isUuid(id)) return reply.code(400).send({ error: 'bad_id' });

    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const auth = req.auth;
    const { title, markdown } = parsed.data;

    // -------- Body update path: try writeback into the live Y.Doc first.
    let appliedViaCollab = false;
    if (markdown !== undefined) {
      appliedViaCollab = await writeMarkdownIntoLiveDoc(id, markdown, {
        user_id: auth.sub,
        tenant_id: auth.tenant_id,
        email: auth.email,
        doc_id: id,
      });
    }

    // -------- Single transaction for whatever DB writes are still needed.
    const updated = await withTenant(auth.tenant_id, async (tx) => {
      // If body went through collab, the next debounced onStoreDocument
      // writes the canonical body. Skip writing markdown/contentHash here.
      const setClause: Partial<{
        title: string;
        markdown: string;
        contentHash: string;
        updatedBy: string;
        updatedAt: Date;
      }> = {
        updatedBy: auth.sub,
        // Bump recency on any real mutation here (title change, or markdown that did
        // NOT go through collab). When markdown was applied via collab, the debounced
        // onStoreDocument bumps updated_at instead, so we don't touch it on the
        // updatedBy-only no-op path below.
        updatedAt: new Date(),
      };
      if (title !== undefined) setClause.title = title;
      if (markdown !== undefined && !appliedViaCollab) {
        setClause.markdown = markdown;
        setClause.contentHash = contentHash(markdown);
      }

      // No-op detection: if we'd only be touching updatedBy, skip the UPDATE
      // and just SELECT to return the current row.
      const hasMutation =
        setClause.title !== undefined ||
        setClause.markdown !== undefined;

      if (!hasMutation) {
        const rows = await tx
          .select()
          .from(docs)
          .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
          .limit(1);
        return rows[0];
      }

      const rows = await tx
        .update(docs)
        .set(setClause)
        .where(and(eq(docs.id, id), isNull(docs.deletedAt)))
        .returning();
      return rows[0];
    });

    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { doc: shapeForResponse(updated) };
  });

  // ── FIX 6: access request flow ───────────────────────────────────────────────
  // POST /api/docs/:docId/request-access — any member may ask for access to a doc
  // they can't see. We read the title + owner via the owner connection (bypasses
  // RLS intentionally — title + owner only, never content) to address the request.
  app.post<{ Params: { docId: string }; Body: { message?: string; permission?: 'read' | 'write' } }>(
    '/api/docs/:docId/request-access',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const { docId } = req.params;
      if (!isUuid(docId)) return reply.code(400).send({ error: 'bad_id' });
      const permission = req.body?.permission === 'write' ? 'write' : 'read';

      const [doc] = await db
        .select({ id: docs.id, title: docs.title, createdBy: docs.createdBy })
        .from(docs)
        .where(and(eq(docs.id, docId), eq(docs.workspaceId, req.auth.tenant_id)))
        .limit(1);
      if (!doc) return reply.code(404).send({ error: 'not_found' });

      // C1 fix: the recipient is ALWAYS the doc owner, derived server-side. Never
      // trust a client-supplied requestedFromId — that allowed self-routing +
      // self-approval to grant oneself access to any doc.
      const recipientId = doc.createdBy;
      if (!recipientId) return reply.code(400).send({ error: 'no_recipient' });

      const [created] = await db.insert(docAccessRequests).values({
        workspaceId: req.auth.tenant_id,
        docId,
        requesterId: req.auth.sub,
        requestedFromId: recipientId,
        message: req.body?.message ?? null,
        permission,
      }).onConflictDoNothing().returning({ id: docAccessRequests.id });

      // Notify the recipient (actorId = the requester). Skip if the request was a
      // duplicate (onConflictDoNothing returned nothing) or self-directed.
      if (created && recipientId !== req.auth.sub) {
        const [requester] = await db.select({ name: users.displayName, email: users.email })
          .from(users).where(eq(users.id, req.auth.sub)).limit(1);
        const who = requester?.name || requester?.email || 'A teammate';
        await db.insert(notifications).values({
          workspaceId: req.auth.tenant_id,
          recipientId,
          actorId: req.auth.sub,
          kind: 'access_request',
          title: `Access request: ${doc.title}`,
          body: `${who} is requesting ${permission} access.`,
          link: `/app/docs/${docId}`,
        });
      }
      return reply.code(201).send({ requested: true });
    },
  );

  // PATCH /api/docs/access-requests/:requestId — the recipient approves or denies.
  // Approval writes a doc_acl grant (optionally time-limited) and notifies the asker.
  app.patch<{ Params: { requestId: string }; Body: { action: 'approve' | 'deny'; expiresAt?: string | null } }>(
    '/api/docs/access-requests/:requestId',
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
      const { requestId } = req.params;
      if (!isUuid(requestId)) return reply.code(400).send({ error: 'bad_id' });
      const action = req.body?.action;
      if (action !== 'approve' && action !== 'deny') return reply.code(400).send({ error: 'bad_action' });

      const [request] = await db.select().from(docAccessRequests).where(and(
        eq(docAccessRequests.id, requestId),
        eq(docAccessRequests.workspaceId, req.auth.tenant_id),
        eq(docAccessRequests.status, 'pending'),
      )).limit(1);
      if (!request) return reply.code(404).send({ error: 'not_found' });

      // C1 fix: authorize from the DOC, not the request's (previously self-selectable)
      // recipient field. Only the doc owner or a workspace owner/admin may resolve.
      const [docRow] = await db.select({ createdBy: docs.createdBy })
        .from(docs).where(and(eq(docs.id, request.docId), eq(docs.workspaceId, req.auth.tenant_id))).limit(1);
      const callerRole = await getUserRole(req.auth.sub, req.auth.tenant_id);
      const isDocOwner = !!docRow && docRow.createdBy === req.auth.sub;
      const isWorkspaceAdmin = callerRole === 'owner' || callerRole === 'admin';
      if (!isDocOwner && !isWorkspaceAdmin) {
        return reply.code(403).send({ error: 'only_doc_owner_or_admin_can_approve' });
      }

      const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;

      if (action === 'approve') {
        // Never clobber an explicit 'none' deny via the grant upsert.
        const [deny] = await db.select({ id: docAcl.id }).from(docAcl).where(and(
          eq(docAcl.resourceType, 'doc'),
          eq(docAcl.resourceId, request.docId),
          eq(docAcl.principalType, 'user'),
          eq(docAcl.principalId, request.requesterId),
          eq(docAcl.permission, 'none'),
        )).limit(1);
        if (deny) {
          // Mark the request resolved (denied) so it doesn't linger as pending.
          await db.update(docAccessRequests)
            .set({ status: 'denied', resolvedBy: req.auth.sub, resolvedAt: new Date() })
            .where(eq(docAccessRequests.id, requestId));
          return reply.code(409).send({ error: 'access_explicitly_denied_by_policy' });
        }

        await db.insert(docAcl).values({
          workspaceId: req.auth.tenant_id,
          resourceType: 'doc',
          resourceId: request.docId,
          principalType: 'user',
          principalId: request.requesterId,
          permission: request.permission,
          createdBy: req.auth.sub,
          expiresAt,
        }).onConflictDoUpdate({
          target: [docAcl.resourceType, docAcl.resourceId, docAcl.principalType, docAcl.principalId],
          set: { permission: request.permission, expiresAt, updatedAt: new Date() },
        });

        await db.insert(notifications).values({
          workspaceId: req.auth.tenant_id,
          recipientId: request.requesterId,
          actorId: req.auth.sub,
          kind: 'access_granted',
          title: 'Access granted',
          body: expiresAt
            ? `You have ${request.permission} access until ${expiresAt.toISOString().slice(0, 10)}.`
            : `You have permanent ${request.permission} access.`,
          link: `/app/docs/${request.docId}`,
        });
      }

      await db.update(docAccessRequests)
        .set({ status: action === 'approve' ? 'approved' : 'denied', resolvedBy: req.auth.sub, resolvedAt: new Date() })
        .where(eq(docAccessRequests.id, requestId));

      return reply.send({ status: action === 'approve' ? 'approved' : 'denied' });
    },
  );

  // GET /api/docs/access-requests?box=incoming|outgoing — list requests for the UI.
  // incoming = requests routed to me (I'm the doc owner) → I approve/deny them.
  // outgoing = requests I filed → I see their status.
  app.get<{ Querystring: { box?: string } }>('/api/docs/access-requests', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const box = req.query.box === 'outgoing' ? 'outgoing' : 'incoming';
    const requester = alias(users, 'req_user');
    const owner = alias(users, 'own_user');
    const mine = box === 'outgoing' ? docAccessRequests.requesterId : docAccessRequests.requestedFromId;

    const rows = await db
      .select({
        id: docAccessRequests.id,
        doc_id: docAccessRequests.docId,
        doc_title: docs.title,
        status: docAccessRequests.status,
        permission: docAccessRequests.permission,
        message: docAccessRequests.message,
        created_at: docAccessRequests.createdAt,
        requester_name: requester.displayName,
        requester_email: requester.email,
        owner_name: owner.displayName,
        owner_email: owner.email,
      })
      .from(docAccessRequests)
      .leftJoin(docs, eq(docs.id, docAccessRequests.docId))
      .leftJoin(requester, eq(requester.id, docAccessRequests.requesterId))
      .leftJoin(owner, eq(owner.id, docAccessRequests.requestedFromId))
      .where(and(eq(mine, req.auth.sub), eq(docAccessRequests.workspaceId, req.auth.tenant_id)))
      .orderBy(desc(docAccessRequests.createdAt))
      .limit(100);

    return reply.send({ box, requests: rows });
  });
};
