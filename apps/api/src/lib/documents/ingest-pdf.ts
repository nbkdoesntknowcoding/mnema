import { Mistral } from '@mistralai/mistralai';
import { config } from '../../config/env.js';
import { uploadAttachment, uploadDocImage } from '../storage/r2-attachments.js';

// pdfjs-dist ships ESM — use dynamic import so Node handles it correctly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');

const SCANNED_THRESHOLD_CHARS_PER_PAGE = 100;

interface TextItem {
  text:     string;
  x:        number;
  y:        number;
  width:    number;
  height:   number;
  fontSize: number;
}

// ── D.1 Scanned PDF detection ─────────────────────────────────────────────────
export async function detectIfScanned(buffer: Buffer): Promise<{
  isScanned:        boolean;
  pageCount:        number;
  avgCharsPerPage:  number;
}> {
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageCount     = pdfDoc.numPages as number;
  const pagesToSample = Math.min(pageCount, 5);
  let totalChars = 0;

  for (let i = 1; i <= pagesToSample; i++) {
    const page    = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    totalChars += (content.items as { str?: string }[])
      .filter((item) => typeof item.str === 'string')
      .reduce((sum, item) => sum + (item.str?.length ?? 0), 0);
  }

  const avgCharsPerPage = totalChars / pagesToSample;
  return {
    isScanned: avgCharsPerPage < SCANNED_THRESHOLD_CHARS_PER_PAGE,
    pageCount,
    avgCharsPerPage,
  };
}

// ── D.2 Text-based PDF extraction (pdfjs-dist + heuristic tables) ─────────────
interface ExtractedPage {
  pageNumber: number;
  markdown:   string;
}

export async function extractTextPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: ExtractedPage[] = [];

  for (let i = 1; i <= (pdfDoc.numPages as number); i++) {
    const page    = await pdfDoc.getPage(i);
    const content = await page.getTextContent();

    const items: TextItem[] = (content.items as {
      str?: string;
      transform: number[];
      width: number;
      height: number;
    }[])
      .filter((item) => typeof item.str === 'string' && item.str.length > 0)
      .map((item) => ({
        text:     item.str as string,
        x:        Math.round(item.transform[4] ?? 0),
        y:        Math.round(item.transform[5] ?? 0),
        width:    Math.round(item.width),
        height:   Math.round(item.height),
        fontSize: Math.round(Math.abs(item.transform[0] ?? 12)),
      }));

    pages.push({ pageNumber: i, markdown: convertItemsToMarkdown(items).replace(/\x00/g, '') });
  }

  return pages;
}

function convertItemsToMarkdown(items: TextItem[]): string {
  if (items.length === 0) return '';

  const rows = groupByYPosition(items, 3);
  const avgFontSize =
    items.reduce((s, it) => s + it.fontSize, 0) / items.length;

  const lines: string[] = [];
  let inTable = false;

  for (const row of rows) {
    const cols = groupByXPosition(row, 20);

    if (cols.length >= 2) {
      if (!inTable) {
        lines.push('| ' + cols.map((c) => c.map((i) => i.text).join(' ')).join(' | ') + ' |');
        lines.push('| ' + cols.map(() => '---').join(' | ') + ' |');
        inTable = true;
      } else {
        lines.push('| ' + cols.map((c) => c.map((i) => i.text).join(' ')).join(' | ') + ' |');
      }
    } else {
      if (inTable) { lines.push(''); inTable = false; }

      const text = row.map((i) => i.text).join(' ').trim();
      if (!text) continue;

      const rowFontSize = row[0]?.fontSize ?? avgFontSize ?? 12;
      if (rowFontSize > avgFontSize * 1.3) {
        lines.push(`## ${text}`);
      } else {
        lines.push(text);
      }
    }
  }

  return lines.join('\n');
}

function groupByYPosition(items: TextItem[], tolerance: number): TextItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const first = sorted[0]!;
  const rows: TextItem[][] = [];
  let current: TextItem[] = [first];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    if (Math.abs(item.y - current[0]!.y) <= tolerance) {
      current.push(item);
    } else {
      rows.push(current.sort((a, b) => a.x - b.x));
      current = [item];
    }
  }
  rows.push(current.sort((a, b) => a.x - b.x));
  return rows;
}

function groupByXPosition(items: TextItem[], tolerance: number): TextItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const cols: TextItem[][] = [[sorted[0]!]];

  for (let i = 1; i < sorted.length; i++) {
    const item    = sorted[i]!;
    const lastCol = cols[cols.length - 1]!;
    const lastItem = lastCol[lastCol.length - 1]!;
    if (item.x - lastItem.x <= tolerance) {
      lastCol.push(item);
    } else {
      cols.push([item]);
    }
  }
  return cols;
}

// ── D.3 Mistral OCR path (scanned PDFs) ──────────────────────────────────────
export async function extractWithMistralOcr(
  buffer: Buffer,
  workspaceId: string,
): Promise<{ markdown: string; imageUrls: string[]; pageCount: number }> {
  if (!config.MISTRAL_API_KEY) {
    throw new Error('MISTRAL_API_KEY not configured. Cannot process scanned PDF.');
  }

  const client = new Mistral({ apiKey: config.MISTRAL_API_KEY });
  const imageUrls: string[] = [];

  let documentInput: Record<string, unknown>;
  if (buffer.length > 20 * 1024 * 1024) {
    // Large file: upload to R2, pass a signed URL to Mistral
    const { url } = await uploadAttachment(workspaceId, buffer, 'pdf', 'temp-ocr.pdf');
    documentInput = { type: 'document_url', document_url: url };
  } else {
    documentInput = {
      type:          'document_base64',
      document_base64: buffer.toString('base64'),
      document_name: 'document.pdf',
    };
  }

  const response = await client.ocr.process({
    model:                'mistral-ocr-latest',
    document:             documentInput as Parameters<typeof client.ocr.process>[0]['document'],
    // @ts-expect-error — table_format and include_image_base64 are valid API params
    table_format:         'markdown',
    include_image_base64: true,
  });

  const pageMarkdowns: string[] = [];

  for (const page of (response as { pages?: { markdown?: string; images?: { id?: string; image_base64?: string }[] }[] }).pages ?? []) {
    let pageMarkdown = page.markdown ?? '';

    for (const image of page.images ?? []) {
      if (image.image_base64 && image.id) {
        const imgBuffer = Buffer.from(image.image_base64, 'base64');
        const url = await uploadDocImage(workspaceId, imgBuffer, 'image/png');
        imageUrls.push(url);
        pageMarkdown = pageMarkdown.replace(image.id, url);
      }
    }

    pageMarkdowns.push(pageMarkdown);
  }

  const pages = (response as { pages?: unknown[] }).pages ?? [];
  return {
    markdown:  pageMarkdowns.join('\n\n---\n\n'),
    imageUrls,
    pageCount: pages.length,
  };
}

// ── D.4 PDF ingestion orchestrator ────────────────────────────────────────────
export interface PdfIngestionResult {
  markdown:   string;
  title:      string;
  imageUrls:  string[];
  pageCount:  number;
  usedOcr:    boolean;
}

export async function ingestPdf(
  buffer: Buffer,
  workspaceId: string,
  filename: string,
): Promise<PdfIngestionResult> {
  const { isScanned, pageCount } = await detectIfScanned(buffer);

  let markdown:  string;
  let imageUrls: string[] = [];
  let usedOcr = false;

  if (isScanned) {
    const result = await extractWithMistralOcr(buffer, workspaceId);
    markdown  = result.markdown;
    imageUrls = result.imageUrls;
    usedOcr   = true;
  } else {
    const pages = await extractTextPdf(buffer);
    markdown = pages.map((p) => p.markdown).join('\n\n---\n\n');
  }

  const firstHeading = markdown.match(/^#{1,2} (.+)$/m)?.[1];
  const title        = firstHeading ?? filename.replace(/\.pdf$/i, '');

  return { markdown, title, imageUrls, pageCount, usedOcr };
}
