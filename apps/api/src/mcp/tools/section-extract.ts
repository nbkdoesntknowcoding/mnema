/**
 * Heading-tree parser + section slicer for markdown.
 *
 * Used by `get_doc_section`. The tool returns the slice from a matched
 * heading up to (but not including) the next heading of equal or higher
 * rank — same convention everyone reading markdown expects.
 *
 * Code-fence awareness: a literal `# Heading` inside a ``` fence is NOT a
 * heading. We track fence state line-by-line. This is the most common false
 * positive in naïve heading parsers.
 *
 * We do not parse setext headings (`====` underlines) — Milkdown emits ATX
 * (`#`) form on round-trip, so authored content the editor produced is
 * always ATX. Imported content with setext headings would need a richer
 * walker; deferring to Phase 3 if it shows up.
 */

export interface HeadingNode {
  level: number;
  text: string;
  /** 1-indexed line number where the heading sits in the source markdown. */
  line: number;
  /** Char offset where the heading starts (inclusive). */
  start: number;
  /** Char offset where this section ends (exclusive). */
  end: number;
  /** Parent headings, e.g. ["Overview", "Setup"] for "Overview > Setup > X". */
  breadcrumb: string[];
}

type HeadingHit = Omit<HeadingNode, 'end' | 'breadcrumb'>;

export function parseHeadings(markdown: string): HeadingNode[] {
  const lines = markdown.split('\n');
  const hits: HeadingHit[] = [];

  let charOffset = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^```/.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        hits.push({
          level: m[1]!.length,
          text: m[2]!.trim(),
          line: i + 1,
          start: charOffset,
        });
      }
    }
    charOffset += line.length + 1; // +1 for the \n
  }

  // Resolve `end` by scanning forward for the next heading at <= level.
  // Resolve `breadcrumb` by scanning backwards for ancestor headings.
  const resolved: HeadingNode[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const h = hits[i]!;
    let end = markdown.length;
    for (let j = i + 1; j < hits.length; j += 1) {
      if (hits[j]!.level <= h.level) {
        end = hits[j]!.start;
        break;
      }
    }
    resolved.push({ ...h, end, breadcrumb: buildBreadcrumb(hits, i) });
  }
  return resolved;
}

function buildBreadcrumb(hits: HeadingHit[], idx: number): string[] {
  const out: string[] = [];
  let currentLevel = hits[idx]!.level;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (hits[i]!.level < currentLevel) {
      out.unshift(hits[i]!.text);
      currentLevel = hits[i]!.level;
    }
  }
  return out;
}

export interface SectionMatch {
  heading_path: string; // e.g., "Overview > Setup > Database"
  heading_text: string;
  line: number;
  markdown: string;
  preview: string; // first ~200 chars of the body, heading stripped
}

/**
 * Find sections whose heading text matches `query`.
 *
 * Match strategy:
 *   1. Exact case-insensitive equality on the heading TEXT (last segment).
 *      If at least one match, return only those.
 *   2. Otherwise fall back to substring containment on heading text.
 *
 * The two-pass shape means "Setup" finds the section named exactly "Setup"
 * even when "Setup Notes" also exists in the doc — exact wins.
 */
export function findSection(markdown: string, query: string): SectionMatch[] {
  const headings = parseHeadings(markdown);
  const needle = query.trim().toLowerCase();
  const exact = headings.filter((h) => h.text.toLowerCase() === needle);
  const candidates =
    exact.length > 0 ? exact : headings.filter((h) => h.text.toLowerCase().includes(needle));

  return candidates.map((h) => {
    const slice = markdown.slice(h.start, h.end);
    return {
      heading_path: [...h.breadcrumb, h.text].join(' > '),
      heading_text: h.text,
      line: h.line,
      markdown: slice,
      // Strip the leading heading line for the preview so the preview is
      // body text, not a duplicate of heading_text.
      preview: slice.replace(/^#+\s+.+\n?/, '').slice(0, 200).trim(),
    };
  });
}
