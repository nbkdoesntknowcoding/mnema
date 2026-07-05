import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../workers/embeddings/chunker.js';

/**
 * Unit tests for the heading-aware markdown chunker. No DB, no I/O —
 * pure CPU. Runs in milliseconds.
 *
 * Coverage targets:
 *   - empty + whitespace input
 *   - heading-path threading down the tree
 *   - heading stack pops correctly when going up
 *   - code fences stay intact (no mid-fence splits)
 *   - oversized blocks (giant code/paragraph) emit as their own chunk
 *   - chunk indices monotonically increase from 0
 */

describe('chunker', () => {
  it('empty input produces no chunks', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('   \n  \n')).toEqual([]);
  });

  it('single paragraph produces one chunk with empty heading path', () => {
    const chunks = chunkMarkdown('A simple paragraph with some words.');
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toContain('A simple paragraph');
    expect(chunks[0]!.headingPath).toBe('');
    expect(chunks[0]!.tokenCount).toBeGreaterThan(0);
  });

  it('headings populate the heading path on subsequent chunks', () => {
    const md = `# Architecture

Some intro text.

## Setup

Set it up like this.

## Deployment

Deploy it like this.
`;
    const chunks = chunkMarkdown(md);
    const setupChunk = chunks.find((c) => c.text.includes('Set it up'));
    const deployChunk = chunks.find((c) => c.text.includes('Deploy it'));
    expect(setupChunk?.headingPath).toBe('Architecture > Setup');
    expect(deployChunk?.headingPath).toBe('Architecture > Deployment');
  });

  it('does not split code blocks mid-fence (closing fence stays in same chunk)', () => {
    // Build a giant code block whose token count exceeds the chunk target,
    // so the chunker is forced to decide whether to split it.
    const giantBody = Array.from({ length: 200 }, (_, i) => `    x${i} = ${i}`).join('\n');
    const md = `Some intro paragraph.

\`\`\`python
def long_function():
    # Pretend this is a 1000-token block.
${giantBody}
    return x
\`\`\`

Some closing paragraph.
`;
    const chunks = chunkMarkdown(md);
    // Find the code chunk — must contain BOTH the opening and closing fence.
    const codeChunk = chunks.find((c) => c.text.includes('```python'));
    expect(codeChunk).toBeTruthy();
    expect(codeChunk!.text).toContain('```python');
    expect(codeChunk!.text).toContain('return x');
    expect(codeChunk!.text.match(/```/g)?.length).toBe(2);
  });

  it('oversized single block emits as its own chunk even if it exceeds the target', () => {
    // 1000 "word " tokens ≈ 1000 tokens >> 500-target, but it's a single
    // paragraph (no blank-line breaks) so it MUST stay whole.
    const giantParagraph = 'word '.repeat(1000).trim();
    const chunks = chunkMarkdown(giantParagraph);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.tokenCount).toBeGreaterThan(500);
  });

  it('chunk indices are sequential and start at zero', () => {
    const md = Array.from(
      { length: 10 },
      (_, i) => `## Section ${i}\n\nContent for section ${i}.`,
    ).join('\n\n');
    const chunks = chunkMarkdown(md);
    expect(chunks.length).toBeGreaterThan(0);
    for (let i = 0; i < chunks.length; i += 1) {
      expect(chunks[i]!.index).toBe(i);
    }
  });

  it('heading stack pops correctly when going up the tree', () => {
    const md = `# A

## B

### C

text under C

## D

text under D
`;
    const chunks = chunkMarkdown(md);
    const cChunk = chunks.find((c) => c.text.includes('text under C'));
    const dChunk = chunks.find((c) => c.text.includes('text under D'));
    // Going from "### C" back to "## D" must pop C and B (since D is at level 2,
    // not under B). Path for D should be A > D, not A > B > D.
    expect(cChunk?.headingPath).toBe('A > B > C');
    expect(dChunk?.headingPath).toBe('A > D');
  });
});
