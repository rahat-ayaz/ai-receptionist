import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { reconcileSubscription } from "@/lib/billing";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/return?session_id=...
 * Stripe Checkout `success_url`. Reconciles the new subscription into the DB
 * immediately (so the happy path works without webhook forwarding), then
 * redirects the customer to the dashboard.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  const base = process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL || "http://localhost:3210";

  if (sessionId) {
    try {
      const stripe = getStripe();
      const checkout = await stripe.checkout.sessions.retrieve(sessionId);
      const userId = checkout.metadata?.userId;
      const subscriptionId =
        typeof checkout.subscription === "string"
          ? checkout.subscription
          : checkout.subscription?.id ?? null;

      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await reconcileSubscription(sub, userId ?? undefined);
      }
    } catch (err) {
      console.error("[billing] return sync failed:", err);
    }
  }

  return NextResponse.redirect(`${base}/dashboard?billing=success`);
}
