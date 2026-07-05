import type { Node as PMNode, Schema } from 'prosemirror-model';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import { getHeadlessEditor } from './editor-schema.js';

interface PMJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMJSON[];
  marks?: PMJSON[];
  text?: string;
}

/**
 * y-prosemirror stores Y.XmlElement attrs as strings (Y.Xml has no type
 * info). When the schema validates with `validate: 'boolean'` (which
 * @milkdown/preset-gfm does on list_item.spread, among others), the string
 * "false" gets rejected. Walk the JSON tree and coerce attrs whose schema
 * declares a typed validate.
 */
function coerceAttrsForSchema(node: PMJSON, schema: Schema): void {
  const nodeType = schema.nodes[node.type];
  if (nodeType && node.attrs) {
    for (const [attrName, attrSpec] of Object.entries(nodeType.spec.attrs ?? {})) {
      const validate = (attrSpec as { validate?: unknown }).validate;
      const current = node.attrs[attrName];
      if (typeof current !== 'string') continue;
      if (validate === 'boolean') {
        node.attrs[attrName] = current === 'true';
      } else if (validate === 'number') {
        node.attrs[attrName] = Number(current);
      }
    }
  }
  if (node.content) {
    for (const child of node.content) coerceAttrsForSchema(child, schema);
  }
}

/**
 * Render the canonical markdown for an encoded Y.Doc state.
 * Output goes through remark-stringify and is canonical-form normalised
 * (e.g., `*` bullet markers, blank lines around blocks).
 */
export async function yjsStateToMarkdown(state: Uint8Array): Promise<string> {
  const yDoc = new Y.Doc();
  Y.applyUpdate(yDoc, state);
  const xml = yDoc.getXmlFragment('prosemirror');
  // Empty Y.Doc → empty markdown. Skip the serializer round-trip which
  // would otherwise crash on a content-less PM doc.
  if (xml.length === 0) return '';
  const { schema, serializer } = await getHeadlessEditor();
  const json = yDocToProsemirrorJSON(yDoc) as PMJSON;
  coerceAttrsForSchema(json, schema);
  const pmDoc: PMNode = schema.nodeFromJSON(json);
  return serializer(pmDoc);
}
