import { describe, expect, it } from 'vitest';
import { loadFixtures, normalizeForCompare, twoRoundTrips } from './helpers.js';

const fixtures = loadFixtures();

describe('round-trip — corpus', () => {
  it.each(fixtures)('$name converges to a stable canonical form', async ({ markdown }) => {
    const { first, second } = await twoRoundTrips(markdown);

    const a = normalizeForCompare(first);
    const b = normalizeForCompare(second);

    if (a !== b) {
      console.error('First  RT (head 500):', a.slice(0, 500));
      console.error('Second RT (head 500):', b.slice(0, 500));
    }

    expect(b).toBe(a);
  });

  it('all fixtures load and (when non-empty) produce a non-empty normalised form', async () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(50);
    for (const fixture of fixtures) {
      if (fixture.markdown.trim() === '') continue; // 19-empty-document.md is allowed
      const { first } = await twoRoundTrips(fixture.markdown);
      expect(normalizeForCompare(first)).toBeTruthy();
    }
  });
});
