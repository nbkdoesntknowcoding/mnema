/**
 * Anchor ID utilities for Phase 9.1.
 *
 * Anchors are stable `data-anchor` attributes on top-level ProseMirror block
 * elements in the Yjs document. They let MCP clients (and the
 * `append_blocks_to_doc` tool) refer to a specific block as an insertion
 * target without knowing the block's content or index.
 *
 * Format: `blk_` + 8 lowercase hex chars (4 random bytes). Collision
 * probability across thousands of blocks is negligible.
 */

import { randomBytes } from 'node:crypto';
import * as Y from 'yjs';

export interface AnchorEntry {
  /** Stable block identifier, e.g. "blk_a1b2c3d4". */
  anchor: string;
  /** ProseMirror node type — "paragraph", "heading", "bulletList", etc. */
  kind: string;
  /** First 80 chars of the block's text content (for orientation). */
  preview: string;
}

/**
 * Extract anchor metadata from a serialised Yjs state.
 * Returns one entry per top-level block that has a `data-anchor` attribute.
 * Blocks without anchors are silently skipped — they haven't been through
 * `assignMissingAnchors` yet (or were added by a client that doesn't write
 * anchors).
 */
export function extractAnchors(yjsState: Uint8Array | Buffer): AnchorEntry[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState instanceof Buffer ? new Uint8Array(yjsState) : yjsState);
  const xml = doc.getXmlFragment('prosemirror');
  const anchors: AnchorEntry[] = [];

  for (const child of xml.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    const anchor = child.getAttribute('data-anchor');
    if (!anchor) continue;
    anchors.push({
      anchor,
      kind: child.nodeName,
      preview: xmlTextContent(child).slice(0, 80),
    });
  }

  return anchors;
}

/**
 * Assign `data-anchor` attributes to every top-level block element in the
 * Yjs document that is currently missing one. Runs inside a single `transact`
 * call for atomicity.
 *
 * Returns the count of newly-assigned anchors (0 means the doc was already
 * fully anchored — no DB write needed).
 */
export function assignMissingAnchors(doc: Y.Doc): number {
  const xml = doc.getXmlFragment('prosemirror');
  let count = 0;

  doc.transact(() => {
    for (const child of xml.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (!child.getAttribute('data-anchor')) {
        child.setAttribute('data-anchor', `blk_${randomBytes(4).toString('hex')}`);
        count++;
      }
    }
  });

  return count;
}

// ── helpers ────────────────────────────────────────────────────────────────

function xmlTextContent(node: Y.XmlElement | Y.XmlText): string {
  if (node instanceof Y.XmlText) return node.toString();
  return node
    .toArray()
    .map((c) => {
      if (c instanceof Y.XmlElement || c instanceof Y.XmlText) {
        return xmlTextContent(c);
      }
      return '';
    })
    .join('');
}
