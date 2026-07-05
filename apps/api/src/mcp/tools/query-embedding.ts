import { createHash } from 'node:crypto';
import IORedis from 'ioredis';
import { config } from '../../config/env.js';
import { embedBatch } from '../../workers/embeddings/voyage.js';

/**
 * Query-side embedding helper for `search_docs` semantic + hybrid modes.
 *
 * Why a separate module from the worker's `embedBatch`:
 *   - Voyage distinguishes `inputType: 'document'` (the worker; rich
 *     paragraphs) from `inputType: 'query'` (this module; short questions).
 *     Using the wrong side noticeably degrades retrieval quality.
 *   - Query embeddings benefit from a hot cache: the same search ("pricing",
 *     "auth", etc.) repeats often across an agent's session, and each cold
 *     call to Voyage costs ~10ms + a few thousand tokens.
 *
 * Cache shape:
 *   - Key: `mcp:qe:{tenant_id}:{sha256(query)}` — tenant-scoped to prevent
 *     any cross-tenant leakage; SHA-256-hashed to keep keys collision-free.
 *   - Value: JSON-encoded float array (~12KB at 1024 dims).
 *   - TTL: 600s. Long enough to absorb burst traffic; short enough that
 *     a model swap recovers within minutes without manual flush.
 *
 * Cache failures (Redis blip, JSON corruption) are non-fatal — we just
 * miss the cache and re-embed. Never let cache code take down the tool.
 */

const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const TTL_SECONDS = 600;

function cacheKey(tenantId: string, query: string): string {
  const hash = createHash('sha256').update(query).digest('hex');
  return `mcp:qe:${tenantId}:${hash}`;
}

export async function embedQuery(tenantId: string, query: string): Promise<number[]> {
  const key = cacheKey(tenantId, query);

  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as unknown;
      if (Array.isArray(parsed) && parsed.length === config.EMBEDDING_DIM) {
        return parsed as number[];
      }
      // Corrupt entry — fall through to re-embed and overwrite.
    }
  } catch {
    // Redis read failure — fall through to fresh embed.
  }

  const { vectors } = await embedBatch({
    texts: [query],
    inputType: 'query',
  });
  const vector = vectors[0]!;

  // Fire-and-forget cache write; failure is non-fatal.
  redis
    .setex(key, TTL_SECONDS, JSON.stringify(vector))
    .catch(() => undefined);

  return vector;
}
