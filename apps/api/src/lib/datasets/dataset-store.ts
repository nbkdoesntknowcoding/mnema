/**
 * Charting Phase 2, Sprint 4 — dataset store. Ingests a CSV into Postgres (datasets + dataset_rows,
 * jsonb), inferring a column schema. The raw rows live ONLY in the store — never in Claude's context
 * or a doc. describe_dataset returns schema + a small sample so Claude can plan a chart without
 * loading the full data. Sprint 5 will aggregate server-side over these rows.
 *
 * Pure helpers (parseCsv / inferColumnTypes / coerceRow) are exported + unit-tested; the DB functions
 * use withTenant so dataset rows are tenant-isolated by RLS like everything else.
 */
import { sql } from 'drizzle-orm';
import { withTenant } from '../../db/with-tenant.js';

export type ColType = 'number' | 'string' | 'boolean' | 'date';
export interface DatasetColumn {
  name: string;
  type: ColType;
}

export const MAX_CSV_BYTES = 15 * 1024 * 1024; // 15MB — the practical MCP-arg ceiling
export const MAX_ROWS = 1_000_000;

// ── pure CSV parsing — quotes, escaped "" , commas-in-quotes, CRLF ──────────────────────────────
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }
  const headers = (records.shift() ?? []).map((h) => h.trim());
  const rows = records.filter((r) => r.some((v) => v.trim() !== ''));
  return { headers, rows };
}

const NUM_RE = /^-?\d+(\.\d+)?$/;
const isBool = (v: string): boolean => /^(true|false)$/i.test(v.trim());
const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(v.trim());

export function inferColumnTypes(headers: string[], rows: string[][]): DatasetColumn[] {
  return headers.map((name, c) => {
    const vals = rows.map((r) => (r[c] ?? '').trim()).filter((v) => v !== '');
    if (vals.length === 0) return { name, type: 'string' };
    if (vals.every((v) => NUM_RE.test(v))) return { name, type: 'number' };
    if (vals.every(isBool)) return { name, type: 'boolean' };
    if (vals.every(isDate)) return { name, type: 'date' };
    return { name, type: 'string' };
  });
}

export function coerceRow(headers: string[], cols: DatasetColumn[], row: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  headers.forEach((h, i) => {
    const raw = (row[i] ?? '').trim();
    const type = cols[i]?.type ?? 'string';
    if (raw === '') { obj[h] = null; return; }
    if (type === 'number') obj[h] = Number(raw);
    else if (type === 'boolean') obj[h] = /^true$/i.test(raw);
    else obj[h] = raw; // date kept as ISO string; string as-is
  });
  return obj;
}

// ── DB ──────────────────────────────────────────────────────────────────────────────────────────
export interface IngestResult { dataset_id: string; name: string; columns: DatasetColumn[]; row_count: number; }

export async function ingestDataset(workspaceId: string, name: string, csvText: string): Promise<IngestResult> {
  const { headers, rows } = parseCsv(csvText);
  if (headers.length === 0) throw new Error('CSV has no header row.');
  if (rows.length === 0) throw new Error('CSV has no data rows.');
  if (rows.length > MAX_ROWS) throw new Error(`Dataset too large (${rows.length} rows; max ${MAX_ROWS}).`);
  const columns = inferColumnTypes(headers, rows);
  const objs = rows.map((r) => coerceRow(headers, columns, r));

  return withTenant(workspaceId, async (tx) => {
    const inserted = (await tx.execute(sql`
      INSERT INTO datasets (workspace_id, name, columns, row_count)
      VALUES (${workspaceId}, ${name}, ${JSON.stringify(columns)}::jsonb, ${objs.length})
      RETURNING id
    `)) as unknown as { id: string }[];
    const datasetId = inserted[0]!.id;
    const BATCH = 5000;
    for (let i = 0; i < objs.length; i += BATCH) {
      const chunk = objs.slice(i, i + BATCH);
      await tx.execute(sql`
        INSERT INTO dataset_rows (dataset_id, workspace_id, row_index, data)
        SELECT ${datasetId}, ${workspaceId}, ${i} + (ord - 1)::int, elem
        FROM jsonb_array_elements(${JSON.stringify(chunk)}::jsonb) WITH ORDINALITY AS t(elem, ord)
      `);
    }
    return { dataset_id: datasetId, name, columns, row_count: objs.length };
  });
}

export interface DatasetDescription {
  dataset_id: string;
  name: string;
  columns: DatasetColumn[];
  row_count: number;
  sample_rows: Record<string, unknown>[];
}

export async function describeDataset(
  workspaceId: string,
  datasetId: string,
  sampleSize = 5,
): Promise<DatasetDescription | null> {
  return withTenant(workspaceId, async (tx) => {
    const meta = (await tx.execute(sql`
      SELECT id, name, columns, row_count FROM datasets WHERE id = ${datasetId} LIMIT 1
    `)) as unknown as { id: string; name: string; columns: DatasetColumn[]; row_count: number }[];
    if (!meta[0]) return null;
    const ds = meta[0];
    const sample = (await tx.execute(sql`
      SELECT data FROM dataset_rows WHERE dataset_id = ${datasetId} ORDER BY row_index LIMIT ${sampleSize}
    `)) as unknown as { data: Record<string, unknown> }[];
    return { dataset_id: ds.id, name: ds.name, columns: ds.columns, row_count: ds.row_count, sample_rows: sample.map((r) => r.data) };
  });
}
