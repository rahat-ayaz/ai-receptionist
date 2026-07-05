import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/sms-rules/[id]">) {
  const { id } = await ctx.params;

  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Scope the delete to the caller's own profile so one tenant can't remove another's rules.
  const result = await prisma.smsTriggerRule.deleteMany({ where: { id, businessProfileId } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
