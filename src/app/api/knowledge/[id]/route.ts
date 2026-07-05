import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/knowledge/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as { active?: boolean };
  const data: Record<string, unknown> = {};
  if (typeof body.active === "boolean") data.active = body.active;

  const result = await prisma.knowledgeBlob.updateMany({ where: { id, businessProfileId }, data });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/knowledge/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const result = await prisma.knowledgeBlob.deleteMany({ where: { id, businessProfileId } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
