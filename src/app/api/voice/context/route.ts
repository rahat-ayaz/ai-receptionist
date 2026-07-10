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

  let customerName: string | null = null;
  let customerEmail: string | null = null;

  if (callSid) {
    const session = await prisma.callSession.findUnique({
      where: { twilioCallSid: callSid },
      select: { customContext: true, callerNumber: true },
    });
    if (session) {
      if (session.customContext) {
        systemInstruction += `\n\n[CRITICAL INSTRUCTION FOR THIS OUTBOUND CALL]: You initiated this call to this customer with the following goal/context: "${session.customContext}". Please lead the conversation to address this goal directly after greeting them.`;
      }

      if (session.callerNumber) {
        const customer = await prisma.customer.findUnique({
          where: {
            businessProfileId_phone: {
              businessProfileId: profile.id,
              phone: session.callerNumber,
            },
          },
          select: { name: true, email: true },
        });
        if (customer) {
          customerName = customer.name;
          customerEmail = customer.email;
        }
      }
    }
  }

  // Inject memory rules
  if (customerName) {
    systemInstruction += `\n\n[RETURNING CUSTOMER]: The caller is a returning customer named "${customerName}". Greet them by name (e.g. "Welcome back, ${customerName}!"). Since you already know their name and email (${customerEmail || "not set"}), you do not need to ask for these details when booking/ordering, unless they want to update them.`;
  } else {
    systemInstruction += `\n\n[NEW CUSTOMER]: You do not know the caller's name or email. If they schedule an appointment, place an order, or book a slot, you MUST ask for their full name and email address to complete the booking.`;
  }

  // Mirror the greeting the telephony webhook speaks from TwiML (including the
  // returning-customer variant) so the bridge can log/reference it accurately.
  const greeting = customerName
    ? `Welcome back, ${customerName}! How can I help you today?`
    : s?.greetingMessage || `Thank you for calling ${profile.name}. How can I help you today?`;

  return NextResponse.json({
    systemInstruction,
    voiceId: resolveVoice(s?.voiceId),
    greeting,
    forwardingNumber: profile.forwardingNumber || "",
    forwardingNumbers: profile.forwardingNumbers || {},
  });
}
