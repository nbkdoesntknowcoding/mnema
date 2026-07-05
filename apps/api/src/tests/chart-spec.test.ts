/**
 * Charting Engine Phase 1, Sprint 2 — add_chart spec builder. Tests the pure validation, size-guard
 * (the Phase-1/Phase-2 seam), and fenced-block round-trip. The actual render is Sprint 1 (proven in
 * headless Chromium); the proposeDocWrite append is the same path add_diagram uses.
 */
import { describe, it, expect } from 'vitest';
import { buildChartBlock, MAX_ROWS } from '../mcp/tools/chart-spec.js';

// pull the JSON back out of the ```chart fence — mirrors what get_doc → the renderer sees
function innerSpec(markdown: string): Record<string, unknown> {
  const inner = markdown.replace(/^`+chart\n/, '').replace(/\n`+$/, '');
  return JSON.parse(inner) as Record<string, unknown>;
}

describe('buildChartBlock — add_chart', () => {
  it('bar (labels + datasets) → fenced chart block, spec round-trips intact', () => {
    const r = buildChartBlock({
      chart_type: 'bar',
      title: 'Revenue',
      data: { labels: ['Jan', 'Feb', 'Mar'], datasets: [{ label: 'Rev', data: [10, 20, 15] }] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toMatch(/^`{3,}chart\n/);
    const spec = innerSpec(r.markdown) as { type: string; data: { datasets: { data: number[] }[] } };
    expect(spec.type).toBe('bar');
    expect(spec.data.datasets[0]!.data).toEqual([10, 20, 15]); // values preserved exactly
  });

  it('line (rows + x + y) → ok; rows preserved for the renderer to pivot', () => {
    const r = buildChartBlock({
      chart_type: 'line',
      data: { rows: [{ m: 'Q1', sales: 40 }, { m: 'Q2', sales: 55 }] },
      x: 'm',
      y: 'sales',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const spec = innerSpec(r.markdown) as { type: string; x: string; y: string; data: { rows: unknown[] } };
    expect(spec.x).toBe('m');
    expect(spec.y).toBe('sales');
    expect(spec.data.rows).toHaveLength(2);
  });

  it('scatter needs numeric x+y (rows) — ok when numeric', () => {
    const r = buildChartBlock({ chart_type: 'scatter', data: { rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }] }, x: 'a', y: 'b' });
    expect(r.ok).toBe(true);
  });

  it('scatter with non-numeric columns → shape_mismatch (helpful error, not garbage)', () => {
    const r = buildChartBlock({ chart_type: 'scatter', data: { rows: [{ a: 'x', b: 'y' }] }, x: 'a', y: 'b' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('shape_mismatch');
  });

  it('pie with >1 dataset → shape_mismatch', () => {
    const r = buildChartBlock({
      chart_type: 'pie',
      data: { labels: ['a', 'b'], datasets: [{ data: [1, 2] }, { data: [3, 4] }] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('shape_mismatch');
  });

  it('bar with datasets but no labels → shape_mismatch', () => {
    const r = buildChartBlock({ chart_type: 'bar', data: { datasets: [{ data: [1, 2, 3] }] } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('shape_mismatch');
  });

  it('no rows and no datasets → invalid_data', () => {
    const r = buildChartBlock({ chart_type: 'bar', data: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalid_data');
  });

  it('unknown chart_type → invalid_chart_type; "donut" normalizes to doughnut', () => {
    expect(buildChartBlock({ chart_type: 'sankey', data: { labels: ['a'], datasets: [{ data: [1] }] } }).ok).toBe(false);
    const donut = buildChartBlock({ chart_type: 'donut', data: { labels: ['a', 'b'], datasets: [{ data: [1, 2] }] } });
    expect(donut.ok).toBe(true);
    if (donut.ok) expect((innerSpec(donut.markdown) as { type: string }).type).toBe('doughnut');
  });

  it('SIZE-GUARD SEAM: > MAX_ROWS rows → too_large, naming the Phase-2 stored-dataset path', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => ({ m: String(i), v: i }));
    const r = buildChartBlock({ chart_type: 'bar', data: { rows }, x: 'm', y: 'v' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('too_large');
    expect(r.message).toMatch(/stored dataset/i);
    expect(r.message).toMatch(/Phase 2/);
  });
});
