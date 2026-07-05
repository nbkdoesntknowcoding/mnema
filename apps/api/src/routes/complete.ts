import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { handleComplete } from './complete/handler.js';

/**
 * Phase 3.4 — autocomplete routes.
 *
 *   - `POST /api/complete`        Production SSE stream from Gemini
 *                                 Flash-Lite. Rate-limited per-user
 *                                 (60/min, 1000/day) and per-tenant
 *                                 (50,000 cost-units/day).
 *   - `POST /api/complete/_stub`  Phase 3.3 deterministic stub. Stays in
 *                                 the codebase as a development tool —
 *                                 useful for E2E plugin tests that don't
 *                                 want a real LLM in the loop.
 */

const stubBodySchema = z.object({
  prefix: z.string().max(10000),
  suffix: z.string().max(2000),
  doc_id: z.string().uuid(),
});

export const completeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/complete', handleComplete);

  // Stub — unchanged from Phase 3.3.
  app.post('/api/complete/_stub', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const parsed = stubBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'bad_request', issues: parsed.error.issues });
    }

    await new Promise<void>((resolve) =>
      setTimeout(resolve, 200 + Math.floor(Math.random() * 200)),
    );

    const trimmed = parsed.data.prefix.trimEnd();
    const lastChar = trimmed.length > 0 ? trimmed[trimmed.length - 1]! : '';
    const isWordChar = /[A-Za-z0-9]/.test(lastChar);
    return { text: isWordChar ? ' continuation' : '' };
  });
};
