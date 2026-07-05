/**
 * Unified diff generator for file change tracking.
 *
 * Uses the `diff` npm package (createPatch) to generate standard unified diff
 * format. Enforces a 100KB max size per diff — truncates and flags if exceeded.
 *
 * Reference: devmanager/db/events.go (diff storage logic)
 */

import { createPatch } from 'diff';

export interface DiffResult {
  diff:         string;
  linesAdded:   number;
  linesRemoved: number;
  truncated:    boolean;
}

const MAX_DIFF_BYTES = 100 * 1024; // 100KB

/**
 * Generates a unified diff between old and new content.
 *
 * @param filePath    Path shown in the diff header (e.g. 'src/app.ts')
 * @param oldContent  Previous file content. Pass undefined for new files.
 * @param newContent  New file content.
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string | undefined,
  newContent: string,
): DiffResult {
  const old = oldContent ?? '';

  // createPatch args: (filename, oldStr, newStr, oldHeader, newHeader, options)
  const patch = createPatch(filePath, old, newContent, '', '', { context: 3 });

  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) linesAdded++;
    if (line.startsWith('-') && !line.startsWith('---')) linesRemoved++;
  }

  const byteLength = Buffer.byteLength(patch, 'utf8');
  if (byteLength > MAX_DIFF_BYTES) {
    // Truncate to MAX_DIFF_BYTES characters (approximate — slicing characters
    // may produce a slightly different byte count, but close enough for storage)
    const truncated = patch.slice(0, MAX_DIFF_BYTES);
    return { diff: truncated, linesAdded, linesRemoved, truncated: true };
  }

  return { diff: patch, linesAdded, linesRemoved, truncated: false };
}
