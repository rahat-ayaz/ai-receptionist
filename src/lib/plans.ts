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
    price: 199.0,
    callCap: 400,
    overage: 0.65,
    priceEnv: "STRIPE_PRICE_STARTER",
    highlights: [
      "1 Number included",
      "24/7 AI receptionist",
      "AI appointment booking, re-scheduling and cancellation",
      "Smart spam filtering",
      "Simultaneous calling",
      "Call forwarding to staff",
      "Call recordings",
      "Analytics",
      "Call transcription",
      "Email support",
      "AI-Powered Sentiment Analysis",
      "Automated SMS & Email Alerts",
      "Web Data Scraping (URLs, Documents & Images)",
      "Seamless CRM & POS Integration",
      "Fully White-Labeled Application",
      "English + French support"
    ],
  },
  PREMIUM: {
    tier: "PREMIUM",
    name: "Growth",
    price: 449.0,
    callCap: 1000,
    overage: 0.60,
    priceEnv: "STRIPE_PRICE_PREMIUM",
    highlights: [
      "2 Numbers included",
      "24/7 AI receptionist",
      "AI appointment booking, re-scheduling and cancellation",
      "Smart spam filtering",
      "Simultaneous calling",
      "Call forwarding to staff",
      "Call recordings",
      "Analytics",
      "Call transcription",
      "Priority support",
      "AI-Powered Sentiment Analysis",
      "Automated SMS & Email Alerts",
      "Web Data Scraping (URLs, Documents & Images)",
      "Seamless CRM & POS Integration",
      "Fully White-Labeled Application",
      "30+ language support"
    ],
  },
  PRO: {
    tier: "PRO",
    name: "Professional",
    price: 899.0,
    callCap: 2500,
    overage: 0.50,
    priceEnv: "STRIPE_PRICE_PRO",
    highlights: [
      "5 Numbers included",
      "24/7 AI receptionist",
      "AI appointment booking, re-scheduling and cancellation",
      "Smart spam filtering",
      "Simultaneous calling",
      "Call forwarding to staff",
      "Call recordings",
      "Full analytics suite",
      "Custom voice settings",
      "Phone support",
      "AI-Powered Sentiment Analysis",
      "Automated SMS & Email Alerts",
      "Web Data Scraping (URLs, Documents & Images)",
      "Seamless CRM & POS Integration",
      "Fully White-Labeled Application",
      "45+ language support"
    ],
  },
  SCALE: {
    tier: "SCALE",
    name: "Enterprise",
    price: 0,
    callCap: 5000,
    overage: 0,
    priceEnv: "STRIPE_PRICE_SCALE",
    highlights: [
      "5,000+ minutes",
      "Dedicated account manager",
      "Call recordings",
      "99.9% SLA guarantee",
      "AI-Powered Sentiment Analysis",
      "Automated SMS & Email Alerts",
      "Web Data Scraping (URLs, Documents & Images)",
      "Seamless CRM & POS Integration",
      "Fully White-Labeled Application"
    ],
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
