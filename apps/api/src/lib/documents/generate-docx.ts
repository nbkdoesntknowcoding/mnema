import { md2docx } from '@m2d/md2docx';
import { emojiPlugin, listPlugin, mathPlugin, tablePlugin } from 'mdast2docx/dist/plugins';
import type { DiagramImage } from '../pdf/browser-pool.js';

export interface DocxGenerationOptions {
  title?:    string;
  author?:   string;
  /** Pre-rendered diagram PNGs keyed by the diagram block's exact source (see diagram-extract.ts). */
  diagrams?: Map<string, DiagramImage>;
}

/**
 * Custom md2docx plugin: turn a ```mermaid / ```svg code block into an embedded image, using a PNG
 * the worker pre-rendered via Chromium (browser-pool.renderDiagramImages). md2docx's own mermaid +
 * image plugins are browser-only (DOM/canvas) and no-op on the server, which is why diagrams never
 * appeared in exported DOCX — this plugin replaces them with a real docx ImageRun from the buffer.
 * If a block has no pre-rendered image (render failed), it falls through to the default code block.
 */
const diagramImagePlugin = (pngs: Map<string, DiagramImage>) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: (docx: any, node: any): unknown[] => {
    if (node.type !== 'code') return [];
    const lang = (node.lang ?? '').toLowerCase();
    if (lang !== 'mermaid' && lang !== 'svg' && lang !== 'chart') return [];
    const img = pngs.get(node.value ?? '');
    if (!img) return [];
    node.type = '';   // consume — default code-block handler skips it
    const MAX_W = 580;   // ~A4 content width in px
    const scale = img.width > MAX_W ? MAX_W / img.width : 1;
    return [
      new docx.Paragraph({
        alignment: docx.AlignmentType.CENTER,
        children: [
          new docx.ImageRun({
            data: img.png,
            type: 'png',
            transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) },
          }),
        ],
      }),
    ];
  },
});

export async function generateDocx(
  markdown: string,
  options: DocxGenerationOptions = {},
): Promise<Buffer> {
  // Explicit plugin list = the server-safe subset of md2docx's defaults (list/math/table/emoji) plus
  // our diagram plugin FIRST. We deliberately omit mermaid/html/image (browser-only) — our diagram
  // plugin handles diagrams, and those never functioned server-side anyway.
  const plugins = [
    diagramImagePlugin(options.diagrams ?? new Map<string, DiagramImage>()),
    listPlugin(),
    mathPlugin(),
    tablePlugin(),
    emojiPlugin(),
  ];

  const result = await md2docx(
    markdown,
    {
      title:   options.title ?? 'Mnema Document',
      creator: options.author ?? 'Mnema — example.com',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { plugins } as any,
    'nodebuffer',
  );

  return result as Buffer;
}
