import { codeBlockConfig } from '@milkdown/kit/component/code-block';
import type { Ctx } from '@milkdown/kit/ctx';
import mermaid from 'mermaid';
import { sanitizeMarkup } from '../../../lib/sanitize';
import { renderChartHost } from './chart';

/**
 * Mermaid theme variables for each Mnema theme. The brand accent stays
 * identical across themes (so node borders + flow arrows read the same
 * regardless of mode), only surfaces and text colors swap. Values come
 * from the design tokens — keep them in sync if global.css changes.
 */
const MERMAID_VARS = {
  dark: {
    primaryColor: '#1c1f24',
    primaryTextColor: '#ededed',
    primaryBorderColor: 'rgba(255, 179, 112, 0.55)',   // brand accent — node borders carry the pop
    lineColor: '#8a8f99',                              // brighter edges so flow reads at a glance
    secondaryColor: '#22262d',
    tertiaryColor: '#14161a',
    noteBkgColor: '#22262d',
    noteTextColor: '#ededed',
    fontFamily: 'Geist, system-ui, sans-serif',
    fontSize: '15px',
  },
  light: {
    primaryColor: '#f4f5f7',
    primaryTextColor: '#1c1f24',
    primaryBorderColor: 'rgba(214, 122, 51, 0.7)',     // accent, darkened for light-bg contrast
    lineColor: '#6E737C',
    secondaryColor: '#eceef1',
    tertiaryColor: '#ffffff',
    noteBkgColor: '#fff6ec',
    noteTextColor: '#1c1f24',
    fontFamily: 'Geist, system-ui, sans-serif',
    fontSize: '15px',
  },
} as const;

function currentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Idempotent init that re-applies on every call. mermaid.initialize() is
 * safe to call repeatedly; later calls replace the theme variables on the
 * shared mermaid global. Existing already-rendered SVGs keep their old
 * theme (their DOM is innerHTML the editor doesn't re-trigger on its own)
 * — re-rendering them is a Phase 5 polish if the seam matters.
 */
function initMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',   // Sprint 0: no script via directives/labels; sanitize HTML labels
    // Render node/edge labels as native SVG <text>, NOT <foreignObject> (mermaid's default HTML
    // labels). Our SVG sanitizer FORBIDs <foreignObject> for XSS safety, which would otherwise strip
    // every label — so html labels render as empty shapes in-app. SVG text survives sanitization.
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: true },
    theme: 'base',
    themeVariables: MERMAID_VARS[currentTheme()],
  });
}

let themeObserver: MutationObserver | null = null;
function ensureThemeObserver(): void {
  if (themeObserver || typeof document === 'undefined') return;
  themeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        initMermaid();
        return;
      }
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

let mermaidIdCounter = 0;
function nextMermaidId(): string {
  mermaidIdCounter += 1;
  return `mermaid-render-${mermaidIdCounter}`;
}

/**
 * Mermaid renders inside Crepe's CodeMirror code-block via the
 * `renderPreview` hook on `codeBlockConfig`. Same pattern Crepe's Latex
 * feature uses for KaTeX. Click "Hide" / "Edit" toggles between source
 * (CodeMirror) and rendered Mermaid SVG.
 *
 * Phase 4.3: also subscribes to <html data-theme> changes so future
 * diagrams render in the active theme's palette without a page reload.
 */
export function configureMermaidPreview(ctx: Ctx): void {
  initMermaid();
  ensureThemeObserver();
  ctx.update(codeBlockConfig.key, (prev) => ({
    ...prev,
    // Figure-first: blocks that have a rendered preview (mermaid/svg/chart) show the figure by
    // default with the source hidden; the "Edit" toggle reveals the code. Crepe only applies this to
    // blocks that actually produce a preview — a normal code block (no preview) still shows its code.
    previewOnlyByDefault: true,
    renderPreview: (language, content, applyPreview) => {
      const lang = language.toLowerCase();
      // Charting Sprint 1: a ```chart fence renders via Chart.js. Handled here in the SAME
      // renderPreview chain (not a separate config) so it actually composes with svg/mermaid.
      if (lang === 'chart') return renderChartHost(content);
      // Diagram Phase 1: an ```svg fence renders the SVG inline — ALWAYS through the Sprint-0
      // sanitizer (never raw). SVG is static, so return the host synchronously.
      if (lang === 'svg') {
        if (!content.trim()) return prev.renderPreview(language, content, applyPreview);
        const host = document.createElement('div');
        host.className = 'svg-preview';
        host.innerHTML = sanitizeMarkup(content.trim());
        return host;
      }
      if (lang !== 'mermaid') {
        return prev.renderPreview(language, content, applyPreview);
      }
      if (!content.trim()) {
        const empty = document.createElement('div');
        empty.className = 'mermaid-empty';
        empty.textContent = 'Empty diagram';
        return empty;
      }

      // Return undefined → preview-panel shows previewLoading, then waits
      // for applyPreview(...) below. Returning the host element synchronously
      // would lock Vue's reactivity to that one instance and never re-render
      // when its innerHTML is mutated later.
      mermaid
        .render(nextMermaidId(), content)
        .then(({ svg }) => {
          const host = document.createElement('div');
          host.className = 'mermaid-preview';
          host.innerHTML = sanitizeMarkup(svg);   // Sprint 0: never inject raw SVG (XSS guard)
          applyPreview(host);
        })
        .catch((err: unknown) => {
          console.error('mermaid render failed', err);
          const errEl = document.createElement('div');
          errEl.className = 'mermaid-error';
          errEl.textContent = `Mermaid: ${String((err as { message?: string })?.message ?? err).slice(0, 200)}`;
          applyPreview(errEl);
        });
      return undefined;
    },
  }));
}
