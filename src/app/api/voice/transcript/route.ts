import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzeCall, type TranscriptTurn } from "@/lib/gemini";
import { createBooking, modifyBooking } from "@/lib/bookings";
import { resolveLineItems, allItems } from "@/lib/catalog-match";

export const dynamic = "force-dynamic";

/**
 * POST /api/voice/transcript   (internal — used by the voice bridge at hangup)
 * Persists the live-call transcript to its CallSession, runs the post-call
 * Gemini analysis (summary/category/spam), and meters usage.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.VOICE_BRIDGE_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = (await req.json()) as {
    callSid?: string;
    transcript?: TranscriptTurn[];
    durationSeconds?: number;
  };
  if (!body.callSid) return NextResponse.json({ error: "callSid required" }, { status: 400 });

  const session = await prisma.callSession.findUnique({
    where: { twilioCallSid: body.callSid },
    include: { businessProfile: { select: { id: true, name: true, userId: true } } },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const transcript = body.transcript ?? [];
  let analysis;
  try {
    analysis = await analyzeCall(session.businessProfile.name, transcript);
  } catch (err) {
    console.error("[voice/transcript] analysis failed:", err);
  }

  await prisma.callSession.update({
    where: { twilioCallSid: body.callSid },
    data: {
      transcript: transcript as object[],
      status: "COMPLETED",
      durationSeconds: body.durationSeconds ?? session.durationSeconds ?? 0,
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

  // Post-call automation: execute extracted booking intents
  if (analysis && !analysis.isSpam && analysis.intent) {
    const intent = analysis.intent as any;
    const profileId = session.businessProfileId;

    if (intent.action === "CREATE_BOOKING" && intent.scheduledAt) {
      try {
        // Resolve spoken item names against the catalog. Unmatched items are
        // reported rather than silently priced at $0 — see catalog-match.ts.
        const match = await resolveLineItems(profileId, intent.items || []);

        const profile = await prisma.businessProfile.findUnique({
          where: { id: profileId },
          select: { province: true }
        });

        const baseNote = intent.notes || `Created automatically from call ${body.callSid}`;

        await createBooking({
          businessProfileId: profileId,
          phone: session.callerNumber,
          type: intent.bookingType || "ORDER",
          scheduledAt: new Date(intent.scheduledAt),
          items: allItems(match),
          province: profile?.province || "ON",
          notes: match.reviewNote ? `${baseNote} — ${match.reviewNote}` : baseNote
        });

        if (match.needsReview) {
          console.warn(
            `[voice/transcript] Booking from call ${body.callSid} needs review: ${match.reviewNote}`,
          );
        }
        console.log(`[voice/transcript] Auto-created booking for call ${body.callSid}`);
      } catch (err) {
        console.error("[voice/transcript] Auto-creation failed:", err);
      }
    } else if (intent.action === "MODIFY_BOOKING") {
      try {
        // Resolve booking to edit
        let booking = null;
        if (intent.bookingReference) {
          booking = await prisma.booking.findFirst({
            where: {
              businessProfileId: profileId,
              reference: { equals: intent.bookingReference.trim().toUpperCase(), mode: "insensitive" }
            }
          });
        }
        
        // Fallback to customer's latest active/pending/confirmed booking
        if (!booking && session.customerId) {
          booking = await prisma.booking.findFirst({
            where: {
              businessProfileId: profileId,
              customerId: session.customerId,
              status: { in: ["PENDING", "CONFIRMED", "RESCHEDULED"] }
            },
            orderBy: { scheduledAt: "desc" }
          });
        }

        if (booking) {
          const patchData: any = {};
          if (intent.scheduledAt) patchData.scheduledAt = new Date(intent.scheduledAt);
          if (intent.notes) patchData.notes = intent.notes;
          
          if (intent.items && intent.items.length > 0) {
            const match = await resolveLineItems(profileId, intent.items);
            patchData.items = allItems(match);
            if (match.reviewNote) {
              patchData.notes = `${patchData.notes ?? booking.notes ?? ""} — ${match.reviewNote}`.trim();
              console.warn(
                `[voice/transcript] Modified booking ${booking.reference} needs review: ${match.reviewNote}`,
              );
            }
          }

          await modifyBooking(booking.id, profileId, patchData);
          console.log(`[voice/transcript] Auto-modified booking ${booking.reference} for call ${body.callSid}`);
        }
      } catch (err) {
        console.error("[voice/transcript] Auto-modification failed:", err);
      }
    }
  }

  if (!analysis?.isSpam) {
    await prisma.subscription.updateMany({
      where: { userId: session.businessProfile.userId },
      data: { callsUsed: { increment: 1 } },
    });
  }

  return NextResponse.json({ ok: true });
}
