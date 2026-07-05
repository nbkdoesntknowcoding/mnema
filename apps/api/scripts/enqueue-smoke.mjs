// One-shot script: enqueue a real embedding job through the live BullMQ
// queue declared in src/queue/embeddings.ts, then exit. The running
// `workers` process picks it up and embeds it via real Voyage.

import { enqueueEmbeddingJob, embeddingsQueue } from '../src/queue/embeddings.js';

const docId = process.argv[2];
const tenantId = process.argv[3];
const contentHash = process.argv[4];
if (!docId || !tenantId || !contentHash) {
  console.error('usage: enqueue-smoke.mjs <doc_id> <tenant_id> <content_hash>');
  process.exit(1);
}

await enqueueEmbeddingJob({
  doc_id: docId,
  tenant_id: tenantId,
  content_hash: contentHash,
});

console.log(`enqueued ${docId}--${contentHash}`);
await embeddingsQueue.close();
process.exit(0);
