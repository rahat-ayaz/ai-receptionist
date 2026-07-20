import { prisma } from "@/lib/prisma";
import { openSecrets, sealSecrets } from "@/lib/crypto";
import {
  classifyHttpStatus,
  classifyThrown,
  fail,
  ok,
  type AdapterResult,
  type BookingPushInput,
  type CatalogPage,
  type ExternalCatalogItem,
  type IntegrationAdapter,
  type IntegrationContext,
} from "../types";
import type { Integration } from "@prisma/client";

// ─── Square adapter ─────────────────────────────────────────────────────────
// Square is the one self-serve POS with a full OAuth flow plus Catalog and
// Orders APIs, so it's the reference implementation for the adapter contract.
//
// Two Square-specific hazards drive the design here:
//
//  1. Refresh tokens are SINGLE USE and expire in 90 days. Every refresh
//     returns a new one that must be persisted, or the connection is dead the
//     next time we try. That makes the `refreshingAt` lock load-bearing: two
//     concurrent refreshes would each burn the token and one would lose.
//  2. Access tokens expire in 30 days. With no background worker, refresh
//     happens lazily at point of use, backed by a daily cron sweep for tenants
//     who go quiet.

export const SQUARE_API_VERSION = "2026-05-20";
const TIMEOUT_MS = 10_000;
/** Refresh this far ahead of expiry so normal traffic keeps the token alive. */
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_LOCK_MS = 60_000;

export function squareBaseUrl(): string {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export function squareCredentials(): { appId: string; appSecret: string } | null {
  const appId = process.env.SQUARE_APP_ID;
  const appSecret = process.env.SQUARE_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export interface SquareTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: string;
  merchant_id?: string;
  token_type?: string;
}

/** Exchange an authorization code, or trade a refresh token for a new pair. */
export async function squareTokenRequest(
  body: Record<string, string>,
): Promise<AdapterResult<SquareTokenResponse>> {
  const creds = squareCredentials();
  if (!creds) return fail("INVALID", "Square is not configured on this deployment.");

  let res: Response;
  try {
    res = await fetch(`${squareBaseUrl()}/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Square-Version": SQUARE_API_VERSION,
      },
      body: JSON.stringify({ client_id: creds.appId, client_secret: creds.appSecret, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: classifyHttpStatus(res.status, text.slice(0, 500)) };
  }

  try {
    return ok(JSON.parse(text) as SquareTokenResponse);
  } catch {
    return fail("UNKNOWN", "Square returned an unreadable token response.");
  }
}

/**
 * Build a context with a guaranteed-fresh access token.
 *
 * Returns null when the integration can't be used (missing credentials, a
 * rejected refresh); in that case the row has already been flipped to
 * NEEDS_REAUTH so the dashboard prompts a reconnect.
 */
export async function getSquareContext(
  integration: Integration,
  baseCtx: IntegrationContext,
): Promise<IntegrationContext | null> {
  if (!isExpiring(integration.accessTokenExpiresAt)) return baseCtx;

  // A deployment missing SQUARE_APP_ID is an operator problem, not a seller
  // problem. Flipping every tenant to NEEDS_REAUTH here would tell them to
  // reconnect — which cannot possibly help, and would churn working
  // connections the moment an env var goes missing. Leave state alone.
  if (!squareCredentials()) {
    console.error(
      `[square] cannot refresh integration ${integration.id}: SQUARE_APP_ID/SQUARE_APP_SECRET are not set.`,
    );
    return baseCtx;
  }

  if (!baseCtx.secrets.refreshToken) {
    await markNeedsReauth(integration.id, "NO_REFRESH_TOKEN", "No refresh token is stored.");
    return null;
  }

  // Claim the refresh.
  const { count } = await prisma.integration.updateMany({
    where: {
      id: integration.id,
      OR: [{ refreshingAt: null }, { refreshingAt: { lt: new Date(Date.now() - REFRESH_LOCK_MS) } }],
    },
    data: { refreshingAt: new Date() },
  });

  // Someone else holds the lock. Their result is what counts — re-read from the
  // database rather than proceeding with our stale copy. If they haven't
  // committed yet we get the previous token, which is still valid: the refresh
  // window opens a week before expiry precisely so this is safe.
  if (count === 0) {
    const current = await prisma.integration.findUnique({ where: { id: integration.id } });
    return current ? reread(current, baseCtx) : baseCtx;
  }

  try {
    // Double-checked locking. Between our expiry check and acquiring the lock,
    // another request may have refreshed and released. Square's refresh tokens
    // are single use, so refreshing again would spend an already-dead token and
    // kill the connection. Re-read and bail out if the work is already done.
    const current = await prisma.integration.findUnique({ where: { id: integration.id } });
    if (!current) return null;
    if (!isExpiring(current.accessTokenExpiresAt)) {
      return reread(current, baseCtx);
    }

    const refreshToken =
      openSecretsSafe(current)?.refreshToken ?? baseCtx.secrets.refreshToken;
    if (!refreshToken) {
      await markNeedsReauth(integration.id, "NO_REFRESH_TOKEN", "No refresh token is stored.");
      return null;
    }

    const result = await squareTokenRequest({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    if (!result.ok) {
      // A rejected refresh is terminal — only the owner can fix it.
      if (!result.error.retryable) {
        await markNeedsReauth(integration.id, "REFRESH_REJECTED", result.error.message);
        return null;
      }
      // Transient: keep the existing token and let the caller try again later.
      return baseCtx;
    }

    const next = {
      ...baseCtx.secrets,
      accessToken: result.data.access_token,
      // Square rotates the refresh token on every use — persisting the new one
      // is mandatory, not optional.
      refreshToken: result.data.refresh_token ?? refreshToken,
    };

    const sealed = sealSecrets(next, integration.businessProfileId, integration.provider);
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        ...sealed,
        accessTokenExpiresAt: result.data.expires_at ? new Date(result.data.expires_at) : null,
        status: "ACTIVE",
        lastErrorAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    return { ...baseCtx, secrets: next };
  } finally {
    await prisma.integration
      .update({ where: { id: integration.id }, data: { refreshingAt: null } })
      .catch(() => {});
  }
}

function isExpiring(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt.getTime() - Date.now() < REFRESH_WINDOW_MS;
}

/** Decrypt without throwing — callers here always have a fallback. */
function openSecretsSafe(integration: Integration): Record<string, string> | null {
  try {
    return openSecrets(integration, integration.businessProfileId, integration.provider);
  } catch {
    return null;
  }
}

/**
 * Adopt whatever another request just persisted, rather than reusing our own
 * stale (and now spent) copy of the credentials.
 */
function reread(integration: Integration, baseCtx: IntegrationContext): IntegrationContext {
  const secrets = openSecretsSafe(integration);
  return secrets ? { ...baseCtx, secrets } : baseCtx;
}

async function markNeedsReauth(id: string, code: string, message: string): Promise<void> {
  await prisma.integration
    .update({
      where: { id },
      data: {
        status: "NEEDS_REAUTH",
        lastErrorAt: new Date(),
        lastErrorCode: code,
        lastErrorMessage: message.slice(0, 2000),
      },
    })
    .catch(() => {});
}

/** Authenticated POST against the Square API. */
async function squarePost<T>(
  ctx: IntegrationContext,
  path: string,
  body: unknown,
): Promise<AdapterResult<T>> {
  const token = ctx.secrets.accessToken;
  if (!token) return fail("AUTH", "No Square access token is stored.");

  let res: Response;
  try {
    res = await fetch(`${squareBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }

  const text = await res.text();
  if (!res.ok) return { ok: false, error: classifyHttpStatus(res.status, text.slice(0, 500)) };

  try {
    return ok(JSON.parse(text) as T);
  } catch {
    return fail("UNKNOWN", "Square returned an unreadable response.");
  }
}

/** Authenticated GET against the Square API. */
async function squareGet<T>(ctx: IntegrationContext, path: string): Promise<AdapterResult<T>> {
  const token = ctx.secrets.accessToken;
  if (!token) return fail("AUTH", "No Square access token is stored.");

  let res: Response;
  try {
    res = await fetch(`${squareBaseUrl()}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_API_VERSION,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }

  const text = await res.text();
  if (!res.ok) return { ok: false, error: classifyHttpStatus(res.status, text.slice(0, 500)) };

  try {
    return ok(JSON.parse(text) as T);
  } catch {
    return fail("UNKNOWN", "Square returned an unreadable response.");
  }
}

interface MerchantResponse {
  merchant?: { id: string; business_name?: string; country?: string; currency?: string };
}

interface LocationsResponse {
  locations?: { id: string; name?: string; status?: string }[];
}

// ─── Catalog ────────────────────────────────────────────────────────────────

interface SquareMoney {
  amount?: number | string; // cents; can arrive as a string for large values
  currency?: string;
}

interface SquareCatalogObject {
  type: string;
  id: string;
  version?: number | string;
  updated_at?: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  item_data?: {
    name?: string;
    description?: string;
    categories?: { id?: string; ordinal?: number }[];
    category_id?: string; // legacy single-category field
    variations?: SquareCatalogObject[];
    image_ids?: string[];
  };
  item_variation_data?: {
    item_id?: string;
    name?: string;
    price_money?: SquareMoney;
    pricing_type?: string;
  };
  category_data?: { name?: string };
  image_data?: { url?: string };
}

interface SearchCatalogResponse {
  objects?: SquareCatalogObject[];
  related_objects?: SquareCatalogObject[];
  cursor?: string;
}

/** Square holds money in minor units; CatalogItem.price is CAD major units. */
function centsToMajor(money: SquareMoney | undefined): number | null {
  if (!money || money.amount === undefined || money.amount === null) return null;
  const cents = typeof money.amount === "string" ? Number(money.amount) : money.amount;
  if (!Number.isFinite(cents)) return null;
  return Math.round(cents) / 100;
}

/**
 * Flatten Square's ITEM → ITEM_VARIATION tree into flat CatalogItem rows.
 *
 * Square models one item with N variations, each carrying its own price;
 * CatalogItem is flat. We therefore emit one row per VARIATION and key the
 * external id on the variation. Keying on the item id instead would collapse a
 * multi-size menu ("Pizza" small/medium/large) into a single row and lose every
 * price but one.
 */
export function flattenSquareCatalog(res: SearchCatalogResponse, locationId?: string | null): ExternalCatalogItem[] {
  const categoryNames = new Map<string, string>();
  const imageUrls = new Map<string, string>();

  for (const rel of res.related_objects ?? []) {
    if (rel.type === "CATEGORY" && rel.category_data?.name) categoryNames.set(rel.id, rel.category_data.name);
    if (rel.type === "IMAGE" && rel.image_data?.url) imageUrls.set(rel.id, rel.image_data.url);
  }

  const out: ExternalCatalogItem[] = [];

  for (const obj of res.objects ?? []) {
    if (obj.type !== "ITEM" || !obj.item_data) continue;

    const item = obj.item_data;
    const itemName = (item.name ?? "").trim();
    if (!itemName) continue;

    const categoryId = item.categories?.[0]?.id ?? item.category_id;
    const category = categoryId ? (categoryNames.get(categoryId) ?? null) : null;
    const imageUrl = item.image_ids?.[0] ? (imageUrls.get(item.image_ids[0]) ?? null) : null;

    // An item present at specific locations only is inactive for this tenant if
    // it isn't offered at the location we're integrated with.
    const availableHere =
      obj.present_at_all_locations !== false ||
      !locationId ||
      (obj.present_at_location_ids ?? []).includes(locationId);

    const variations = (item.variations ?? []).filter((v) => v.type === "ITEM_VARIATION");
    const multiple = variations.length > 1;

    for (const variation of variations) {
      const vd = variation.item_variation_data;
      if (!vd) continue;

      const variationName = (vd.name ?? "").trim();
      const name = multiple && variationName ? `${itemName} — ${variationName}` : itemName;

      out.push({
        externalId: variation.id,
        // Square bumps `version` on every edit — cheap change detection so an
        // unchanged item costs no write on re-sync.
        externalVersion: variation.version != null ? String(variation.version) : null,
        name,
        description: item.description?.trim() || null,
        // VARIABLE_PRICING items are priced at the register, so we have no
        // figure to quote — null rather than a misleading 0.
        price: vd.pricing_type === "VARIABLE_PRICING" ? null : centsToMajor(vd.price_money),
        currency: vd.price_money?.currency ?? null,
        category,
        active: !obj.is_deleted && !variation.is_deleted && availableHere,
        imageUrl,
      });
    }
  }

  return out;
}

// ─── Orders ─────────────────────────────────────────────────────────────────

const toCents = (major: number) => Math.round(major * 100);

/**
 * Map our computed Canadian tax onto Square's order taxes.
 *
 * We push our own percentages rather than letting Square apply the location's
 * configured tax. The caller was already quoted a total on the phone, and the
 * ticket has to match that number — deriving it again at the Square end would
 * silently disagree whenever the two configurations drift.
 */
function buildTaxes(input: BookingPushInput): { name: string; percentage: string; scope: "ORDER" }[] {
  const { taxRates, taxRate, subtotal, province, pstName } = input;
  if (!taxRate || subtotal <= 0) return [];

  // Use the declared rates, never a percentage back-computed from the rounded
  // tax amounts — that drift is real money on the seller's tax reporting.
  // Quebec's QST is 9.975%, so trailing decimals must survive.
  const pct = (rate: number) => String(Number(rate.toFixed(4)));

  // HST provinces fold both portions into a single line.
  if (taxRates.hst > 0) {
    return [{ name: `HST (${province})`, percentage: pct(taxRates.hst), scope: "ORDER" }];
  }

  const taxes: { name: string; percentage: string; scope: "ORDER" }[] = [];
  if (taxRates.gst > 0) taxes.push({ name: "GST", percentage: pct(taxRates.gst), scope: "ORDER" });
  if (taxRates.pst > 0) {
    // QST in Quebec, RST in Manitoba, PST elsewhere — this label lands on the
    // seller's own tax reporting, so it has to be right.
    taxes.push({ name: pstName || "PST", percentage: pct(taxRates.pst), scope: "ORDER" });
  }
  return taxes;
}

interface CreateOrderResponse {
  order?: { id?: string; total_money?: SquareMoney };
}

export const squareAdapter: IntegrationAdapter = {
  provider: "square",
  capabilities: new Set(["oauth", "catalog.pull", "booking.push"]),

  async listCatalog(ctx, cursor): Promise<AdapterResult<CatalogPage>> {
    const result = await squarePost<SearchCatalogResponse>(ctx, "/v2/catalog/search", {
      object_types: ["ITEM"],
      include_related_objects: true,
      include_deleted_objects: false,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) return result;

    return ok({
      items: flattenSquareCatalog(result.data, ctx.config.locationId as string | null),
      cursor: result.data.cursor ?? null,
    });
  },

  async pushBooking(ctx, input: BookingPushInput): Promise<AdapterResult<{ externalId: string }>> {
    const locationId = ctx.config.locationId as string | null | undefined;
    if (!locationId) {
      return fail("INVALID", "No Square location is selected for this integration.");
    }
    if (input.lineItems.length === 0) {
      return fail("INVALID", "Square orders require at least one line item.");
    }

    const currency = "CAD";
    const order: Record<string, unknown> = {
      location_id: locationId,
      // Square caps reference_id at 40 chars.
      reference_id: input.reference?.slice(0, 40) ?? undefined,
      line_items: input.lineItems.map((li) => ({
        name: li.name.slice(0, 512),
        quantity: String(li.qty),
        base_price_money: { amount: toCents(li.unitPrice), currency },
        // Linking to the seller's own catalog object makes the ticket show up
        // as a real menu item rather than an ad-hoc line.
        ...(li.externalId ? { catalog_object_id: li.externalId } : {}),
      })),
      taxes: buildTaxes(input),
      ...(input.notes ? { note: input.notes.slice(0, 500) } : {}),
    };

    const result = await squarePost<CreateOrderResponse>(ctx, "/v2/orders", {
      idempotency_key: input.idempotencyKey.slice(0, 192),
      order,
    });
    if (!result.ok) return result;

    const id = result.data.order?.id;
    if (!id) return fail("UNKNOWN", "Square accepted the order but returned no id.");

    // Surface a mismatch rather than letting the kitchen and the caller
    // disagree about the price — rounding differences here are real money.
    const squareTotal = centsToMajor(result.data.order?.total_money);
    if (squareTotal !== null && Math.abs(squareTotal - input.total) > 0.02) {
      console.warn(
        `[square] order ${id} total ${squareTotal} differs from quoted ${input.total} (${input.reference}).`,
      );
    }

    return ok({ externalId: id });
  },

  async test(ctx) {
    const merchantId = (ctx.config.merchantId as string) ?? "me";
    const result = await squareGet<MerchantResponse>(ctx, `/v2/merchants/${merchantId}`);
    if (!result.ok) return result;

    const name = result.data.merchant?.business_name ?? "Square account";
    const locationName = ctx.config.locationName as string | undefined;
    return ok({ accountLabel: locationName ? `${name} — ${locationName}` : name });
  },
};

/** Fetch merchant + active locations right after the OAuth exchange. */
export async function fetchSquareAccountInfo(
  ctx: IntegrationContext,
  merchantId: string,
): Promise<{ businessName: string | null; locations: { id: string; name: string }[] }> {
  const merchant = await squareGet<MerchantResponse>(ctx, `/v2/merchants/${merchantId}`);
  const locations = await squareGet<LocationsResponse>(ctx, "/v2/locations");

  return {
    businessName: merchant.ok ? (merchant.data.merchant?.business_name ?? null) : null,
    locations: locations.ok
      ? (locations.data.locations ?? [])
          .filter((l) => l.status !== "INACTIVE")
          .map((l) => ({ id: l.id, name: l.name ?? l.id }))
      : [],
  };
}
