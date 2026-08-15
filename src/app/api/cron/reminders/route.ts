import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendBookingReminder } from "@/lib/bookings";
import { requireCronAuth } from "@/lib/cron-auth";
import { cronCadenceMs } from "@/lib/cron-cadence";
import { runTrialReminders } from "@/lib/trial-reminders";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

type Tier = {
  type: "24h" | "3h";
  offsetMs: number;
  sentField: "reminder24SentAt" | "reminder3SentAt";
};

/** Reminder tiers, most urgent first. */
const TIERS: Tier[] = [
  { type: "3h", offsetMs: 3 * HOUR_MS, sentField: "reminder3SentAt" },
  { type: "24h", offsetMs: 24 * HOUR_MS, sentField: "reminder24SentAt" },
];

const WIDEST_OFFSET_MS = Math.max(...TIERS.map((t) => t.offsetMs));

/**
 * GET /api/cron/reminders
 *
 * Sends booking reminders, then sweeps trial-expiry reminders. Both run from
 * this one route because Vercel Hobby allows only two cron entries and the
 * other is taken by /api/cron/integrations.
 *
 * A tier fires once the booking would come due before the next run rather
 * than at its exact offset — see cron-cadence.ts. At most one reminder goes
 * out per booking per run: when a coarse tier is still pending but a more
 * urgent one has just been sent, the coarse tier is marked superseded instead
 * of queueing a second, now-stale message.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const now = new Date();
    const cadenceMs = cronCadenceMs();
    const horizon = new Date(now.getTime() + WIDEST_OFFSET_MS + cadenceMs);

    const bookings = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        scheduledAt: { gt: now, lte: horizon },
        OR: [{ reminder24SentAt: null }, { reminder3SentAt: null }],
      },
      select: {
        id: true,
        scheduledAt: true,
        reminder24SentAt: true,
        reminder3SentAt: true,
      },
    });

    const sent: Record<Tier["type"], number> = { "24h": 0, "3h": 0 };
    let failed = 0;

    for (const booking of bookings) {
      const leadMs = booking.scheduledAt.getTime() - now.getTime();

      // Every tier coarser than a due one is due as well, so sending the most
      // urgent would burn the finer tiers on a single early message. Take the
      // coarsest instead and let each finer tier fire on the run where its own
      // moment arrives — TIERS is most-urgent-first, so that is the last entry.
      const due = TIERS.filter(
        (t) => leadMs <= t.offsetMs + cadenceMs && booking[t.sentField] === null,
      );
      if (due.length === 0) continue;
      const tier = due[due.length - 1];

      try {
        await sendBookingReminder(booking.id, tier.type);
        sent[tier.type] += 1;
      } catch (err) {
        // One tenant's misconfigured sender must not halt the sweep for
        // everyone queued behind it.
        console.error(`[cron:reminders] booking ${booking.id} (${tier.type}) failed:`, err);
        failed += 1;
        continue;
      }

      // A tier whose offset already exceeds the time left can never land where
      // it was meant to — a "24h before" notice sent 2h out is just a second
      // message. Stamp those instead of sending them.
      const stale = TIERS.filter(
        (t) => t !== tier && booking[t.sentField] === null && t.offsetMs >= leadMs,
      );
      if (stale.length) {
        const data: { reminder24SentAt?: Date; reminder3SentAt?: Date } = {};
        for (const t of stale) data[t.sentField] = now;
        await prisma.booking.update({ where: { id: booking.id }, data });
      }
    }

    // Trials are swept in the same run; a failure there must still report the
    // booking reminders that did go out.
    let trials;
    try {
      trials = await runTrialReminders(now);
    } catch (err) {
      console.error("[cron:reminders] trial sweep failed:", err);
      trials = { error: (err as Error).message };
    }

    return NextResponse.json({
      ok: true,
      processed: { reminder24: sent["24h"], reminder3: sent["3h"], failed },
      trials,
    });
  } catch (err) {
    console.error("[cron:reminders] failed to run reminders task:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 },
    );
  }
}
