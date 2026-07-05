import { prosemirrorToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';
import { getHeadlessEditor } from './editor-schema.js';

/**
 * Parse markdown into a Y.Doc state. The fragment name 'prosemirror' matches
 * what y-prosemirror's editor binding uses by default.
 */
export async function markdownToYjsState(markdown: string): Promise<Uint8Array> {
  if (!markdown) return Y.encodeStateAsUpdate(new Y.Doc());
  const { parser } = await getHeadlessEditor();
  const pmDoc = parser(markdown);
  if (!pmDoc) return Y.encodeStateAsUpdate(new Y.Doc());
  const yDoc = prosemirrorToYDoc(pmDoc, 'prosemirror');
  return Y.encodeStateAsUpdate(yDoc);
}
