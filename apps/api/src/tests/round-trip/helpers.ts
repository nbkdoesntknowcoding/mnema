import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToYjsState, yjsStateToMarkdown } from '@boppl/schema/node';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, 'fixtures');

export interface Fixture {
  name: string;
  markdown: string;
}

export function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((name) => ({
      name,
      markdown: readFileSync(join(FIXTURES_DIR, name), 'utf-8'),
    }));
}

/** One full markdown → Y.Doc → markdown cycle. */
export async function oneRoundTrip(markdown: string): Promise<string> {
  const yjsState = await markdownToYjsState(markdown);
  return await yjsStateToMarkdown(yjsState);
}

/**
 * Run two round-trips. The fixed-point property: second === first.
 * (Comparing back to original input fails on canonical-form normalization
 * — list markers, fence variants, trailing newlines — which is fine.
 * What matters is that further cycles don't drift further.)
 */
export async function twoRoundTrips(
  markdown: string,
): Promise<{ first: string; second: string }> {
  const first = await oneRoundTrip(markdown);
  const second = await oneRoundTrip(first);
  return { first, second };
}

/**
 * Normalize line endings + strip trailing whitespace per line.
 * Genuine semantic differences are preserved — this only paves over
 * line-ending and end-of-line whitespace drift.
 */
export function normalizeForCompare(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trimEnd();
}
