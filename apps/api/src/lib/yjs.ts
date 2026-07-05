import { createHash } from 'node:crypto';
import * as Y from 'yjs';

/**
 * Encoded empty Y.Doc state. Satisfies docs.yjs_state NOT NULL at create time.
 * Phase 1 (Hocuspocus) hydrates this from markdown when collab first opens.
 */
export function emptyYjsState(): Buffer {
  const doc = new Y.Doc();
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

export function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}
