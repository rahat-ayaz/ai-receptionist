import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { computeTax } from "@/lib/tax";
import { nicheConfig } from "@/lib/niche";
import { buildContext, getAdapter, invoke, recordError, clearError } from "./index";
import type { BookingPushInput, BookingPushLineItem } from "./types";
import type { Booking, Integration } from "@prisma/client";

// ─── Outbox: durable, retryable push queue ──────────────────────────────────
// This repo has no job queue, no worker, and no retry primitive. POS APIs fail
// intermittently and serverless functions get frozen the moment a response is
// returned, so "fire and forget after responding" silently loses work. The
// outbox is a database table drained by cron, with an inline best-effort first
// attempt so the happy path still feels instant.

/** Backoff schedule by attempt number. Exhausted → DEAD. */
const BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000, 21_600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
/** A serverless function killed mid-push leaves an IN_FLIGHT row behind. */
const STUCK_AFTER_MS = 5 * 60_000;
const INLINE_ATTEMPT_MS = 2_500;

type PushKind = "BOOKING_CREATE" | "BOOKING_UPDATE" | "BOOKING_CANCEL";

interface StoredLineItem {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * A revision that changes only when the order materially changes.
 *
 * Deliberately NOT `updatedAt`: sendBookingConfirmation writes to the booking
 * (confirmationSentAt), so every confirm bumps the timestamp and a re-confirm
 * would mint a fresh key and push a duplicate order. Hashing the fields a POS
 * actually cares about means a repeat confirm collapses to a no-op, while a
 * genuine reschedule or item edit correctly produces a new push.
 */
function revisionOf(booking: Booking): string {
  const material = JSON.stringify({
    status: booking.status,
    scheduledAt: booking.scheduledAt.toISOString(),
    lineItems: booking.lineItems,
    total: booking.total,
    taxAmount: booking.taxAmount,
    notes: booking.notes,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function backoffFor(attempts: number): number {
  const base = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
  // ±20% jitter so a provider outage doesn't produce a synchronized retry storm.
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * Build the provider-agnostic envelope, resolving each line item to its
 * external id where the catalog is linked. The payload is snapshotted at
 * enqueue time so a later catalog change can't rewrite an in-flight order.
 */
async function buildPayload(
  booking: Booking & { customer: { name: string | null; phone: string; email: string | null } },
  integrationId: string,
  idempotencyKey: string,
): Promise<BookingPushInput> {
  const stored = (booking.lineItems as unknown as StoredLineItem[]) ?? [];

  // One query for every link, keyed by local catalog id. Line items carry names
  // rather than ids, so match by name against the tenant's active catalog.
  const names = stored.map((i) => i.name);
  const catalogItems = names.length
    ? await prisma.catalogItem.findMany({
        where: { businessProfileId: booking.businessProfileId, name: { in: names } },
        select: { id: true, name: true },
      })
    : [];

  const refs = catalogItems.length
    ? await prisma.externalRef.findMany({
        where: {
          integrationId,
          entityType: "CATALOG_ITEM",
          localId: { in: catalogItems.map((c) => c.id) },
        },
        select: { localId: true, externalId: true },
      })
    : [];

  const externalByLocalId = new Map(refs.map((r) => [r.localId, r.externalId]));
  const externalByName = new Map(
    catalogItems
      .map((c) => [c.name, externalByLocalId.get(c.id) ?? null] as const)
      .filter(([, ext]) => ext !== null),
  );

  const lineItems: BookingPushLineItem[] = stored.map((i) => ({
    name: i.name,
    qty: i.qty,
    unitPrice: i.unitPrice,
    lineTotal: i.lineTotal,
    externalId: externalByName.get(i.name) ?? null,
  }));

  const tax = computeTax(booking.province, booking.subtotal);

  return {
    bookingId: booking.id,
    reference: booking.reference,
    type: booking.type === "ORDER" ? "ORDER" : "APPOINTMENT",
    scheduledAt: booking.scheduledAt.toISOString(),
    customer: {
      name: booking.customer.name,
      phone: booking.customer.phone,
      email: booking.customer.email,
    },
    lineItems,
    subtotal: booking.subtotal,
    taxAmount: booking.taxAmount,
    total: booking.total,
    taxLabel: booking.taxLabel,
    taxRate: tax.rate,
    taxBreakdown: tax.breakdown,
    taxRates: tax.rates,
    pstName: tax.pstName,
    province: booking.province,
    notes: booking.notes,
    idempotencyKey,
  };
}

/**
 * Queue a confirmed booking for delivery to every eligible integration, then
 * make one inline attempt so the common case lands before the HTTP response.
 *
 * Called from sendBookingConfirmation. Never throws — a queueing problem must
 * not break the confirmation flow.
 */
export async function enqueueBookingPush(
  booking: Booking,
  businessProfileId: string,
  isUpdate = false,
): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: { businessProfileId, status: "ACTIVE", bookingPushEnabled: true },
  });
  if (integrations.length === 0) return;

  const eligible = integrations.filter((i) => {
    const adapter = getAdapter(i.provider);
    return adapter?.capabilities.has("booking.push");
  });
  if (eligible.length === 0) return;

  const full = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: { customer: { select: { name: true, phone: true, email: true } } },
  });
  if (!full) return;

  const kind: PushKind =
    full.status === "CANCELLED" ? "BOOKING_CANCEL" : isUpdate ? "BOOKING_UPDATE" : "BOOKING_CREATE";

  // Guard the known $0 hazard: the voice pipeline prices unmatched items at
  // zero, and a $0 ticket on a live kitchen printer is worse than no ticket.
  const profile = await prisma.businessProfile.findUnique({
    where: { id: businessProfileId },
    select: { niche: true },
  });
  const expectsPrices = nicheConfig(profile?.niche).hasPrice;
  const stored = (full.lineItems as unknown as StoredLineItem[]) ?? [];
  const hasUnpriced = expectsPrices && stored.some((i) => !i.unitPrice || i.unitPrice <= 0);

  const createdIds: string[] = [];

  for (const integration of eligible) {
    const idempotencyKey = `${full.id}:${kind}:${revisionOf(full)}:${integration.id}`;
    try {
      const payload = await buildPayload(full, integration.id, idempotencyKey);
      const row = await prisma.integrationOutbox.create({
        data: {
          integrationId: integration.id,
          businessProfileId,
          kind,
          entityId: full.id,
          idempotencyKey,
          payload: payload as unknown as object,
          // Held rather than sent — the owner has to review the zero-priced items.
          status: hasUnpriced ? "FAILED" : "PENDING",
          ...(hasUnpriced
            ? {
                lastErrorCode: "UNPRICED_ITEMS",
                lastErrorMessage:
                  "One or more items have no price. Review the order before sending it to your POS.",
              }
            : {}),
        },
      });
      if (!hasUnpriced) createdIds.push(row.id);
    } catch (err) {
      // P2002 on idempotencyKey — a duplicate confirm. Collapsing to one push
      // is exactly the intent, so this is a silent no-op.
      if ((err as { code?: string }).code === "P2002") continue;
      console.error(`[outbox] enqueue failed for booking ${full.id}:`, err);
    }
  }

  if (createdIds.length === 0) return;

  // Best-effort inline delivery. Bounded, and never fatal — anything slower or
  // failing is already durably queued for the cron drain.
  try {
    await Promise.race([
      drain({ ids: createdIds }),
      new Promise((resolve) => setTimeout(resolve, INLINE_ATTEMPT_MS)),
    ]);
  } catch (err) {
    console.error("[outbox] inline attempt failed:", err);
  }
}

export interface DrainResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  dead: number;
}

/**
 * Process due outbox rows. Safe to run concurrently — each row is claimed with
 * a conditional update, the same count-as-lock idiom used across this codebase.
 */
export async function drain(
  opts: { limit?: number; ids?: string[]; deadlineMs?: number } = {},
): Promise<DrainResult> {
  const { limit = 25, ids, deadlineMs = 25_000 } = opts;
  const startedAt = Date.now();
  const result: DrainResult = { claimed: 0, succeeded: 0, failed: 0, retried: 0, dead: 0 };

  // Recover rows abandoned by a frozen or killed function instance.
  await prisma.integrationOutbox.updateMany({
    where: { status: "IN_FLIGHT", claimedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: "PENDING" },
  });

  const due = await prisma.integrationOutbox.findMany({
    where: ids
      ? { id: { in: ids }, status: "PENDING" }
      : { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    include: { integration: true },
  });

  for (const row of due) {
    if (Date.now() - startedAt > deadlineMs) break;

    // Claim it. count === 0 means another tick got there first.
    const { count } = await prisma.integrationOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "IN_FLIGHT", claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 0) continue;
    result.claimed += 1;

    const attempts = row.attempts + 1;
    await deliver(row.id, row.integration, row.payload as unknown as BookingPushInput, attempts, result);
  }

  return result;
}

async function deliver(
  rowId: string,
  integration: Integration,
  payload: BookingPushInput,
  attempts: number,
  result: DrainResult,
): Promise<void> {
  const adapter = getAdapter(integration.provider);
  if (!adapter) {
    await terminal(rowId, "FAILED", "UNSUPPORTED", `No adapter for provider "${integration.provider}".`);
    result.failed += 1;
    return;
  }

  const ctx = await buildContext(integration);
  if (!ctx) {
    // buildContext already flipped the integration to NEEDS_REAUTH.
    await terminal(rowId, "FAILED", "DECRYPT_FAILED", "Integration credentials could not be read. Reconnect it.");
    result.failed += 1;
    return;
  }

  const outcome = await invoke(adapter, "booking.push", (a) => a.pushBooking?.(ctx, payload));

  if (outcome.ok) {
    await prisma.integrationOutbox.update({
      where: { id: rowId },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        resultExternalId: outcome.data.externalId || null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    // Record the link so a later cancel/update can address the remote order.
    if (outcome.data.externalId) {
      await prisma.externalRef
        .upsert({
          where: {
            integrationId_entityType_localId: {
              integrationId: integration.id,
              entityType: "BOOKING",
              localId: payload.bookingId,
            },
          },
          create: {
            integrationId: integration.id,
            businessProfileId: integration.businessProfileId,
            entityType: "BOOKING",
            localId: payload.bookingId,
            externalId: outcome.data.externalId,
          },
          update: { externalId: outcome.data.externalId, missingSince: null },
        })
        .catch((err) => console.error("[outbox] externalRef upsert failed:", err));
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: { lastBookingPushAt: new Date() },
    });
    await clearError(integration.id).catch(() => {});
    result.succeeded += 1;
    return;
  }

  const { code, message, retryable, retryAfterMs } = outcome.error;
  await recordError(integration.id, code, message).catch(() => {});

  if (!retryable) {
    await terminal(rowId, "FAILED", code, message);
    result.failed += 1;
    return;
  }

  if (attempts >= MAX_ATTEMPTS) {
    await terminal(rowId, "DEAD", code, message);
    result.dead += 1;
    return;
  }

  const delay = Math.max(backoffFor(attempts), retryAfterMs ?? 0);
  await prisma.integrationOutbox.update({
    where: { id: rowId },
    data: {
      status: "PENDING",
      nextAttemptAt: new Date(Date.now() + delay),
      claimedAt: null,
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 2000),
    },
  });
  result.retried += 1;
}

async function terminal(
  rowId: string,
  status: "FAILED" | "DEAD",
  code: string,
  message: string,
): Promise<void> {
  await prisma.integrationOutbox.update({
    where: { id: rowId },
    data: {
      status,
      completedAt: new Date(),
      lastErrorCode: code,
      lastErrorMessage: message.slice(0, 2000),
    },
  });
}

/** Reset a terminal row so the owner can retry it from the dashboard. */
export async function retryOutboxRow(id: string, businessProfileId: string): Promise<boolean> {
  const { count } = await prisma.integrationOutbox.updateMany({
    where: { id, businessProfileId, status: { in: ["FAILED", "DEAD"] } },
    data: {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: new Date(),
      claimedAt: null,
      completedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  return count > 0;
}
