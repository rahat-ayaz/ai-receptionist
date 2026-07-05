import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { reconcileSubscription, userIdForCustomer } from "@/lib/billing";

// Webhooks must read the raw, unparsed body and never be cached.
export const dynamic = "force-dynamic";

/**
 * POST /api/billing/webhook
 * Stripe event sink. Verifies the signature, then reconciles subscription
 * state into the database.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");

  if (!secret || !signature) {
    return new NextResponse("Webhook not configured", { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("[billing] signature verification failed:", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await reconcileSubscription(event.data.object as Stripe.Subscription);
        break;

      case "invoice.payment_succeeded":
        await onInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        await onInvoiceFailed(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.deleted":
        await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        // Acknowledge unhandled events so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error(`[billing] handler error for ${event.type}:`, err);
    return new NextResponse("Handler error", { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  // Prefer the userId we stamped into checkout metadata.
  const userId = session.metadata?.userId ?? (await userIdForCustomer(customerId));
  if (!userId) return;

  // Persist the Stripe customer mapping if we learned it here.
  if (customerId) {
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
  if (subscriptionId) {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    await reconcileSubscription(sub, userId);
  }
}

async function onInvoicePaid(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const userId = await userIdForCustomer(customerId);
  if (!userId) return;

  // A successful invoice marks the start of a fresh metering window — reset usage.
  await prisma.subscription.updateMany({
    where: { userId },
    data: { status: "ACTIVE", callsUsed: 0 },
  });
}

async function onInvoiceFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const userId = await userIdForCustomer(customerId);
  if (!userId) return;

  await prisma.subscription.updateMany({
    where: { userId },
    data: { status: "PAST_DUE" },
  });
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = await userIdForCustomer(customerId);
  if (!userId) return;

  await prisma.subscription.updateMany({
    where: { userId },
    data: { status: "CANCELED", cancelAtPeriodEnd: false },
  });
}
