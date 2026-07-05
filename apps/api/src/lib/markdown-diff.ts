import { createTwoFilesPatch } from 'diff';

/**
 * Unified-diff representation used by the doc-versions diff endpoint.
 *
 * Phase 4.2 ships line-level diffs only; the version-diff UI renders each
 * chunk with the appropriate add/remove/context styling. Phase 5 may swap
 * the parser for a structural (block-level) diff once we have telemetry on
 * how people actually use the diff view.
 */
export interface DiffChunk {
  type: 'add' | 'remove' | 'context';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export function markdownDiff(oldMarkdown: string, newMarkdown: string): DiffChunk[] {
  const patch = createTwoFilesPatch(
    'old.md',
    'new.md',
    oldMarkdown,
    newMarkdown,
    '',
    '',
    { context: 3 },
  );
  return parseUnifiedPatch(patch);
}

/**
 * Walk a unified diff (the kind `diff -u` or git emits) and emit per-line
 * chunks. We keep our own line counters because the @@-hunk header gives us
 * the *starting* line numbers only; subsequent lines inside the hunk just
 * use leading +, -, or space.
 */
function parseUnifiedPatch(patch: string): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  const lines = patch.split('\n');
  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldLineNum = parseInt(m[1]!, 10);
        newLineNum = parseInt(m[2]!, 10);
      }
      continue;
    }
    // Skip the file-header lines that `diff` emits even with empty
    // filenames; they don't represent diff content.
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('Index:')) {
      continue;
    }
    // `\ No newline at end of file` markers — informational, not content.
    if (line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      chunks.push({ type: 'add', text: line.slice(1), newLineNum });
      newLineNum++;
    } else if (line.startsWith('-')) {
      chunks.push({ type: 'remove', text: line.slice(1), oldLineNum });
      oldLineNum++;
    } else if (line.startsWith(' ')) {
      chunks.push({ type: 'context', text: line.slice(1), oldLineNum, newLineNum });
      oldLineNum++;
      newLineNum++;
    }
  }
  return chunks;
}
