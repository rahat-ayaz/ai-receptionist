import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateTwilioSignature } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * POST /api/telephony/recording
 *
 * Twilio recording status callback. Saves the completed recording URL to the CallSession.
 */
export async function POST(req: NextRequest) {
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const url = `${baseUrl}/api/telephony/recording`;
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => (params[k] = v.toString()));

  const signature = req.headers.get("x-twilio-signature") ?? "";
  if (!validateTwilioSignature(signature, url, params)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid = params.CallSid;
  const recordingUrl = params.RecordingUrl;

  if (!callSid || !recordingUrl) {
    return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
  }

  try {
    const session = await prisma.callSession.findUnique({
      where: { twilioCallSid: callSid },
    });

    if (!session) {
      console.warn(`[telephony/recording] No call session found for Twilio CallSid: ${callSid}`);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await prisma.callSession.update({
      where: { twilioCallSid: callSid },
      data: { recordingUrl },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telephony/recording] Update failed:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
