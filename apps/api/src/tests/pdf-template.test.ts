/**
 * Diagram Phase 1, Sprint 2 → Build 4 — PDF export template wiring. The template now ONLY emits the
 * doc HTML (diagrams stay as ```mermaid / ```svg code blocks) + the .diagram figure CSS. The actual
 * render happens in renderPdf (browser-pool.ts), which injects mermaid + DOMPurify from the API's
 * OWN node_modules — NO CDN. So this asserts the template emits the right code blocks for the worker
 * to find, carries the figure CSS, and embeds NO external-CDN reference. The rasterization itself is
 * a deploy-time smoke test (needs Chromium).
 */
import { describe, it, expect } from 'vitest';
import { renderDocumentHtml } from '../lib/pdf/template.js';

describe('renderDocumentHtml — diagram export', () => {
  it('mermaid fence → language-mermaid block the worker will render', () => {
    const html = renderDocumentHtml('# Title\n\n```mermaid\ngraph TD; A-->B;\n```', 'Doc');
    expect(html).toContain('class="language-mermaid"');   // marked output the worker swaps for an SVG
    expect(html).toContain('.diagram');                   // figure CSS the render swaps the block into
  });

  it('svg fence → language-svg block the worker will sanitize + render', () => {
    const html = renderDocumentHtml('```svg\n<svg><circle r="5"/></svg>\n```', 'Doc');
    expect(html).toContain('class="language-svg"');
  });

  it('chart fence → language-chart block the worker renders via Chart.js (Sprint 3)', () => {
    const html = renderDocumentHtml('```chart\n{"type":"bar","data":{"labels":["a"],"datasets":[{"data":[1]}]}}\n```', 'Doc');
    expect(html).toContain('class="language-chart"');
    expect(html).toContain('.chart-figure'); // the figure CSS the worker swaps the block into
  });

  it('NO external CDN: the template never references jsdelivr / unpkg (libs are injected locally)', () => {
    const html = renderDocumentHtml('# T\n\n```mermaid\ngraph TD; A-->B;\n```\n\n```svg\n<svg/>\n```', 'Doc');
    expect(html).not.toContain('jsdelivr');
    expect(html).not.toContain('unpkg');
    expect(html).not.toContain('cdn.');
  });

  it('no-regression: a no-diagram doc renders its body unchanged with no diagram blocks', () => {
    const html = renderDocumentHtml('# Hello\n\nJust **text**, no diagrams.\n\n- a\n- b', 'Doc');
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('<strong>text</strong>');
    expect(html).toContain('<li>a</li>');
    expect(html).not.toContain('class="language-mermaid"');
    expect(html).not.toContain('class="language-svg"');
  });
});
