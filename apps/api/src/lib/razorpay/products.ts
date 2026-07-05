export type PlanKey = 'free' | 'pro' | 'team';

export interface PlanDefinition {
  key: PlanKey;
  displayName: string;
  razorpayManaged: boolean;
  description: string;
  amountUsdCents?: number;
  features: {
    maxSeats: number | null;
    maxDocs: number | null;
    maxMcpCallsPerMonth: number | null;
    autocomplete: boolean;
    versionHistory: boolean;
    prioritySupport: boolean;
    sso: boolean;
  };
}

// STRIPE: ENABLE WHEN APPROVED
// export interface PlanDefinition {
//   key: PlanKey;
//   displayName: string;
//   stripeManaged: boolean;
//   ...
// }

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    displayName: 'Free',
    razorpayManaged: false,
    description: 'For trying it out.',
    features: {
      maxSeats: 3,
      maxDocs: 100,
      maxMcpCallsPerMonth: 500,
      autocomplete: false,
      versionHistory: true,
      prioritySupport: false,
      sso: false,
    },
  },
  pro: {
    key: 'pro',
    displayName: 'Pro',
    razorpayManaged: true,
    description: 'For small teams.',
    amountUsdCents: 1500,
    features: {
      maxSeats: 5,
      maxDocs: null,
      maxMcpCallsPerMonth: 5000,
      autocomplete: true,
      versionHistory: true,
      prioritySupport: false,
      sso: false,
    },
  },
  team: {
    key: 'team',
    displayName: 'Team',
    razorpayManaged: true,
    description: 'For growing companies.',
    amountUsdCents: 2500,
    features: {
      maxSeats: null,
      maxDocs: null,
      maxMcpCallsPerMonth: null,
      autocomplete: true,
      versionHistory: true,
      prioritySupport: true,
      sso: false,
    },
  },
};

export function getPlan(key: PlanKey): PlanDefinition {
  return PLANS[key];
}
