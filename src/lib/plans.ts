// ─── CAPRO subscription matrix ──────────────────────────────────────────────
// Single source of truth for the four-tier Stripe billing model. The overage
// increment is the metered per-call charge once `callCap` is exhausted.

export type PlanTier = "STARTER" | "PREMIUM" | "PRO" | "SCALE";

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  /** Monthly base price in USD. */
  price: number;
  /** Included phone-call volume per billing period. */
  callCap: number;
  /** Metered overage charge per call beyond the cap, in USD. */
  overage: number;
  /** Env var holding the Stripe Price ID for the recurring base fee. */
  priceEnv: string;
  highlights: string[];
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  STARTER: {
    tier: "STARTER",
    name: "Starter",
    price: 24.95,
    callCap: 30,
    overage: 1.5,
    priceEnv: "STRIPE_PRICE_STARTER",
    highlights: ["30 calls / mo", "$1.50 per extra call", "24/7 availability", "Instant SMS summaries"],
  },
  PREMIUM: {
    tier: "PREMIUM",
    name: "Premium",
    price: 59.95,
    callCap: 90,
    overage: 1.0,
    priceEnv: "STRIPE_PRICE_PREMIUM",
    highlights: ["90 calls / mo", "$1.00 per extra call", "24/7 availability", "Transcript logs"],
  },
  PRO: {
    tier: "PRO",
    name: "Pro",
    price: 159.95,
    callCap: 300,
    overage: 0.75,
    priceEnv: "STRIPE_PRICE_PRO",
    highlights: ["300 calls / mo", "$0.75 per extra call", "24/7 availability", "Custom telemetry capture"],
  },
  SCALE: {
    tier: "SCALE",
    name: "Scale",
    price: 299.95,
    callCap: 600,
    overage: 0.7,
    priceEnv: "STRIPE_PRICE_SCALE",
    highlights: ["600 calls / mo", "$0.70 per extra call", "24/7 availability", "Priority routing"],
  },
};

export const PLAN_ORDER: PlanTier[] = ["STARTER", "PREMIUM", "PRO", "SCALE"];

/** Resolve a tier from a Stripe Price ID by checking the configured env vars. */
export function tierFromPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const tier of PLAN_ORDER) {
    if (process.env[PLANS[tier].priceEnv] === priceId) return tier;
  }
  return null;
}

export function planForTier(tier: PlanTier): PlanDefinition {
  return PLANS[tier];
}
