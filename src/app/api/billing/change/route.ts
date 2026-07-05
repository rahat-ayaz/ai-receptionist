import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { reconcileSubscription } from "@/lib/billing";
import { PLANS, type PlanTier } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/billing/change
 * Upgrade/downgrade the signed-in user's EXISTING subscription in place
 * (Stripe handles proration). If they have no active subscription yet, returns
 * { needsCheckout: true } so the client falls back to a Checkout session.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { tier } = (await req.json()) as { tier?: PlanTier };
  if (!tier || !PLANS[tier]) {
    return NextResponse.json({ error: "Unknown plan tier" }, { status: 400 });
  }

  const priceId = process.env[PLANS[tier].priceEnv];
  if (!priceId) {
    return NextResponse.json({ error: `Price not configured for ${tier}.` }, { status: 500 });
  }

  const sub = await prisma.subscription.findUnique({ where: { userId: session.user.id } });
  if (!sub?.stripeSubscriptionId || sub.status === "CANCELED") {
    return NextResponse.json({ needsCheckout: true });
  }

  const stripe = getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) return NextResponse.json({ needsCheckout: true });

  const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "create_prorations",
  });

  await reconcileSubscription(updated, session.user.id);
  return NextResponse.json({ ok: true, tier });
}
