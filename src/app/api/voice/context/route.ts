import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSystemPrompt } from "@/lib/gemini";
import { resolveVoice } from "@/lib/voices";

export const dynamic = "force-dynamic";

/**
 * GET /api/voice/context?profileId=...   (internal — used by the voice bridge)
 * Returns the built Gemini system instruction + voice + greeting for a tenant,
 * so the plain-JS bridge needs no Prisma/TS imports. Guarded by a shared secret.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.VOICE_BRIDGE_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const profileId = req.nextUrl.searchParams.get("profileId");
  const callSid = req.nextUrl.searchParams.get("callSid");
  if (!profileId) return NextResponse.json({ error: "profileId required" }, { status: 400 });

  const profile = await prisma.businessProfile.findUnique({
    where: { id: profileId },
    include: { agentSettings: true, knowledgeBlobs: { where: { active: true } } },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const s = profile.agentSettings;
  let systemInstruction = buildSystemPrompt({
    businessName: profile.name,
    receptionistName: s?.receptionistName ?? "Ava",
    tone: s?.tone ?? "PROFESSIONAL",
    industry: profile.industry,
    rawContext: profile.rawContext,
    ruleMatrix: profile.ruleMatrix,
    knowledge: profile.knowledgeBlobs.map((k) => `${k.title}: ${k.data}`),
  });

  if (callSid) {
    const session = await prisma.callSession.findUnique({
      where: { twilioCallSid: callSid },
      select: { customContext: true },
    });
    if (session?.customContext) {
      systemInstruction += `\n\n[CRITICAL INSTRUCTION FOR THIS OUTBOUND CALL]: You initiated this call to this customer with the following goal/context: "${session.customContext}". Please lead the conversation to address this goal directly after greeting them.`;
    }
  }

  return NextResponse.json({
    systemInstruction,
    voiceId: resolveVoice(s?.voiceId),
    greeting: s?.greetingMessage || `Thank you for calling ${profile.name}. How can I help you today?`,
    forwardingNumber: profile.forwardingNumber || "",
    forwardingNumbers: profile.forwardingNumbers || {},
  });
}
