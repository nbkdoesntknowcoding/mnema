import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { config } from '../../config/env.js';

export const razorpay = new Razorpay({
  key_id: config.RAZORPAY_KEY_ID,
  key_secret: config.RAZORPAY_KEY_SECRET,
});

export function validateWebhookSignature(body: Buffer, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', config.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

// STRIPE: ENABLE WHEN APPROVED
// import Stripe from 'stripe';
// export const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
//   apiVersion: '2026-04-22.dahlia',
//   typescript: true,
//   appInfo: { name: 'Mnema', version: '0.1.0', url: 'https://context.example.com' },
// });
