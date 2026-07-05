import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import { docVersions, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { enqueueEmbeddingJob } from '../queue/embeddings.js';
import { emitDocUpdated } from '../lib/doc-events.js';
import type { ConnectionContext } from './auth.js';
import { markdownToYjsState, yjsStateToMarkdown } from './markdown-bridge.js';

const EMPTY_DOC_STATE_LEN = Y.encodeStateAsUpdate(new Y.Doc()).length;
// Within a single long editing session, snapshot at most this often as a ceiling so a
// marathon session still leaves periodic recovery anchors.
const SNAPSHOT_EVERY = 50;
// "Once per editing session": if the last snapshot for a doc was longer ago than this,
// the next content-changing store snapshots. Stores fire every few seconds while a doc is
// actively edited, so this yields ~one version per sitting (a new session after an idle gap
// re-arms it) instead of the old 50-store cadence that meant hand edits almost never versioned.
const SESSION_SNAPSHOT_MS = Number(process.env.DOC_VERSION_SESSION_MS ?? 120_000);

function contentHash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function isEmptyState(state: Buffer): boolean {
  if (state.length !== EMPTY_DOC_STATE_LEN) return false;
  const probe = new Y.Doc();
  Y.applyUpdate(probe, state);
  return probe.getXmlFragment('prosemirror').length === 0;
}

export async function loadDocumentState(ctx: ConnectionContext): Promise<Uint8Array> {
  return await withTenant(ctx.tenant_id, async (tx) => {
    const rows = await tx
      .select({ yjsState: docs.yjsState, markdown: docs.markdown })
      .from(docs)
      .where(and(eq(docs.id, ctx.doc_id), isNull(docs.deletedAt)))
      .limit(1);
    if (rows.length === 0) {
      throw new Error('Doc not found at load time');
    }
    const row = rows[0]!;
    const state = row.yjsState as Buffer | null | undefined;
    if (state && state.length > 0 && !isEmptyState(state)) {
      return new Uint8Array(state);
    }
    if (row.markdown && row.markdown.length > 0) {
      return await markdownToYjsState(row.markdown);
    }
    return Y.encodeStateAsUpdate(new Y.Doc());
  });
}

export interface StoreResult {
  contentChanged: boolean;
  snapshotted: boolean;
}

export interface AiVersionMeta {
  toolName: string;
}

// Per-process counter of successful content-changing stores per doc.
// Resets on restart — snapshots are best-effort recovery anchors, not audit.
const storeCounts = new Map<string, number>();
// Per-doc wall-clock of the last snapshot, driving the once-per-session cadence.
const lastSnapshotAt = new Map<string, number>();
// Per-doc content hash of the last snapshot. Lets the session-end flush snapshot the
// FINAL state whenever it differs from the last snapshot — even though the docs row hash
// already matches (every store writes it), so `contentChanged` alone is false by then.
const lastSnapshotHash = new Map<string, string>();

/**
 * Atomic write of yjs_state + markdown + content_hash for a single doc.
 *
 *   1. Re-derive markdown from the live Y.Doc using the @boppl/schema bridge.
 *   2. Hash the new markdown.
 *   3. Compare hash to the row's stored hash. Equal → contentChanged=false
 *      (Phase 3 reads this to skip pointless embedding work).
 *   4. UPDATE all four columns in one transaction under SET LOCAL app.tenant_id.
 *   5. Every SNAPSHOT_EVERY content-changing stores per doc, INSERT a
 *      doc_versions row as a recovery anchor.
 */
/**
 * Persist the current Y.Doc state to the database.
 *
 * When `aiMeta` is provided the store ALWAYS creates a `doc_versions` snapshot
 * tagged `author_kind = 'ai'`, regardless of the 50-store cycle. This is how
 * MCP write tools (append, replace, create) leave a permanent version trail.
 */
export async function storeDocumentState(
  ctx: ConnectionContext,
  yjsDoc: Y.Doc,
  aiMeta?: AiVersionMeta | null,
  isSessionEnd = false,
): Promise<StoreResult> {
  const encoded = Y.encodeStateAsUpdate(yjsDoc);
  const newMarkdown = await yjsStateToMarkdown(encoded);
  const newYjsState = Buffer.from(encoded);
  const newHash = contentHash(newMarkdown);

  const result = await withTenant(ctx.tenant_id, async (tx) => {
    const existing = await tx
      .select({ contentHash: docs.contentHash })
      .from(docs)
      .where(and(eq(docs.id, ctx.doc_id), isNull(docs.deletedAt)))
      .limit(1);
    if (existing.length === 0) {
      return { contentChanged: false, snapshotted: false };
    }
    const oldHash = existing[0]?.contentHash ?? '';
    const contentChanged = oldHash !== newHash;

    await tx
      .update(docs)
      .set({
        yjsState: newYjsState,
        markdown: newMarkdown,
        contentHash: newHash,
        updatedBy: ctx.user_id,
        // Bump the recency clock ONLY when the body actually changed. This is the
        // single chokepoint every content edit passes through — the live editor
        // AND every MCP write tool (append/replace/create via IPC → onStoreDocument).
        // Without this, updated_at stayed frozen at creation, so edited docs never
        // surfaced in recency feeds (list_recent_activity, list_docs). Skipped on
        // no-op stores (anchor assignment, reconnect flush) so idle opens don't churn it.
        ...(contentChanged ? { updatedAt: new Date() } : {}),
      })
      .where(and(eq(docs.id, ctx.doc_id), isNull(docs.deletedAt)));

    let snapshotted = false;
    // Session-end flush (last client left): capture the FINAL state as a version whenever it
    // differs from the last snapshot. By now the docs row already holds this content, so
    // `contentChanged` is false — we compare against the last SNAPSHOT's hash instead. This is
    // what guarantees a short session's closing edits get their own version.
    const endCapture = isSessionEnd && newHash !== (lastSnapshotHash.get(ctx.doc_id) ?? '');
    if (contentChanged || endCapture) {
      const count = (storeCounts.get(ctx.doc_id) ?? 0) + 1;
      if (contentChanged) storeCounts.set(ctx.doc_id, count);

      // Snapshot when: an AI write (always), OR the session just ended with unsaved-since-snapshot
      // changes, OR this is the first content change of a new editing session (last snapshot older
      // than SESSION_SNAPSHOT_MS), OR the within-session ceiling is hit. Gives ~one human version
      // per sitting PLUS the closing state, vs the old 50-store-only rule that left hand-edited
      // docs with essentially no version history.
      const now = Date.now();
      const sinceLast = now - (lastSnapshotAt.get(ctx.doc_id) ?? 0);
      const shouldSnapshot = aiMeta != null || endCapture || sinceLast >= SESSION_SNAPSHOT_MS || count % SNAPSHOT_EVERY === 0;

      if (shouldSnapshot) {
        const nextRow = await tx.execute(
          sql`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM doc_versions WHERE doc_id = ${ctx.doc_id}`,
        );
        const versionNum = Number((nextRow[0] as { next: number | string } | undefined)?.next ?? 1);
        await tx.insert(docVersions).values({
          docId: ctx.doc_id,
          version: versionNum,
          markdown: newMarkdown,
          yjsState: newYjsState,
          authorId: ctx.user_id,
          authorKind: aiMeta != null ? 'ai' : 'human',
          comment: aiMeta != null
            ? `AI write: ${aiMeta.toolName}`
            : endCapture
              ? 'Auto-snapshot (session end)'
              : 'Auto-snapshot (editing session)',
        });
        snapshotted = true;
        lastSnapshotAt.set(ctx.doc_id, now);
        lastSnapshotHash.set(ctx.doc_id, newHash);
        // Reset the human counter after an AI-triggered snapshot so the 50-store
        // cycle doesn't immediately fire again on the very next human keystroke.
        if (aiMeta != null) storeCounts.set(ctx.doc_id, 0);
      }
    }

    return { contentChanged, snapshotted };
  });

  // Phase 3.1: fire-and-forget enqueue an embedding job whenever content
  // actually changed. The enqueue is deduped at the BullMQ layer by
  // `${doc_id}:${content_hash}` so retried Hocuspocus stores don't burn
  // Voyage tokens. A Redis blip here MUST NOT fail the save itself —
  // worst case the doc lags on embeddings until the next edit re-triggers.
  if (result.contentChanged) {
    try {
      await enqueueEmbeddingJob({
        doc_id: ctx.doc_id,
        tenant_id: ctx.tenant_id,
        content_hash: newHash,
      });
    } catch (err) {
      // Don't bring down the persistence path on a queue outage.
      process.stderr.write(
        `[persistence] embeddings enqueue failed for ${ctx.doc_id}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }

    // Content changed → notify subscribers (the ee graph module enqueues semantic
    // extraction). Emitted on the generic doc bus so core never imports queue/graph.
    // setImmediate keeps it off the persistence response path.
    setImmediate(() => {
      emitDocUpdated({ tenantId: ctx.tenant_id, docId: ctx.doc_id });
    });
  }

  return result;
}
