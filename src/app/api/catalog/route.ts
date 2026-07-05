import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ items: [], niche: "OTHER" });
  const [items, profile] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { businessProfileId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { niche: true } }),
  ]);
  return NextResponse.json({ items, niche: profile?.niche ?? "OTHER" });
}

export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    name?: string;
    price?: number | null;
    description?: string;
    category?: string;
  };
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const price =
    typeof body.price === "number" && isFinite(body.price) && body.price >= 0
      ? Math.round(body.price * 100) / 100
      : null;

  const item = await prisma.catalogItem.create({
    data: {
      businessProfileId,
      name: body.name.trim(),
      price,
      description: body.description?.trim() || null,
      category: body.category?.trim() || null,
    },
  });
  return NextResponse.json({ item });
}
