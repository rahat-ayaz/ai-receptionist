import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * GET /api/calls/[id]/recording
 * Streams a call's Twilio voice recording. Twilio media URLs require HTTP Basic
 * Auth, so we proxy them server-side (keeping credentials off the client) and
 * scope access to the caller's own business profile.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/calls/[id]/recording">) {
  const { id } = await ctx.params;

  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return new NextResponse("Unauthorized", { status: 401 });

  const call = await prisma.callSession.findFirst({
    where: { id, businessProfileId },
    select: { recordingUrl: true },
  });
  if (!call?.recordingUrl) return new NextResponse("No recording", { status: 404 });

  // If the recording URL is a public/demo audio link (not hosted on Twilio), redirect directly to it
  // to avoid requiring Twilio credentials.
  if (!call.recordingUrl.includes("twilio.com")) {
    return NextResponse.redirect(call.recordingUrl);
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return new NextResponse("Telephony not configured", { status: 503 });

  // Twilio serves the audio at the recording URL + .mp3, behind Basic Auth.
  const mediaUrl = call.recordingUrl.endsWith(".mp3") ? call.recordingUrl : `${call.recordingUrl}.mp3`;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const upstream = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Recording unavailable", { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
