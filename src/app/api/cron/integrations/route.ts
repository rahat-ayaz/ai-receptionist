import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { drain } from "@/lib/integrations/outbox";
import { buildContext } from "@/lib/integrations";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/integrations
 * Drains the integration outbox (retryable pushes to connected POS/CRM systems)
 * and expires stale OAuth state nonces.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const result = await drain({ limit: 50, deadlineMs: 25_000 });

    // Safety net for idle tenants: a Square token nobody touched for 30 days
    // would otherwise expire silently. buildContext refreshes it as a side
    // effect and flips the row to NEEDS_REAUTH if the refresh is rejected.
    const expiring = await prisma.integration.findMany({
      where: {
        provider: "square",
        status: "ACTIVE",
        accessTokenExpiresAt: { lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
      take: 25,
    });

    let refreshed = 0;
    let reauthNeeded = 0;
    for (const integration of expiring) {
      const ctx = await buildContext(integration).catch(() => null);
      if (ctx) refreshed += 1;
      else reauthNeeded += 1;
    }

    // Housekeeping: consumed nonces are deleted on use, but abandoned OAuth
    // attempts would otherwise accumulate forever.
    const { count: expiredStates } = await prisma.integrationOAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    return NextResponse.json({
      ok: true,
      outbox: result,
      tokens: { checked: expiring.length, refreshed, reauthNeeded },
      expiredStates,
    });
  } catch (err) {
    console.error("[cron:integrations] drain failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 },
    );
  }
}
