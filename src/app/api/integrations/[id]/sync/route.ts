import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { getAdapter } from "@/lib/integrations";
import { pullCatalog } from "@/lib/integrations/sync/catalog";

export const dynamic = "force-dynamic";

/** POST /api/integrations/[id]/sync — pull the provider's catalog into CAPRO. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/integrations/[id]/sync">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const integration = await prisma.integration.findFirst({ where: { id, businessProfileId } });
  if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const adapter = getAdapter(integration.provider);
  if (!adapter?.capabilities.has("catalog.pull")) {
    return NextResponse.json(
      { error: "This integration doesn't sync a catalog." },
      { status: 400 },
    );
  }
  if (!integration.catalogSyncEnabled) {
    return NextResponse.json({ error: "Catalog sync is turned off for this integration." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { resume?: boolean };

  // A resumed run continues from the stored cursor and must not deactivate,
  // since it hasn't seen the whole catalog.
  const summary = await pullCatalog(integration, { full: !body.resume });

  return NextResponse.json({
    ok: summary.status !== "FAILED",
    summary,
  });
}
