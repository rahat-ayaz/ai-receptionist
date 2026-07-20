import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ items: [], niche: "OTHER", managed: {} });

  const [items, profile, refs] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { businessProfileId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.businessProfile.findUnique({ where: { id: businessProfileId }, select: { niche: true } }),
    // Items linked to a POS are overwritten on every sync, so the UI needs to
    // stop owners editing them and then watching their work revert.
    prisma.externalRef.findMany({
      where: { businessProfileId, entityType: "CATALOG_ITEM" },
      select: { localId: true, integration: { select: { provider: true, label: true } } },
    }),
  ]);

  const managed: Record<string, string> = {};
  for (const ref of refs) {
    managed[ref.localId] = ref.integration.label ?? ref.integration.provider;
  }

  return NextResponse.json({ items, niche: profile?.niche ?? "OTHER", managed });
}

export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    name?: string;
    price?: number | null;
    description?: string;
    category?: string;
    imageUrl?: string;
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
      imageUrl: body.imageUrl?.trim() || null,
    },
  });
  return NextResponse.json({ item });
}
