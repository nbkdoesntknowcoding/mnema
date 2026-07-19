/**
 * Phase 10 — Google Drive folder linking + two-way sync.
 *
 *   GET   /api/drive/connect          → redirect to Google consent (offline, configurable scope)
 *   GET   /api/drive/callback         → exchange code, store encrypted refresh token
 *   GET   /api/drive/status           → { connected, configured, scope }
 *   GET   /api/drive/folders?parent=  → list the user's Drive folders (picker)
 *   GET   /api/drive/links            → list this workspace's folder links
 *   POST  /api/drive/links            → link a Mnema folder ⇄ Drive folder
 *   PATCH /api/drive/links/:id        → edit types / direction / conflict policy / pause
 *   DELETE /api/drive/links/:id       → unlink
 *   POST  /api/drive/links/:id/sync   → enqueue a sync now
 *
 * The refresh token is user-scoped (their Google Drive); links + mappings are
 * workspace-scoped and enforced app-layer (filter by workspace_id + requireRole).
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { config } from '../config/env.js';
import { db } from '../db/index.js';
import { driveFileMappings, driveFolderLinks, folders, workspaceMembers } from '../db/schema.js';
import {
  consentUrl, createDriveFolder, DEFAULT_ACCEPTED_TYPES, driveClientFromRefresh,
  driveConfigured, driveScopeUrl, exchangeCode, listDriveFolders, type DriveClient,
} from '../lib/google-drive.js';
import { enqueueDriveSync } from '../queue/drive-sync.js';
import { requireRole, RoleError } from '../lib/role.js';
import { signState, verifySignedState } from '../lib/secret-box.js';
import { getSecretStore } from '../lib/secret-store/index.js';

const DIRECTIONS = ['pull', 'push', 'both'] as const;
const CONFLICT_POLICIES = ['manual', 'lww'] as const;

export const driveRoutes: FastifyPluginAsync = async (app) => {
  function guard(err: unknown, reply: FastifyReply): boolean {
    if (err instanceof RoleError) { reply.code(err.status).send({ error: err.reason }); return true; }
    return false;
  }

  /** The requesting user's Drive client (their token), or null if not connected. */
  async function userDrive(userId: string): Promise<DriveClient | null> {
    const rows = await db.select({ tok: workspaceMembers.driveRefreshToken })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, userId), isNotNull(workspaceMembers.driveRefreshToken)))
      .limit(1);
    const enc = rows[0]?.tok;
    return enc ? driveClientFromRefresh(await getSecretStore().decrypt(enc)) : null;
  }

  function normalizeTypes(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return [...new Set(input
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean))];
  }

  // ── Start the link flow ────────────────────────────────────────────────────
  app.get('/api/drive/connect', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    if (!driveConfigured()) return reply.code(503).send({ error: 'drive_not_configured' });
    try { await requireRole(req, 'editor'); } catch (e) { if (guard(e, reply)) return; throw e; }
    const state = signState({ sub: req.auth.sub, tenant: req.auth.tenant_id });
    const url = consentUrl(state);
    // Navigate to Google WITHOUT a referrer (same reasoning as calendar connect):
    // a referrer-less navigation resolves the active session and shows the account
    // chooser instead of Google's sign-in form (which 400s without a session).
    return reply
      .header('Referrer-Policy', 'no-referrer')
      .type('text/html')
      .send(
        `<!doctype html><meta name="referrer" content="no-referrer">` +
        `<script>location.replace(${JSON.stringify(url)})</script>` +
        `<noscript><a href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">Continue to Google</a></noscript>`,
      );
  });

  // ── Google redirects back here ─────────────────────────────────────────────
  app.get('/api/drive/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const back = `${config.WEB_BASE_URL}/app/settings/integrations`;
    if (q.error || !q.code || !q.state) return reply.redirect(`${back}?drive=error`);
    const st = verifySignedState(q.state);
    if (!st || !driveConfigured()) return reply.redirect(`${back}?drive=error`);
    try {
      const tokens = await exchangeCode(q.code);
      if (!tokens.refresh_token) {
        req.log.warn('drive callback: no refresh_token returned');
        return reply.redirect(`${back}?drive=error`);
      }
      await db.update(workspaceMembers)
        .set({ driveRefreshToken: await getSecretStore().encrypt(tokens.refresh_token) })
        .where(and(eq(workspaceMembers.workspaceId, st.tenant), eq(workspaceMembers.userId, st.sub)));
      return reply.redirect(`${back}?drive=connected`);
    } catch (err) {
      req.log.error({ err }, 'drive callback failed');
      return reply.redirect(`${back}?drive=error`);
    }
  });

  // ── Connection status ──────────────────────────────────────────────────────
  app.get('/api/drive/status', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const rows = await db.select({ tok: workspaceMembers.driveRefreshToken })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, req.auth.sub), isNotNull(workspaceMembers.driveRefreshToken)))
      .limit(1);
    return reply.send({
      connected: rows.length > 0,
      configured: driveConfigured(),
      scope: driveConfigured() ? driveScopeUrl() : null,
      defaultTypes: DEFAULT_ACCEPTED_TYPES,
    });
  });

  // ── List the user's Drive folders (for the picker) ─────────────────────────
  app.get('/api/drive/folders', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    if (!driveConfigured()) return reply.code(503).send({ error: 'drive_not_configured' });
    const drive = await userDrive(req.auth.sub);
    if (!drive) return reply.code(400).send({ error: 'drive_not_connected' });
    const parent = (req.query as { parent?: string }).parent || 'root';
    try {
      const folderList = await listDriveFolders(drive, parent);
      return reply.send({ folders: folderList });
    } catch (err) {
      req.log.error({ err }, 'drive folders list failed');
      return reply.code(502).send({ error: 'drive_list_failed' });
    }
  });

  // ── List links for the active workspace ────────────────────────────────────
  app.get('/api/drive/links', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const ws = req.auth.tenant_id;
    const rows = await db.select().from(driveFolderLinks)
      .where(eq(driveFolderLinks.workspaceId, ws));
    return reply.send({ links: rows });
  });

  // ── Create a link ──────────────────────────────────────────────────────────
  app.post('/api/drive/links', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    if (!driveConfigured()) return reply.code(503).send({ error: 'drive_not_configured' });
    try { await requireRole(req, 'editor'); } catch (e) { if (guard(e, reply)) return; throw e; }

    const ws = req.auth.tenant_id;
    const body = req.body as {
      folderId?: string;
      driveFolderId?: string;
      createInDrive?: boolean;
      driveParentId?: string;
      driveFolderName?: string;
      acceptedTypes?: string[];
      direction?: string;
      conflictPolicy?: string;
    };
    if (!body.folderId) return reply.code(400).send({ error: 'folderId_required' });

    // The Mnema folder must belong to the active workspace.
    const [folder] = await db.select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(and(eq(folders.id, body.folderId), eq(folders.workspaceId, ws)))
      .limit(1);
    if (!folder) return reply.code(404).send({ error: 'folder_not_found' });

    const drive = await userDrive(req.auth.sub);
    if (!drive) return reply.code(400).send({ error: 'drive_not_connected' });

    // Resolve the Drive folder: either an existing one, or create it from the Mnema folder.
    let driveFolderId = body.driveFolderId;
    let driveFolderName = body.driveFolderName ?? null;
    try {
      if (body.createInDrive) {
        driveFolderId = await createDriveFolder(drive, folder.name, body.driveParentId);
        driveFolderName = folder.name;
      }
    } catch (err) {
      req.log.error({ err }, 'drive folder create failed');
      return reply.code(502).send({ error: 'drive_create_failed' });
    }
    if (!driveFolderId) return reply.code(400).send({ error: 'driveFolderId_or_createInDrive_required' });

    const direction = DIRECTIONS.includes(body.direction as never) ? body.direction! : 'both';
    const conflictPolicy = CONFLICT_POLICIES.includes(body.conflictPolicy as never) ? body.conflictPolicy! : 'manual';

    try {
      const [link] = await db.insert(driveFolderLinks).values({
        workspaceId: ws,
        folderId: folder.id,
        driveFolderId,
        driveFolderName,
        connectedBy: req.auth.sub,
        direction,
        conflictPolicy,
        acceptedTypes: normalizeTypes(body.acceptedTypes),
      }).returning();
      // Kick off an initial sync.
      await enqueueDriveSync({ linkId: link!.id, reason: 'manual' });
      return reply.send({ link });
    } catch (err) {
      // Unique violation → folder already linked.
      req.log.warn({ err }, 'drive link create failed');
      return reply.code(409).send({ error: 'already_linked' });
    }
  });

  // ── Edit a link ────────────────────────────────────────────────────────────
  app.patch('/api/drive/links/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'editor'); } catch (e) { if (guard(e, reply)) return; throw e; }
    const ws = req.auth.tenant_id;
    const { id } = req.params as { id: string };
    const body = req.body as { acceptedTypes?: string[]; direction?: string; conflictPolicy?: string; status?: string };

    const patch: Partial<typeof driveFolderLinks.$inferInsert> = { updatedAt: new Date() };
    if (body.acceptedTypes !== undefined) patch.acceptedTypes = normalizeTypes(body.acceptedTypes);
    if (body.direction && DIRECTIONS.includes(body.direction as never)) patch.direction = body.direction;
    if (body.conflictPolicy && CONFLICT_POLICIES.includes(body.conflictPolicy as never)) patch.conflictPolicy = body.conflictPolicy;
    if (body.status === 'active' || body.status === 'paused') patch.status = body.status;

    const [link] = await db.update(driveFolderLinks).set(patch)
      .where(and(eq(driveFolderLinks.id, id), eq(driveFolderLinks.workspaceId, ws)))
      .returning();
    if (!link) return reply.code(404).send({ error: 'link_not_found' });
    return reply.send({ link });
  });

  // ── Unlink ─────────────────────────────────────────────────────────────────
  app.delete('/api/drive/links/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'editor'); } catch (e) { if (guard(e, reply)) return; throw e; }
    const ws = req.auth.tenant_id;
    const { id } = req.params as { id: string };
    const [gone] = await db.delete(driveFolderLinks)
      .where(and(eq(driveFolderLinks.id, id), eq(driveFolderLinks.workspaceId, ws)))
      .returning({ id: driveFolderLinks.id });
    if (!gone) return reply.code(404).send({ error: 'link_not_found' });
    return reply.send({ ok: true });
  });

  // ── Sync now ───────────────────────────────────────────────────────────────
  app.post('/api/drive/links/:id/sync', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    try { await requireRole(req, 'editor'); } catch (e) { if (guard(e, reply)) return; throw e; }
    const ws = req.auth.tenant_id;
    const { id } = req.params as { id: string };
    const [link] = await db.select({ id: driveFolderLinks.id }).from(driveFolderLinks)
      .where(and(eq(driveFolderLinks.id, id), eq(driveFolderLinks.workspaceId, ws)))
      .limit(1);
    if (!link) return reply.code(404).send({ error: 'link_not_found' });
    await enqueueDriveSync({ linkId: id, reason: 'manual' });
    return reply.send({ ok: true, queued: true });
  });

  // ── Conflicts for a link (for the resolver UI) ─────────────────────────────
  app.get('/api/drive/links/:id/conflicts', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthorized' });
    const ws = req.auth.tenant_id;
    const { id } = req.params as { id: string };
    const [link] = await db.select({ id: driveFolderLinks.id }).from(driveFolderLinks)
      .where(and(eq(driveFolderLinks.id, id), eq(driveFolderLinks.workspaceId, ws)))
      .limit(1);
    if (!link) return reply.code(404).send({ error: 'link_not_found' });
    const rows = await db.select().from(driveFileMappings)
      .where(and(eq(driveFileMappings.linkId, id), eq(driveFileMappings.syncState, 'conflict')));
    return reply.send({ conflicts: rows });
  });
};
