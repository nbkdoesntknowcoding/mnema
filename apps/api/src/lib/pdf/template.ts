import { marked } from 'marked';

// Diagram Phase 1 (Sprint 2 → Build 4): mermaid + sanitized SVG fences render in the export. The
// rendering itself runs in renderPdf (browser-pool.ts), which injects mermaid + DOMPurify into the
// export page from the API's OWN node_modules — NOT a CDN. This removes the jsDelivr dependency that
// was timing out the export on the VPS (the Chromium host can't always reach external CDNs). This
// template just emits the doc HTML (diagrams stay as ```mermaid / ```svg code blocks) + the .diagram
// figure CSS the renderer swaps them into.

// Light-mode professional document template.
// Intentionally separate from Mnema's dark UI — exported PDFs are clean documents.
export function renderDocumentHtml(markdown: string, title: string): string {
  marked.setOptions({ gfm: true, breaks: false });
  const body = marked.parse(markdown) as string;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.7;
    color: #1a1a1a;
    background: #ffffff;
  }

  h1 { font-size: 22pt; margin-bottom: 8pt; margin-top: 24pt; }
  h2 { font-size: 16pt; margin-bottom: 6pt; margin-top: 18pt; }
  h3 { font-size: 13pt; margin-bottom: 4pt; margin-top: 14pt; }
  h1:first-child, h2:first-child { margin-top: 0; }

  p { margin-bottom: 10pt; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 14pt 0;
    font-size: 10pt;
  }
  th {
    background: #f3f4f6;
    font-weight: 600;
    text-align: left;
    padding: 7pt 10pt;
    border: 1px solid #d1d5db;
  }
  td {
    padding: 6pt 10pt;
    border: 1px solid #e5e7eb;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #fafafa; }

  pre {
    background: #f6f8fa;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    padding: 12pt;
    margin: 12pt 0;
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    line-height: 1.5;
    page-break-inside: avoid;
    white-space: pre-wrap;
    word-break: break-all;
  }
  code {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background: #f6f8fa;
    padding: 1pt 4pt;
    border-radius: 3px;
  }
  pre code { background: none; padding: 0; }

  img { max-width: 100%; height: auto; margin: 10pt 0; page-break-inside: avoid; }

  blockquote {
    border-left: 3px solid #d1d5db;
    padding-left: 14pt;
    color: #4b5563;
    margin: 12pt 0;
    font-style: italic;
  }

  ul, ol { padding-left: 20pt; margin-bottom: 10pt; }
  li { margin-bottom: 3pt; }

  hr { border: none; border-top: 1px solid #e5e7eb; margin: 20pt 0; }

  a { color: #1d4ed8; text-decoration: underline; }

  h1, h2, h3 { page-break-after: avoid; }
  pre, table, img { page-break-inside: avoid; }

  .diagram { margin: 14pt 0; text-align: center; page-break-inside: avoid; }
  .diagram svg { max-width: 100%; height: auto; }

  .chart-figure { margin: 14pt 0; text-align: center; page-break-inside: avoid; }
  .chart-figure canvas { max-width: 100%; height: auto; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
