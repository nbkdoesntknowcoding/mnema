/**
 * Diagram Phase 1, Sprint 1 — add_diagram fencing: the source must round-trip byte-faithful inside
 * a fenced ```mermaid / ```svg block (no escaping, no mangling), with backtick-fence collisions
 * defended.
 */
import { describe, it, expect } from 'vitest';
import { fenceDiagram } from '../mcp/tools/diagram-fence.js';

const unfence = (block: string): string => block.split('\n').slice(1, -1).join('\n');

describe('fenceDiagram — byte-faithful diagram blocks', () => {
  it('wraps mermaid source in a ```mermaid fence; source recoverable verbatim', () => {
    const src = 'graph TD;\n  A-->B;\n  B-->C;';
    const out = fenceDiagram('mermaid', src);
    expect(out).toBe('```mermaid\ngraph TD;\n  A-->B;\n  B-->C;\n```');
    expect(unfence(out)).toBe(src);            // unmangled
  });

  it('wraps svg source in a ```svg fence; source recoverable verbatim', () => {
    const src = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const out = fenceDiagram('svg', src);
    expect(out).toBe('```svg\n' + src + '\n```');
    expect(unfence(out)).toBe(src);
  });

  it('uses a LONGER fence when the source contains a ``` run (no premature close)', () => {
    const src = 'note: a ``` appears mid-source';
    const out = fenceDiagram('mermaid', src);
    expect(out.startsWith('````mermaid\n')).toBe(true);   // 4 backticks > the 3 inside
    expect(out.endsWith('\n````')).toBe(true);
    expect(out).toContain('a ``` appears');               // inner backticks preserved
  });

  it('trims only trailing newlines, leaves internal content intact', () => {
    expect(fenceDiagram('svg', '<svg/>\n\n\n')).toBe('```svg\n<svg/>\n```');
    expect(fenceDiagram('mermaid', 'A\n\nB')).toBe('```mermaid\nA\n\nB\n```');  // internal blank kept
  });
});
