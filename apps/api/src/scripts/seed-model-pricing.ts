/**
 * Seed model pricing table with current Anthropic Claude pricing.
 * Run: npx tsx src/scripts/seed-model-pricing.ts
 *
 * Prices in USD per 1 million tokens (as of 2025-05).
 * Columns: input / output / cache_read / cache_write
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
