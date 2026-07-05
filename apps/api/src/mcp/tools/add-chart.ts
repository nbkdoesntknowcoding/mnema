/**
 * MCP tool: `add_chart` (Charting Engine Phase 1, Sprint 2).
 *
 * Lets Claude add an accurate, library-rendered data chart to a doc from data it holds (a pasted
 * CSV, a query result). Distinct from `add_diagram`: diagrams are Claude-authored SVG; charts are
 * rendered by Chart.js from real data, because a mis-scaled axis is a factual error in a report.
 *
 * THIN wrapper over propose_doc_write (same as add_diagram): validates the data shape against the
 * chart type, enforces the embedded-data size guard (the Phase-1/Phase-2 seam), wraps the spec+data
 * in a fenced ```chart block, and appends it through the EXACT same propose/commit safety.
 */
import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { proposeDocWrite } from './propose-doc-write.js';
import { buildChartBlock, CHART_TYPES } from './chart-spec.js';
import { describeDataset } from '../../lib/datasets/dataset-store.js';
import { aggregateDataset, type AggregationSpec } from '../../lib/datasets/aggregate.js';

export const ADD_CHART_TOOL_NAME = 'add_chart';

export const ADD_CHART_TOOL_SPEC = {
  name: ADD_CHART_TOOL_NAME,
  description: [
    'Add a data chart to a doc — rendered by a real charting library (Chart.js) from real data, so',
    'axes/scales/legends are accurate. Use this for charts FROM DATA (a CSV, query results); use',
    'add_diagram for hand-drawn diagrams (flowcharts, architecture).',
    '',
    'Shape the data yourself, then call. Two data shapes are accepted:',
    '  • { rows: [{...}] } + x (category column) + y (value column, or array of columns) — the common',
    '    case when you have tabular rows.',
    '  • { labels: [...], datasets: [{ label, data: [...] }] } — Chart.js-native, for pre-shaped series.',
    'Pick chart_type from: bar, line, area, scatter, pie, doughnut. Validation rejects a data/type',
    'mismatch (e.g. scatter needs numeric x+y) with a clear error so you can correct it.',
    '',
    'EMBEDDED-DATA LIMIT: a few thousand rows. Larger data returns a "too_large" error pointing to the',
    'stored-dataset path — do NOT paste huge datasets into a chart block.',
    '',
    'REFERENCED MODE (no ceiling, Phase 2): instead of `data`, pass `dataset_id` (from ingest_dataset)',
    '+ `aggregation` { x, y:{fn,column}, series?, bucket?, top_n?, order? }. The server aggregates the',
    'stored dataset (GROUP BY) and embeds only the small AGGREGATED result — the raw rows never enter',
    'the doc. Use describe_dataset first to pick columns. Example aggregation: { "x":"category",',
    '"y":{"fn":"sum","column":"revenue"}, "top_n":10, "order":"value_desc" }.',
    '',
    'Appends a fenced ```chart block through the SAME preview/approve flow as add_diagram — the commit',
    'only fires when the user approves. IN CLAUDE CODE / CLI: show the proposed block, get explicit',
    'approval, then call confirm_doc_write with the proposal_token. REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: { type: 'string', description: 'UUID of the target doc.' },
      chart_type: { type: 'string', enum: [...CHART_TYPES, 'donut'], description: 'Chart type: bar, line, area, scatter, pie, doughnut.' },
      data: {
        type: 'object',
        description: 'Embedded data: { rows: [{...}] } (with x/y column keys) OR { labels: [...], datasets: [{ label, data: [...] }] }.',
      },
      x: { type: 'string', description: 'For rows data: the column key for the x-axis / category.' },
      y: { type: 'string', description: 'For rows data: the column key for the value series (single key; use {datasets} for multiple).' },
      series: { type: 'string', description: 'Optional: for rows data, a column key to split into multiple series (grouped/stacked).' },
      title: { type: 'string', description: 'Optional chart title.' },
      options: { type: 'object', description: 'Optional Chart.js options overrides (merged over the themed defaults).' },
      after_anchor: { type: 'string', description: 'Optional anchor id to insert after (Phase 1 appends at the end).' },
      dataset_id: { type: 'string', description: 'Referenced mode: id of a stored dataset (from ingest_dataset). Provide WITH aggregation, instead of data.' },
      aggregation: { type: 'object', description: 'Referenced mode: { x, y: { fn: sum|avg|count|min|max, column? }, series?, bucket?: day|week|month, top_n?, order? }.' },
    },
    required: ['doc_id', 'chart_type'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Add a data chart (with preview)' },
};

const argsSchema = z
  .object({
    doc_id: z.string().uuid(),
    chart_type: z.string(),
    data: z.record(z.unknown()).optional(),
    x: z.string().optional(),
    y: z.union([z.string(), z.array(z.string())]).optional(),
    series: z.string().optional(),
    title: z.string().max(200).optional(),
    options: z.record(z.unknown()).optional(),
    after_anchor: z.string().min(1).max(64).optional(),
    dataset_id: z.string().uuid().optional(),
    aggregation: z.record(z.unknown()).optional(),
  })
  .strict();

type ChartToolResult = { content: string; structuredContent: Record<string, unknown>; error?: string; message?: string };
const fail = (error: string, message: string): ChartToolResult => ({ content: message, structuredContent: { error, message }, error });

export async function addChart(ctx: McpAuthContext, rawArgs: Record<string, unknown>): Promise<ChartToolResult> {
  const args = argsSchema.parse(rawArgs);

  // Referenced mode (Phase 2): aggregate a stored dataset server-side, embed only the small result.
  let data = args.data;
  let source: Record<string, unknown> | undefined;
  if (args.dataset_id) {
    if (!args.aggregation) return fail('missing_aggregation', 'Referenced mode needs `aggregation` alongside `dataset_id`.');
    const desc = await describeDataset(ctx.tenant_id, args.dataset_id, 0);
    if (!desc) return fail('dataset_not_found', `Dataset ${args.dataset_id} not found.`);
    try {
      const agg = await aggregateDataset(ctx.tenant_id, args.dataset_id, args.aggregation as unknown as AggregationSpec, desc.columns);
      data = { labels: agg.labels, datasets: agg.datasets };
      source = { dataset_id: args.dataset_id, aggregation: args.aggregation };
    } catch (err) {
      return fail('aggregation_failed', err instanceof Error ? err.message : String(err));
    }
  }
  if (!data) return fail('missing_data', 'Provide either `data` (embedded) or `dataset_id` + `aggregation` (referenced).');

  const built = buildChartBlock({
    chart_type: args.chart_type,
    data: data as never,
    x: args.x,
    y: args.y,
    series: args.series,
    title: args.title,
    options: args.options,
    source,
  });
  if (!built.ok) return { content: built.message, structuredContent: { error: built.error }, error: built.error };
  return proposeDocWrite(ctx, { operation: 'append', doc_id: args.doc_id, markdown: built.markdown });
}
