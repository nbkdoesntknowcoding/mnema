/**
 * Shared DTO shapes for the doc-versions UI surface.
 * Server payloads are snake_case; we mirror them here verbatim so the
 * components don't have to translate field names.
 */

export interface VersionRow {
  version: number;
  comment: string | null;
  author_id: string | null;
  created_at: string;
}

export interface DiffChunk {
  type: 'add' | 'remove' | 'context';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}
