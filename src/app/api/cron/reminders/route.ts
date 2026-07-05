import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBookingReminder } from "@/lib/bookings";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/reminders
 * Trigger booking reminders:
 * - 24 hours before scheduled time (reminder24SentAt is null)
 * - 3 hours before scheduled time (reminder3SentAt is null)
 */
export async function GET(req: NextRequest) {
  try {
    const now = new Date();

    // 1) Find bookings happening in the next 24 hours that haven't received the 24h reminder
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const bookings24 = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        scheduledAt: {
          gt: now,
          lte: tomorrow,
        },
        reminder24SentAt: null,
      },
    });

    let sent24 = 0;
    for (const b of bookings24) {
      await sendBookingReminder(b.id, "24h");
      sent24++;
    }

    // 2) Find bookings happening in the next 3 hours that haven't received the 3h reminder
    const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const bookings3 = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        scheduledAt: {
          gt: now,
          lte: threeHoursFromNow,
        },
        reminder3SentAt: null,
      },
    });

    let sent3 = 0;
    for (const b of bookings3) {
      await sendBookingReminder(b.id, "3h");
      sent3++;
    }

    return NextResponse.json({
      ok: true,
      processed: {
        reminder24: sent24,
        reminder3: sent3,
      },
    });
  } catch (err: any) {
    console.error("[cron:reminders] failed to run reminders task:", err);
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
