/**
 * Shared IORedis connection for BullMQ queues.
 *
 * BullMQ requires `maxRetriesPerRequest: null` — without it, the library
 * logs deprecation warnings and misbehaves on transient Redis hiccups.
 *
 * Both the queue side (api process enqueuing jobs) and the worker side
 * (workers process dequeuing) import this. Using a shared module ensures
 * they always use the same connection options.
 *
 * Note: Workers create their OWN IORedis instance (see each worker file) —
 * a dedicated connection per worker is recommended by BullMQ to avoid
 * head-of-line blocking between pub/sub and command traffic.
 */

import IORedis from 'ioredis';
import { config } from '../config/env.js';

export const redisConnection = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});
