-- ── Seed model_pricing with current Anthropic models ─────────────────────────
-- Without pricing rows, lib/dev/cost.ts calculateCost() returns 0 for every
-- token report and the whole cost pipeline (sessions → /app/cost → optimize
-- cost rules) reads as $0. The seed script (src/scripts/seed-model-pricing.ts)
-- had to be run by hand; self-host installs never did. Seeding via migration
-- makes a fresh `docker compose up` cost-capable out of the box.
--
-- Prices in USD per 1M tokens (platform.claude.com pricing, 2026-06).
-- Cache read = 0.1x input; cache write (5-min TTL) = 1.25x input.
-- ON CONFLICT keeps this idempotent AND refreshes stale prices on re-run,
-- while manual edits to other columns (is_active) survive.

INSERT INTO model_pricing
  (model_id, provider, input_price_per_million, output_price_per_million,
   cache_read_price_per_million, cache_write_price_per_million, is_active, updated_at)
VALUES
  ('claude-fable-5',    'anthropic', 10.0, 50.0, 1.0,  12.5,  TRUE, NOW()),
  ('claude-opus-4-8',   'anthropic',  5.0, 25.0, 0.5,  6.25,  TRUE, NOW()),
  ('claude-opus-4-7',   'anthropic',  5.0, 25.0, 0.5,  6.25,  TRUE, NOW()),
  ('claude-opus-4-6',   'anthropic',  5.0, 25.0, 0.5,  6.25,  TRUE, NOW()),
  ('claude-sonnet-5',   'anthropic',  3.0, 15.0, 0.3,  3.75,  TRUE, NOW()),
  ('claude-sonnet-4-6', 'anthropic',  3.0, 15.0, 0.3,  3.75,  TRUE, NOW()),
  ('claude-haiku-4-5',  'anthropic',  1.0,  5.0, 0.1,  1.25,  TRUE, NOW())
ON CONFLICT (model_id) DO UPDATE SET
  input_price_per_million       = EXCLUDED.input_price_per_million,
  output_price_per_million      = EXCLUDED.output_price_per_million,
  cache_read_price_per_million  = EXCLUDED.cache_read_price_per_million,
  cache_write_price_per_million = EXCLUDED.cache_write_price_per_million,
  updated_at                    = NOW();
