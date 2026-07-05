/**
 * Pure helpers for add_chart (Charting Engine Phase 1, Sprint 2) — kept db-free so the validation,
 * size-guard, and fencing are unit-testable without the env/db chain. Mirrors diagram-fence.ts.
 *
 * Builds a fenced ```chart block carrying a JSON chart spec + embedded data. The in-app + export
 * Chart.js renderer (plugins/chart.tsx, Sprint 1) consumes the same spec shape:
 *   { type, data: { labels, datasets } | { rows }, x?, y?, series?, title?, options? }
 */

export const CHART_TYPES = ['bar', 'line', 'area', 'scatter', 'pie', 'doughnut'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// Embedded-chart ceiling. Beyond this the data does NOT belong in a doc block — that's the seam
// where Phase 2 (stored datasets + server-side aggregation) takes over.
export const MAX_ROWS = 5000;
export const MAX_POINTS = 20_000; // total data points across all datasets
export const MAX_PAYLOAD_BYTES = 256 * 1024; // 256KB serialized spec

interface Dataset {
  label?: string;
  data: unknown[];
  [k: string]: unknown;
}
export interface ChartData {
  labels?: unknown[];
  datasets?: Dataset[];
  rows?: Record<string, unknown>[];
}
export interface BuildChartInput {
  chart_type: string;
  data: ChartData;
  x?: string;
  y?: string | string[];
  series?: string;
  title?: string;
  options?: Record<string, unknown>;
  /** Provenance for a referenced chart (Sprint 5): { dataset_id, aggregation }. The renderer ignores
   *  it — the embedded `data` is the aggregated snapshot — but it records what the chart came from. */
  source?: Record<string, unknown>;
}

export type BuildChartResult =
  | { ok: true; markdown: string; rows: number; points: number }
  | { ok: false; error: string; message: string };

function fail(error: string, message: string): BuildChartResult {
  return { ok: false, error, message };
}

// ```chart fence, longer than any backtick run inside the JSON (byte-faithful round-trip via get_doc).
function fenceChart(specJson: string): string {
  const longestRun = (specJson.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}chart\n${specJson}\n${fence}`;
}

const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

export function buildChartBlock(input: BuildChartInput): BuildChartResult {
  // normalize + validate the type
  const type = String(input.chart_type).toLowerCase().replace('donut', 'doughnut') as ChartType;
  if (!(CHART_TYPES as readonly string[]).includes(type)) {
    return fail('invalid_chart_type', `chart_type must be one of: ${CHART_TYPES.join(', ')}. Got "${input.chart_type}".`);
  }

  const data = input.data ?? {};
  const hasRows = Array.isArray(data.rows) && data.rows.length > 0;
  const hasDatasets = Array.isArray(data.datasets) && data.datasets.length > 0;
  if (!hasRows && !hasDatasets) {
    return fail(
      'invalid_data',
      'data must provide either { rows: [{...}] } (with x/y column keys) or { labels, datasets: [{ label, data }] }.',
    );
  }

  let rowCount = 0;
  let pointCount = 0;

  if (hasRows) {
    const rows = data.rows!;
    rowCount = rows.length;
    if (!input.x) return fail('missing_x', 'For rows data, `x` (the category / x-axis column key) is required.');
    if (!input.y) return fail('missing_y', 'For rows data, `y` (the value column key, or array of keys) is required.');
    const ys = Array.isArray(input.y) ? input.y : [input.y];
    const sample = rows[0]!;
    if (!(input.x in sample)) return fail('bad_x', `x column "${input.x}" not found in the row data.`);
    for (const yk of ys) {
      if (!(yk in sample)) return fail('bad_y', `y column "${yk}" not found in the row data.`);
    }
    // scatter needs numeric x AND y; categorical types need numeric y
    if (type === 'scatter') {
      if (!isNum(sample[input.x]) || !isNum(sample[ys[0]!])) {
        return fail('shape_mismatch', `scatter needs numeric x and y. Column "${input.x}"/"${ys[0]}" is not numeric.`);
      }
    } else if (!isNum(sample[ys[0]!])) {
      return fail('shape_mismatch', `${type} needs numeric values. y column "${ys[0]}" is not numeric.`);
    }
    pointCount = rowCount * ys.length;
  } else {
    const datasets = data.datasets!;
    for (const ds of datasets) {
      if (!Array.isArray(ds.data)) return fail('invalid_data', 'each dataset needs a `data` array.');
      pointCount += ds.data.length;
    }
    rowCount = Math.max(...datasets.map((d) => d.data.length));
    // categorical types want labels aligned to the data length
    if (type !== 'scatter' && !Array.isArray(data.labels)) {
      return fail('shape_mismatch', `${type} needs data.labels (the categories) alongside datasets.`);
    }
    if ((type === 'pie' || type === 'doughnut') && datasets.length > 1) {
      return fail('shape_mismatch', `${type} renders one series — provide a single dataset (got ${datasets.length}).`);
    }
  }

  // size guard — the Phase-1/Phase-2 seam
  const tooLarge = (detail: string): BuildChartResult =>
    fail(
      'too_large',
      `Dataset too large for an embedded chart (${detail}). Embedded charts cap at ~${MAX_ROWS} rows — ` +
        `use a stored dataset instead (Phase 2: ingest_dataset + a referenced chart that aggregates server-side).`,
    );
  if (rowCount > MAX_ROWS) return tooLarge(`${rowCount} rows`);
  if (pointCount > MAX_POINTS) return tooLarge(`${pointCount} data points`);

  // assemble the spec (omit undefined keys)
  const spec: Record<string, unknown> = { type, data };
  if (input.x !== undefined) spec.x = input.x;
  if (input.y !== undefined) spec.y = input.y;
  if (input.series !== undefined) spec.series = input.series;
  if (input.title !== undefined) spec.title = input.title;
  if (input.options !== undefined) spec.options = input.options;
  if (input.source !== undefined) spec.source = input.source;

  const json = JSON.stringify(spec, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) {
    return tooLarge(`${Math.round(Buffer.byteLength(json, 'utf8') / 1024)}KB payload`);
  }

  return { ok: true, markdown: fenceChart(json), rows: rowCount, points: pointCount };
}
