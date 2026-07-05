import type { EditorState } from 'prosemirror-state';

/**
 * Trigger gating + context extraction for the autocomplete plugin.
 *
 * `shouldTrigger` runs synchronously on every transaction. Cheap and pure —
 * no async, no I/O. If it returns `{ ok: false, reason }` we short-circuit
 * the request entirely. The reason is captured in case we ever want to
 * instrument it; for 3.3 it's debug-only.
 *
 * Gates we care about:
 *   - inside an atom node (code/math/mermaid) → never trigger
 *   - in a non-text container (e.g., the doc itself) → never trigger
 *   - non-empty selection → never trigger (we're a next-token tool)
 *   - cursor at start of an empty block → never trigger (nothing to predict)
 *   - cursor in the middle of a word → never trigger (would clobber word)
 *   - cursor right after punctuation → never trigger (likely sentence end,
 *     probabilistic noise without sentence context)
 */

const ATOM_NODE_TYPES = new Set([
  'code_block',
  'math_inline',
  'math_block',
  'horizontal_rule',
  'image',
]);

// Block types whose content is `inline*` and thus typeable. Other blocks
// (lists, tables) wrap these — we still walk up to find the typeable one.
const TYPEABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
]);

export interface TriggerResult {
  ok: boolean;
  reason?: string;
}

export function shouldTrigger(state: EditorState): TriggerResult {
  const { selection } = state;

  // Need a single cursor, not a range — we extend at point, never replace.
  if (!selection.empty) return { ok: false, reason: 'has_selection' };

  const $cursor = selection.$head;
  const parent = $cursor.parent;

  // The immediate parent must be a typeable block (paragraph / heading /
  // blockquote). Lists wrap their content in paragraphs, so list cursors
  // still satisfy this check.
  if (!TYPEABLE_BLOCK_TYPES.has(parent.type.name)) {
    return { ok: false, reason: `non_text_parent:${parent.type.name}` };
  }

  // Walk ancestors — even inside a paragraph, if any enclosing node is an
  // atom (e.g., a math block has a paragraph child), we must bail.
  for (let depth = $cursor.depth; depth > 0; depth -= 1) {
    const ancestor = $cursor.node(depth);
    if (ATOM_NODE_TYPES.has(ancestor.type.name)) {
      return { ok: false, reason: `inside_atom:${ancestor.type.name}` };
    }
  }

  const textBefore = parent.textBetween(0, $cursor.parentOffset);
  if (textBefore.length === 0) {
    return { ok: false, reason: 'start_of_empty_block' };
  }

  // Last char must be a word char — gates out cursor-after-punctuation
  // ("hello." → don't trigger) and cursor-after-space which would reset
  // the model into a "complete the sentence" prompt without enough signal.
  const lastChar = textBefore[textBefore.length - 1]!;
  const isWordChar = /[A-Za-z0-9]/.test(lastChar);
  if (!isWordChar) {
    return { ok: false, reason: 'cursor_after_non_word' };
  }

  // End-of-block (no chars after cursor) → trigger.
  const atEndOfBlock = $cursor.parentOffset === parent.content.size;
  if (atEndOfBlock) return { ok: true };

  // Mid-block — trigger only if the next char is a word boundary.
  // Otherwise we'd be predicting INTO an existing word, which the user
  // is presumably about to keep typing.
  const textAfter = parent.textBetween($cursor.parentOffset, parent.content.size);
  const nextChar = textAfter[0] ?? '';
  if (/[A-Za-z0-9]/.test(nextChar)) {
    return { ok: false, reason: 'mid_word' };
  }

  return { ok: true };
}

export interface ExtractedContext {
  prefix: string;
  suffix: string;
}

export function extractContext(
  state: EditorState,
  maxPrefixChars: number,
  maxSuffixChars: number,
): ExtractedContext {
  const docText = state.doc.textBetween(0, state.doc.content.size, '\n', '\n');
  const cursorOffset = positionToTextOffset(state);

  const prefix = docText.slice(Math.max(0, cursorOffset - maxPrefixChars), cursorOffset);
  const suffix = docText.slice(cursorOffset, cursorOffset + maxSuffixChars);

  return { prefix, suffix };
}

/**
 * Convert ProseMirror's position-with-token-boundaries to a character
 * offset that lines up with `doc.textBetween(0, end, '\n', '\n')`.
 *
 * ProseMirror counts opening/closing markers in its position; our backend
 * wants raw character offsets. We walk the tree once accumulating text
 * length, adding 1 per block boundary to match the `'\n'` separator.
 *
 * Approximate-but-deterministic. 3.4 may revisit if token-accurate context
 * windowing for prompt budgeting matters; for the stub this is plenty.
 */
function positionToTextOffset(state: EditorState): number {
  let offset = 0;
  const targetPos = state.selection.from;
  state.doc.nodesBetween(0, targetPos, (node, pos) => {
    if (node.isText) {
      const slice = node.text!.slice(0, Math.max(0, targetPos - pos));
      offset += slice.length;
    } else if (node.isBlock && pos < targetPos && offset > 0) {
      // Implicit '\n' between blocks — matches the textBetween separator.
      offset += 1;
    }
    return true;
  });
  return offset;
}
