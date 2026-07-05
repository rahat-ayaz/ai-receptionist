import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import type { MessageChannel, TemplatePurpose } from "@prisma/client";

export const dynamic = "force-dynamic";

const PURPOSES = ["GENERAL", "BOOKING_CONFIRMATION", "BOOKING_REMINDER"];

export async function GET(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ templates: [] });
  const channel = req.nextUrl.searchParams.get("channel") as MessageChannel | null;
  const templates = await prisma.messageTemplate.findMany({
    where: { businessProfileId, ...(channel ? { channel } : {}) },
    orderBy: [{ channel: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    channel?: MessageChannel;
    purpose?: string;
    name?: string;
    subject?: string;
    body?: string;
  };
  if (!body.name || !body.body || (body.channel !== "SMS" && body.channel !== "EMAIL")) {
    return NextResponse.json({ error: "channel (SMS|EMAIL), name and body are required" }, { status: 400 });
  }

  const template = await prisma.messageTemplate.create({
    data: {
      businessProfileId,
      channel: body.channel,
      purpose: (PURPOSES.includes(body.purpose ?? "") ? body.purpose : "GENERAL") as TemplatePurpose,
      name: body.name.trim(),
      subject: body.channel === "EMAIL" ? body.subject?.trim() || null : null,
      body: body.body,
    },
  });
  return NextResponse.json({ template });
}
