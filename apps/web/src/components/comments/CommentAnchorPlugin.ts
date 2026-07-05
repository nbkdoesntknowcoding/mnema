import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';

/**
 * ProseMirror plugin that renders the soft-tint background under text that
 * has a comment thread anchored to it.
 *
 * Source of truth lives in React (the CommentsSidebar holds the polled
 * thread list and resolves anchor RelativePositions to PM positions on
 * every render). React pushes ranges into the plugin via setMeta:
 *
 *   view.dispatch(view.state.tr.setMeta(commentAnchorPluginKey, ranges))
 *
 * The plugin recomputes its DecorationSet on each set, and additionally
 * remaps decorations through every transaction so they ride along with
 * concurrent edits (otherwise the highlight would lag behind a peer's
 * insertion until the next 5-second poll repaints it).
 *
 * Overlapping ranges naturally stack — each decoration just adds a class,
 * and CSS handles the visual stacking.
 */

export interface AnchorRange {
  from: number;
  to: number;
  threadId: string;
  /** True when the user is hovering this thread in the sidebar. */
  active?: boolean;
}

interface PluginStateShape {
  ranges: AnchorRange[];
  decorations: DecorationSet;
}

export const commentAnchorPluginKey = new PluginKey<PluginStateShape>('boppl-comment-anchors');

function buildDecorations(doc: ProseNode, ranges: AnchorRange[]): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  const docSize = doc.content.size;
  for (const r of ranges) {
    const from = Math.max(0, Math.min(r.from, docSize));
    const to = Math.max(from, Math.min(r.to, docSize));
    if (from === to) continue;
    decos.push(
      Decoration.inline(from, to, {
        class: r.active ? 'comment-anchor comment-anchor--active' : 'comment-anchor',
        'data-thread-id': r.threadId,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

export function createCommentAnchorPlugin(): Plugin<PluginStateShape> {
  return new Plugin<PluginStateShape>({
    key: commentAnchorPluginKey,
    state: {
      init() {
        return { ranges: [], decorations: DecorationSet.empty };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(commentAnchorPluginKey) as AnchorRange[] | undefined;
        if (meta !== undefined) {
          // React replaced the set — rebuild from scratch against the
          // post-transaction doc.
          return { ranges: meta, decorations: buildDecorations(tr.doc, meta) };
        }
        if (tr.docChanged) {
          // No new set this tick, but the doc moved — slide existing
          // decorations through the transaction's mapping so they stay
          // pinned to their text.
          return {
            ranges: prev.ranges,
            decorations: prev.decorations.map(tr.mapping, tr.doc),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return commentAnchorPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * Helper used by the React side to set the active anchor ranges on a view.
 * Safe to call with an empty array to clear all anchors.
 */
export function setCommentAnchors(view: EditorView, ranges: AnchorRange[]): void {
  view.dispatch(view.state.tr.setMeta(commentAnchorPluginKey, ranges));
}
