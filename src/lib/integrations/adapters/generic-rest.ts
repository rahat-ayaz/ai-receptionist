import { createHmac } from "node:crypto";
import {
  classifyHttpStatus,
  classifyThrown,
  fail,
  ok,
  type AdapterResult,
  type BookingPushInput,
  type IntegrationAdapter,
  type IntegrationContext,
} from "../types";

// ─── Generic REST / webhook adapter ─────────────────────────────────────────
// The universal escape hatch: any HTTPS endpoint that accepts JSON. This is
// what keeps a customer on a gated POS (Toast, TouchBistro) or an in-house
// system from being blocked on a partnership.
//
// The envelope is fixed and documented. We deliberately do NOT ship a
// field-mapping UI — that's the classic integrations tar pit. Customers who
// need a different shape put a two-line transform in their own endpoint.

const TIMEOUT_MS = 8_000;

interface GenericConfig {
  url?: string;
  method?: string;
  authType?: "none" | "bearer" | "header";
  headerName?: string;
}

function buildHeaders(
  cfg: GenericConfig,
  secrets: Record<string, string>,
  body: string,
  idempotencyKey: string,
): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": "CAPRO-Integrations/1.0",
    "idempotency-key": idempotencyKey,
  });

  const token = secrets.token ?? "";
  if (cfg.authType === "bearer" && token) {
    headers.set("authorization", `Bearer ${token}`);
  } else if (cfg.authType === "header" && token && cfg.headerName) {
    headers.set(cfg.headerName, token);
  }

  // Lets the receiver verify the payload really came from us.
  if (secrets.hmacSecret) {
    const sig = createHmac("sha256", secrets.hmacSecret).update(body).digest("hex");
    headers.set("x-capro-signature", `sha256=${sig}`);
  }

  return headers;
}

async function post(
  ctx: IntegrationContext,
  payload: unknown,
  idempotencyKey: string,
): Promise<AdapterResult<{ externalId: string }>> {
  const cfg = ctx.config as GenericConfig;

  if (!cfg.url) {
    return fail("INVALID", "No endpoint URL is configured for this integration.");
  }
  // Guard here as well as at save time — config can be edited directly in the DB.
  if (!/^https:\/\//i.test(cfg.url)) {
    return fail("INVALID", "Endpoint URL must use HTTPS.");
  }

  const body = JSON.stringify(payload);

  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: cfg.method || "POST",
      headers: buildHeaders(cfg, ctx.secrets, body, idempotencyKey),
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (err) {
    return { ok: false, error: classifyThrown(err) };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: classifyHttpStatus(res.status, text.slice(0, 500)) };
  }

  // A returned id is optional — most webhook receivers just 200.
  let externalId = "";
  try {
    const json = (await res.json()) as { id?: string; externalId?: string };
    externalId = json.externalId ?? json.id ?? "";
  } catch {
    // Empty or non-JSON 2xx body is a perfectly valid ack.
  }

  return ok({ externalId });
}

export const genericRestAdapter: IntegrationAdapter = {
  provider: "generic_rest",
  capabilities: new Set(["booking.push"]),

  async test(ctx) {
    const cfg = ctx.config as GenericConfig;
    const result = await post(
      ctx,
      { test: true, message: "CAPRO connection test", sentAt: new Date().toISOString() },
      `test-${Date.now()}`,
    );
    if (!result.ok) return result;

    let host = cfg.url ?? "endpoint";
    try {
      host = new URL(cfg.url!).host;
    } catch {
      // Fall back to the raw string; validation already ran above.
    }
    return ok({ accountLabel: host });
  },

  async pushBooking(ctx, input: BookingPushInput) {
    return post(ctx, { event: "booking.confirmed", booking: input }, input.idempotencyKey);
  },
};
