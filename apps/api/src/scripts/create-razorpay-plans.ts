/**
 * One-time Razorpay plan creation script.
 *
 * Run with: npx tsx src/scripts/create-razorpay-plans.ts
 * Prerequisites: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set in .env
 * Output: prints env var block — copy into .env and set in Vercel/Railway.
 *
 * Idempotent: running twice will NOT create duplicate plans. If a plan
 * with the same name already exists, the script prints the existing ID
 * and skips creation.
 *
 * Plan structure: 3 slugs × 2 currencies × 2 cycles = 12 plans.
 * Amounts in smallest currency unit (USD: cents, INR: paise).
 */

import { config as dotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv({ path: resolve(__dirname, '../../../../.env') });

import Razorpay from 'razorpay';

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.error('Error: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in .env');
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

interface PlanDef {
  slug: string;
  amount: number;
  currency: string;
  period: 'monthly' | 'yearly';
  interval: number;
  name: string;
}

const plans: PlanDef[] = [
  // USD monthly
  { slug: 'individual_usd_monthly', amount: 1000,   currency: 'USD', period: 'monthly', interval: 1, name: 'Individual — Monthly (USD)' },
  { slug: 'team_usd_monthly',       amount: 1500,   currency: 'USD', period: 'monthly', interval: 1, name: 'Team — Monthly (USD)' },
  { slug: 'business_usd_monthly',   amount: 2400,   currency: 'USD', period: 'monthly', interval: 1, name: 'Business — Monthly (USD)' },
  // USD annual (20% discount: individual $10×12×0.8=$96, team $15×12×0.8=$144, business $24×12×0.8=$230.40→$240)
  { slug: 'individual_usd_annual',  amount: 9600,   currency: 'USD', period: 'yearly',  interval: 1, name: 'Individual — Annual (USD)' },
  { slug: 'team_usd_annual',        amount: 14400,  currency: 'USD', period: 'yearly',  interval: 1, name: 'Team — Annual (USD)' },
  { slug: 'business_usd_annual',    amount: 24000,  currency: 'USD', period: 'yearly',  interval: 1, name: 'Business — Annual (USD)' },
  // INR monthly
  { slug: 'individual_inr_monthly', amount: 89900,  currency: 'INR', period: 'monthly', interval: 1, name: 'Individual — Monthly (INR)' },
  { slug: 'team_inr_monthly',       amount: 99900,  currency: 'INR', period: 'monthly', interval: 1, name: 'Team — Monthly (INR)' },
  { slug: 'business_inr_monthly',   amount: 199900, currency: 'INR', period: 'monthly', interval: 1, name: 'Business — Monthly (INR)' },
  // INR annual (25% discount: individual ₹899×12×0.75=₹8,091→₹8,099, team ₹999×12×0.75=₹8,991, business ₹1999×12×0.75=₹17,991)
  { slug: 'individual_inr_annual',  amount: 809900, currency: 'INR', period: 'yearly',  interval: 1, name: 'Individual — Annual (INR)' },
  { slug: 'team_inr_annual',        amount: 899100, currency: 'INR', period: 'yearly',  interval: 1, name: 'Team — Annual (INR)' },
  { slug: 'business_inr_annual',    amount: 1799100,currency: 'INR', period: 'yearly',  interval: 1, name: 'Business — Annual (INR)' },
];

interface RazorpayPlan {
  id: string;
  item?: { name?: string };
  interval?: number;
  period?: string;
}

async function getExistingPlanByName(name: string): Promise<RazorpayPlan | null> {
  try {
    // Razorpay returns up to 100 plans per page. For small plan counts this is fine.
    const result = await razorpay.plans.all({ count: 100 }) as { items?: RazorpayPlan[] };
    const items = result.items ?? [];
    return items.find((p: RazorpayPlan) => p.item?.name === name) ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`\nCreating Razorpay plans (environment: ${process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test') ? 'TEST' : 'LIVE'})\n`);

  const envLines: string[] = [];

  for (const plan of plans) {
    const envKey = `RAZORPAY_PLAN_${plan.slug.toUpperCase()}`;

    // Idempotency check — skip if already exists with this name
    const existing = await getExistingPlanByName(plan.name);
    if (existing) {
      console.log(`  ✓ ${plan.name} — already exists: ${existing.id}`);
      envLines.push(`${envKey}=${existing.id}`);
      continue;
    }

    try {
      const created = await razorpay.plans.create({
        period: plan.period,
        interval: plan.interval,
        item: {
          name: plan.name,
          amount: plan.amount,
          currency: plan.currency,
        },
      }) as RazorpayPlan;

      console.log(`  ✅ ${plan.name} — created: ${created.id}`);
      envLines.push(`${envKey}=${created.id}`);
    } catch (err) {
      console.error(`  ❌ ${plan.name} — FAILED:`, err);
      envLines.push(`${envKey}=CREATION_FAILED`);
    }
  }

  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('Copy these into your .env file:\n');
  envLines.forEach(line => console.log(line));
  console.log('─────────────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
