import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { resolveVoice, TONES } from "@/lib/voices";
import type { AgentTone } from "@prisma/client";

export const dynamic = "force-dynamic";

/** GET — load the agent settings for the current tenant (creating defaults if absent). */
export async function GET() {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ settings: null });

  const settings = await prisma.agentSettings.upsert({
    where: { businessProfileId },
    create: { businessProfileId },
    update: {},
  });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { forwardingNumber: true, forwardingNumbers: true },
  });

  // Normalize legacy/unset voice ids (e.g. the "Puck" seed) to a valid option.
  return NextResponse.json({
    settings: {
      ...settings,
      voiceId: resolveVoice(settings.voiceId),
      forwardingNumber: profile?.forwardingNumber || "",
      forwardingNumbers: profile?.forwardingNumbers || {},
    },
  });
}

/** PATCH — update the agent settings (voice, speed, tone, name, greeting, recording). */
export async function PATCH(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    receptionistName?: string;
    voiceId?: string;
    voiceSpeed?: number;
    tone?: string;
    greetingMessage?: string;
    recordCalls?: boolean;
    forwardingNumber?: string;
    forwardingNumbers?: Record<string, string>;
  };

  const data: Record<string, unknown> = {};
  if (body.receptionistName !== undefined) data.receptionistName = body.receptionistName.trim() || "Ava";
  if (body.voiceId !== undefined) data.voiceId = resolveVoice(body.voiceId);
  if (typeof body.voiceSpeed === "number") data.voiceSpeed = Math.min(1.2, Math.max(0.7, body.voiceSpeed));
  if (body.tone && (TONES as readonly string[]).includes(body.tone)) data.tone = body.tone as AgentTone;
  if (body.greetingMessage !== undefined) data.greetingMessage = body.greetingMessage;
  if (typeof body.recordCalls === "boolean") data.recordCalls = body.recordCalls;

  const profileData: Record<string, any> = {};
  if (body.forwardingNumber !== undefined) profileData.forwardingNumber = body.forwardingNumber.trim() || null;
  if (body.forwardingNumbers !== undefined) profileData.forwardingNumbers = body.forwardingNumbers;

  if (Object.keys(profileData).length > 0) {
    await prisma.businessProfile.update({
      where: { id: businessProfileId },
      data: profileData,
    });
  }

  const settings = await prisma.agentSettings.upsert({
    where: { businessProfileId },
    create: { businessProfileId, ...data },
    update: data,
  });
  return NextResponse.json({ settings });
}
