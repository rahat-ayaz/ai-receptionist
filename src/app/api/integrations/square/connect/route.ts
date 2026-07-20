import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { isCryptoConfigured } from "@/lib/crypto";
import { squareBaseUrl, squareCredentials } from "@/lib/integrations/adapters/square";

export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "capro_oauth_state";
const STATE_TTL_MS = 10 * 60_000;

// Only what we actually use: read the catalog, read/write orders, and read the
// merchant profile for a display label. Requesting less than we need would fail
// at runtime; requesting more is an unnecessary ask of the seller.
const SCOPES = ["MERCHANT_PROFILE_READ", "ITEMS_READ", "ORDERS_READ", "ORDERS_WRITE"];

/**
 * GET /api/integrations/square/connect
 * Starts the Square OAuth flow. Reached by a full-page navigation (a plain
 * <a href>), never fetch — the response is a cross-site redirect.
 */
export async function GET(_req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL ?? "http://localhost:3000"));
  }

  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  if (!squareCredentials()) {
    return NextResponse.redirect(new URL("/dashboard/integrations?error=square_not_configured", base));
  }
  if (!isCryptoConfigured()) {
    return NextResponse.redirect(new URL("/dashboard/integrations?error=crypto_not_configured", base));
  }

  const nonce = randomBytes(32).toString("base64url");
  await prisma.integrationOAuthState.create({
    data: {
      nonce,
      provider: "square",
      businessProfileId,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });

  const authorizeUrl = new URL(`${squareBaseUrl()}/oauth2/authorize`);
  authorizeUrl.searchParams.set("client_id", squareCredentials()!.appId);
  authorizeUrl.searchParams.set("scope", SCOPES.join("+"));
  authorizeUrl.searchParams.set("session", "false");
  authorizeUrl.searchParams.set("state", nonce);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    // "lax" is required: the callback arrives as a cross-site top-level GET,
    // and "strict" would withhold the cookie exactly when we need it.
    sameSite: "lax",
    path: "/api/integrations",
    maxAge: STATE_TTL_MS / 1000,
  });
  return res;
}
