import { prisma } from "@/lib/prisma";
import { nicheConfig } from "@/lib/niche";
import { buildContext, getAdapter, invoke, recordError, clearError } from "../index";
import type { ExternalCatalogItem } from "../types";
import type { Integration } from "@prisma/client";

// ─── Catalog pull (POS → CAPRO) ─────────────────────────────────────────────
// The POS is authoritative for linked items: name, price and availability are
// overwritten on every sync. Items created only in CAPRO are never touched.
//
// The failure modes here are destructive rather than merely annoying — a bad
// sync can wipe a restaurant's menu or double it — so most of the code below is
// about refusing to do damage when the provider misbehaves.

const PAGE_BATCH = 50;
const DEFAULT_DEADLINE_MS = 20_000;

export interface SyncSummary {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  ambiguous: number;
  pricesDiscarded: number;
  error?: string;
}

/** The subset of CatalogItem the POS owns. */
interface CatalogFields {
  name: string;
  description: string | null;
  price: number | null;
  category: string | null;
  active: boolean;
  imageUrl: string | null;
}

/** trim → lowercase → collapse whitespace → strip punctuation. */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[‘’'"`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function pullCatalog(
  integration: Integration,
  opts: { full?: boolean; deadlineMs?: number } = {},
): Promise<SyncSummary> {
  const { full = true, deadlineMs = DEFAULT_DEADLINE_MS } = opts;
  const startedAt = Date.now();

  const run = await prisma.integrationSyncRun.create({
    data: {
      integrationId: integration.id,
      businessProfileId: integration.businessProfileId,
      kind: "CATALOG_PULL",
      status: "RUNNING",
    },
  });

  const summary: SyncSummary = {
    runId: run.id,
    status: "FAILED",
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    ambiguous: 0,
    pricesDiscarded: 0,
  };

  const finish = async (status: SyncSummary["status"], error?: string) => {
    summary.status = status;
    summary.error = error;
    await prisma.integrationSyncRun.update({
      where: { id: run.id },
      data: {
        status,
        createdCount: summary.created,
        updatedCount: summary.updated,
        deactivatedCount: summary.deactivated,
        skippedCount: summary.skipped,
        ambiguousCount: summary.ambiguous,
        errorMessage: error?.slice(0, 2000) ?? null,
        finishedAt: new Date(),
      },
    });
    return summary;
  };

  const adapter = getAdapter(integration.provider);
  if (!adapter) return finish("FAILED", `No adapter for provider "${integration.provider}".`);

  const ctx = await buildContext(integration);
  if (!ctx) return finish("FAILED", "Credentials could not be read. Reconnect this integration.");

  const profile = await prisma.businessProfile.findUnique({
    where: { id: integration.businessProfileId },
    select: { niche: true },
  });
  // MEDICAL / DENTAL / LEGAL catalogs are people, not products. A price synced
  // onto a doctor row would flow through priceOrder and quote a patient a
  // dollar figure, so drop prices entirely for those niches.
  const expectsPrices = nicheConfig(profile?.niche).hasPrice;

  // First sync adopts by name (see adoptOrCreate); afterwards externalId is the
  // only identity we trust.
  const firstSync = integration.lastCatalogSyncAt === null;

  const seenExternalIds = new Set<string>();
  let cursor = full ? null : integration.catalogCursor;
  let pages = 0;
  let hitDeadline = false;

  try {
    for (;;) {
      const page = await invoke(adapter, "catalog.pull", (a) => a.listCatalog?.(ctx, cursor));

      if (!page.ok) {
        await recordError(integration.id, page.error.code, page.error.message);
        return finish("FAILED", page.error.message);
      }

      pages += 1;
      for (const item of page.data.items) seenExternalIds.add(item.externalId);

      for (let i = 0; i < page.data.items.length; i += PAGE_BATCH) {
        await applyBatch(
          page.data.items.slice(i, i + PAGE_BATCH),
          integration,
          { expectsPrices, firstSync },
          summary,
        );
      }

      cursor = page.data.cursor;
      if (!cursor) break;

      // Serverless functions get killed mid-run. Persist the cursor and let the
      // next tick (or click) resume rather than losing the work.
      if (Date.now() - startedAt > deadlineMs) {
        hitDeadline = true;
        break;
      }
    }
  } catch (err) {
    return finish("FAILED", (err as Error).message);
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { catalogCursor: hitDeadline ? cursor : null, lastCatalogSyncAt: new Date() },
  });

  if (hitDeadline) return finish("PARTIAL");

  // ── Deactivation ────────────────────────────────────────────────────────
  // Only on a run that reached the last page, and never on an empty result: a
  // provider returning 200-with-nothing during an outage must not wipe a live
  // menu. Requiring at least one page of items is the cheap insurance.
  if (full && seenExternalIds.size > 0) {
    summary.deactivated = await deactivateMissing(integration, seenExternalIds);
  } else if (full && seenExternalIds.size === 0 && pages > 0) {
    await recordError(
      integration.id,
      "EMPTY_CATALOG",
      "The provider returned no items. Nothing was deactivated.",
    );
    return finish("PARTIAL", "Provider returned an empty catalog — no items were deactivated.");
  }

  await clearError(integration.id).catch(() => {});
  return finish("SUCCEEDED");
}

async function applyBatch(
  items: ExternalCatalogItem[],
  integration: Integration,
  flags: { expectsPrices: boolean; firstSync: boolean },
  summary: SyncSummary,
): Promise<void> {
  if (items.length === 0) return;

  const refs = await prisma.externalRef.findMany({
    where: {
      integrationId: integration.id,
      entityType: "CATALOG_ITEM",
      externalId: { in: items.map((i) => i.externalId) },
    },
  });
  const refByExternalId = new Map(refs.map((r) => [r.externalId, r]));

  for (const item of items) {
    const price = flags.expectsPrices ? (item.price ?? null) : null;
    if (!flags.expectsPrices && item.price != null) summary.pricesDiscarded += 1;

    const data: CatalogFields = {
      name: item.name,
      description: item.description ?? null,
      price,
      category: item.category ?? null,
      active: item.active,
      imageUrl: item.imageUrl ?? null,
    };

    const ref = refByExternalId.get(item.externalId);

    if (ref) {
      // Unchanged since last sync — skip the write entirely.
      if (item.externalVersion && ref.externalVersion === item.externalVersion) {
        summary.skipped += 1;
        continue;
      }

      const result = await prisma.catalogItem.updateMany({
        where: { id: ref.localId, businessProfileId: integration.businessProfileId },
        data,
      });

      if (result.count === 0) {
        // The local row was deleted out from under the link — recreate it.
        const created = await prisma.catalogItem.create({
          data: { businessProfileId: integration.businessProfileId, ...data },
        });
        await prisma.externalRef.update({
          where: { id: ref.id },
          data: { localId: created.id, externalVersion: item.externalVersion ?? null, missingSince: null },
        });
        summary.created += 1;
        continue;
      }

      await prisma.externalRef.update({
        where: { id: ref.id },
        data: { externalVersion: item.externalVersion ?? null, missingSince: null },
      });
      summary.updated += 1;
      continue;
    }

    await adoptOrCreate(item, data, integration, flags.firstSync, summary);
  }
}

/**
 * Link an incoming item to an existing unlinked CatalogItem where we can be
 * certain of the match, otherwise create a new row.
 *
 * This matters because /api/catalog/bulk is append-only, so most tenants arrive
 * with a hand-built catalog. Without adoption, connecting a POS instantly
 * doubles every menu and the voice pipeline's substring matcher starts picking
 * arbitrarily between the twins.
 *
 * Matching is strict normalized equality and unique-match-only. Ambiguity
 * creates a new row and is reported: an unlinked duplicate is a cheap mistake
 * the owner can see and merge, whereas a wrong link silently overwrites the
 * wrong row on every subsequent sync.
 */
async function adoptOrCreate(
  item: ExternalCatalogItem,
  data: CatalogFields,
  integration: Integration,
  firstSync: boolean,
  summary: SyncSummary,
): Promise<void> {
  if (firstSync) {
    const linked = await prisma.externalRef.findMany({
      where: { integrationId: integration.id, entityType: "CATALOG_ITEM" },
      select: { localId: true },
    });
    const linkedIds = new Set(linked.map((l) => l.localId));

    const candidates = await prisma.catalogItem.findMany({
      where: { businessProfileId: integration.businessProfileId },
      select: { id: true, name: true },
    });

    const target = normalizeName(item.name);
    const matches = candidates.filter(
      (c) => !linkedIds.has(c.id) && normalizeName(c.name) === target,
    );

    if (matches.length === 1) {
      await prisma.catalogItem.updateMany({
        where: { id: matches[0].id, businessProfileId: integration.businessProfileId },
        data,
      });
      await prisma.externalRef.create({
        data: {
          integrationId: integration.id,
          businessProfileId: integration.businessProfileId,
          entityType: "CATALOG_ITEM",
          localId: matches[0].id,
          externalId: item.externalId,
          externalVersion: item.externalVersion ?? null,
        },
      });
      summary.updated += 1;
      return;
    }

    if (matches.length > 1) summary.ambiguous += 1;
  }

  const created = await prisma.catalogItem.create({
    data: { businessProfileId: integration.businessProfileId, ...data },
  });
  await prisma.externalRef.create({
    data: {
      integrationId: integration.id,
      businessProfileId: integration.businessProfileId,
      entityType: "CATALOG_ITEM",
      localId: created.id,
      externalId: item.externalId,
      externalVersion: item.externalVersion ?? null,
    },
  });
  summary.created += 1;
}

/**
 * Soft-deactivate links the provider stopped returning. Never a hard delete —
 * an item that reappears in the POS should revive rather than duplicate, and
 * historical bookings still reference these names.
 */
async function deactivateMissing(
  integration: Integration,
  seenExternalIds: Set<string>,
): Promise<number> {
  const refs = await prisma.externalRef.findMany({
    where: { integrationId: integration.id, entityType: "CATALOG_ITEM", missingSince: null },
    select: { id: true, localId: true, externalId: true },
  });

  const missing = refs.filter((r) => !seenExternalIds.has(r.externalId));
  if (missing.length === 0) return 0;

  await prisma.externalRef.updateMany({
    where: { id: { in: missing.map((m) => m.id) } },
    data: { missingSince: new Date() },
  });

  const { count } = await prisma.catalogItem.updateMany({
    where: {
      id: { in: missing.map((m) => m.localId) },
      businessProfileId: integration.businessProfileId,
    },
    data: { active: false },
  });

  return count;
}
