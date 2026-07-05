import * as Y from 'yjs';
import type { EditorView } from 'prosemirror-view';
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from 'y-prosemirror';

/**
 * Yjs RelativePosition codec used by the comments anchor flow.
 *
 * The editor is Milkdown/Crepe, which under the hood uses @milkdown/plugin-collab,
 * which wires up y-prosemirror's `ySyncPlugin`. That gives us `ySyncPluginKey`
 * on the EditorView state, with the three things we need:
 *   - `binding.type`     — the Y.XmlFragment bound to the prosemirror doc
 *   - `binding.mapping`  — Y.AbstractType → ProseMirror Node mapping
 *   - `binding.doc`      — the underlying Y.Doc
 *
 * y-prosemirror exposes two helpers that do the heavy lifting between PM
 * absolute positions and Yjs relative positions:
 *   - absolutePositionToRelativePosition(pos, type, mapping) → relPos
 *   - relativePositionToAbsolutePosition(y, type, relPos, mapping) → pos | null
 *
 * We serialize the relPos as base64 for clean JSON transport (the bytes
 * themselves are opaque to the server). If the anchor's target text has
 * been deleted, the reverse helper returns null — the sidebar treats that
 * as an orphaned comment ("⚠ Context removed").
 */

// y-prosemirror's ProsemirrorMapping is internally typed as
// `Map<Y.AbstractType<any>, Node | Array<Node>>` but isn't exported, so we
// keep an opaque alias and cast at the call site when handing it to the
// public helpers. The actual values are whatever sync-plugin stuffed in —
// we only ever pass the map through; we never read from it ourselves.
type AnyMapping = Map<unknown, unknown>;

interface SyncBinding {
  type: Y.XmlFragment;
  mapping: AnyMapping;
  doc: Y.Doc;
}

function getBinding(view: EditorView): SyncBinding | null {
  // ySyncPluginKey.getState returns the sync plugin's state object, whose
  // `binding` field is the ProsemirrorBinding instance. Older versions of
  // y-prosemirror exposed the same fields directly on the state object —
  // we read through `.binding` first, then fall back.
  const state = ySyncPluginKey.getState(view.state) as
    | { binding?: SyncBinding; type?: Y.XmlFragment; mapping?: AnyMapping; doc?: Y.Doc }
    | undefined;
  if (!state) return null;
  if (state.binding) return state.binding;
  if (state.type && state.mapping && state.doc) {
    return { type: state.type, mapping: state.mapping, doc: state.doc };
  }
  return null;
}

/**
 * Convert a ProseMirror absolute position to a base64-encoded Yjs
 * RelativePosition. Returns null if the editor doesn't yet have a sync
 * binding (mount race) or the position can't be resolved.
 *
 * Wrapped in try/catch because y-prosemirror's walker throws an internal
 * `unexpectedCase` on a few degenerate positions (e.g. zero-length frags
 * during init) — caller treats null the same as "couldn't resolve".
 */
export function pmPosToRelative(view: EditorView, pmPos: number): string | null {
  const binding = getBinding(view);
  if (!binding) return null;
  try {
    const relPos = absolutePositionToRelativePosition(
      pmPos,
      binding.type,
      // ProsemirrorMapping is a non-exported alias; the helper only writes
      // through the map, never reading. Casting to the helper's parameter
      // type is the same shape y-prosemirror's own internals use.
      binding.mapping as unknown as Parameters<typeof absolutePositionToRelativePosition>[2],
    );
    if (!relPos) return null;
    const encoded = Y.encodeRelativePosition(relPos);
    return uint8ArrayToBase64(encoded);
  } catch {
    return null;
  }
}

/**
 * Convert a base64-encoded RelativePosition back to a ProseMirror absolute
 * position. Returns null if:
 *   - the editor doesn't yet have a sync binding
 *   - the encoded payload is malformed (decode throws → caught here)
 *   - the anchor's underlying Yjs item has been deleted (orphaned comment)
 *   - the helper throws `unexpectedCase` because the rel-pos points at a
 *     completely different Y.Doc (e.g. after a restore wiped the state)
 *
 * Any throw from the y-prosemirror helpers is caught and surfaced as null
 * so the CommentsSidebar never gets a hot exception from an upstream
 * payload it didn't author. Critical: this used to crash the React tree
 * when a sibling user posted a thread with anchor bytes that didn't match
 * the local doc state.
 */
export function relativeToPmPos(view: EditorView, base64: string): number | null {
  const binding = getBinding(view);
  if (!binding) return null;
  try {
    const relPos = Y.decodeRelativePosition(base64ToUint8Array(base64));
    return relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      relPos,
      binding.mapping as unknown as Parameters<typeof relativePositionToAbsolutePosition>[3],
    );
  } catch {
    return null;
  }
}

// --- base64 helpers (browser-safe, no Buffer) ------------------------------

function uint8ArrayToBase64(arr: Uint8Array): string {
  // String.fromCharCode handles each byte individually; safe for the small
  // payloads RelativePositions produce (typically <100 bytes).
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!);
  }
  return btoa(binary);
}

function base64ToUint8Array(s: string): Uint8Array {
  const binary = atob(s);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}
