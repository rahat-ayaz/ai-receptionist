import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { runTrialReminders } from "@/lib/trial-reminders";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/trial-reminders
 *
 * Manual/ad-hoc entry point. This route is deliberately absent from
 * vercel.json — Vercel Hobby allows only two cron entries, so the sweep runs
 * as part of /api/cron/reminders. Give it its own schedule entry once the
 * plan allows a third.
 */
export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  try {
    const summary = await runTrialReminders();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[cron:trial-reminders] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 },
    );
  }
}
