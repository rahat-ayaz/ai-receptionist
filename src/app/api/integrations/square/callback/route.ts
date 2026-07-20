import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { sealSecrets } from "@/lib/crypto";
import {
  fetchSquareAccountInfo,
  squareTokenRequest,
} from "@/lib/integrations/adapters/square";
import { OAUTH_STATE_COOKIE } from "../connect/route";

export const dynamic = "force-dynamic";

const appBase = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

function back(params: Record<string, string>): NextResponse {
  const url = new URL("/dashboard/integrations", appBase());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/**
 * GET /api/integrations/square/callback
 *
 * CSRF is enforced three ways, and all three must agree:
 *   1. the `state` query param must match the httpOnly cookie (double-submit),
 *   2. the nonce must exist in the DB, unexpired, and is consumed atomically,
 *   3. the signed-in tenant must be the one that started the flow.
 *
 * /api/** sits outside the proxy matcher, which is correct here: the callback
 * does its own session check and must not be bounced to /login mid-flow.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back({ error });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code || !state) return back({ error: "missing_code" });
  if (!cookie || cookie !== state) return back({ error: "state_mismatch" });

  // Consume the nonce atomically — deleteMany returning 1 is the claim.
  const record = await prisma.integrationOAuthState.findUnique({ where: { nonce: state } });
  if (!record || record.provider !== "square") return back({ error: "unknown_state" });

  const { count } = await prisma.integrationOAuthState.deleteMany({ where: { nonce: state } });
  if (count !== 1) return back({ error: "state_already_used" });
  if (record.expiresAt.getTime() < Date.now()) return back({ error: "state_expired" });

  const businessProfileId = await currentProfileId();
  if (!businessProfileId || businessProfileId !== record.businessProfileId) {
    return back({ error: "session_mismatch" });
  }

  // ── Exchange the code ───────────────────────────────────────────────────
  const token = await squareTokenRequest({ grant_type: "authorization_code", code });
  if (!token.ok) {
    console.error("[square/callback] token exchange failed:", token.error);
    return back({ error: "token_exchange_failed" });
  }

  const merchantId = token.data.merchant_id ?? "me";
  const secrets = {
    accessToken: token.data.access_token,
    refreshToken: token.data.refresh_token,
  };

  // Look up the display label and locations using the token we just received.
  const info = await fetchSquareAccountInfo(
    {
      integrationId: "pending",
      businessProfileId,
      provider: "square",
      config: { merchantId },
      secrets,
      persistSecrets: async () => {},
    },
    merchantId,
  );

  const primaryLocation = info.locations[0] ?? null;
  const sealed = sealSecrets(secrets, businessProfileId, "square");

  await prisma.integration.upsert({
    where: { businessProfileId_provider: { businessProfileId, provider: "square" } },
    create: {
      businessProfileId,
      provider: "square",
      status: "ACTIVE",
      label: info.businessName ?? "Square",
      externalAccountId: merchantId,
      config: {
        merchantId,
        locationId: primaryLocation?.id ?? null,
        locationName: primaryLocation?.name ?? null,
        // Kept so the dashboard can offer a picker for multi-location sellers.
        locations: info.locations,
      },
      accessTokenExpiresAt: token.data.expires_at ? new Date(token.data.expires_at) : null,
      ...sealed,
    },
    update: {
      status: "ACTIVE",
      label: info.businessName ?? "Square",
      externalAccountId: merchantId,
      config: {
        merchantId,
        locationId: primaryLocation?.id ?? null,
        locationName: primaryLocation?.name ?? null,
        locations: info.locations,
      },
      accessTokenExpiresAt: token.data.expires_at ? new Date(token.data.expires_at) : null,
      ...sealed,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return back({ connected: "square" });
}
