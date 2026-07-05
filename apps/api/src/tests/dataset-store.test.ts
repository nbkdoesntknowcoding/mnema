/**
 * Charting Phase 2, Sprint 4 — dataset store pure helpers (CSV parse + type inference + coercion).
 * The DB ingest/describe need Postgres (verified live after migration 0061); these cover the parsing.
 */
import { describe, it, expect } from 'vitest';
import { parseCsv, inferColumnTypes, coerceRow } from '../lib/datasets/dataset-store.js';

describe('parseCsv', () => {
  it('parses headers + rows, handling quoted fields, commas-in-quotes, escaped quotes, CRLF', () => {
    const csv = 'name,city,note\r\n"Doe, John",NYC,"He said ""hi"""\r\nJane,LA,plain\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['name', 'city', 'note']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['Doe, John', 'NYC', 'He said "hi"']);
    expect(rows[1]).toEqual(['Jane', 'LA', 'plain']);
  });

  it('drops fully-empty trailing rows', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n');
    expect(rows).toHaveLength(1);
  });
});

describe('inferColumnTypes', () => {
  it('infers number / boolean / date / string per column', () => {
    const headers = ['n', 'flag', 'day', 'label'];
    const rows = [
      ['12', 'true', '2026-01-01', 'foo'],
      ['3.5', 'false', '2026-02-15', 'bar'],
      ['-7', 'TRUE', '2026-03-30', 'baz'],
    ];
    expect(inferColumnTypes(headers, rows)).toEqual([
      { name: 'n', type: 'number' },
      { name: 'flag', type: 'boolean' },
      { name: 'day', type: 'date' },
      { name: 'label', type: 'string' },
    ]);
  });

  it('a column with mixed/non-numeric values falls back to string', () => {
    const cols = inferColumnTypes(['x'], [['1'], ['2'], ['n/a']]);
    expect(cols[0]).toEqual({ name: 'x', type: 'string' });
  });
});

describe('coerceRow', () => {
  it('coerces values to their column type; empty → null', () => {
    const headers = ['n', 'flag', 'label'];
    const cols = inferColumnTypes(headers, [['1', 'true', 'a']]);
    const obj = coerceRow(headers, cols, ['42', 'false', '']);
    expect(obj).toEqual({ n: 42, flag: false, label: null });
    expect(typeof obj.n).toBe('number');
    expect(typeof obj.flag).toBe('boolean');
  });
});
