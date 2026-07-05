import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { uploadDocImage } from '../storage/r2-attachments.js';

export interface DocxIngestionResult {
  markdown:  string;
  title:     string;
  imageUrls: string[];
  warnings:  string[];
}

export async function ingestDocx(
  buffer: Buffer,
  workspaceId: string,
  filename: string,
): Promise<DocxIngestionResult> {
  const imageUrls: string[] = [];
  const warnings: string[]  = [];

  // ── Step 1: Mammoth DOCX → HTML ─────────────────────────────────────────
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const imgBuffer = await image.read();
        const url = await uploadDocImage(
          workspaceId,
          Buffer.from(imgBuffer),
          image.contentType ?? 'image/png',
        );
        imageUrls.push(url);
        return { src: url };
      }),
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Code']      => pre > code:fresh",
      ],
    },
  );

  warnings.push(...result.messages.map((m) => m.message));

  // ── Step 2: HTML → Markdown via Turndown ────────────────────────────────
  const td = new TurndownService({
    headingStyle:    'atx',
    codeBlockStyle:  'fenced',
    bulletListMarker: '-',
  });
  td.use(gfm);

  // Preserve table cell text on a single line (GFM pipe tables require it)
  td.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement(content) {
      return ` ${content.replace(/\n/g, ' ').trim()} |`;
    },
  });

  const markdown = td.turndown(result.value);

  // ── Step 3: Extract title ────────────────────────────────────────────────
  const firstH1 = markdown.match(/^# (.+)$/m)?.[1];
  const title   = firstH1 ?? filename.replace(/\.docx$/i, '');

  return { markdown, title, imageUrls, warnings };
}
