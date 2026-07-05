import type { MilkdownPlugin } from '@milkdown/ctx';
import { $node, $remark } from '@milkdown/utils';
import remarkMath from 'remark-math';

// Cast to `never` to stop TypeScript inferring Options from the transitive
// mdast-util-math dep — avoids TS2742 "type cannot be named" errors on emit.
export const remarkMathPlugin = $remark('remark-math', () => remarkMath as never);

export const mathInlineNode = $node('math_inline', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',
  attrs: { src: { default: '' } },
  parseDOM: [
    {
      tag: 'span[data-type="math-inline"]',
      getAttrs: (dom) => ({
        src: (dom as HTMLElement).getAttribute('data-src') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'span',
    {
      'data-type': 'math-inline',
      'data-src': (node.attrs.src as string) ?? '',
      class: 'math-inline-placeholder',
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'inlineMath',
    runner: (state, node, type) => {
      const value = (node as { value?: string }).value ?? '';
      state.addNode(type, { src: value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_inline',
    runner: (state, node) => {
      state.addNode('inlineMath', undefined, (node.attrs.src as string) ?? '');
    },
  },
}));

export const mathBlockNode = $node('math_block', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  marks: '',
  attrs: { src: { default: '' } },
  parseDOM: [
    {
      tag: 'div[data-type="math-block"]',
      getAttrs: (dom) => ({
        src: (dom as HTMLElement).getAttribute('data-src') ?? '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'math-block',
      'data-src': (node.attrs.src as string) ?? '',
      class: 'math-block-placeholder',
    },
  ],
  parseMarkdown: {
    match: ({ type }) => type === 'math',
    runner: (state, node, type) => {
      const value = (node as { value?: string }).value ?? '';
      state.addNode(type, { src: value });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'math_block',
    runner: (state, node) => {
      state.addNode('math', undefined, (node.attrs.src as string) ?? '');
    },
  },
}));

/**
 * The flat list of plugins that teach a Milkdown editor about $...$ and
 * $$...$$ math syntax. Both the browser editor and the headless Node bridge
 * import this from here so the schema is authoritative in one place.
 */
export const mathSchemaPlugin: MilkdownPlugin[] = [remarkMathPlugin, mathInlineNode, mathBlockNode].flat();
