import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { PLANS, tierFromPriceId } from "@/lib/plans";

// ─── Test / complimentary accounts ──────────────────────────────────────────

/**
 * Emails exempt from trial expiry and subscription gating — internal test
 * and demo accounts. Comma-separated in the TEST_ACCOUNT_EMAILS env var.
 */
export function isComplimentaryUser(email?: string | null): boolean {
  if (!email) return false;
  return (process.env.TEST_ACCOUNT_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// ─── Stripe subscription status → our enum ──────────────────────────────────
const SUB_STATUS_MAP: Record<string, "ACTIVE" | "PAST_DUE" | "CANCELED" | "UNPAID" | "INCOMPLETE"> = {
  active: "ACTIVE",
  trialing: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  unpaid: "UNPAID",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
};

/** Resolve the user id behind a Stripe customer id. */
export async function userIdForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
  return user?.id ?? null;
}

/**
 * Return the user's Stripe customer id, creating (and persisting) one the first
 * time. Reuses the stored `stripeCustomerId` on subsequent calls.
 */
export async function getOrCreateCustomer(user: {
  id: string;
  email: string;
  name?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * Reconcile a Stripe Subscription into our `Subscription` table. Shared by the
 * webhook and the post-checkout return route so both paths stay consistent.
 */
export async function reconcileSubscription(
  sub: Stripe.Subscription,
  knownUserId?: string,
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = knownUserId ?? (await userIdForCustomer(customerId));
  if (!userId) return;

  const item = sub.items.data[0];
  const priceId = item?.price.id ?? null;
  const tier = tierFromPriceId(priceId) ?? "STARTER";
  const plan = PLANS[tier];
  const status = SUB_STATUS_MAP[sub.status] ?? "INCOMPLETE";
  const periodStart = item?.current_period_start ? new Date(item.current_period_start * 1000) : null;
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      tier,
      status,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      callsIncluded: plan.callCap,
      callsUsed: 0,
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
    update: {
      tier,
      status,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      callsIncluded: plan.callCap,
      periodStart: periodStart ?? undefined,
      periodEnd: periodEnd ?? undefined,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    },
  });
}
