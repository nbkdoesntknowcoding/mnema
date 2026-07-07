/**
 * Seed model pricing table with current Anthropic Claude pricing.
 * Run: npx tsx src/scripts/seed-model-pricing.ts
 *
 * NOTE: migration 0066 seeds the current-generation models automatically on
 * every fresh install — this script is the manual refresh path for price
 * changes and for keeping legacy model rows around for historical sessions.
 *
 * Prices in USD per 1 million tokens (as of 2026-06).
 * Columns: input / output / cache_read / cache_write
 * Cache read = 0.1x input; cache write (5-min TTL) = 1.25x input.
 */

import { db } from '../db/index.js';
import { modelPricing } from '../db/schema.js';

const MODELS: Array<{
  modelId: string;
  provider: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheReadPricePerMillion: number;
  cacheWritePricePerMillion: number;
}> = [
  // ── Current generation ──────────────────────────────────────────────────
  {
    modelId: 'claude-fable-5',
    provider: 'anthropic',
    inputPricePerMillion: 10.0,
    outputPricePerMillion: 50.0,
    cacheReadPricePerMillion: 1.0,
    cacheWritePricePerMillion: 12.5,
  },
  {
    modelId: 'claude-opus-4-8',
    provider: 'anthropic',
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    cacheReadPricePerMillion: 0.5,
    cacheWritePricePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-7',
    provider: 'anthropic',
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    cacheReadPricePerMillion: 0.5,
    cacheWritePricePerMillion: 6.25,
  },
  {
    modelId: 'claude-opus-4-6',
    provider: 'anthropic',
    inputPricePerMillion: 5.0,
    outputPricePerMillion: 25.0,
    cacheReadPricePerMillion: 0.5,
    cacheWritePricePerMillion: 6.25,
  },
  {
    modelId: 'claude-sonnet-5',
    provider: 'anthropic',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
  },
  {
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
  },
  {
    modelId: 'claude-haiku-4-5',
    provider: 'anthropic',
    inputPricePerMillion: 1.0,
    outputPricePerMillion: 5.0,
    cacheReadPricePerMillion: 0.1,
    cacheWritePricePerMillion: 1.25,
  },
  // ── Legacy models (kept for historical sessions) ────────────────────────
  {
    modelId: 'claude-opus-4-5',
    provider: 'anthropic',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    cacheReadPricePerMillion: 1.5,
    cacheWritePricePerMillion: 18.75,
  },
  {
    modelId: 'claude-opus-4',
    provider: 'anthropic',
    inputPricePerMillion: 15.0,
    outputPricePerMillion: 75.0,
    cacheReadPricePerMillion: 1.5,
    cacheWritePricePerMillion: 18.75,
  },
  {
    modelId: 'claude-sonnet-4-5',
    provider: 'anthropic',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
  },
  {
    modelId: 'claude-sonnet-4',
    provider: 'anthropic',
    inputPricePerMillion: 3.0,
    outputPricePerMillion: 15.0,
    cacheReadPricePerMillion: 0.3,
    cacheWritePricePerMillion: 3.75,
  },
  {
    modelId: 'claude-haiku-3-5',
    provider: 'anthropic',
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4.0,
    cacheReadPricePerMillion: 0.08,
    cacheWritePricePerMillion: 1.0,
  },
];

async function seed() {
  console.log('Seeding model_pricing table...');

  for (const m of MODELS) {
    await db
      .insert(modelPricing)
      .values({
        modelId: m.modelId,
        provider: m.provider,
        inputPricePerMillion: m.inputPricePerMillion,
        outputPricePerMillion: m.outputPricePerMillion,
        cacheReadPricePerMillion: m.cacheReadPricePerMillion,
        cacheWritePricePerMillion: m.cacheWritePricePerMillion,
        isActive: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: modelPricing.modelId,
        set: {
          inputPricePerMillion: m.inputPricePerMillion,
          outputPricePerMillion: m.outputPricePerMillion,
          cacheReadPricePerMillion: m.cacheReadPricePerMillion,
          cacheWritePricePerMillion: m.cacheWritePricePerMillion,
          isActive: true,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${m.modelId}`);
  }

  console.log(`Done — seeded ${MODELS.length} models.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
