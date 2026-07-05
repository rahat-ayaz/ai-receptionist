import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const businessProfileId = await currentProfileId();
    if (!businessProfileId) return NextResponse.json({ rules: [] });
    const rules = await prisma.smsTriggerRule.findMany({
      where: { businessProfileId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ rules });
  } catch {
    return NextResponse.json({ rules: [] });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    label?: string;
    matchKeywords?: string[];
    messageTemplate?: string;
    fireOn?: "DURING_CALL" | "AFTER_CALL";
  };

  if (!body.label || !body.messageTemplate || !body.matchKeywords?.length) {
    return NextResponse.json({ error: "label, matchKeywords and messageTemplate are required" }, { status: 400 });
  }

  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Create a business profile first (run onboarding)." }, { status: 400 });
  }

  const rule = await prisma.smsTriggerRule.create({
    data: {
      businessProfileId,
      label: body.label,
      matchKeywords: body.matchKeywords.map((k) => k.trim()).filter(Boolean),
      messageTemplate: body.messageTemplate,
      fireOn: body.fireOn ?? "DURING_CALL",
    },
  });

  return NextResponse.json({ rule });
}
