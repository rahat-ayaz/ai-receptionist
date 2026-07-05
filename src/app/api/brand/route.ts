import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_LOGO = 800 * 1024; // ~800KB base64

export async function GET() {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ brand: null });
  const p = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { name: true, brandColor: true, brandAccentColor: true, logoData: true },
  });
  return NextResponse.json({ brand: p });
}

export async function PATCH(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    brandColor?: string | null;
    brandAccentColor?: string | null;
    logoData?: string | null;
  };

  const data: Record<string, unknown> = {};
  if (body.brandColor !== undefined) {
    if (body.brandColor && !HEX.test(body.brandColor)) return NextResponse.json({ error: "Invalid colour" }, { status: 400 });
    data.brandColor = body.brandColor || null;
  }
  if (body.brandAccentColor !== undefined) {
    if (body.brandAccentColor && !HEX.test(body.brandAccentColor)) return NextResponse.json({ error: "Invalid accent colour" }, { status: 400 });
    data.brandAccentColor = body.brandAccentColor || null;
  }
  if (body.logoData !== undefined) {
    if (body.logoData) {
      if (!body.logoData.startsWith("data:image/")) return NextResponse.json({ error: "Logo must be an image" }, { status: 400 });
      if (body.logoData.length > MAX_LOGO) return NextResponse.json({ error: "Logo too large (max ~600KB)" }, { status: 413 });
    }
    data.logoData = body.logoData || null;
  }

  await prisma.businessProfile.update({ where: { id: businessProfileId }, data });
  return NextResponse.json({ ok: true });
}
