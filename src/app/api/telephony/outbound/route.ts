import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import twilio from "twilio";

export const dynamic = "force-dynamic";

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { phone, name = "", context = "" } = (await req.json()) as { phone?: string; name?: string; context?: string };
  if (!phone) {
    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  }

  if (!twilioClient) {
    return NextResponse.json({ error: "Twilio integration is not configured." }, { status: 500 });
  }

  try {
    const profile = await prisma.businessProfile.findUnique({
      where: { userId: session.user.id },
      include: {
        twilioNumbers: { where: { active: true }, select: { phoneNumber: true }, take: 1 },
      },
    });

    if (!profile || profile.twilioNumbers.length === 0) {
      return NextResponse.json({ error: "No active receptionist phone number found. Please provision one first." }, { status: 400 });
    }

    const twilioNumber = profile.twilioNumbers[0].phoneNumber;
    const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    
    const call = await twilioClient.calls.create({
      url: `${base}/api/telephony/outbound-connect?profileId=${profile.id}&customerName=${encodeURIComponent(name)}&context=${encodeURIComponent(context)}`,
      to: phone,
      from: twilioNumber,
    });

    return NextResponse.json({ success: true, callSid: call.sid });
  } catch (err: any) {
    console.error("[telephony:outbound] Failed to trigger call:", err);
    return NextResponse.json({ error: err.message || "Failed to trigger outbound call." }, { status: 500 });
  }
}
