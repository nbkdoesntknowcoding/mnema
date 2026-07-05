/**
 * Single sanitization point for any HTML/SVG markup that reaches the DOM in a doc render path
 * (marked output, mermaid-rendered SVG, dangerouslySetInnerHTML). Closes the pre-existing XSS hole
 * (Diagram Phase 1, Sprint 0) and is the gate for safely rendering Claude/user-authored SVG.
 *
 * Strips: <script>, <style>, <foreignObject>, <iframe>/<object>/<embed>, all event-handler
 * attributes (onload/onerror/…), and EXTERNAL resource refs on SVG resource elements
 * (<image href>, <use xlink:href>, <feImage>, …) — those are an exfil/XSS surface. Ordinary
 * <a href> links in HTML are left intact so doc links keep working; data:image/* and in-doc #refs
 * are kept.
 *
 * The user-authored vectors (mermaid SVG, the doc editor) render client-side, where DOMPurify runs;
 * SSR (no DOM) returns the input unchanged — only ever app-trusted preview content is emitted there.
 */
import DOMPurify from 'dompurify';

const SVG_REF_TAGS = new Set([
  'image', 'use', 'feimage', 'filter', 'pattern', 'mask', 'cursor', 'textpath', 'altglyph', 'tref',
]);

let hookInstalled = false;
function ensureHook(): void {
  if (hookInstalled || typeof DOMPurify.addHook !== 'function') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    const tag = (el.tagName || '').toLowerCase();
    if (!SVG_REF_TAGS.has(tag)) return;
    for (const attr of ['href', 'xlink:href', 'src']) {
      const v = el.getAttribute?.(attr)?.trim();
      if (v && !/^(#|data:image\/)/i.test(v)) el.removeAttribute(attr);
    }
  });
  hookInstalled = true;
}

const CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  // NOTE: <style> is intentionally NOT forbidden — mermaid embeds a <style> element in its SVG for
  // theming; stripping it breaks every rendered diagram. DOMPurify keeps it and sanitizes its CSS
  // (no @import/expression/javascript: url), so it's safe. <script>/<foreignObject>/etc. ARE forbidden.
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'annotation-xml'],
  // DOMPurify already strips on*/javascript:; explicit belt-and-suspenders for the common handlers.
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onbegin', 'onend'],
};

/** Sanitize HTML/SVG markup before it touches the DOM. */
export function sanitizeMarkup(dirty: string): string {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return dirty;
  ensureHook();
  return DOMPurify.sanitize(dirty, CONFIG);
}
