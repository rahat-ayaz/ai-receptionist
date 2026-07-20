import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/integrations/square/webhook
 *
 * Receives Square event notifications so a menu edit in Square shows up in
 * CAPRO without waiting for the next scheduled sync.
 *
 * This endpoint is unauthenticated by nature — anyone can POST to it — so the
 * HMAC signature is the only thing standing between a stranger and our data.
 * Two details matter and are easy to get wrong:
 *
 *  1. Square signs `notificationUrl + rawBody`, not the body alone. The URL
 *     must match what's configured in the Square dashboard exactly.
 *  2. The comparison must be constant-time, or the key is recoverable by
 *     timing analysis.
 *
 * The handler never trusts anything in the payload beyond the merchant id used
 * to look up an existing integration, and it does no work inline: it flags the
 * integration and returns, letting the cron perform the sync.
 */
export async function POST(req: NextRequest) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    // Fail closed. Without a key we cannot tell Square apart from anyone else.
    console.error("[square/webhook] SQUARE_WEBHOOK_SIGNATURE_KEY is not set — rejecting.");
    return NextResponse.json({ error: "Webhooks are not configured" }, { status: 503 });
  }

  // Must read the raw body: re-serializing parsed JSON would change the bytes
  // and break the signature.
  const rawBody = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") ?? "";

  const notificationUrl =
    process.env.SQUARE_WEBHOOK_URL ??
    `${process.env.APP_BASE_URL ?? ""}/api/integrations/square/webhook`;

  if (!verifySignature(notificationUrl, rawBody, signature, signatureKey)) {
    console.warn("[square/webhook] rejected a notification with a bad signature.");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: {
    type?: string;
    merchant_id?: string;
    data?: { type?: string; id?: string };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const merchantId = event.merchant_id;
  if (!merchantId) return NextResponse.json({ ok: true, ignored: "no merchant_id" });

  const integration = await prisma.integration.findFirst({
    where: { provider: "square", externalAccountId: merchantId },
  });
  // An unknown merchant is not an error — it's a seller who disconnected, or a
  // notification for an app install we don't track. Acknowledge and move on, or
  // Square will retry it indefinitely.
  if (!integration) return NextResponse.json({ ok: true, ignored: "unknown merchant" });

  switch (event.type) {
    case "catalog.version.updated": {
      if (integration.catalogSyncEnabled) {
        await prisma.integration.update({
          where: { id: integration.id },
          data: { catalogSyncRequestedAt: new Date() },
        });
      }
      break;
    }

    case "oauth.authorization.revoked": {
      // The seller revoked us in Square. Reflect that immediately rather than
      // letting them discover it via failing orders.
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: "NEEDS_REAUTH",
          lastErrorAt: new Date(),
          lastErrorCode: "AUTH_REVOKED",
          lastErrorMessage: "Access was revoked in Square. Reconnect to resume syncing.",
        },
      });
      break;
    }

    default:
      // Unsubscribed event types still get a 200 — Square retries non-2xx.
      break;
  }

  return NextResponse.json({ ok: true });
}

function verifySignature(
  notificationUrl: string,
  rawBody: string,
  signature: string,
  key: string,
): boolean {
  if (!signature) return false;

  const expected = createHmac("sha256", key)
    .update(notificationUrl + rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
