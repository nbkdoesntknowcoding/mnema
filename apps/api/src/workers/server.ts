/**
 * Workers process entrypoint.
 *
 * The third Node process in the dev stack (alongside `api` on :8080 and
 * `collab` on :1234). Runs all background workers — currently just the
 * embeddings worker; Phase 3.4 will add an autocomplete worker here too.
 *
 * `concurrently` from apps/api/package.json launches this with `tsx watch`.
 * In production it lives in the same Fly app under a third [processes]
 * entry — single deployment unit, three runtime processes.
 */
import { startEmbeddingsWorker } from './embeddings/worker.js';
import { startEmailWorker } from './email/worker.js';
import { startHookEventsWorker } from './hook-events/worker.js';
import { startRetryWorker } from './retry/worker.js';
import { startCronWorkers } from './cron.js';
import { startPdfGenerationWorker } from './pdf-generation/worker.js';
import { loadEeWorkers } from '../lib/load-ee.js';

const embeddings = startEmbeddingsWorker();
// eslint-disable-next-line no-console
console.log('[workers] embeddings worker started');

const emailWorker = startEmailWorker();
// eslint-disable-next-line no-console
console.log('[workers] email worker started');

const hookEventsWorker = startHookEventsWorker();
// eslint-disable-next-line no-console
console.log('[workers] hook-events worker started');

const retryWorker = startRetryWorker();
// eslint-disable-next-line no-console
console.log('[workers] retry worker started');

const cronWorkers = startCronWorkers();
// eslint-disable-next-line no-console
console.log('[workers] cron workers started');

// PDF worker requires Playwright/Chromium — gracefully skip if not installed
let pdfWorker: Awaited<ReturnType<typeof startPdfGenerationWorker>> | null = null;
try {
  pdfWorker = await startPdfGenerationWorker();
  // eslint-disable-next-line no-console
  console.log('[workers] pdf-generation worker started');
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[workers] pdf-generation worker disabled (Playwright not installed):', err instanceof Error ? err.message : err);
}

// Phase 3 — start the ee workers (knowledge-graph, meeting-end) if present; the
// core worker process boots without them in the public build.
const eeWorkers = await loadEeWorkers();

const shutdown = async (signal: string): Promise<void> => {
  // eslint-disable-next-line no-console
  console.log(`[workers] ${signal} received, draining and shutting down`);
  await embeddings.close();
  await emailWorker.close();
  await hookEventsWorker.close();
  await retryWorker.close();
  await cronWorkers.close();
  if (pdfWorker) await pdfWorker.close();
  if (eeWorkers) await eeWorkers.close();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
