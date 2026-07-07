import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Lazily construct the Stripe client. Deferring construction keeps module
 * import side-effect free so a missing key only fails at request time
 * (e.g. during `next build` page-data collection) rather than at import.
 */
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set — billing is unavailable.");
  }
  client = new Stripe(key, { appInfo: { name: "CAPRO", version: "1.0.0" } });
  return client;
}
