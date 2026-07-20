import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { isCryptoConfigured, sealSecrets } from "@/lib/crypto";
import { PROVIDER_LIST, providerDescriptor } from "@/lib/integrations/registry";
import type { Integration } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * Hand-built projection. Never spread the row — `secretsCipher` and friends
 * must not leave the server, and a `...integration` would ship them the first
 * time someone adds a field.
 */
function present(i: Integration) {
  const config = (i.config as Record<string, unknown>) ?? {};
  return {
    id: i.id,
    provider: i.provider,
    status: i.status,
    label: i.label,
    externalAccountId: i.externalAccountId,
    config,
    hasCredentials: Boolean(i.secretsCipher),
    catalogSyncEnabled: i.catalogSyncEnabled,
    bookingPushEnabled: i.bookingPushEnabled,
    lastCatalogSyncAt: i.lastCatalogSyncAt,
    lastBookingPushAt: i.lastBookingPushAt,
    lastErrorAt: i.lastErrorAt,
    lastErrorCode: i.lastErrorCode,
    lastErrorMessage: i.lastErrorMessage,
    createdAt: i.createdAt,
  };
}

export async function GET() {
  try {
    const businessProfileId = await currentProfileId();
    if (!businessProfileId) {
      return NextResponse.json({ integrations: [], providers: PROVIDER_LIST, failures: [] });
    }

    const [integrations, failures] = await Promise.all([
      prisma.integration.findMany({ where: { businessProfileId }, orderBy: { createdAt: "asc" } }),
      prisma.integrationOutbox.findMany({
        where: { businessProfileId, status: { in: ["FAILED", "DEAD"] } },
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: {
          id: true,
          kind: true,
          entityId: true,
          status: true,
          attempts: true,
          lastErrorCode: true,
          lastErrorMessage: true,
          updatedAt: true,
          integration: { select: { provider: true } },
        },
      }),
    ]);

    // Attach the booking reference so the failure list is human-readable.
    const bookingIds = failures.map((f) => f.entityId);
    const bookings = bookingIds.length
      ? await prisma.booking.findMany({
          where: { id: { in: bookingIds }, businessProfileId },
          select: { id: true, reference: true, total: true },
        })
      : [];
    const byId = new Map(bookings.map((b) => [b.id, b]));

    return NextResponse.json({
      integrations: integrations.map(present),
      providers: PROVIDER_LIST,
      configured: isCryptoConfigured(),
      failures: failures.map((f) => ({
        id: f.id,
        kind: f.kind,
        status: f.status,
        attempts: f.attempts,
        provider: f.integration.provider,
        errorCode: f.lastErrorCode,
        errorMessage: f.lastErrorMessage,
        updatedAt: f.updatedAt,
        reference: byId.get(f.entityId)?.reference ?? null,
        total: byId.get(f.entityId)?.total ?? null,
      })),
    });
  } catch (err) {
    console.error("[integrations] list failed:", err);
    return NextResponse.json({ integrations: [], providers: PROVIDER_LIST, failures: [] });
  }
}

/** Create or update a form-configured integration (Generic REST today). */
export async function POST(req: NextRequest) {
  const businessProfileId = await currentProfileId();
  if (!businessProfileId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as { provider?: string; values?: Record<string, string> };
  const descriptor = providerDescriptor(body.provider);

  if (!descriptor) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  if (!descriptor.available) {
    return NextResponse.json({ error: `${descriptor.label} is not available yet.` }, { status: 400 });
  }
  if (descriptor.connectMode !== "form") {
    return NextResponse.json(
      { error: `${descriptor.label} is connected through its own authorization flow.` },
      { status: 400 },
    );
  }
  if (!isCryptoConfigured()) {
    return NextResponse.json(
      { error: "Integrations are not configured on this deployment." },
      { status: 503 },
    );
  }

  const values = body.values ?? {};

  // Split declared fields into plaintext config and the encrypted bundle.
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const field of descriptor.fields ?? []) {
    const raw = (values[field.key] ?? "").trim();
    if (field.required && !raw) {
      return NextResponse.json({ error: `${field.label} is required` }, { status: 400 });
    }
    if (!raw) continue;
    if (field.secret) secrets[field.key] = raw;
    else config[field.key] = raw;
  }

  if (config.url && !/^https:\/\//i.test(config.url)) {
    return NextResponse.json({ error: "Endpoint URL must use HTTPS." }, { status: 400 });
  }
  if (config.authType === "header" && !config.headerName) {
    return NextResponse.json(
      { error: 'Header name is required when authentication is "header".' },
      { status: 400 },
    );
  }

  const sealed = Object.keys(secrets).length
    ? sealSecrets(secrets, businessProfileId, descriptor.key)
    : { secretsCipher: null, secretsIv: null, secretsTag: null, secretsKeyVer: null };

  const integration = await prisma.integration.upsert({
    where: { businessProfileId_provider: { businessProfileId, provider: descriptor.key } },
    create: {
      businessProfileId,
      provider: descriptor.key,
      status: "ACTIVE",
      label: descriptor.label,
      externalAccountId: safeHost(config.url),
      config,
      ...sealed,
    },
    update: {
      status: "ACTIVE",
      externalAccountId: safeHost(config.url),
      config,
      ...sealed,
      lastErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return NextResponse.json({ integration: present(integration) });
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
