/**
 * Cursor pagination for `list_docs`.
 *
 * Encodes (updated_at, id) into a base64url string so the client treats it
 * as opaque. Decoding tolerates garbage (returns null) so a malicious or
 * stale cursor turns into a fresh first-page query rather than a 500.
 *
 * The (updated_at, id) tuple is what makes pagination stable: ordering
 * `updated_at DESC, id DESC` and paging by `< (last.updated_at, last.id)`
 * gives a total order even when two docs share a timestamp millisecond.
 */

interface CursorPayload {
  updated_at: string;
  id: string;
}

export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'updated_at' in parsed &&
      'id' in parsed &&
      typeof (parsed as CursorPayload).updated_at === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) {
      return { updated_at: (parsed as CursorPayload).updated_at, id: (parsed as CursorPayload).id };
    }
    return null;
  } catch {
    return null;
  }
}
