/**
 * Pricing tier definitions — single source of truth for the pricing page,
 * settings panel CTAs, and billing flow.
 *
 * Prices must stay in sync with:
 *   apps/api/src/lib/razorpay/plans.ts → PLAN_PRICING / ANNUAL_TOTALS
 */

export type PlanSlug = 'free' | 'individual' | 'team' | 'business' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type Currency = 'INR' | 'USD';

export interface PricingFeature {
  label: string;
  /** Optional tooltip or explanatory note */
  note?: string;
}

export interface PricingTier {
  slug: PlanSlug;
  name: string;
  tagline: string;
  /** Per-seat pricing in USD. Null for free/enterprise. */
  usd_monthly: number | null;
  usd_annual: number | null;   // per-seat per-month display (annual total / 12)
  usd_annual_total: number | null;
  /** Per-seat pricing in INR. */
  inr_monthly: number | null;
  inr_annual: number | null;   // per-seat per-month display (annual total / 12)
  inr_annual_total: number | null;
  /** True for team/business where only writers pay */
  perSeat: boolean;
  /** Highlight as most popular */
  highlighted: boolean;
  /** Show "Readers free" callout */
  readersCallout: boolean;
  features: PricingFeature[];
  cta: {
    label: string;
    href: string;
  };
}

export const TIERS: PricingTier[] = [
  {
    slug: 'free',
    name: 'Free',
    tagline: 'Personal use, forever.',
    usd_monthly: 0,
    usd_annual: 0,
    usd_annual_total: 0,
    inr_monthly: 0,
    inr_annual: 0,
    inr_annual_total: 0,
    perSeat: false,
    highlighted: false,
    readersCallout: false,
    features: [
      { label: 'Up to 3 teammates' },
      { label: '50 docs' },
      { label: '5 flows' },
      { label: 'MCP connector' },
      { label: 'Real-time collaboration' },
      { label: 'Hybrid search' },
    ],
    cta: { label: 'Get started', href: '/signup?plan=free' },
  },
  {
    slug: 'individual',
    name: 'Individual',
    tagline: 'For solo builders and freelancers.',
    usd_monthly: 10,
    usd_annual: 8,
    usd_annual_total: 96,
    inr_monthly: 899,
    inr_annual: 675,
    inr_annual_total: 8099,
    perSeat: false,
    highlighted: false,
    readersCallout: false,
    features: [
      { label: '1 workspace' },
      { label: 'Unlimited docs' },
      { label: 'Unlimited flows' },
      { label: 'AI autocomplete' },
      { label: 'Version history' },
      { label: 'Email support' },
    ],
    cta: { label: 'Start Individual', href: '/signup?plan=individual' },
  },
  {
    slug: 'team',
    name: 'Team',
    tagline: 'For growing engineering teams.',
    usd_monthly: 15,
    usd_annual: 12,
    usd_annual_total: 144,
    inr_monthly: 999,
    inr_annual: 749,
    inr_annual_total: 8991,
    perSeat: true,
    highlighted: true,
    readersCallout: true,
    features: [
      { label: 'Unlimited teammates' },
      { label: 'Unlimited docs' },
      { label: 'Unlimited flows' },
      { label: 'AI autocomplete' },
      { label: 'Priority support' },
      { label: 'SSO (coming soon)' },
    ],
    cta: { label: 'Start Team', href: '/signup?plan=team' },
  },
  {
    slug: 'business',
    name: 'Business',
    tagline: 'For scaling product orgs.',
    usd_monthly: 24,
    usd_annual: 20,
    usd_annual_total: 240,
    inr_monthly: 1999,
    inr_annual: 1499,
    inr_annual_total: 17991,
    perSeat: true,
    highlighted: false,
    readersCallout: true,
    features: [
      { label: 'Everything in Team' },
      { label: 'Multiple workspaces' },
      { label: 'Audit log' },
      { label: 'Custom retention' },
      { label: 'SLA guarantee' },
      { label: 'Dedicated support' },
    ],
    cta: { label: 'Start Business', href: '/signup?plan=business' },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    tagline: 'Custom contracts and compliance.',
    usd_monthly: null,
    usd_annual: null,
    usd_annual_total: null,
    inr_monthly: null,
    inr_annual: null,
    inr_annual_total: null,
    perSeat: false,
    highlighted: false,
    readersCallout: false,
    features: [
      { label: 'Everything in Business' },
      { label: 'On-prem / VPC option' },
      { label: 'Custom SLA' },
      { label: 'SAML SSO' },
      { label: 'Data residency choice' },
      { label: 'Volume pricing' },
    ],
    cta: { label: 'Contact sales', href: 'mailto:mnema@theboringpeople.in' },
  },
];
