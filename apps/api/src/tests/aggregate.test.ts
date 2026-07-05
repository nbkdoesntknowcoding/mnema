/**
 * Charting Phase 2, Sprint 5 — aggregation spec validation (pure). The SQL aggregation itself needs
 * Postgres (verified live); this covers the guardrails that reject a bad spec with a clear error.
 */
import { describe, it, expect } from 'vitest';
import { validateAggregationSpec, type AggregationSpec } from '../lib/datasets/aggregate.js';
import { buildChartBlock } from '../mcp/tools/chart-spec.js';
import type { DatasetColumn } from '../lib/datasets/dataset-store.js';

const cols: DatasetColumn[] = [
  { name: 'category', type: 'string' },
  { name: 'revenue', type: 'number' },
  { name: 'day', type: 'date' },
];

describe('validateAggregationSpec', () => {
  it('accepts a valid group-by sum', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'sum', column: 'revenue' } }, cols)).not.toThrow();
  });
  it('accepts count without a column', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'count' } }, cols)).not.toThrow();
  });
  it('rejects unknown x column', () => {
    expect(() => validateAggregationSpec({ x: 'nope', y: { fn: 'count' } }, cols)).toThrow(/not in the dataset/);
  });
  it('rejects sum without a column', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'sum' } }, cols)).toThrow(/required for sum/);
  });
  it('rejects sum on a non-number column', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'avg', column: 'category' } }, cols)).toThrow(/not number/);
  });
  it('rejects time-bucket on a non-date x', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'count' }, bucket: 'month' }, cols)).toThrow(/date column/);
  });
  it('rejects an unknown series column', () => {
    expect(() => validateAggregationSpec({ x: 'category', y: { fn: 'count' }, series: 'ghost' } as AggregationSpec, cols)).toThrow(/series/);
  });
});

describe('buildChartBlock — referenced source provenance', () => {
  it('embeds the aggregated data + records source { dataset_id, aggregation }', () => {
    const r = buildChartBlock({
      chart_type: 'bar',
      data: { labels: ['A', 'B'], datasets: [{ label: 'sum(revenue)', data: [10, 20] }] },
      source: { dataset_id: 'd1', aggregation: { x: 'category', y: { fn: 'sum', column: 'revenue' } } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inner = JSON.parse(r.markdown.replace(/^`+chart\n/, '').replace(/\n`+$/, '')) as { data: { datasets: { data: number[] }[] }; source: { dataset_id: string } };
    expect(inner.data.datasets[0]!.data).toEqual([10, 20]); // only the aggregated result, no raw rows
    expect(inner.source.dataset_id).toBe('d1');
  });
});
