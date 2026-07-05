/**
 * Pure helper for add_diagram (kept db-free so it's unit-testable without the env/db chain).
 * Wraps a diagram source in a fenced markdown block, stored verbatim → byte-faithful round-trip.
 * Defends against a stray backtick-fence inside the source by choosing a fence longer than any
 * backtick run it contains (CommonMark allows fences of 3+ backticks).
 */
export function fenceDiagram(format: 'mermaid' | 'svg', source: string): string {
  const longestRun = (source.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${format}\n${source.replace(/\n+$/, '')}\n${fence}`;
}
