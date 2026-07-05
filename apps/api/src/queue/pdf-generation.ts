import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/env.js';

export const PDF_GENERATION_QUEUE = 'pdf-generation';

export interface PdfGenerationJobData {
  attachmentId: string;
  docId:        string;
  workspaceId:  string;
  title:        string;
  /** Export format. Defaults to 'pdf' for back-compat with already-queued jobs. */
  format?:      'pdf' | 'docx';
}

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const pdfGenerationQueue = new Queue<PdfGenerationJobData>(PDF_GENERATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts:  2,
    backoff:   { type: 'fixed', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail:     100,
  },
});
