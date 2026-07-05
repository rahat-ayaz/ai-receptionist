// ════════════════════════════════════════════════════════════════════════════
//  CAPRO — Stripe product/price provisioning
//  Creates (idempotently) the 4 subscription products + monthly recurring prices
//  in your Stripe account, then writes the price IDs back into .env.
//
//    1) Put STRIPE_SECRET_KEY="sk_test_..." in .env
//    2) node scripts/stripe-setup.mjs
// ════════════════════════════════════════════════════════════════════════════
import "dotenv/config";
import Stripe from "stripe";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(ROOT, ".env");

// Mirror of src/lib/plans.ts (kept inline so this plain-Node script needs no TS).
const PLANS = [
  { tier: "STARTER", name: "CAPRO Starter", price: 24.95, callCap: 30, env: "STRIPE_PRICE_STARTER" },
  { tier: "PREMIUM", name: "CAPRO Premium", price: 59.95, callCap: 90, env: "STRIPE_PRICE_PREMIUM" },
  { tier: "PRO", name: "CAPRO Pro", price: 159.95, callCap: 300, env: "STRIPE_PRICE_PRO" },
  { tier: "SCALE", name: "CAPRO Scale", price: 299.95, callCap: 600, env: "STRIPE_PRICE_SCALE" },
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("✗ STRIPE_SECRET_KEY is not set in .env. Add your sk_test_… key first.");
  process.exit(1);
}
if (!key.startsWith("sk_test_")) {
  console.warn("⚠ STRIPE_SECRET_KEY does not look like a TEST key (sk_test_…). Continuing anyway.");
}

const stripe = new Stripe(key);

async function findProduct(tier) {
  // Prefer search (test mode supports it); fall back to listing.
  try {
    const res = await stripe.products.search({ query: `metadata['capro_tier']:'${tier}'` });
    if (res.data[0]) return res.data[0];
  } catch {
    const all = await stripe.products.list({ active: true, limit: 100 });
    const hit = all.data.find((p) => p.metadata?.capro_tier === tier);
    if (hit) return hit;
  }
  return null;
}

async function ensureProduct(plan) {
  const existing = await findProduct(plan.tier);
  if (existing) return existing;
  return stripe.products.create({
    name: plan.name,
    metadata: { capro_tier: plan.tier },
    description: `${plan.callCap} calls / month`,
  });
}

async function ensurePrice(product, plan) {
  const amount = Math.round(plan.price * 100);
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find(
    (p) => p.currency === "usd" && p.unit_amount === amount && p.recurring?.interval === "month",
  );
  if (match) return match;
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
    metadata: { capro_tier: plan.tier },
  });
}

function writeEnv(updates) {
  let env = readFileSync(ENV_PATH, "utf8");
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}="${v}"`;
    const re = new RegExp(`^${k}=.*$`, "m");
    env = re.test(env) ? env.replace(re, line) : env + `\n${line}`;
  }
  writeFileSync(ENV_PATH, env);
}

const updates = {};
for (const plan of PLANS) {
  const product = await ensureProduct(plan);
  const price = await ensurePrice(product, plan);
  updates[plan.env] = price.id;
  console.log(`✓ ${plan.tier.padEnd(8)} product ${product.id}  price ${price.id}  ($${plan.price}/mo)`);
}

writeEnv(updates);
console.log(`\n✓ Wrote ${Object.keys(updates).length} price IDs to .env. Restart the dev server.`);
