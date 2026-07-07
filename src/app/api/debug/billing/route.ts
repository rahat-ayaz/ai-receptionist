import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    hasStripeSecretKey: !!process.env.STRIPE_SECRET_KEY,
    stripeSecretKeyLength: process.env.STRIPE_SECRET_KEY?.length || 0,
    hasPriceStarter: !!process.env.STRIPE_PRICE_STARTER,
    priceStarter: process.env.STRIPE_PRICE_STARTER || "missing",
    hasPricePremium: !!process.env.STRIPE_PRICE_PREMIUM,
    pricePremium: process.env.STRIPE_PRICE_PREMIUM || "missing",
    hasPricePro: !!process.env.STRIPE_PRICE_PRO,
    pricePro: process.env.STRIPE_PRICE_PRO || "missing",
    betterAuthUrl: process.env.BETTER_AUTH_URL || "missing",
  });
}
