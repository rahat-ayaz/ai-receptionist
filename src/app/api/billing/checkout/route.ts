import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getOrCreateCustomer } from "@/lib/billing";
import { PLANS, type PlanTier } from "@/lib/plans";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout
 * Body: { tier }
 *
 * Opens a Stripe Checkout Session for the signed-in user and the selected tier.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { tier } = (await req.json()) as { tier?: PlanTier };
  if (!tier || !PLANS[tier]) {
    return NextResponse.json({ error: "Unknown plan tier" }, { status: 400 });
  }

  const priceId = process.env[PLANS[tier].priceEnv];
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price not configured for ${tier}. Run: node scripts/stripe-setup.mjs` },
      { status: 500 },
    );
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const stripe = getStripe();
    const customerId = await getOrCreateCustomer(user);

    const base = process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL || "http://localhost:3210";
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId: user.id, tier },
      subscription_data: { 
        metadata: { userId: user.id, tier },
        trial_period_days: 7 
      },
      success_url: `${base}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?billing=cancelled`,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err: any) {
    console.error("[billing:checkout] failed to create session:", err);
    return NextResponse.json({ error: err.message || "Failed to initiate Stripe checkout." }, { status: 500 });
  }
}
