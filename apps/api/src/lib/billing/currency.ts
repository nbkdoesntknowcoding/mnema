/**
 * Currency detection for billing.
 *
 * Razorpay India only supports INR by default.
 * USD requires "International Payments" to be enabled in the Razorpay dashboard.
 *
 * Strategy:
 *   1. Use Cloudflare's CF-IPCountry header (available when traffic flows through CF)
 *   2. Fall back to INR if header is absent or country is IN
 *
 * India → INR
 * Anywhere else → USD (if USD plans are configured)
 *
 * If USD plans are not configured (env vars empty), always fall back to INR.
 */

import type { Currency } from '../razorpay/plans.js';

/** Country codes that bill in INR. */
const INR_COUNTRIES = new Set(['IN']);

/**
 * Detect the billing currency from a Fastify/Node request's headers.
 *
 * @param headers - Request headers object (req.headers from Fastify)
 * @returns 'INR' or 'USD'
 */
export function detectCurrency(headers: Record<string, string | string[] | undefined>): Currency {
  // Check if USD plans are configured at all
  const usdConfigured = !!(
    process.env.RAZORPAY_PLAN_INDIVIDUAL_USD_MONTHLY ||
    process.env.RAZORPAY_PLAN_TEAM_USD_MONTHLY ||
    process.env.RAZORPAY_PLAN_BUSINESS_USD_MONTHLY
  );

  if (!usdConfigured) return 'INR';

  // Cloudflare sets CF-IPCountry on all proxied requests
  const cfCountry = headers['cf-ipcountry'];
  const country = Array.isArray(cfCountry) ? cfCountry[0] : cfCountry;

  if (!country || INR_COUNTRIES.has(country.toUpperCase())) return 'INR';
  return 'USD';
}
