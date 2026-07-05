/**
 * Extract mermaid / svg diagram fences from a doc's markdown, in document order.
 *
 * Parsed with the SAME remark parser md2docx uses internally, so each block's `source` is byte-equal
 * to the mdast `code` node's `value` — which lets the docx diagram plugin (generate-docx.ts) look up
 * the pre-rendered image by that exact key. The worker renders these to PNGs (browser-pool) and the
 * plugin swaps the code block for the image.
 */
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export interface DiagramBlock {
  format: 'mermaid' | 'svg' | 'chart';
  source: string;
}

interface MdNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdNode[];
}

export function extractDiagramBlocks(markdown: string): DiagramBlock[] {
  const tree = unified().use(remarkParse).parse(markdown) as unknown as MdNode;
  const out: DiagramBlock[] = [];
  const walk = (node: MdNode): void => {
    if (node.type === 'code') {
      const lang = (node.lang ?? '').toLowerCase();
      if (lang === 'mermaid' || lang === 'svg' || lang === 'chart') {
        out.push({ format: lang, source: node.value ?? '' });
      }
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  return out;
}
