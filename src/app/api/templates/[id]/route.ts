import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/templates/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as { name?: string; subject?: string; body?: string; purpose?: string };
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.subject !== undefined) data.subject = body.subject.trim() || null;
  if (body.body !== undefined) data.body = body.body;
  if (body.purpose && ["GENERAL", "BOOKING_CONFIRMATION", "BOOKING_REMINDER"].includes(body.purpose)) {
    data.purpose = body.purpose;
  }

  const result = await prisma.messageTemplate.updateMany({ where: { id, businessProfileId }, data });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/templates/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const result = await prisma.messageTemplate.deleteMany({ where: { id, businessProfileId } });
  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
