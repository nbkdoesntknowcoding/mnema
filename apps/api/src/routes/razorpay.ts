import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/index.js';
import { webhookEvents } from '../db/schema.js';
import { validateWebhookSignature } from '../lib/razorpay/client.js';
import {
  computeEventId,
  handleSubscriptionActivated,
  handleSubscriptionCancelled,
  handleSubscriptionCharged,
  handleSubscriptionHalted,
  handleSubscriptionPaused,
  type RazorpayWebhookEvent,
} from '../lib/razorpay/webhook-handlers.js';

// STRIPE: ENABLE WHEN APPROVED
// import { stripe } from '../lib/stripe/client.js';
// import { config } from '../config/env.js';
// import {
//   handleInvoicePaymentFailed,
//   handleInvoicePaymentSucceeded,
//   handleSubscriptionDeleted,
//   handleSubscriptionEvent,
// } from '../lib/stripe/webhook-handlers.js';

export const razorpayRoutes: FastifyPluginAsync = async (app) => {
  // Raw-buffer parser scoped to this plugin — signature verification requires
  // exact bytes before any JSON parse.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  app.post('/api/razorpay/webhook', {
    config: { skipAuth: true },
  }, async (req, reply) => {
    const signature = req.headers['x-razorpay-signature'];
    if (!signature || Array.isArray(signature)) {
      return reply.code(400).send({ error: 'missing_signature' });
    }

    const body = req.body as Buffer;
    if (!validateWebhookSignature(body, signature)) {
      console.error('[razorpay-webhook] signature verification failed');
      return reply.code(400).send({ error: 'invalid_signature' });
    }

    let event: RazorpayWebhookEvent;
    try {
      event = JSON.parse(body.toString()) as RazorpayWebhookEvent;
    } catch {
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    if (!event.payload?.subscription?.entity) {
      console.log(`[razorpay-webhook] non-subscription event ${event.event}, ignoring`);
      return reply.code(200).send({ received: true });
    }

    const eventId = computeEventId(event);

    // Idempotency — refuse to re-process the same event
    const existing = await db.select({ id: webhookEvents.id })
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, eventId))
      .limit(1);
    if (existing.length > 0) {
      console.log(`[razorpay-webhook] event ${eventId} already processed, skipping`);
      return reply.code(200).send({ received: true, duplicate: true });
    }

    const [inserted] = await db.insert(webhookEvents).values({
      eventId,
      eventType: event.event,
      payload: event as unknown as Record<string, unknown>,
    }).returning();

    try {
      switch (event.event) {
        case 'subscription.activated':
          await handleSubscriptionActivated(event);
          break;
        case 'subscription.charged':
          await handleSubscriptionCharged(event);
          break;
        case 'subscription.halted':
          await handleSubscriptionHalted(event);
          break;
        case 'subscription.cancelled':
          await handleSubscriptionCancelled(event);
          break;
        case 'subscription.paused':
          await handleSubscriptionPaused(event);
          break;
        default:
          console.log(`[razorpay-webhook] unhandled event type: ${event.event}`);
      }

      await db.update(webhookEvents)
        .set({ processedAt: new Date() })
        .where(eq(webhookEvents.id, inserted!.id));

      return reply.code(200).send({ received: true });
    } catch (err) {
      console.error(`[razorpay-webhook] handler error for ${event.event}`, err);
      await db.update(webhookEvents)
        .set({ error: err instanceof Error ? err.message : String(err) })
        .where(eq(webhookEvents.id, inserted!.id));
      // Return 200 so Razorpay doesn't retry — investigate from webhook_events table
      return reply.code(200).send({ received: true, processing_error: true });
    }
  });

  // STRIPE: ENABLE WHEN APPROVED
  // app.post('/api/stripe/webhook', { config: { skipAuth: true } }, async (req, reply) => { ... });
};
