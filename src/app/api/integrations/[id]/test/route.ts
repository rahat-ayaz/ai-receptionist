import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { buildContext, getAdapter, recordError, clearError } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/** POST /api/integrations/[id]/test — cheap auth probe against the provider. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/integrations/[id]/test">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const integration = await prisma.integration.findFirst({ where: { id, businessProfileId } });
  if (!integration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const adapter = getAdapter(integration.provider);
  if (!adapter) {
    return NextResponse.json({ error: "This provider is not connectable yet." }, { status: 400 });
  }

  const context = await buildContext(integration);
  if (!context) {
    return NextResponse.json(
      { error: "Stored credentials could not be read. Reconnect this integration." },
      { status: 400 },
    );
  }

  const result = await adapter.test(context);

  if (!result.ok) {
    await recordError(integration.id, result.error.code, result.error.message);
    // The provider rejecting a probe is a valid outcome, not a server fault —
    // return 200 with ok:false so the UI can render the reason inline.
    return NextResponse.json({ ok: false, error: result.error.message, code: result.error.code });
  }

  await clearError(integration.id);
  await prisma.integration.update({
    where: { id: integration.id },
    data: { label: result.data.accountLabel || integration.label, status: "ACTIVE" },
  });

  return NextResponse.json({ ok: true, accountLabel: result.data.accountLabel });
}
