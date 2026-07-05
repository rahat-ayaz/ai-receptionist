import { NextRequest, NextResponse } from "next/server";
import { currentProfileId } from "@/lib/tenant";
import { modifyBooking, sendBookingConfirmation } from "@/lib/bookings";
import type { BookingStatus } from "@prisma/client";
import type { LineItemInput } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/bookings/[id]
 * Body either { action: "confirm" } to send confirmation + mark CONFIRMED,
 * or a modify patch { status?, scheduledAt?, items?, province?, notes? }
 * (covers reschedule / cancel / edit).
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/bookings/[id]">) {
  const { id } = await ctx.params;
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as {
    action?: "confirm";
    status?: BookingStatus;
    scheduledAt?: string;
    items?: LineItemInput[];
    province?: string;
    notes?: string;
  };

  if (body.action === "confirm") {
    const booking = await sendBookingConfirmation(id, businessProfileId);
    if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ booking });
  }

  const booking = await modifyBooking(id, businessProfileId, {
    status: body.status,
    scheduledAt: body.scheduledAt,
    items: body.items,
    province: body.province,
    notes: body.notes,
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Send email and SMS notifications with the updated booking details
  const updatedBooking = await sendBookingConfirmation(id, businessProfileId, true);

  return NextResponse.json({ booking: updatedBooking || booking });
}
