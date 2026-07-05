import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { isNiche } from "@/lib/niche";

export const dynamic = "force-dynamic";

/** PATCH /api/profile/niche — persist the business niche. */
export async function PATCH(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { niche } = (await req.json()) as { niche?: string };
  if (!isNiche(niche)) return NextResponse.json({ error: "Unknown niche" }, { status: 400 });

  await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { niche } });
  return NextResponse.json({ ok: true, niche });
}
