import { randomBytes } from 'node:crypto';
import { Logger } from '@hocuspocus/extension-logger';
import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { config } from '../config/env.js';
import { assignMissingAnchors } from '../mcp/anchors.js';
import { authenticateConnection, type ConnectionContext } from './auth.js';
import { consumeAiWrite, markAiWrite } from './ai-version-queue.js';
import { markdownToYjsState } from './markdown-bridge.js';
import { loadDocumentState, storeDocumentState } from './persistence.js';
import { loadEeCollab } from '../lib/load-ee.js';

// Phase 3 — dynamically mount the ee collab hooks (graph doc subscriber) if the
// ee module is present. Non-static so the core collab process boots without it.
void loadEeCollab();

const server = new Server<ConnectionContext>({
  port: config.COLLAB_PORT,
  address: '0.0.0.0',
  name: 'boppl-context-collab',
  // Research-anchored: 3s idle window, 15s ceiling under continuous typing.
  debounce: 3000,
  maxDebounce: 15000,
  // Disconnect peers idle for 30s — defends against half-open WS connections.
  timeout: 30000,
  extensions: [
    new Logger({
      onLoadDocument: true,
      onStoreDocument: true,
      onConnect: true,
      onDisconnect: true,
    }),
  ],

  async onAuthenticate(data) {
    const token = typeof data.token === 'string' ? data.token : '';
    if (!token) {
      throw new Error('Missing token');
    }
    return await authenticateConnection({
      token,
      documentName: data.documentName,
    });
  },

  async onLoadDocument(data) {
    const state = await loadDocumentState(data.context);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);

    // Phase 9.1: assign stable data-anchor attributes to any top-level block
    // elements that are missing one. These anchors are the stable handles that
    // let append_blocks_to_doc target specific insertion points.
    //
    // If any anchors were assigned we persist immediately so they survive
    // across sessions — otherwise every load would re-roll random IDs, making
    // anchors useless as stable references.
    try {
      const assigned = assignMissingAnchors(doc);
      if (assigned > 0) {
        await storeDocumentState(data.context, doc);
        console.log(`[collab] assigned ${assigned} anchor(s) for ${data.context.doc_id}`);
      }
    } catch (err) {
      // Anchor assignment failure must never break document loading.
      console.warn('[collab] anchor assignment failed', err);
    }

    return doc;
  },

  async onStoreDocument(data) {
    const ctx = data.lastContext;
    if (!ctx) return;
    // Consume any pending AI-version signal for this doc (set by IPC handlers).
    const aiToolName = consumeAiWrite(ctx.doc_id);
    const aiMeta = aiToolName ? { toolName: aiToolName } : null;
    // clientsCount === 0 means this is the final flush after the last editor disconnected —
    // the end of an editing session. storeDocumentState uses it to always version the closing state.
    const isSessionEnd = (data as { clientsCount?: number }).clientsCount === 0;
    const result = await storeDocumentState(ctx, data.document, aiMeta, isSessionEnd);
    if (result.snapshotted) {
      const label = aiMeta ? `AI write (${aiMeta.toolName})` : '50-store anchor';
      console.log(`[collab] Version snapshot for ${ctx.doc_id} — ${label}`);
    }
  },

  /**
   * Internal IPC for the api process's writeback path. The api and collab are
   * SEPARATE processes (per the deploy topology), so an in-process register
   * pattern can't work. Instead, the api POSTs to this endpoint with
   * X-Boppl-Internal-Secret = COLLAB_INTERNAL_SECRET (Phase 0 split this off
   * WORKOS_COOKIE_PASSWORD). Auth scoping is the api's
   * responsibility — by the time we get here, the request is server-to-server.
   */
  async onRequest(data) {
    const url = data.request.url ?? '/';

    // ── /_internal/writeback/{docId} — REPLACE semantics ───────────────────
    if (url.startsWith('/_internal/writeback/')) {
      if (data.request.method !== 'POST') {
        data.response.writeHead(405).end();
        throw null; // Hocuspocus contract: empty throw = "handled, skip default 404"
      }
      const secret = data.request.headers['x-boppl-internal-secret'];
      if (!secret || secret !== process.env.COLLAB_INTERNAL_SECRET) {
        data.response.writeHead(403).end();
        throw null;
      }
      const docId = url.replace('/_internal/writeback/', '').split('?')[0] ?? '';
      if (!docId) {
        data.response.writeHead(400).end();
        throw null;
      }

      let body = '';
      for await (const chunk of data.request) {
        body += String(chunk);
      }
      const parsed = JSON.parse(body) as {
        markdown?: string;
        ctx?: ConnectionContext;
      };
      const markdown = parsed.markdown ?? '';

      if (!data.instance.documents.has(docId)) {
        data.response.writeHead(404, { 'content-type': 'application/json' });
        data.response.end(JSON.stringify({ applied: false, reason: 'no_live_doc' }));
        throw null;
      }

      const direct = await data.instance.openDirectConnection(docId, parsed.ctx);
      try {
        const newState = await markdownToYjsState(markdown);
        const incoming = new Y.Doc();
        Y.applyUpdate(incoming, newState);
        const incomingXml = incoming.getXmlFragment('prosemirror');
        const incomingItems = incomingXml.toArray();
        await direct.transact((live: Y.Doc) => {
          const xml = live.getXmlFragment('prosemirror');
          // REPLACE semantics: delete everything, then push new items.
          if (xml.length > 0) xml.delete(0, xml.length);
          for (const item of incomingItems) {
            if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
              xml.push([item.clone()]);
            }
          }
        });
        data.response.writeHead(200, { 'content-type': 'application/json' });
        data.response.end(JSON.stringify({ applied: true }));
      } catch (err: unknown) {
        console.error('[collab] writeback failed', err);
        data.response.writeHead(500).end();
      } finally {
        await direct.disconnect();
      }
      // Throwing terminates Hocuspocus's onRequest chain — signals "handled".
      // The contract is THROW A FALSY VALUE: Hocuspocus's handler does
      // `if (error) throw error`, so a real Error gets re-thrown and crashes
      // the process. Use `throw null` so the "handled" signal is delivered
      // without triggering the upstream re-throw. (This regression killed
      // the collab process after every writeback when it was previously
      // `throw new Error('handled')` — see Phase 1.2 notes.)
      throw null;
    }

    // ── /_internal/init/{docId} — CREATE/SEED semantics (Phase 9.2) ────────
    if (url.startsWith('/_internal/init/')) {
      if (data.request.method !== 'POST') {
        data.response.writeHead(405).end();
        throw null;
      }
      const secret = data.request.headers['x-boppl-internal-secret'];
      if (!secret || secret !== process.env.COLLAB_INTERNAL_SECRET) {
        data.response.writeHead(403).end();
        throw null;
      }
      const docId = url.replace('/_internal/init/', '').split('?')[0] ?? '';
      if (!docId) {
        data.response.writeHead(400).end();
        throw null;
      }

      let body = '';
      for await (const chunk of data.request) {
        body += String(chunk);
      }
      const parsed = JSON.parse(body) as {
        markdown?: string;
        ctx?: ConnectionContext;
      };
      const markdown = parsed.markdown ?? '';

      // openDirectConnection loads or creates the Y.Doc — unlike writeback,
      // we intentionally allow this even for brand-new docs.
      const direct = await data.instance.openDirectConnection(docId, parsed.ctx);
      try {
        if (markdown.trim()) {
          const newState = await markdownToYjsState(markdown);
          const incoming = new Y.Doc();
          Y.applyUpdate(incoming, newState);
          const incomingItems = incoming.getXmlFragment('prosemirror').toArray();

          await direct.transact((live: Y.Doc) => {
            const xml = live.getXmlFragment('prosemirror');
            // Replace-all: clear whatever is there (empty for new doc) then
            // insert the seed content.
            if (xml.length > 0) xml.delete(0, xml.length);
            const toInsert: Array<Y.XmlElement | Y.XmlText> = [];
            for (const item of incomingItems) {
              if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
                const cloned = item.clone();
                if (cloned instanceof Y.XmlElement && !cloned.getAttribute('data-anchor')) {
                  cloned.setAttribute('data-anchor', `blk_${randomBytes(4).toString('hex')}`);
                }
                toInsert.push(cloned);
              }
            }
            for (const el of toInsert) xml.push([el]);
          });
        }

        if (markdown.trim()) markAiWrite(docId, 'create_doc');
        data.response.writeHead(200, { 'content-type': 'application/json' });
        data.response.end(JSON.stringify({ initialized: true }));
      } catch (err: unknown) {
        console.error('[collab] init failed', err);
        data.response.writeHead(500).end();
      } finally {
        await direct.disconnect();
      }
      throw null;
    }

    // ── /_internal/replacesection/{docId} — REPLACE SECTION (Phase 9.2) ────
    if (url.startsWith('/_internal/replacesection/')) {
      if (data.request.method !== 'POST') {
        data.response.writeHead(405).end();
        throw null;
      }
      const secret = data.request.headers['x-boppl-internal-secret'];
      if (!secret || secret !== process.env.COLLAB_INTERNAL_SECRET) {
        data.response.writeHead(403).end();
        throw null;
      }
      const docId = url.replace('/_internal/replacesection/', '').split('?')[0] ?? '';
      if (!docId) {
        data.response.writeHead(400).end();
        throw null;
      }

      let body = '';
      for await (const chunk of data.request) {
        body += String(chunk);
      }
      const parsed = JSON.parse(body) as {
        section_anchor: string;
        markdown: string;
        ctx?: ConnectionContext;
      };

      const direct = await data.instance.openDirectConnection(docId, parsed.ctx);
      try {
        const newState = await markdownToYjsState(parsed.markdown);
        const incoming = new Y.Doc();
        Y.applyUpdate(incoming, newState);
        const incomingItems = incoming.getXmlFragment('prosemirror').toArray();

        let found = false;
        const newAnchors: string[] = [];

        await direct.transact((live: Y.Doc) => {
          const xml = live.getXmlFragment('prosemirror');
          const items = xml.toArray();

          // Find the section heading by data-anchor.
          let sectionIdx = -1;
          let sectionLevel = 0;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (
              item instanceof Y.XmlElement &&
              item.getAttribute('data-anchor') === parsed.section_anchor
            ) {
              sectionIdx = i;
              // Detect heading level: Yjs/Milkdown stores `level` as attribute.
              const levelAttr = item.getAttribute('level');
              sectionLevel = levelAttr ? parseInt(String(levelAttr), 10) : 0;
              break;
            }
          }

          if (sectionIdx === -1) {
            // Anchor not found — signal via a thrown string (caught below).
            throw 'anchor_not_found';
          }

          found = true;

          // Walk forward to find the end of the section: stop at a heading
          // with level <= sectionLevel (or at EOF). We always include the
          // heading node itself in the replaced range.
          let endIdx = items.length; // exclusive
          if (sectionLevel > 0) {
            for (let i = sectionIdx + 1; i < items.length; i++) {
              const item = items[i];
              if (item instanceof Y.XmlElement) {
                const nodeLevelAttr = item.getAttribute('level');
                const nodeLevel = nodeLevelAttr ? parseInt(String(nodeLevelAttr), 10) : 0;
                const nodeName = item.nodeName;
                // Stop if we hit a heading that is same or higher level.
                if (nodeName === 'heading' && nodeLevel > 0 && nodeLevel <= sectionLevel) {
                  endIdx = i;
                  break;
                }
              }
            }
          }

          const deleteCount = endIdx - sectionIdx;

          // Clone incoming elements and assign fresh anchors.
          const toInsert: Array<Y.XmlElement | Y.XmlText> = [];
          for (const item of incomingItems) {
            if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
              const cloned = item.clone();
              if (cloned instanceof Y.XmlElement) {
                if (!cloned.getAttribute('data-anchor')) {
                  cloned.setAttribute('data-anchor', `blk_${randomBytes(4).toString('hex')}`);
                }
                newAnchors.push(cloned.getAttribute('data-anchor') as string);
              }
              toInsert.push(cloned);
            }
          }

          // Atomic: delete old range, insert new content at same position.
          xml.delete(sectionIdx, deleteCount);
          if (toInsert.length > 0) {
            xml.insert(sectionIdx, toInsert);
          }
        });

        markAiWrite(docId, 'replace_doc_section');
        data.response.writeHead(200, { 'content-type': 'application/json' });
        data.response.end(JSON.stringify({ applied: true, new_anchors: newAnchors }));
      } catch (err: unknown) {
        if (err === 'anchor_not_found') {
          data.response.writeHead(404, { 'content-type': 'application/json' });
          data.response.end(JSON.stringify({ error: 'anchor_not_found' }));
        } else {
          console.error('[collab] replacesection failed', err);
          data.response.writeHead(500).end();
        }
      } finally {
        await direct.disconnect();
      }
      throw null;
    }

    // ── /_internal/replacebody/{docId} — REPLACE BODY (Phase 9.2) ───────────
    if (url.startsWith('/_internal/replacebody/')) {
      if (data.request.method !== 'POST') {
        data.response.writeHead(405).end();
        throw null;
      }
      const secret = data.request.headers['x-boppl-internal-secret'];
      if (!secret || secret !== process.env.COLLAB_INTERNAL_SECRET) {
        data.response.writeHead(403).end();
        throw null;
      }
      const docId = url.replace('/_internal/replacebody/', '').split('?')[0] ?? '';
      if (!docId) {
        data.response.writeHead(400).end();
        throw null;
      }

      let body = '';
      for await (const chunk of data.request) {
        body += String(chunk);
      }
      const parsed = JSON.parse(body) as {
        markdown: string;
        expected_anchors: string[];
        ctx?: ConnectionContext;
      };

      const direct = await data.instance.openDirectConnection(docId, parsed.ctx);
      try {
        const newState = await markdownToYjsState(parsed.markdown);
        const incoming = new Y.Doc();
        Y.applyUpdate(incoming, newState);
        const incomingItems = incoming.getXmlFragment('prosemirror').toArray();

        let docChanged = false;
        const newAnchors: string[] = [];

        await direct.transact((live: Y.Doc) => {
          const xml = live.getXmlFragment('prosemirror');

          // Collect current anchors to compare with expected_anchors.
          const currentAnchors: string[] = [];
          for (const item of xml.toArray()) {
            if (item instanceof Y.XmlElement) {
              const anchor = item.getAttribute('data-anchor');
              if (anchor) currentAnchors.push(anchor);
            }
          }

          // Compare: same elements, same order.
          const expected = parsed.expected_anchors ?? [];
          const matches =
            currentAnchors.length === expected.length &&
            currentAnchors.every((a, i) => a === expected[i]);

          if (!matches) {
            docChanged = true;
            return; // exit transact callback early without mutating
          }

          // Build cloned nodes with fresh anchors.
          const toInsert: Array<Y.XmlElement | Y.XmlText> = [];
          for (const item of incomingItems) {
            if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
              const cloned = item.clone();
              if (cloned instanceof Y.XmlElement) {
                if (!cloned.getAttribute('data-anchor')) {
                  cloned.setAttribute('data-anchor', `blk_${randomBytes(4).toString('hex')}`);
                }
                newAnchors.push(cloned.getAttribute('data-anchor') as string);
              }
              toInsert.push(cloned);
            }
          }

          // Atomic: wipe then insert.
          if (xml.length > 0) xml.delete(0, xml.length);
          for (const el of toInsert) xml.push([el]);
        });

        if (docChanged) {
          data.response.writeHead(409, { 'content-type': 'application/json' });
          data.response.end(JSON.stringify({ error: 'doc_changed' }));
        } else {
          markAiWrite(docId, 'replace_doc_body');
          data.response.writeHead(200, { 'content-type': 'application/json' });
          data.response.end(JSON.stringify({ applied: true, new_anchors: newAnchors }));
        }
      } catch (err: unknown) {
        console.error('[collab] replacebody failed', err);
        data.response.writeHead(500).end();
      } finally {
        await direct.disconnect();
      }
      throw null;
    }

    // ── /_internal/appendblocks/{docId} — APPEND semantics (Phase 9.1) ─────
    if (url.startsWith('/_internal/appendblocks/')) {
      if (data.request.method !== 'POST') {
        data.response.writeHead(405).end();
        throw null;
      }
      const secret = data.request.headers['x-boppl-internal-secret'];
      if (!secret || secret !== process.env.COLLAB_INTERNAL_SECRET) {
        data.response.writeHead(403).end();
        throw null;
      }
      const docId = url.replace('/_internal/appendblocks/', '').split('?')[0] ?? '';
      if (!docId) {
        data.response.writeHead(400).end();
        throw null;
      }

      let body = '';
      for await (const chunk of data.request) {
        body += String(chunk);
      }
      const parsed = JSON.parse(body) as {
        markdown?: string;
        after_anchor?: string;
        ctx?: ConnectionContext;
      };
      const markdown = parsed.markdown ?? '';

      // Note: unlike the REPLACE writeback, APPEND does NOT require the doc to
      // be pre-loaded in memory. openDirectConnection loads it if needed and
      // onStoreDocument fires on disconnect to persist the change.
      const direct = await data.instance.openDirectConnection(docId, parsed.ctx);
      try {
        const newState = await markdownToYjsState(markdown);
        const incoming = new Y.Doc();
        Y.applyUpdate(incoming, newState);
        const incomingItems = incoming.getXmlFragment('prosemirror').toArray();

        await direct.transact((live: Y.Doc) => {
          const xml = live.getXmlFragment('prosemirror');

          // Determine insertion index.
          // Default: end of document.
          let insertAt = xml.length;

          if (parsed.after_anchor) {
            const items = xml.toArray();
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              if (
                item instanceof Y.XmlElement &&
                item.getAttribute('data-anchor') === parsed.after_anchor
              ) {
                insertAt = i + 1;
                break;
              }
            }
          }

          // Clone incoming elements and assign fresh anchors so the new
          // blocks are reachable by subsequent append calls.
          const toInsert: Array<Y.XmlElement | Y.XmlText> = [];
          for (const item of incomingItems) {
            if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
              const cloned = item.clone();
              if (cloned instanceof Y.XmlElement && !cloned.getAttribute('data-anchor')) {
                cloned.setAttribute('data-anchor', `blk_${randomBytes(4).toString('hex')}`);
              }
              toInsert.push(cloned);
            }
          }

          if (toInsert.length > 0) {
            if (insertAt >= xml.length) {
              // push is cheaper than insert at end
              for (const el of toInsert) xml.push([el]);
            } else {
              xml.insert(insertAt, toInsert);
            }
          }
        });

        markAiWrite(docId, 'append_blocks_to_doc');
        data.response.writeHead(200, { 'content-type': 'application/json' });
        data.response.end(JSON.stringify({ applied: true }));
      } catch (err: unknown) {
        console.error('[collab] appendblocks failed', err);
        data.response.writeHead(500).end();
      } finally {
        await direct.disconnect();
      }
      throw null;
    }
  },
});

server
  .listen()
  .then(() => {
    console.log(`[collab] Hocuspocus listening on :${config.COLLAB_PORT}`);
  })
  .catch((err: unknown) => {
    console.error('[collab] Failed to start', err);
    process.exit(1);
  });

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[collab] ${signal} received — draining and shutting down`);
  try {
    const docs = server.hocuspocus.documents;
    for (const [name, doc] of docs.entries()) {
      const conn = doc.connections.entries().next();
      if (conn.done) continue;
      const ctx = conn.value[0].context as ConnectionContext | undefined;
      if (!ctx) continue;
      try {
        await storeDocumentState(ctx, doc);
        console.log(`[collab] drained ${name}`);
      } catch (err: unknown) {
        console.error(`[collab] drain failed for ${name}`, err);
      }
    }
  } finally {
    await server.destroy();
    process.exit(0);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
