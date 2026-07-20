import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Toggle sync switches or disable an integration. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/integrations/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as {
    catalogSyncEnabled?: boolean;
    bookingPushEnabled?: boolean;
    enabled?: boolean;
    config?: Record<string, unknown>;
  };

  const data: Record<string, unknown> = {};
  if (typeof body.catalogSyncEnabled === "boolean") data.catalogSyncEnabled = body.catalogSyncEnabled;
  if (typeof body.bookingPushEnabled === "boolean") data.bookingPushEnabled = body.bookingPushEnabled;
  if (typeof body.enabled === "boolean") data.status = body.enabled ? "ACTIVE" : "DISABLED";

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await prisma.integration.updateMany({ where: { id, businessProfileId }, data });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * Disconnect. Drops the credentials and every identity link, so a later
 * reconnect re-adopts by name rather than trusting stale external ids.
 */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/integrations/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const existing = await prisma.integration.findFirst({
    where: { id, businessProfileId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cascades handle ExternalRef / outbox / syncRuns via the relation.
  await prisma.integration.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
