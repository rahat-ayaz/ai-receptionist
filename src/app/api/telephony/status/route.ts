import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateTwilioSignature } from "@/lib/twilio";
import { analyzeCall, type TranscriptTurn } from "@/lib/gemini";
import { dispatchTriggerSms } from "@/lib/sms-rules";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/status
 *
 * Twilio call status callback. On completion we finalize the CallSession:
 * record duration + recording URL, run the post-call semantic analysis,
 * fire "after call" SMS triggers, and meter usage against the subscription.
 */
export async function POST(req: NextRequest) {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const url = `${baseUrl}/api/telephony/status`;
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid = params.CallSid;
  const callStatus = params.CallStatus; // completed | busy | no-answer | failed
  const duration = params.CallDuration ? Number(params.CallDuration) : undefined;
  const recordingUrl = params.RecordingUrl || undefined;

  if (!callSid) return NextResponse.json({ ok: true });

  const session = await prisma.callSession.findUnique({
    where: { twilioCallSid: callSid },
    include: { businessProfile: { select: { id: true, name: true, userId: true } } },
  });
  if (!session) return NextResponse.json({ ok: true });

  // Only finalize terminal states.
  const terminal = ["completed", "busy", "no-answer", "failed", "canceled"];
  if (!terminal.includes(callStatus)) {
    return NextResponse.json({ ok: true });
  }

  const transcript = (session.transcript as unknown as TranscriptTurn[]) ?? [];

  // Post-call semantic summary + classification.
  let analysis;
  try {
    analysis = await analyzeCall(session.businessProfile.name, transcript);
  } catch (err) {
    console.error("[telephony/status] analysis failed:", err);
  }

  await prisma.callSession.update({
    where: { twilioCallSid: callSid },
    data: {
      status: callStatus === "completed" ? "COMPLETED" : "FAILED",
      durationSeconds: duration ?? session.durationSeconds ?? 0,
      recordingUrl: recordingUrl ?? session.recordingUrl,
      endedAt: new Date(),
      ...(analysis
        ? {
            summary: analysis.summary,
            category: analysis.category,
            sentiment: analysis.sentiment,
            tags: analysis.tags,
            isSpam: analysis.isSpam,
            intent: analysis.intent as object,
          }
        : {}),
    },
  });

  // Fire "after call" SMS triggers against the full transcript.
  const fullText = transcript.map((t) => t.text).join(" ");
  void dispatchTriggerSms({
    businessProfileId: session.businessProfile.id,
    businessName: session.businessProfile.name,
    callerNumber: session.callerNumber,
    utterance: fullText,
    fireOn: "AFTER_CALL",
  });

  // Meter usage (skip spam) against the user's subscription window.
  if (callStatus === "completed" && !(analysis?.isSpam)) {
    await prisma.subscription.updateMany({
      where: { userId: session.businessProfile.userId },
      data: { callsUsed: { increment: 1 } },
    });
  }

  return NextResponse.json({ ok: true });
}
