import { describe, expect, it } from 'vitest';
import { normalizeForCompare, twoRoundTrips } from './helpers.js';

type Op =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list-item'; ordered: boolean; text: string }
  | { kind: 'code'; lang: string; body: string }
  | { kind: 'quote'; text: string }
  | { kind: 'inline-math'; src: string }
  | { kind: 'display-math'; src: string }
  | { kind: 'mermaid'; src: string }
  | { kind: 'hr' };

class Rng {
  constructor(private seed: number) {}
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff;
  }
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }
  bool(): boolean {
    return this.next() > 0.5;
  }
}

const WORDS = [
  'design', 'engine', 'context', 'doc', 'block', 'edit', 'sync', 'state',
  'markdown', 'editor', 'client', 'server', 'render', 'parser', 'token',
  'matrix', 'vector', 'graph', 'flow', 'process', 'workspace', 'tenant',
];
const LANGS = ['typescript', 'python', 'rust', ''];
const INLINE_MATHS = ['x^2', 'a+b', '\\alpha', 'E = mc^2'];
const DISPLAY_MATHS = ['\\int_0^1 x\\,dx', '\\sum_{i=1}^n i', 'a^2 + b^2 = c^2'];

function makeText(rng: Rng, words: number): string {
  return Array.from({ length: words }, () => rng.pick(WORDS)).join(' ');
}

function generateOps(rng: Rng, n: number): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i < n; i += 1) {
    const r = rng.next();
    if (r < 0.2) ops.push({ kind: 'paragraph', text: makeText(rng, 3 + rng.int(20)) });
    else if (r < 0.35)
      ops.push({
        kind: 'heading',
        level: (1 + rng.int(3)) as 1 | 2 | 3,
        text: makeText(rng, 2 + rng.int(6)),
      });
    else if (r < 0.55)
      ops.push({ kind: 'list-item', ordered: rng.bool(), text: makeText(rng, 2 + rng.int(8)) });
    else if (r < 0.7)
      ops.push({ kind: 'code', lang: rng.pick(LANGS), body: makeText(rng, 5 + rng.int(15)) });
    else if (r < 0.8) ops.push({ kind: 'quote', text: makeText(rng, 4 + rng.int(12)) });
    else if (r < 0.86) ops.push({ kind: 'inline-math', src: rng.pick(INLINE_MATHS) });
    else if (r < 0.92) ops.push({ kind: 'display-math', src: rng.pick(DISPLAY_MATHS) });
    else if (r < 0.97) ops.push({ kind: 'mermaid', src: 'graph TD; A-->B; B-->C' });
    else ops.push({ kind: 'hr' });
  }
  return ops;
}

function opsToMarkdown(ops: Op[]): string {
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind === 'heading') out.push(`${'#'.repeat(op.level)} ${op.text}`);
    else if (op.kind === 'paragraph') out.push(op.text);
    else if (op.kind === 'list-item') out.push(op.ordered ? `1. ${op.text}` : `- ${op.text}`);
    else if (op.kind === 'code') out.push('```' + op.lang + '\n' + op.body + '\n```');
    else if (op.kind === 'quote') out.push(`> ${op.text}`);
    else if (op.kind === 'inline-math') out.push(`Inline: $${op.src}$`);
    else if (op.kind === 'display-math') out.push(`$$\n${op.src}\n$$`);
    else if (op.kind === 'mermaid') out.push('```mermaid\n' + op.src + '\n```');
    else out.push('---');
  }
  return out.join('\n\n');
}

describe('round-trip — fuzz', () => {
  const SEEDS = 30;
  const OPS_PER_SEED = 25;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    it(`seed ${seed} converges`, async () => {
      const rng = new Rng(seed * 12345);
      const ops = generateOps(rng, OPS_PER_SEED);
      const markdown = opsToMarkdown(ops);

      const { first, second } = await twoRoundTrips(markdown);
      const a = normalizeForCompare(first);
      const b = normalizeForCompare(second);

      if (a !== b) {
        console.error(`seed ${seed} ops:`, ops);
        console.error('First  RT (head 400):', a.slice(0, 400));
        console.error('Second RT (head 400):', b.slice(0, 400));
      }

      expect(b).toBe(a);
    });
  }
});
