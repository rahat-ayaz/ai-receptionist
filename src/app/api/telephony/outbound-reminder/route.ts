import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRejectTwiML } from "@/lib/twilio";
import { formatBookingMessage } from "@/lib/bookings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bookingId = searchParams.get("bookingId");

  if (!bookingId) {
    return new NextResponse("<Response><Hangup/></Response>", { headers: { "Content-Type": "text/xml" } });
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      businessProfile: { include: { agentSettings: true } },
    },
  });

  if (!booking) {
    return new NextResponse("<Response><Hangup/></Response>", { headers: { "Content-Type": "text/xml" } });
  }

  const bp = booking.businessProfile;
  const settings = bp.agentSettings;
  const message = formatBookingMessage(booking, bp.name, "reminder");

  const twiml = buildRejectTwiML(
    `Hello. This is a reminder call from ${bp.name}. ${message} Goodbye.`,
    settings?.voiceId,
    settings?.voiceSpeed
  );

  return new NextResponse(twiml, { headers: { "Content-Type": "text/xml" } });
}
