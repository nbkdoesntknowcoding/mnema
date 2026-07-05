import { Chart } from 'chart.js/auto';

/**
 * Charting Engine — Phase 1, Sprint 1. Renders a fenced ```chart block in-app via Chart.js,
 * mirroring the diagram `renderPreview` hook in mermaid.tsx (a `chart` branch alongside svg/mermaid).
 *
 * The block carries a JSON chart spec + embedded data:
 *   { type, data: { labels, datasets } | { rows }, x, y, series?, title?, options? }
 * Chart.js (self-hosted, bundled — no CDN) does the geometry: axes, scales, ticks, legends. We map
 * the friendly spec to a Chart.js config and apply the brand palette so charts match the doc's look.
 */

// Series colour ramp — brand accent first, then a tasteful set that reads on dark + light surfaces.
const SERIES_PALETTE = ['#FFB370', '#6EA8FF', '#7BD88F', '#E879A6', '#C9A2FF', '#F2C14E', '#5BC8C0'];

function isLight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light';
}
const FONT = 'Geist, system-ui, sans-serif';

interface ChartSpec {
  type: string;
  data?: { labels?: unknown[]; datasets?: Record<string, unknown>[]; rows?: Record<string, unknown>[] };
  x?: string;
  y?: string | string[];
  series?: string;
  title?: string;
  options?: Record<string, unknown>;
}

// Map the friendly chart spec → a Chart.js config. Handles the `rows + x + y` shape by pivoting to
// labels + datasets, applies the brand palette, themes text/grid to the active mode, and disables
// animation so the render is deterministic (matters for the PDF export path in Sprint 3).
export function toChartConfig(spec: ChartSpec): Record<string, unknown> {
  const text = isLight() ? '#1c1f24' : '#ededed';
  const grid = isLight() ? 'rgba(10,11,13,0.08)' : 'rgba(255,255,255,0.08)';
  const isArea = spec.type === 'area';
  const type = isArea ? 'line' : spec.type;

  let labels = spec.data?.labels;
  let datasets: Record<string, unknown>[] = spec.data?.datasets ?? [];

  // rows + x + y → labels + datasets (optionally split into series by spec.series)
  const rows = spec.data?.rows;
  if (Array.isArray(rows) && spec.x && spec.y) {
    const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
    if (spec.series) {
      const seriesNames = [...new Set(rows.map((r) => String(r[spec.series!])))];
      const xs = [...new Set(rows.map((r) => r[spec.x!]))];
      labels = xs;
      const yk = ys[0]!;
      datasets = seriesNames.map((s) => ({
        label: s,
        data: xs.map((xv) => {
          const row = rows.find((r) => r[spec.x!] === xv && String(r[spec.series!]) === s);
          return row ? row[yk] : null;
        }),
      }));
    } else {
      labels = rows.map((r) => r[spec.x!]);
      datasets = ys.map((yk) => ({ label: yk, data: rows.map((r) => r[yk]) }));
    }
  }

  const styled = datasets.map((ds, i) => {
    const color = SERIES_PALETTE[i % SERIES_PALETTE.length]!;
    const base: Record<string, unknown> = { ...ds };
    if (type === 'line') {
      base.borderColor = ds.borderColor ?? color;
      base.backgroundColor = ds.backgroundColor ?? (isArea ? `${color}33` : color);
      base.fill = isArea ? true : (ds.fill ?? false);
      base.tension = ds.tension ?? 0.3;
      base.pointRadius = ds.pointRadius ?? 2;
    } else if (type === 'pie' || type === 'doughnut') {
      base.backgroundColor = ds.backgroundColor ?? SERIES_PALETTE;
    } else if (type === 'scatter' || type === 'bubble') {
      base.backgroundColor = ds.backgroundColor ?? color;
    } else {
      base.backgroundColor = ds.backgroundColor ?? color;
      base.borderRadius = ds.borderRadius ?? 4;
    }
    return base;
  });

  const isCircular = type === 'pie' || type === 'doughnut';
  const showLegend = styled.length > 1 || isCircular;

  return {
    type,
    data: { labels, datasets: styled },
    options: {
      animation: false,
      // Rendered offscreen to a fixed-size canvas → toDataURL → <img> (Crepe serializes the preview
      // to innerHTML, which would wipe a live <canvas>). So fixed size, NOT responsive.
      responsive: false,
      maintainAspectRatio: false,
      color: text,
      plugins: {
        legend: { display: showLegend, labels: { color: text, font: { family: FONT } } },
        title: spec.title
          ? { display: true, text: spec.title, color: text, font: { family: FONT, size: 15, weight: '600' } }
          : { display: false },
      },
      scales: isCircular
        ? {}
        : {
            x: { ticks: { color: text, font: { family: FONT } }, grid: { color: grid } },
            y: { beginAtZero: true, ticks: { color: text, font: { family: FONT } }, grid: { color: grid } },
          },
      ...(spec.options ?? {}),
    },
  };
}

/**
 * Render a ```chart block's preview, called from the diagram renderPreview hook (mermaid.tsx) — ONE
 * renderPreview chain handles svg/mermaid/chart (two separate crepe.editor.config() overrides don't
 * compose).
 *
 * CRITICAL: Crepe renders the preview by serializing the returned element to innerHTML (DOMPurify),
 * so a live <canvas> loses its drawing. We therefore render Chart.js to a DETACHED fixed-size canvas,
 * snapshot it to a PNG data URL, and return an <img> — which survives the innerHTML round-trip (img +
 * data: is allowed by Crepe's sanitizer). Fully synchronous: the host is ready before it's serialized.
 */
export function renderChartHost(content: string): HTMLElement {
  if (!content.trim()) {
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = 'Empty chart';
    return empty;
  }
  let spec: ChartSpec;
  try {
    spec = JSON.parse(content) as ChartSpec;
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'chart-error';
    err.textContent = `Chart: invalid JSON — ${String((e as Error).message).slice(0, 160)}`;
    return err;
  }
  const host = document.createElement('div');
  host.className = 'chart-preview';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 640;
    const chart = new Chart(canvas, toChartConfig(spec) as never);
    const url = canvas.toDataURL('image/png');
    chart.destroy();
    const img = document.createElement('img');
    img.className = 'chart-img';
    img.src = url;
    img.alt = spec.title ?? 'chart';
    host.appendChild(img);
  } catch (e) {
    host.className = 'chart-error';
    host.textContent = `Chart render failed: ${String((e as Error).message).slice(0, 160)}`;
  }
  return host;
}
