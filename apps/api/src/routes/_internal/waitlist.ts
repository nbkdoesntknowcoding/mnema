/**
 * POST /api/_internal/waitlist
 *
 * Pre-launch waitlist capture. Called server-side by the web app's
 * /api/waitlist proxy (never the browser directly), guarded by the same
 * internal_secret (API_INTERNAL_SECRET) used by set-session.
 *
 * Purely additive: this does NOT touch the live WorkOS sign-up/sign-in flow.
 * It records interest and, on a NEW signup, enqueues a confirmation email.
 * Duplicate emails are a no-op (already=true) and do not re-send.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { db } from '../../db/index.js';
import { waitlist } from '../../db/schema.js';
import { emailQueue } from '../../queue/email.js';

const bodySchema = z.object({
  internal_secret: z.string(),
  email: z.string().email(),
  name: z.string().trim().max(200).optional().nullable(),
  company: z.string().trim().max(200).optional().nullable(),
  source: z.string().trim().max(40).optional(),
});

export const waitlistRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/_internal/waitlist', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request' });
    }
    if (parsed.data.internal_secret !== config.API_INTERNAL_SECRET) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const name = parsed.data.name?.trim() || null;
    const company = parsed.data.company?.trim() || null;

    // Insert a new pending row. onConflictDoNothing → an empty `returning`
    // means the email was already on the list (a repeat submission).
    const inserted = await db
      .insert(waitlist)
      .values({
        email,
        name,
        company,
        source: parsed.data.source ?? 'landing',
      })
      .onConflictDoNothing({ target: waitlist.email })
      .returning({ id: waitlist.id });

    const isNew = inserted.length > 0;

    if (isNew) {
      // Enqueue the confirmation email — never block the response on email I/O.
      await emailQueue.add('waitlist', {
        type: 'waitlist',
        to: email,
        params: { name },
      });
    } else if (name || company) {
      // Repeat submission: refresh details if the person added more, but never
      // overwrite existing values with blanks and never re-send the email.
      await db
        .update(waitlist)
        .set({
          ...(name ? { name } : {}),
          ...(company ? { company } : {}),
        })
        .where(eq(waitlist.email, email));
    }

    return { ok: true, already: !isNew };
  });
};
