import { NextRequest, NextResponse } from "next/server";

// ─── Cron authentication ────────────────────────────────────────────────────
// The cron routes send SMS, email, and place outbound Twilio voice calls, so an
// unauthenticated GET is a direct cost and abuse vector. Every /api/cron/* route
// must gate on this.

/**
 * Returns a 401 response when the request is not an authorized cron invocation,
 * or `null` when it may proceed.
 *
 * Accepts either `Authorization: Bearer $CRON_SECRET` (external schedulers,
 * curl, GitHub Actions) or Vercel's own `x-vercel-cron` header, which Vercel
 * sets on platform-scheduled invocations and strips from external traffic.
 */
export function requireCronAuth(req: NextRequest): NextResponse | null {
  if (req.headers.get("x-vercel-cron")) return null;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed. An unset secret must not silently re-open the endpoint.
    console.error("[cron-auth] CRON_SECRET is not set — refusing the request.");
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !timingSafeEqual(token, secret)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  return null;
}

/** Constant-time string compare, so the secret can't be probed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
