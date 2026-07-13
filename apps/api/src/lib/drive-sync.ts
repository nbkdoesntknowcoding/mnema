/**
 * Phase 10 — Google Drive ⇄ Mnema sync engine (shared by routes/drive.ts and the
 * drive-sync worker).
 *
 *   pullLink(link)  — Drive → Mnema: create/update docs (text) + attachments (binary)
 *   pushLink(link)  — Mnema → Drive: export the linked folder's docs as files
 *   syncLink(link)  — run both directions according to link.direction
 *
 * All writes go through withSystemPrivilege (server-side, RLS-bypassing) and are
 * explicitly scoped by workspace_id. Sync is idempotent, keyed on
 * drive_file_mappings (link_id, drive_file_id) and the file md5 checksum.
 */
import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { markdownToYjsState } from '@boppl/schema/node';
import { and, eq, isNotNull } from 'drizzle-orm';
import { config } from '../config/env.js';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import {
  attachments, docs, driveFileMappings, driveFolderLinks, workspaceMembers,
} from '../db/schema.js';
import {
  downloadDriveFile, driveClientFromRefresh, extOf, isAcceptedType, isTextExt,
  listFilesInFolder, mimeForExt, updateDriveFile, uploadToFolder,
  type DriveClient, type DriveFile,
} from './google-drive.js';
import { decryptSecret } from './secret-box.js';
import { R2_BUCKET, isR2Configured, r2 } from './storage/r2-client.js';
import { contentHash } from './yjs.js';

export type DriveLink = typeof driveFolderLinks.$inferSelect;
type DriveMapping = typeof driveFileMappings.$inferSelect;

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  pushed: number;
  conflicts: number;
  error?: string;
}

const emptyResult = (): SyncResult => ({ created: 0, updated: 0, skipped: 0, pushed: 0, conflicts: 0 });

/** The Drive client for a link, from the connecting member's encrypted token. */
export async function getLinkDrive(link: DriveLink): Promise<DriveClient | null> {
  const rows = await withSystemPrivilege((tx) =>
    tx.select({ tok: workspaceMembers.driveRefreshToken })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, link.connectedBy), isNotNull(workspaceMembers.driveRefreshToken)))
      .limit(1),
  );
  const enc = rows[0]?.tok;
  if (!enc) return null;
  return driveClientFromRefresh(decryptSecret(enc));
}

function tooLarge(f: DriveFile): boolean {
  return Boolean(f.size && f.size > config.DRIVE_SYNC_MAX_FILE_MB * 1024 * 1024);
}

async function findMapping(linkId: string, driveFileId: string): Promise<DriveMapping | undefined> {
  const rows = await withSystemPrivilege((tx) =>
    tx.select().from(driveFileMappings)
      .where(and(eq(driveFileMappings.linkId, linkId), eq(driveFileMappings.driveFileId, driveFileId)))
      .limit(1),
  );
  return rows[0];
}

async function touchLink(linkId: string, patch: Partial<DriveLink>): Promise<void> {
  await withSystemPrivilege((tx) =>
    tx.update(driveFolderLinks).set({ ...patch, updatedAt: new Date() }).where(eq(driveFolderLinks.id, linkId)),
  );
}

// ── Pull (Drive → Mnema) ──────────────────────────────────────────────────────

async function upsertDocFromDrive(
  link: DriveLink, f: DriveFile, markdown: string, mapping: DriveMapping | undefined,
): Promise<void> {
  const hash = contentHash(markdown);
  const title = f.name.replace(/\.[^.]+$/, '');
  const yjsState = Buffer.from(await markdownToYjsState(markdown));
  const now = new Date();

  await withSystemPrivilege(async (tx) => {
    let docId = mapping?.docId ?? null;
    if (docId) {
      await tx.update(docs)
        .set({ title, markdown, yjsState, contentHash: hash, updatedAt: now })
        .where(and(eq(docs.id, docId), eq(docs.workspaceId, link.workspaceId)));
    } else {
      const [doc] = await tx.insert(docs).values({
        workspaceId: link.workspaceId,
        folderId: link.folderId,
        path: `drive-${f.id}`,
        title,
        markdown,
        yjsState,
        contentHash: hash,
        createdBy: link.connectedBy,
        updatedBy: link.connectedBy,
      }).returning({ id: docs.id });
      docId = doc!.id;
    }
    await upsertMapping(tx, link.id, f, { docId, contentHash: hash });
  });
}

async function upsertAttachmentFromDrive(
  link: DriveLink, f: DriveFile, ext: string, bytes: Buffer, mapping: DriveMapping | undefined,
): Promise<void> {
  const r2Key = `attachments/${link.workspaceId}/${randomUUID()}.${ext}`;
  const mime = f.mimeType || mimeForExt(ext);
  await r2().send(new PutObjectCommand({
    Bucket: R2_BUCKET(), Key: r2Key, Body: bytes, ContentType: mime,
    ContentDisposition: `attachment; filename="${f.name}"`,
  }));

  await withSystemPrivilege(async (tx) => {
    let attachmentId = mapping?.attachmentId ?? null;
    if (attachmentId) {
      await tx.update(attachments)
        .set({ r2Key, format: ext, originalName: f.name, mimeType: mime, sizeBytes: bytes.length, status: 'ready', updatedAt: new Date() })
        .where(and(eq(attachments.id, attachmentId), eq(attachments.workspaceId, link.workspaceId)));
    } else {
      const [att] = await tx.insert(attachments).values({
        workspaceId: link.workspaceId,
        type: 'source',
        format: ext,
        originalName: f.name,
        r2Key,
        mimeType: mime,
        sizeBytes: bytes.length,
        status: 'ready',
      }).returning({ id: attachments.id });
      attachmentId = att!.id;
    }
    await upsertMapping(tx, link.id, f, { attachmentId });
  });
}

async function upsertMapping(
  tx: Parameters<Parameters<typeof withSystemPrivilege>[0]>[0],
  linkId: string, f: DriveFile, extra: { docId?: string; attachmentId?: string; contentHash?: string },
): Promise<void> {
  const now = new Date();
  await tx.insert(driveFileMappings).values({
    linkId,
    driveFileId: f.id,
    driveName: f.name,
    docId: extra.docId ?? null,
    attachmentId: extra.attachmentId ?? null,
    driveMd5: f.md5Checksum,
    contentHash: extra.contentHash ?? null,
    driveModifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null,
    mnemaModifiedAt: now,
    syncState: 'synced',
  }).onConflictDoUpdate({
    target: [driveFileMappings.linkId, driveFileMappings.driveFileId],
    set: {
      driveName: f.name,
      ...(extra.docId ? { docId: extra.docId } : {}),
      ...(extra.attachmentId ? { attachmentId: extra.attachmentId } : {}),
      driveMd5: f.md5Checksum,
      ...(extra.contentHash ? { contentHash: extra.contentHash } : {}),
      driveModifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null,
      mnemaModifiedAt: now,
      syncState: 'synced',
      updatedAt: now,
    },
  });
}

/** Drive → Mnema. Downloads accepted, changed files and writes docs/attachments. */
export async function pullLink(link: DriveLink): Promise<SyncResult> {
  const res = emptyResult();
  const drive = await getLinkDrive(link);
  if (!drive) return { ...res, error: 'not_connected' };

  let files: DriveFile[];
  try {
    files = await listFilesInFolder(drive, link.driveFolderId);
  } catch (err) {
    await touchLink(link.id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'list_failed' });
    return { ...res, error: 'list_failed' };
  }

  for (const f of files) {
    const ext = extOf(f.name);
    if (!isAcceptedType(ext, link.acceptedTypes) || tooLarge(f)) { res.skipped++; continue; }

    const mapping = await findMapping(link.id, f.id);
    if (mapping?.driveMd5 && mapping.driveMd5 === f.md5Checksum) continue; // unchanged on Drive

    // Manual conflict policy: if Mnema has an un-pushed local edit, don't clobber it.
    if (mapping?.syncState === 'pending_push' && link.conflictPolicy === 'manual') {
      await withSystemPrivilege((tx) =>
        tx.update(driveFileMappings).set({ syncState: 'conflict', updatedAt: new Date() }).where(eq(driveFileMappings.id, mapping.id)),
      );
      res.conflicts++;
      continue;
    }

    try {
      if (isTextExt(ext)) {
        const bytes = await downloadDriveFile(drive, f.id);
        await upsertDocFromDrive(link, f, bytes.toString('utf8'), mapping);
      } else if (ext === 'pdf' || ext === 'docx') {
        // Binaries land in `attachments`, whose `format` is docx|pdf (v1). Other
        // binary types are skipped rather than stored with a foreign format.
        if (!isR2Configured()) { res.skipped++; continue; } // no blob store → can't hold binaries
        const bytes = await downloadDriveFile(drive, f.id);
        await upsertAttachmentFromDrive(link, f, ext, bytes, mapping);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[drive-sync] link=${link.id} skipping unsupported type "${ext}" (${f.name})`);
        res.skipped++;
        continue;
      }
      if (mapping) res.updated++; else res.created++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[drive-sync] link=${link.id} pull failed for "${f.name}":`, err instanceof Error ? err.message : err);
      res.skipped++;
    }
  }

  await touchLink(link.id, { lastSyncedAt: new Date(), status: 'active', errorMessage: null });
  return res;
}

// ── Push (Mnema → Drive) ──────────────────────────────────────────────────────

/** Mnema → Drive. Exports the linked folder's docs to `.md` files in Drive. */
export async function pushLink(link: DriveLink): Promise<SyncResult> {
  const res = emptyResult();
  const drive = await getLinkDrive(link);
  if (!drive) return { ...res, error: 'not_connected' };

  const folderDocs = await withSystemPrivilege((tx) =>
    tx.select({ id: docs.id, title: docs.title, markdown: docs.markdown, contentHash: docs.contentHash })
      .from(docs)
      .where(and(eq(docs.workspaceId, link.workspaceId), eq(docs.folderId, link.folderId))),
  );

  for (const d of folderDocs) {
    try {
      const existing = await withSystemPrivilege((tx) =>
        tx.select().from(driveFileMappings)
          .where(and(eq(driveFileMappings.linkId, link.id), eq(driveFileMappings.docId, d.id)))
          .limit(1),
      );
      const map = existing[0];
      // Skip if the doc hasn't changed since it was last synced.
      if (map && map.contentHash && map.contentHash === d.contentHash) continue;

      const body = Buffer.from(d.markdown, 'utf8');
      const name = `${d.title || 'untitled'}.md`;
      if (map?.driveFileId) {
        const { md5Checksum } = await updateDriveFile(drive, map.driveFileId, 'text/markdown', body);
        await withSystemPrivilege((tx) =>
          tx.update(driveFileMappings)
            .set({ driveMd5: md5Checksum, contentHash: d.contentHash, syncState: 'synced', mnemaModifiedAt: new Date(), updatedAt: new Date() })
            .where(eq(driveFileMappings.id, map.id)),
        );
      } else {
        const { id: driveFileId, md5Checksum } = await uploadToFolder(drive, link.driveFolderId, name, 'text/markdown', body);
        await withSystemPrivilege((tx) =>
          tx.insert(driveFileMappings).values({
            linkId: link.id, driveFileId, driveName: name, docId: d.id,
            driveMd5: md5Checksum, contentHash: d.contentHash, mnemaModifiedAt: new Date(), syncState: 'synced',
          }),
        );
      }
      res.pushed++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[drive-sync] link=${link.id} push failed for doc "${d.title}":`, err instanceof Error ? err.message : err);
      res.skipped++;
    }
  }

  await touchLink(link.id, { lastSyncedAt: new Date() });
  return res;
}

/** Run the configured direction(s) for a link and return a combined result. */
export async function syncLink(link: DriveLink): Promise<SyncResult> {
  if (link.status === 'paused') return { ...emptyResult(), error: 'paused' };
  const combined = emptyResult();
  const add = (r: SyncResult) => {
    combined.created += r.created; combined.updated += r.updated; combined.skipped += r.skipped;
    combined.pushed += r.pushed; combined.conflicts += r.conflicts;
    if (r.error && !combined.error) combined.error = r.error;
  };
  if (link.direction === 'pull' || link.direction === 'both') add(await pullLink(link));
  if (link.direction === 'push' || link.direction === 'both') add(await pushLink(link));
  return combined;
}
