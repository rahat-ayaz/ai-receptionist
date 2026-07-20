// ─── Integration adapter contract ───────────────────────────────────────────
// The provider-agnostic surface every POS / CRM / ERP connector implements.
// Kept free of Prisma and React imports so it can be consumed from server
// routes, the sync engine, and (for the type-only bits) client components.

export type Capability =
  | "oauth" // a self-serve connect flow exists
  | "catalog.pull"
  | "catalog.push" // reserved; deliberately unimplemented (see plan)
  | "booking.push"
  | "booking.cancel"
  | "customer.push"
  | "webhook.receive";

/**
 * Adapters never throw across this boundary. The outbox drainer needs to know
 * whether a failure is worth retrying, and an exception can't carry that.
 */
export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AdapterError };

export type AdapterErrorCode =
  | "UNSUPPORTED" // capability not declared — never retry
  | "AUTH" // 401/403 → flip to NEEDS_REAUTH, never retry
  | "RATE_LIMIT" // 429 → retry, honour retryAfterMs
  | "INVALID" // 4xx from a bad payload → never retry, show the owner
  | "TRANSIENT" // 5xx / network / timeout → retry
  | "UNKNOWN";

export interface AdapterError {
  code: AdapterErrorCode;
  retryable: boolean;
  message: string;
  httpStatus?: number;
  retryAfterMs?: number;
  /** Logged server-side only. Never returned to a client. */
  raw?: unknown;
}

export const ok = <T>(data: T): AdapterResult<T> => ({ ok: true, data });

export const fail = <T>(
  code: AdapterErrorCode,
  message: string,
  extra: Omit<Partial<AdapterError>, "code" | "message"> = {},
): AdapterResult<T> => ({
  ok: false,
  error: {
    code,
    message,
    // TRANSIENT and RATE_LIMIT are the only inherently retryable classes.
    retryable: extra.retryable ?? (code === "TRANSIENT" || code === "RATE_LIMIT"),
    ...extra,
  },
});

/**
 * A normalized catalog row. `price` is in CAD major units and maps 1:1 onto
 * CatalogItem.price — currency conversion belongs in the adapter, never the
 * sync engine. `null` means genuinely unpriced.
 */
export interface ExternalCatalogItem {
  externalId: string;
  externalVersion?: string | null;
  name: string;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  category?: string | null;
  active: boolean;
  imageUrl?: string | null;
}

export interface CatalogPage {
  items: ExternalCatalogItem[];
  /** null signals the last page. */
  cursor: string | null;
}

export interface BookingPushLineItem {
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Resolved from ExternalRef at enqueue time; null for CAPRO-only items. */
  externalId: string | null;
}

/**
 * The envelope handed to every provider. Carries the full tax breakdown so a
 * provider can reconstruct the exact total the caller was quoted on the phone
 * rather than re-deriving it from its own tax configuration.
 */
export interface BookingPushInput {
  bookingId: string;
  reference: string | null;
  type: "ORDER" | "APPOINTMENT";
  scheduledAt: string; // ISO 8601
  customer: { name: string | null; phone: string; email: string | null };
  lineItems: BookingPushLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  taxLabel: string;
  /** Combined effective rate (%). */
  taxRate: number;
  /** Component tax amounts in CAD. */
  taxBreakdown: { gst: number; pst: number; hst: number };
  /**
   * Component tax rates (%). Providers restating our tax must use these rather
   * than deriving a percentage from the cent-rounded amounts above.
   */
  taxRates: { gst: number; pst: number; hst: number };
  /** "PST" | "RST" | "QST" — the provincial component's proper name. */
  pstName: string;
  province: string;
  notes: string | null;
  idempotencyKey: string;
}

export interface IntegrationContext {
  integrationId: string;
  businessProfileId: string;
  provider: string;
  config: Record<string, unknown>;
  /** Decrypted, in-memory only. Never persisted or logged from here. */
  secrets: Record<string, string>;
  /** Adapters call this after refreshing a token; the engine persists it. */
  persistSecrets(next: Record<string, string>, expiresAt?: Date | null): Promise<void>;
}

export interface IntegrationAdapter {
  readonly provider: string;
  readonly capabilities: ReadonlySet<Capability>;

  /** Cheap auth probe backing the "Test connection" button. */
  test(ctx: IntegrationContext): Promise<AdapterResult<{ accountLabel: string }>>;

  listCatalog?(
    ctx: IntegrationContext,
    cursor: string | null,
  ): Promise<AdapterResult<CatalogPage>>;

  pushBooking?(
    ctx: IntegrationContext,
    input: BookingPushInput,
  ): Promise<AdapterResult<{ externalId: string }>>;

  cancelBooking?(
    ctx: IntegrationContext,
    externalId: string,
  ): Promise<AdapterResult<void>>;

  verifyWebhook?(rawBody: string, headers: Headers, ctx: IntegrationContext): boolean;
}

/**
 * Map an HTTP status onto the error taxonomy. Shared by every HTTP-based
 * adapter so retry behaviour stays consistent across providers.
 */
export function classifyHttpStatus(status: number, body?: string): AdapterError {
  if (status === 401 || status === 403) {
    return { code: "AUTH", retryable: false, message: "Authorization rejected by provider.", httpStatus: status };
  }
  if (status === 429) {
    return { code: "RATE_LIMIT", retryable: true, message: "Rate limited by provider.", httpStatus: status };
  }
  if (status === 408 || status >= 500) {
    return { code: "TRANSIENT", retryable: true, message: `Provider returned ${status}.`, httpStatus: status };
  }
  if (status >= 400) {
    return {
      code: "INVALID",
      retryable: false,
      message: `Provider rejected the request (${status}).`,
      httpStatus: status,
      raw: body,
    };
  }
  return { code: "UNKNOWN", retryable: false, message: `Unexpected status ${status}.`, httpStatus: status };
}

/** Network-level failures: DNS, connection reset, AbortSignal timeout. */
export function classifyThrown(err: unknown): AdapterError {
  const name = (err as Error)?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") {
    return { code: "TRANSIENT", retryable: true, message: "Provider request timed out." };
  }
  return {
    code: "TRANSIENT",
    retryable: true,
    message: `Could not reach provider: ${(err as Error)?.message ?? "unknown error"}`,
    raw: err,
  };
}
