import { NextRequest, NextResponse } from "next/server";
import { currentProfileId } from "@/lib/tenant";
import { retryOutboxRow, drain } from "@/lib/integrations/outbox";

export const dynamic = "force-dynamic";

/** POST /api/integrations/failures — requeue a failed push and try it now. */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const requeued = await retryOutboxRow(body.id, businessProfileId);
  if (!requeued) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Give it an immediate attempt so the owner sees a result rather than
  // waiting for the next cron tick.
  const result = await drain({ ids: [body.id], deadlineMs: 8_000 });
  return NextResponse.json({ ok: true, result });
}
