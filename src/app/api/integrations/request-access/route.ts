import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { providerDescriptor } from "@/lib/integrations/registry";
import { sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/request-access
 * Registers interest in a gated provider (Toast, TouchBistro). These require an
 * approved partnership before any API access exists, so the only honest action
 * is to record the request and start that process off-platform.
 */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as { provider?: string };
  const descriptor = providerDescriptor(body.provider);
  if (!descriptor) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  if (descriptor.available) {
    return NextResponse.json({ error: `${descriptor.label} can be connected directly.` }, { status: 400 });
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { name: true, niche: true, user: { select: { email: true, name: true } } },
  });

  const integration = await prisma.integration.upsert({
    where: { businessProfileId_provider: { businessProfileId, provider: descriptor.key } },
    create: {
      businessProfileId,
      provider: descriptor.key,
      status: "ACCESS_PENDING",
      label: descriptor.label,
    },
    update: { status: "ACCESS_PENDING" },
  });

  const notifyTo = process.env.INTEGRATIONS_NOTIFY_EMAIL;
  if (notifyTo) {
    try {
      await sendEmail({
        to: notifyTo,
        subject: `Integration access requested: ${descriptor.label}`,
        text: [
          `Provider: ${descriptor.label} (${descriptor.key})`,
          `Business: ${profile?.name ?? "unknown"} (${profile?.niche ?? "?"})`,
          `Owner: ${profile?.user?.name ?? ""} <${profile?.user?.email ?? "?"}>`,
          `Profile id: ${businessProfileId}`,
        ].join("\n"),
      });
    } catch (err) {
      // The request is already recorded; a mail failure must not fail the call.
      console.error("[integrations] access-request email failed:", err);
    }
  }

  return NextResponse.json({ ok: true, status: integration.status });
}
