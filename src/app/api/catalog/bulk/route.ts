import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { isNiche } from "@/lib/niche";

export const dynamic = "force-dynamic";

interface IncomingItem {
  name?: string;
  price?: number | null;
  category?: string | null;
  description?: string | null;
}

/**
 * POST /api/catalog/bulk
 * Save reviewed entries to the catalog (and optionally persist the niche).
 */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as { items?: IncomingItem[]; niche?: string };

  const items = (body.items ?? [])
    .filter((i) => i.name?.trim())
    .map((i) => ({
      businessProfileId,
      name: i.name!.trim(),
      price: typeof i.price === "number" && isFinite(i.price) ? Math.round(i.price * 100) / 100 : null,
      category: i.category?.trim() || null,
      description: i.description?.trim() || null,
    }));

  if (items.length === 0) {
    return NextResponse.json({ error: "No valid items to save." }, { status: 400 });
  }

  if (body.niche && isNiche(body.niche)) {
    await prisma.businessProfile.update({ where: { id: businessProfileId }, data: { niche: body.niche } });
  }

  const result = await prisma.catalogItem.createMany({ data: items });
  return NextResponse.json({ created: result.count });
}
