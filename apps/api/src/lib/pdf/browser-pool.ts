import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../../config/env.js';

// Build 4: diagram libs are read from the API's own node_modules and injected into the export page
// (no CDN). Read lazily + cached — a no-diagram export never touches them, and an SVG-only export
// never loads the 3.2MB mermaid bundle. require.resolve works under ESM via createRequire.
const requireFromHere = createRequire(import.meta.url);
let dompurifySrc: string | null = null;
let mermaidSrc: string | null = null;
function getDompurifySrc(): string {
  return (dompurifySrc ??= readFileSync(requireFromHere.resolve('dompurify/dist/purify.min.js'), 'utf8'));
}
function getMermaidSrc(): string {
  return (mermaidSrc ??= readFileSync(requireFromHere.resolve('mermaid/dist/mermaid.min.js'), 'utf8'));
}
// Charting Sprint 3: the Chart.js UMD bundle, read from the API's node_modules (no CDN). chart.js's
// `exports` only exposes ".", "./auto", "./helpers" — resolving ./package.json or ./dist/* throws
// ERR_PACKAGE_PATH_NOT_EXPORTED under a strict (Docker-flattened) node_modules. So resolve the main
// entry (dist/chart.cjs) and read the UMD sibling from that same dist dir.
let chartSrc: string | null = null;
function getChartSrc(): string {
  if (chartSrc === null) {
    const dir = dirname(requireFromHere.resolve('chart.js'));
    chartSrc = readFileSync(join(dir, 'chart.umd.js'), 'utf8');
  }
  return chartSrc;
}

// Runs INSIDE the export page. Swaps ```chart code blocks for a Chart.js canvas rendered from the
// embedded JSON spec — light-themed + animation:false (deterministic for print), mirroring the
// in-app plugins/chart.tsx adapter. responsive:false so the canvas backing buffer is fixed and crisp
// in the PDF. A per-block try/catch leaves the source visible on a bad spec.
async function renderChartsInPage(): Promise<void> {
  const w = window as unknown as { Chart?: new (c: HTMLCanvasElement, cfg: unknown) => unknown };
  if (!w.Chart) return;
  const PAL = ['#FFB370', '#6EA8FF', '#7BD88F', '#E879A6', '#C9A2FF', '#F2C14E', '#5BC8C0'];
  const TEXT = '#1c1f24';
  const GRID = 'rgba(10,11,13,0.08)';
  const FONT = 'Geist, system-ui, sans-serif';
  const buildCfg = (spec: Record<string, unknown>): Record<string, unknown> => {
    const s = spec as { type: string; data?: { labels?: unknown[]; datasets?: Record<string, unknown>[]; rows?: Record<string, unknown>[] }; x?: string; y?: string | string[]; title?: string; options?: Record<string, unknown> };
    const isArea = s.type === 'area';
    const type = isArea ? 'line' : s.type;
    let labels = s.data?.labels;
    let datasets: Record<string, unknown>[] = s.data?.datasets ?? [];
    const rows = s.data?.rows;
    if (Array.isArray(rows) && s.x && s.y) {
      const ys = Array.isArray(s.y) ? s.y : [s.y];
      labels = rows.map((r) => r[s.x as string]);
      datasets = ys.map((yk) => ({ label: yk, data: rows.map((r) => r[yk]) }));
    }
    const styled = datasets.map((ds, i) => {
      const c = PAL[i % PAL.length]!;
      const b: Record<string, unknown> = { ...ds };
      if (type === 'line') { b.borderColor = ds.borderColor ?? c; b.backgroundColor = ds.backgroundColor ?? (isArea ? `${c}33` : c); b.fill = isArea ? true : (ds.fill ?? false); b.tension = 0.3; b.pointRadius = 2; }
      else if (type === 'pie' || type === 'doughnut') { b.backgroundColor = ds.backgroundColor ?? PAL; }
      else if (type === 'scatter') { b.backgroundColor = ds.backgroundColor ?? c; }
      else { b.backgroundColor = ds.backgroundColor ?? c; b.borderRadius = 4; }
      return b;
    });
    const circ = type === 'pie' || type === 'doughnut';
    const legend = styled.length > 1 || circ;
    return {
      type,
      data: { labels, datasets: styled },
      options: {
        animation: false, responsive: false, maintainAspectRatio: false, color: TEXT,
        plugins: {
          legend: { display: legend, labels: { color: TEXT, font: { family: FONT } } },
          title: s.title ? { display: true, text: s.title, color: TEXT, font: { family: FONT, size: 15, weight: '600' } } : { display: false },
        },
        scales: circ ? {} : {
          x: { ticks: { color: TEXT, font: { family: FONT } }, grid: { color: GRID } },
          y: { beginAtZero: true, ticks: { color: TEXT, font: { family: FONT } }, grid: { color: GRID } },
        },
        ...(s.options ?? {}),
      },
    };
  };
  for (const code of Array.from(document.querySelectorAll('pre > code.language-chart'))) {
    try {
      const spec = JSON.parse(code.textContent || '{}') as Record<string, unknown>;
      const fig = document.createElement('div');
      fig.className = 'chart-figure';
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      fig.appendChild(canvas);
      code.closest('pre')?.replaceWith(fig);
      new w.Chart(canvas, buildCfg(spec));
    } catch { /* leave the source block on a bad spec */ }
  }
  // let Chart.js paint before page.pdf() captures the canvas
  await new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));
}

// Runs INSIDE the export page (serialized by Playwright). Swaps ```svg / ```mermaid code blocks for
// rendered figures: SVG is sanitized via the injected DOMPurify (svg profile, no script/handlers);
// mermaid is rendered via the injected mermaid global in strict mode. A per-block try/catch leaves
// the source visible on a parse error rather than failing the whole export.
async function renderDiagramsInPage(): Promise<void> {
  const w = window as unknown as {
    DOMPurify?: { sanitize: (s: string, opts: unknown) => string };
    mermaid?: { initialize: (o: unknown) => void; render: (id: string, src: string) => Promise<{ svg: string }> };
  };
  const replaceWithDiagram = (code: Element, htmlStr: string): void => {
    const fig = document.createElement('div');
    fig.className = 'diagram';
    fig.innerHTML = htmlStr;
    code.closest('pre')?.replaceWith(fig);
  };
  if (w.DOMPurify) {
    for (const code of Array.from(document.querySelectorAll('pre > code.language-svg'))) {
      const clean = w.DOMPurify.sanitize(code.textContent || '', {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
      });
      replaceWithDiagram(code, clean);
    }
  }
  const mmBlocks = Array.from(document.querySelectorAll('pre > code.language-mermaid'));
  if (mmBlocks.length && w.mermaid) {
    // Build 5: brand the exported mermaid (light palette — PDFs are light-mode) so it matches the
    // in-app look rather than mermaid's flat default. Mirrors MERMAID_VARS.light in the web editor.
    w.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // SVG <text> labels (not <foreignObject>) — matches the in-app render so the PDF looks the same.
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      theme: 'base',
      themeVariables: {
        primaryColor: '#f4f5f7',
        primaryTextColor: '#1c1f24',
        primaryBorderColor: 'rgba(214, 122, 51, 0.7)',
        lineColor: '#6E737C',
        secondaryColor: '#eceef1',
        tertiaryColor: '#ffffff',
        fontFamily: 'Geist, system-ui, sans-serif',
        fontSize: '15px',
      },
    });
    for (let i = 0; i < mmBlocks.length; i++) {
      const code = mmBlocks[i];
      if (!code) continue;
      try {
        const out = await w.mermaid.render(`exp-mmd-${i}`, code.textContent || '');
        replaceWithDiagram(code, out.svg);
      } catch { /* leave the source block as-is on a mermaid parse error */ }
    }
  }
}

const POOL_SIZE = 2;
const pool: Browser[] = [];
let initialised = false;

export async function initBrowserPool(): Promise<void> {
  if (initialised) return;
  for (let i = 0; i < POOL_SIZE; i++) {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
    });
    pool.push(browser);
  }
  initialised = true;
  // eslint-disable-next-line no-console
  console.log(`[browser-pool] initialised ${POOL_SIZE} Chromium instance(s)`);
}

let poolIndex = 0;
function getBrowser(): Browser {
  const browser = pool[poolIndex % pool.length];
  poolIndex++;
  if (!browser) throw new Error('Browser pool is empty — call initBrowserPool() first');
  return browser;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const browser = getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    // 'load' waits for the doc's own images but no longer races any network fetch — diagram libs are
    // injected locally below, so there's nothing external to stall on.
    let t = Date.now();
    await page.setContent(html, {
      waitUntil: 'load',
      timeout:   config.PDF_RENDER_TIMEOUT_MS,
    });
    logStep('setContent', t);
    // Build 4: render diagrams from LOCAL libs (no CDN). Only inject what a given doc needs — SVG
    // needs DOMPurify; mermaid needs the (large) mermaid bundle.
    const hasSvg = html.includes('language-svg');
    const hasMermaid = html.includes('language-mermaid');
    const hasChart = html.includes('language-chart');
    if (hasSvg || hasMermaid || hasChart) {
      // HARD time-bound the whole figure step (lib inject + render). A render that hangs in headless
      // Chromium must NEVER hang the job — on budget-exceeded we abandon it and print whatever the
      // page has (the figure degrades to its source code). This restores the guarantee the old
      // CDN-era 12s fallback gave; without it a hung render stalls the job to a 30s timeout.
      t = Date.now();
      const work = (async () => {
        if (hasSvg) { await page!.addScriptTag({ content: getDompurifySrc() }); logStep('inject:dompurify', t); }
        if (hasMermaid) { const m = Date.now(); await page!.addScriptTag({ content: getMermaidSrc() }); logStep('inject:mermaid', m); }
        if (hasSvg || hasMermaid) {
          const r = Date.now();
          await page!.evaluate(renderDiagramsInPage);
          logStep('render:diagrams', r);
        }
        if (hasChart) {
          const c = Date.now();
          await page!.addScriptTag({ content: getChartSrc() });
          await page!.evaluate(renderChartsInPage);
          logStep('render:charts', c);
        }
      })();
      try {
        await Promise.race([
          work,
          new Promise((_, rej) => setTimeout(() => rej(new Error('figure-render-budget-exceeded')), DIAGRAM_BUDGET_MS)),
        ]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[browser-pool] figure step abandoned after ${Date.now() - t}ms: ${String(err)} — printing source`);
      }
    }
    t = Date.now();
    const pdf = await page.pdf({
      format:     'A4',
      margin:     { top: '25mm', right: '20mm', bottom: '25mm', left: '20mm' },
      printBackground: true,
    });
    logStep('pdf', t);
    return Buffer.from(pdf);
  } finally {
    await page?.close();
  }
}

// Upper bound for the whole diagram render step. Must be comfortably under export_doc's 30s poll so a
// pathological diagram degrades to source and the job still returns a PDF instead of a 'timeout'.
const DIAGRAM_BUDGET_MS = 15_000;

function logStep(label: string, since: number): void {
  // eslint-disable-next-line no-console
  console.log(`[browser-pool] ${label}: ${Date.now() - since}ms`);
}

// Light mermaid palette for raster exports (PDF + DOCX are light documents). Mirrors the in-app
// MERMAID_VARS.light so an exported diagram looks like the one in the editor.
const LIGHT_MERMAID_VARS = {
  primaryColor: '#f4f5f7',
  primaryTextColor: '#1c1f24',
  primaryBorderColor: 'rgba(214, 122, 51, 0.7)',
  lineColor: '#6E737C',
  secondaryColor: '#eceef1',
  tertiaryColor: '#ffffff',
  fontFamily: 'Geist, system-ui, sans-serif',
  fontSize: '15px',
} as const;

export interface DiagramImage {
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Render diagram fences to PNG images for DOCX embedding (DOCX can't run a browser, but the worker
 * has Chromium). Returns a map keyed by the block's exact source — the docx diagram plugin looks up
 * each ```mermaid / ```svg code node's value here. Renders all blocks in one page (libs injected
 * once). A per-block failure is skipped (that block falls back to its source text in the doc).
 */
export async function renderDiagramImages(
  blocks: { format: 'mermaid' | 'svg' | 'chart'; source: string }[],
): Promise<Map<string, DiagramImage>> {
  const result = new Map<string, DiagramImage>();
  if (!blocks.length) return result;
  const browser = getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(
      '<!doctype html><html><body><div id="diagram-host" style="display:inline-block;background:#fff;padding:10px"></div></body></html>',
      { waitUntil: 'load' },
    );
    const needsSvg = blocks.some((b) => b.format === 'svg');
    const needsMermaid = blocks.some((b) => b.format === 'mermaid');
    let chartReady = blocks.some((b) => b.format === 'chart');
    if (chartReady) {
      try {
        await page.addScriptTag({ content: getChartSrc() });
      } catch (err) {
        // Never let a chart-lib load failure crash the whole export — just skip charts.
        chartReady = false;
        // eslint-disable-next-line no-console
        console.warn(`[browser-pool] chart lib load failed, skipping charts: ${String(err)}`);
      }
    }
    if (needsSvg) await page.addScriptTag({ content: getDompurifySrc() });
    if (needsMermaid) {
      await page.addScriptTag({ content: getMermaidSrc() });
      await page.evaluate((vars) => {
        (window as unknown as { mermaid: { initialize: (o: unknown) => void } }).mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict',
          htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true },
          theme: 'base', themeVariables: vars,
        });
      }, LIGHT_MERMAID_VARS);
    }
    for (const block of blocks) {
      if (result.has(block.source)) continue;   // identical diagram → reuse one render
      // Charts render to a detached canvas → PNG data URL (a canvas can't be screenshotted via the
      // svg-host path). Light-themed, fixed 1280x640 — mirrors the in-app + PDF chart config.
      if (block.format === 'chart') {
        if (!chartReady) continue;   // chart lib didn't load → leave the block as source
        try {
          const dataUrl = await Promise.race([
            page.evaluate((source) => {
              const w = window as unknown as { Chart: new (c: HTMLCanvasElement, cfg: unknown) => { destroy: () => void } };
              const spec = JSON.parse(source) as { type: string; data?: { labels?: unknown[]; datasets?: Record<string, unknown>[]; rows?: Record<string, unknown>[] }; x?: string; y?: string | string[]; title?: string; options?: Record<string, unknown> };
              const PAL = ['#FFB370', '#6EA8FF', '#7BD88F', '#E879A6', '#C9A2FF', '#F2C14E', '#5BC8C0'];
              const T = '#1c1f24', G = 'rgba(10,11,13,0.08)', F = 'Geist, system-ui, sans-serif';
              const isArea = spec.type === 'area';
              const type = isArea ? 'line' : spec.type;
              let labels = spec.data?.labels;
              let ds: Record<string, unknown>[] = spec.data?.datasets ?? [];
              const rows = spec.data?.rows;
              if (Array.isArray(rows) && spec.x && spec.y) {
                const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
                labels = rows.map((r) => r[spec.x as string]);
                ds = ys.map((yk) => ({ label: yk, data: rows.map((r) => r[yk]) }));
              }
              const styled = ds.map((d, i) => {
                const c = PAL[i % PAL.length]; const b: Record<string, unknown> = { ...d };
                if (type === 'line') { b.borderColor = d.borderColor ?? c; b.backgroundColor = d.backgroundColor ?? (isArea ? `${c}33` : c); b.fill = isArea ? true : (d.fill ?? false); b.tension = 0.3; b.pointRadius = 2; }
                else if (type === 'pie' || type === 'doughnut') { b.backgroundColor = d.backgroundColor ?? PAL; }
                else if (type === 'scatter') { b.backgroundColor = d.backgroundColor ?? c; }
                else { b.backgroundColor = d.backgroundColor ?? c; b.borderRadius = 4; }
                return b;
              });
              const circ = type === 'pie' || type === 'doughnut';
              const cfg = { type, data: { labels, datasets: styled }, options: { animation: false, responsive: false, maintainAspectRatio: false, color: T,
                plugins: { legend: { display: styled.length > 1 || circ, labels: { color: T, font: { family: F } } }, title: spec.title ? { display: true, text: spec.title, color: T, font: { family: F, size: 15, weight: '600' } } : { display: false } },
                scales: circ ? {} : { x: { ticks: { color: T, font: { family: F } }, grid: { color: G } }, y: { beginAtZero: true, ticks: { color: T, font: { family: F } }, grid: { color: G } } }, ...(spec.options ?? {}) } };
              const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 640;
              const chart = new w.Chart(canvas, cfg);
              const url = canvas.toDataURL('image/png');
              chart.destroy();
              return url;
            }, block.source),
            new Promise<null>((res) => setTimeout(() => res(null), DIAGRAM_BUDGET_MS)),
          ]);
          if (!dataUrl) continue;
          const png = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
          result.set(block.source, { png, width: 1280, height: 640 });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[browser-pool] docx chart image failed: ${String(err)}`);
        }
        continue;
      }
      try {
        const dims = await Promise.race([
          page.evaluate(async ({ format, source }) => {
            const w = window as unknown as {
              mermaid: { render: (id: string, src: string) => Promise<{ svg: string }> };
              DOMPurify: { sanitize: (s: string, o: unknown) => string };
            };
            const host = document.getElementById('diagram-host');
            if (!host) return null;
            let svg: string;
            if (format === 'mermaid') {
              const id = `docx-mmd-${Math.floor(performance.now())}-${source.length}`;
              svg = (await w.mermaid.render(id, source)).svg;
            } else {
              svg = w.DOMPurify.sanitize(source, {
                USE_PROFILES: { svg: true, svgFilters: true },
                FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
              });
            }
            host.innerHTML = svg;
            const el = host.querySelector('svg');
            if (!el) return null;
            const vb = el.viewBox?.baseVal;
            const ww = vb && vb.width ? vb.width : el.getBoundingClientRect().width;
            const hh = vb && vb.height ? vb.height : el.getBoundingClientRect().height;
            el.setAttribute('width', String(ww));
            el.setAttribute('height', String(hh));
            (el as unknown as { style: { maxWidth: string } }).style.maxWidth = 'none';
            return { width: Math.ceil(ww), height: Math.ceil(hh) };
          }, block),
          new Promise<null>((res) => setTimeout(() => res(null), DIAGRAM_BUDGET_MS)),
        ]);
        if (!dims) continue;
        const png = await page.locator('#diagram-host').screenshot({ type: 'png' });
        result.set(block.source, { png: Buffer.from(png), width: dims.width, height: dims.height });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[browser-pool] docx diagram image failed (${block.format}): ${String(err)}`);
      }
    }
  } finally {
    await page?.close();
  }
  return result;
}

export async function closeBrowserPool(): Promise<void> {
  await Promise.all(pool.map((b) => b.close()));
  pool.length = 0;
  initialised = false;
}
