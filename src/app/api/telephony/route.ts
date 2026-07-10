import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  validateTwilioSignature,
  buildGreetingTwiML,
  buildReplyTwiML,
  buildForwardTwiML,
  buildRejectTwiML,
  buildStreamTwiML,
  buildRelayTwiML,
  twilioClient,
} from "@/lib/twilio";
import {
  buildSystemPrompt,
  generateReply,
  type BusinessContext,
  type TranscriptTurn,
} from "@/lib/gemini";
import { dispatchTriggerSms } from "@/lib/sms-rules";
import { getOrCreateCustomer } from "@/lib/bookings";

// Twilio webhooks are POST form-encoded and must never be statically cached.
export const dynamic = "force-dynamic";

const XML_HEADERS = { "Content-Type": "application/xml" };

// Cheap heuristic for caller-initiated hang-up intent.
const GOODBYE = /\b(bye|goodbye|that'?s all|nothing else|thank you,? bye|hang up)\b/i;

function twiml(body: string) {
  return new NextResponse(body, { headers: XML_HEADERS });
}

function resolveForwardingTarget(
  text: string,
  generalNumber: string | null,
  forwardingNumbers: any
): string | null {
  const depts = forwardingNumbers as Record<string, string> || {};
  for (const [dept, num] of Object.entries(depts)) {
    if (new RegExp(`\\b${dept}\\b`, "i").test(text)) {
      return num;
    }
  }
  return generalNumber;
}

/**
 * POST /api/telephony
 *
 * Single endpoint that drives the entire inbound voice conversation:
 *   • First hit (no SpeechResult)  → greet + open a CallSession + <Gather>.
 *   • Subsequent hits (SpeechResult) → transcribe turn, fire SMS triggers,
 *     ask Gemini for the next spoken reply, loop the <Gather>.
 */
export async function POST(req: NextRequest) {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const actionUrl = `${baseUrl}/api/telephony`;

  // 1) Parse + authenticate the Twilio payload.
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateTwilioSignature(signature, actionUrl, params)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid = params.CallSid;
  const toNumber = params.To;
  const fromNumber = params.From;
  const speech = params.SpeechResult?.trim();

  if (!callSid || !toNumber) {
    return twiml(buildRejectTwiML("We could not process this call. Goodbye."));
  }

  // 2) Resolve the tenant that owns the dialed number.
  const number = await prisma.provisionedNumber.findUnique({
    where: { phoneNumber: toNumber },
    include: {
      businessProfile: {
        include: {
          agentSettings: true,
          knowledgeBlobs: { where: { active: true } },
          user: {
            select: {
              createdAt: true,
              subscription: true,
            },
          },
        },
      },
    },
  });

  if (!number || !number.active) {
    return twiml(buildRejectTwiML("This number is not currently in service. Goodbye."));
  }

  const profile = number.businessProfile;
  const user = profile.user;

  const hasSubscription = user?.subscription && user.subscription.status !== "CANCELED";
  const trialEndsAt = new Date((user?.createdAt || new Date()).getTime() + 7 * 24 * 60 * 60 * 1000);
  const isTrialActive = new Date() < trialEndsAt;

  if (!isTrialActive && !hasSubscription) {
    return twiml(buildRejectTwiML("Thank you for calling. This line is temporarily inactive because the account has expired. Goodbye."));
  }

  const settings = profile.agentSettings;
  let greeting = settings?.greetingMessage || `Thank you for calling ${profile.name}. How can I help you today?`;

  // ── First turn: greet and open a session ──────────────────────────────────
  if (!speech) {
    // Track the caller by phone number so their history/orders are reattached.
    const customer = await getOrCreateCustomer(profile.id, fromNumber ?? "unknown");
    if (customer.name) {
      greeting = `Welcome back, ${customer.name}! How can I help you today?`;
    }

    await prisma.callSession.upsert({
      where: { twilioCallSid: callSid },
      create: {
        businessProfileId: profile.id,
        twilioCallSid: callSid,
        callerNumber: fromNumber ?? "unknown",
        customerId: customer.id,
        direction: "INBOUND",
        status: "IN_PROGRESS",
        transcript: [{ role: "agent", text: greeting, at: new Date().toISOString() }],
      },
      update: {}, // a redirect with no speech just re-greets
    });

    if (settings?.recordCalls) {
      // Fire-and-forget: don't hold the TwiML response (and the caller's
      // pickup) hostage to a Twilio REST round trip.
      void twilioClient.calls(callSid).recordings.create({
        recordingStatusCallback: `${actionUrl}/recording`,
        trim: "trim-silence",
      }).catch((e) => console.error("[telephony] Failed to start recording:", e));
    }

    // Preferred path: hand the call to the Gemini Live bridge (real-time voice).
    const wss = process.env.PUBLIC_WSS_URL;
    if (wss && process.env.USE_CONVERSATION_RELAY === "true") {
      // Lowest-latency path: Twilio edge STT/TTS + Gemini text streaming.
      return twiml(
        buildRelayTwiML(
          wss,
          {
            businessProfileId: profile.id,
            callSid,
            callerNumber: fromNumber ?? "unknown",
          },
          { greeting },
        ),
      );
    }
    if (wss) {
      return twiml(
        buildStreamTwiML(
          wss,
          {
            businessProfileId: profile.id,
            callSid,
            callerNumber: fromNumber ?? "unknown",
            greeted: "1",
          },
          { text: greeting, voiceId: settings?.voiceId, voiceSpeed: settings?.voiceSpeed },
        ),
      );
    }

    // Fallback (no bridge configured): turn-based Gather + Gemini-TTS flow.
    return twiml(
      buildGreetingTwiML({
        greeting,
        actionUrl,
        record: false, // Bypassed blocking Record verb
        voiceId: settings?.voiceId,
        voiceSpeed: settings?.voiceSpeed ?? 1.0,
      }),
    );
  }

  // ── Conversational turn ───────────────────────────────────────────────────
  const session = await prisma.callSession.findUnique({
    where: { twilioCallSid: callSid },
    include: { customer: true }
  });
  if (!session) {
    // Lost the session somehow — restart the greeting flow.
    return twiml(
      buildGreetingTwiML({ greeting, actionUrl, record: settings?.recordCalls ?? true, voiceId: settings?.voiceId, voiceSpeed: settings?.voiceSpeed ?? 1.0 }),
    );
  }

  const history = (session.transcript as unknown as TranscriptTurn[]) ?? [];

  // Fire any "during call" SMS trigger rules against this utterance.
  void dispatchTriggerSms({
    businessProfileId: profile.id,
    businessName: profile.name,
    callerNumber: fromNumber ?? "unknown",
    utterance: speech,
    fireOn: "DURING_CALL",
  });

  // Human-fallback intent → forward if a number is configured.
  const callerWantsHuman = /\b(speak|talk) to (a )?(human|person|someone|representative|agent)\b/i.test(speech);
  if (callerWantsHuman) {
    const targetNumber = resolveForwardingTarget(speech, profile.forwardingNumber, profile.forwardingNumbers);
    if (targetNumber) {
      const updated: TranscriptTurn[] = [
        ...history,
        { role: "caller", text: speech, at: new Date().toISOString() },
        { role: "agent", text: "Sure, connecting you now.", at: new Date().toISOString() },
      ];
      await prisma.callSession.update({
        where: { twilioCallSid: callSid },
        data: { transcript: updated as object[] },
      });
      return twiml(buildForwardTwiML(targetNumber, "One moment while I connect you.", settings?.voiceId, settings?.voiceSpeed));
    }
  }

  // 3) Ask Gemini for the next spoken reply.
  const ctx: BusinessContext = {
    businessName: profile.name,
    receptionistName: settings?.receptionistName ?? "Ava",
    tone: settings?.tone ?? "PROFESSIONAL",
    industry: profile.industry,
    rawContext: profile.rawContext,
    ruleMatrix: profile.ruleMatrix,
    knowledge: profile.knowledgeBlobs.map((k) => `${k.title}: ${k.data}`),
  };
  let systemPrompt = buildSystemPrompt(ctx);

  // Inject returning customer memory rules
  const customerName = session.customer?.name;
  const customerEmail = session.customer?.email;
  if (customerName) {
    systemPrompt += `\n\n[RETURNING CUSTOMER]: The caller is a returning customer named "${customerName}". Greet them by name (e.g. "Welcome back, ${customerName}!"). Since you already know their name and email (${customerEmail || "not set"}), you do not need to ask for these details when booking/ordering, unless they want to update them.`;
  } else {
    systemPrompt += `\n\n[NEW CUSTOMER]: You do not know the caller's name or email. If they schedule an appointment, place an order, or book a slot, you MUST ask for their full name and email address to complete the booking.`;
  }

  let reply: string;
  try {
    reply = await generateReply(systemPrompt, history, speech);
  } catch (err) {
    console.error("[telephony] Gemini error:", err);
    reply = "I'm having trouble with our system right now. Can I take a message and have someone call you back?";
  }

  const agentWantsTransfer = /\b(transfer|connect|forward)( you)?\b/i.test(reply) || /\b(representative|human agent)\b/i.test(reply);
  if (agentWantsTransfer) {
    const targetNumber = resolveForwardingTarget(speech + " " + reply, profile.forwardingNumber, profile.forwardingNumbers);
    if (targetNumber) {
      const updated: TranscriptTurn[] = [
        ...history,
        { role: "caller", text: speech, at: new Date().toISOString() },
        { role: "agent", text: reply, at: new Date().toISOString() },
      ];
      await prisma.callSession.update({
        where: { twilioCallSid: callSid },
        data: {
          transcript: updated as object[],
          status: "COMPLETED",
          endedAt: new Date(),
        },
      });
      return twiml(buildForwardTwiML(targetNumber, reply, settings?.voiceId, settings?.voiceSpeed));
    }
  }

  const hangup = GOODBYE.test(speech);

  // 4) Persist both turns.
  const updated: TranscriptTurn[] = [
    ...history,
    { role: "caller", text: speech, at: new Date().toISOString() },
    { role: "agent", text: reply, at: new Date().toISOString() },
  ];
  await prisma.callSession.update({
    where: { twilioCallSid: callSid },
    data: {
      transcript: updated as object[],
      status: hangup ? "COMPLETED" : "IN_PROGRESS",
      ...(hangup ? { endedAt: new Date() } : {}),
    },
  });

  return twiml(buildReplyTwiML({ text: reply, actionUrl, hangup, voiceId: settings?.voiceId, voiceSpeed: settings?.voiceSpeed }));
}
