// @vitest-environment jsdom
/**
 * Sprint 0 (Diagram Phase 1) — XSS gate for the doc render path. Asserts the sanitizer neutralizes
 * the attack surface (script / event handlers / foreignObject / external SVG refs) while leaving
 * benign markup and ordinary doc links intact.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeMarkup } from './sanitize';

describe('sanitizeMarkup — Sprint 0 XSS gate', () => {
  it('strips <script>', () => {
    const out = sanitizeMarkup('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('hi');
  });

  it('strips event-handler attributes (onload) but keeps the benign SVG shape', () => {
    const out = sanitizeMarkup('<svg onload="alert(1)"><circle r="5"></circle></svg>');
    expect(out.toLowerCase()).not.toContain('onload');
    expect(out).toContain('circle');
  });

  it('strips <foreignObject>', () => {
    const out = sanitizeMarkup('<svg><foreignObject><div onclick="x()">hi</div></foreignObject></svg>');
    expect(out.toLowerCase()).not.toContain('foreignobject');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('strips EXTERNAL svg resource refs (image href) but keeps benign shapes', () => {
    const out = sanitizeMarkup('<svg><image href="http://evil.example/x.png"></image><circle r="5"></circle></svg>');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('circle');
  });

  it('keeps ordinary <a href> doc links (NOT an svg ref — links must still work)', () => {
    const out = sanitizeMarkup('<p><a href="https://example.com">link</a></p>');
    expect(out).toContain('https://example.com');
    expect(out).toContain('link');
  });

  it('KEEPS <style> inside SVG (mermaid embeds it) while still stripping <script>', () => {
    const out = sanitizeMarkup('<svg><style>.node{fill:#fff}</style><script>alert(1)</script><circle r="5"></circle></svg>');
    expect(out.toLowerCase()).toContain('<style');     // mermaid theming survives
    expect(out).toContain('.node');
    expect(out).not.toMatch(/<script/i);               // script still removed
    expect(out).toContain('circle');
  });

  it('leaves benign markdown/SVG unchanged in substance', () => {
    const out = sanitizeMarkup('<h1>Title</h1><p>body</p><svg><rect width="10" height="10"></rect></svg>');
    expect(out).toContain('Title');
    expect(out).toContain('body');
    expect(out).toContain('rect');
    expect(out).not.toMatch(/<script|onload|onerror/i);
  });
});
