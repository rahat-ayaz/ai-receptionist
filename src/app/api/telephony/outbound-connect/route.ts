import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrCreateCustomer } from "@/lib/bookings";
import { buildStreamTwiML, buildRejectTwiML } from "@/lib/twilio";
import twilio from "twilio";

export const dynamic = "force-dynamic";

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

function twiml(xml: string) {
  return new Response(xml, {
    headers: { "Content-Type": "application/xml" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.formData();
    const callSid = data.get("CallSid") as string;
    const toNumber = data.get("To") as string;

    const { searchParams } = req.nextUrl;
    const profileId = searchParams.get("profileId");
    const customerName = searchParams.get("customerName") || "";
    const customContext = searchParams.get("context") || "";

    if (!profileId || !callSid) {
      return twiml(buildRejectTwiML("Invalid outbound connection request. Goodbye."));
    }

    const profile = await prisma.businessProfile.findUnique({
      where: { id: profileId },
      include: { agentSettings: true },
    });

    if (!profile) {
      return twiml(buildRejectTwiML("Business profile not found. Goodbye."));
    }

    const settings = profile.agentSettings;
    
    // Set greeting. If there's specific custom context instructions, prefix/include it.
    let greeting = settings?.greetingMessage || `Hello, I am calling from ${profile.name} to assist you. How can I help you today?`;
    if (customContext) {
      greeting = `Hello, I'm calling from ${profile.name} on behalf of the receptionist regarding your request. How can I help you today?`;
    }

    // Resolve or create customer profile
    const customer = await getOrCreateCustomer(profile.id, toNumber || "unknown");
    if (customerName && !customer.name) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { name: customerName },
      });
    }

    // Record Outbound Call Session
    await prisma.callSession.upsert({
      where: { twilioCallSid: callSid },
      create: {
        businessProfileId: profile.id,
        twilioCallSid: callSid,
        callerNumber: toNumber || "unknown",
        customerId: customer.id,
        direction: "OUTBOUND",
        status: "IN_PROGRESS",
        customContext: customContext || null,
        transcript: [{ role: "agent", text: greeting, at: new Date().toISOString() }],
      },
      update: {},
    });

    if (settings?.recordCalls && twilioClient) {
      const base = (process.env.BETTER_AUTH_URL || process.env.APP_BASE_URL || "https://ai-receptionist-rho-three.vercel.app").replace(/\/$/, "");
      void twilioClient.calls(callSid).recordings.create({
        recordingStatusCallback: `${base}/api/telephony/recording`,
        trim: "trim-silence",
      }).catch((e) => console.error("[telephony:outbound-connect] Failed to start recording:", e));
    }

    const wss = process.env.PUBLIC_WSS_URL;
    if (wss) {
      return twiml(
        buildStreamTwiML(wss, {
          businessProfileId: profile.id,
          callSid,
          callerNumber: toNumber || "unknown",
        }),
      );
    }

    return twiml(buildRejectTwiML("Voice connection bridge unavailable. Goodbye."));
  } catch (err: any) {
    console.error("[telephony:outbound-connect] failed:", err);
    return twiml(buildRejectTwiML("An error occurred during connection. Goodbye."));
  }
}
