import { type Node, Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { shouldTrigger } from './trigger';

/**
 * Unit tests for the autocomplete trigger gate.
 *
 * Pure-CPU and runs against a hand-built minimal ProseMirror schema —
 * no Milkdown bootstrap, no DOM, no I/O. The cases mirror each gate in
 * shouldTrigger so a regression is caught at the right granularity.
 */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
    },
    code_block: {
      group: 'block',
      content: 'text*',
      code: true,
      defining: true,
      toDOM: () => ['pre', ['code', 0]],
    },
    horizontal_rule: {
      group: 'block',
      atom: true,
      selectable: true,
      toDOM: () => ['hr'],
    },
    text: { group: 'inline' },
  },
});

/**
 * Build an EditorState containing a single paragraph with `text`. The
 * cursor lands at `cursorOffset` (counted within the paragraph's text);
 * if omitted, the cursor lands at end-of-text.
 */
function paragraphState(text: string, cursorOffset?: number): EditorState {
  const doc: Node = schema.node('doc', null, [
    schema.node('paragraph', null, text.length > 0 ? [schema.text(text)] : []),
  ]);
  // Position 1 is "inside the opening <paragraph>". Add the per-char offset.
  const off = cursorOffset !== undefined ? cursorOffset : text.length;
  const pos = 1 + off;
  const selection = TextSelection.create(doc, pos, pos);
  return EditorState.create({ schema, doc, selection });
}

describe('shouldTrigger', () => {
  it('returns false on an empty doc (no text to predict from)', () => {
    const s = paragraphState('');
    const r = shouldTrigger(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('start_of_empty_block');
  });

  it('returns true at end of a word at end of line', () => {
    const s = paragraphState('hello');
    expect(shouldTrigger(s).ok).toBe(true);
  });

  it('returns false in the middle of a word', () => {
    // "hello", cursor between "hel" and "lo" → next char is 'l', a word char
    const s = paragraphState('hello', 3);
    const r = shouldTrigger(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mid_word');
  });

  it('returns false after punctuation', () => {
    const s = paragraphState('hello.');
    const r = shouldTrigger(s);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cursor_after_non_word');
  });

  it('returns true at end of word followed by space', () => {
    // "hello world" with cursor right after "hello" — next char is ' '
    const s = paragraphState('hello world', 5);
    expect(shouldTrigger(s).ok).toBe(true);
  });

  it('returns false inside a code block', () => {
    const doc = schema.node('doc', null, [
      schema.node('code_block', null, [schema.text('const x = 1')]),
    ]);
    const pos = 1 + 'const x = 1'.length;
    const selection = TextSelection.create(doc, pos, pos);
    const s = EditorState.create({ schema, doc, selection });
    const r = shouldTrigger(s);
    expect(r.ok).toBe(false);
    // Could be either non_text_parent (immediate parent is code_block) or
    // inside_atom (if walked up). Our impl returns non_text_parent first.
    expect(r.reason).toMatch(/non_text_parent|inside_atom/);
  });
});
