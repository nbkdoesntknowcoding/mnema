import { encode } from 'gpt-tokenizer';
import { config } from '../../config/env.js';

/**
 * Heading-aware markdown chunker.
 *
 * Strategy:
 *   1. Walk lines, building "blocks" (paragraphs, code fences, headings).
 *      Code fences are tracked so a `# Heading` literal inside ```python
 *      isn't mistaken for a heading.
 *   2. Greedily pack blocks into chunks up to `EMBEDDING_CHUNK_TARGET_TOKENS`.
 *      Never split a block — a 1000-token code fence becomes its own
 *      chunk that exceeds the target. Splitting mid-syntax is worse than
 *      a fat chunk.
 *   3. When emitting a chunk, optionally seed the next chunk with the LAST
 *      block of the previous chunk as overlap — but ONLY when the heading
 *      stack is unchanged. Section boundaries terminate overlap; pulling
 *      context from a different section pollutes retrieval.
 *
 * Headings are emitted as their own blocks so the chunk's `text` field
 * contains the section title — Claude sees "## Setup\n\nDo this..." not
 * just the orphaned body.
 *
 * Token counts use cl100k (gpt-tokenizer) — Voyage's tokenizer isn't
 * published as an npm package, but cl100k is within ~10% which is fine
 * for sizing decisions (the 500-token target has slack).
 */

export interface Chunk {
  /** 0-based ordinal within the doc. Insert into embeddings.chunk_index. */
  index: number;
  text: string;
  tokenCount: number;
  /** "Architecture > Setup > Database", or "" for pre-heading content. */
  headingPath: string;
}

interface Block {
  text: string;
  tokenCount: number;
  /** Heading stack snapshot at the time this block closed. */
  headingStack: string[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^```/;

export function chunkMarkdown(markdown: string): Chunk[] {
  if (markdown.trim().length === 0) return [];
  const blocks = parseToBlocks(markdown);
  return packBlocksIntoChunks(blocks);
}

function parseToBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let currentLines: string[] = [];
  let inFence = false;
  const headingStack: string[] = [];

  function flush(): void {
    const text = currentLines.join('\n').trim();
    currentLines = [];
    if (!text) return;
    blocks.push({
      text,
      tokenCount: encode(text).length,
      headingStack: [...headingStack],
    });
  }

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      currentLines.push(line);
      if (inFence) {
        // Closing fence — emit the whole fenced block as one unit.
        flush();
        inFence = false;
      } else {
        // Opening fence — flush whatever paragraph was accumulating before
        // we entered the fence so the fence stands alone.
        const accumulated = currentLines.slice(0, -1).join('\n').trim();
        if (accumulated) {
          currentLines = currentLines.slice(0, -1);
          flush();
          currentLines = [line];
        }
        inFence = true;
      }
      continue;
    }

    if (!inFence) {
      const m = HEADING_RE.exec(line);
      if (m) {
        flush();
        const level = m[1]!.length;
        const text = m[2]!.trim();
        // Pop the stack so siblings/uncles aren't kept; push the new heading.
        while (headingStack.length >= level) headingStack.pop();
        headingStack.push(text);
        // Heading itself is its own block — keeps the title in the chunk.
        currentLines.push(line);
        flush();
        continue;
      }
      // Blank line outside a fence = paragraph boundary.
      if (line.trim() === '') {
        flush();
        continue;
      }
    }

    currentLines.push(line);
  }

  flush();
  return blocks;
}

function packBlocksIntoChunks(blocks: Block[]): Chunk[] {
  const target = config.EMBEDDING_CHUNK_TARGET_TOKENS;
  const overlap = config.EMBEDDING_CHUNK_OVERLAP_TOKENS;
  const chunks: Chunk[] = [];
  let current: Block[] = [];
  let currentTokens = 0;

  function emit(): void {
    if (current.length === 0) return;
    const text = current.map((b) => b.text).join('\n\n');
    const tokenCount = current.reduce((sum, b) => sum + b.tokenCount, 0);
    // Heading path = stack at the LAST block. Because we ALSO flush on
    // heading-stack change below, every block in `current` shares this
    // same stack — so "last block's path" is unambiguous.
    const headingPath = current[current.length - 1]!.headingStack.join(' > ');
    chunks.push({
      index: chunks.length,
      text,
      tokenCount,
      headingPath,
    });
    current = [];
    currentTokens = 0;
  }

  for (const block of blocks) {
    // Section boundary — never pack across a heading-stack change. A chunk
    // labeled "A > B > C" must contain ONLY content actually under that
    // path; mixing pollutes retrieval and makes heading_path misleading.
    if (current.length > 0) {
      const lastStack = current[current.length - 1]!.headingStack;
      if (!sameHeading(lastStack, block.headingStack)) {
        emit();
      }
    }

    // Oversized block — emit any accumulated chunk first, then this block alone.
    if (block.tokenCount >= target) {
      emit();
      chunks.push({
        index: chunks.length,
        text: block.text,
        tokenCount: block.tokenCount,
        headingPath: block.headingStack.join(' > '),
      });
      continue;
    }

    // Token-budget overflow within the same section — close the current
    // chunk and consider seeding the next chunk with the previous block
    // as overlap (only when small enough; same-section is now guaranteed
    // by the section-boundary check above).
    if (currentTokens + block.tokenCount > target && current.length > 0) {
      const lastBlock = current[current.length - 1]!;
      emit();
      if (lastBlock.tokenCount <= overlap) {
        current.push(lastBlock);
        currentTokens += lastBlock.tokenCount;
      }
    }

    current.push(block);
    currentTokens += block.tokenCount;
  }

  emit();
  return chunks;
}

function sameHeading(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
