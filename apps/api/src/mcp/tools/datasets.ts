/**
 * MCP tools for the dataset store (Charting Phase 2, Sprint 4):
 *   ingest_dataset(name, csv)   — register a CSV as a queryable dataset; returns a dataset_id +
 *                                 inferred schema + row count. The raw rows are stored server-side,
 *                                 NEVER returned to Claude.
 *   describe_dataset(dataset_id) — schema + row count + a small sample, so Claude can plan a chart
 *                                 (type, axes, aggregation) WITHOUT loading the full dataset.
 *
 * The no-ceiling path: when add_chart returns `too_large`, ingest the data here and (Sprint 5)
 * reference the dataset_id + an aggregation spec from a chart.
 */
import { z } from 'zod';
import type { McpAuthContext } from '../auth.js';
import { ingestDataset, describeDataset, MAX_CSV_BYTES } from '../../lib/datasets/dataset-store.js';

type ToolResult = { content: string; structuredContent: Record<string, unknown>; error?: string };

export const INGEST_DATASET_TOOL_NAME = 'ingest_dataset';
export const INGEST_DATASET_TOOL_SPEC = {
  name: INGEST_DATASET_TOOL_NAME,
  description: [
    'Ingest a CSV as a queryable dataset stored in Mnema — for data too large for an embedded chart',
    '(the seam add_chart points to with a "too_large" error). The raw rows are stored server-side and',
    'are NOT returned to you; you get back a dataset_id + the inferred column schema + row count.',
    '',
    'After ingesting, use describe_dataset to inspect schema + a sample, then (Phase 2.5) reference the',
    'dataset_id from a chart with an aggregation spec. REQUIRES: workspace:write scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      name: { type: 'string', description: 'A human name for the dataset.' },
      csv: { type: 'string', description: 'The CSV text (header row + data rows). Up to ~15MB.' },
    },
    required: ['name', 'csv'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Ingest a dataset (CSV)' },
};

const ingestArgs = z.object({ name: z.string().min(1).max(200), csv: z.string().min(1) }).strict();

export async function ingestDatasetTool(ctx: McpAuthContext, raw: Record<string, unknown>): Promise<ToolResult> {
  const args = ingestArgs.parse(raw);
  if (Buffer.byteLength(args.csv, 'utf8') > MAX_CSV_BYTES) {
    return { content: 'CSV too large for inline ingest (max ~15MB).', structuredContent: { error: 'too_large' }, error: 'too_large' };
  }
  try {
    const res = await ingestDataset(ctx.tenant_id, args.name, args.csv);
    const schema = res.columns.map((c) => `${c.name}:${c.type}`).join(', ');
    return {
      content: `Ingested dataset "${res.name}" — ${res.row_count} rows. dataset_id: ${res.dataset_id}. Columns: ${schema}. Raw data is stored server-side; use describe_dataset to inspect it.`,
      structuredContent: { dataset_id: res.dataset_id, name: res.name, row_count: res.row_count, columns: res.columns },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Dataset ingest failed: ${message}`, structuredContent: { error: 'ingest_failed', message }, error: 'ingest_failed' };
  }
}

export const DESCRIBE_DATASET_TOOL_NAME = 'describe_dataset';
export const DESCRIBE_DATASET_TOOL_SPEC = {
  name: DESCRIBE_DATASET_TOOL_NAME,
  description: [
    'Describe a stored dataset: its column schema (name + inferred type), row count, and a small',
    'sample of rows — so you can choose a chart type, axes, and aggregation WITHOUT loading the whole',
    'dataset into context. REQUIRES: docs:read (or workspace) scope.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: { dataset_id: { type: 'string', description: 'The dataset id from ingest_dataset.' } },
    required: ['dataset_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Describe a dataset' },
};

const describeArgs = z.object({ dataset_id: z.string().uuid() }).strict();

export async function describeDatasetTool(ctx: McpAuthContext, raw: Record<string, unknown>): Promise<ToolResult> {
  const args = describeArgs.parse(raw);
  const d = await describeDataset(ctx.tenant_id, args.dataset_id);
  if (!d) return { content: `Dataset ${args.dataset_id} not found.`, structuredContent: { error: 'not_found' }, error: 'not_found' };
  const schema = d.columns.map((c) => `${c.name}:${c.type}`).join(', ');
  return {
    content: `Dataset "${d.name}" — ${d.row_count} rows. Columns: ${schema}. Sample (${d.sample_rows.length} rows): ${JSON.stringify(d.sample_rows)}`,
    structuredContent: { dataset_id: d.dataset_id, name: d.name, row_count: d.row_count, columns: d.columns, sample_rows: d.sample_rows },
  };
}
