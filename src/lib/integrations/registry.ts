import type { Capability } from "./types";

// ─── Provider registry ──────────────────────────────────────────────────────
// Metadata for every POS / CRM / ERP we list in the dashboard, including the
// ones we can't yet talk to. Kept free of React imports (same rule as
// src/lib/niche.ts) so it can be imported from API routes, the sync engine, and
// client components alike; `iconKey` is mapped to a lucide component at the UI
// layer.
//
// `available: false` providers render as honest disabled cards. That is a
// deliberate product choice — the access constraints below are commercial, not
// technical, so the code can't unblock them:
//
//   Toast       — requires an integration partner application plus signing the
//                 API Documentation License Agreement before docs are issued.
//   TouchBistro — API is private, keys are issued case-by-case under commercial
//                 terms, historically with a months-long partner queue.
//   Clover      — self-serve, buildable; not yet implemented.
//   Lightspeed  — partner registration required; not yet implemented.
//   Odoo        — self-serve (JSON-RPC + API key); not yet implemented.

export type ConnectMode = "oauth" | "form" | "request_access";

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "url" | "secret" | "select";
  options?: string[];
  required: boolean;
  placeholder?: string;
  help?: string;
  /** Stored in the encrypted bundle rather than plaintext `config`. */
  secret?: boolean;
}

export interface ProviderDescriptor {
  key: string;
  label: string;
  blurb: string;
  iconKey: string;
  capabilities: Capability[];
  connectMode: ConnectMode;
  /** false → dimmed, non-connectable card. */
  available: boolean;
  /** Shown on unavailable cards to explain why. */
  unavailableReason?: string;
  fields?: ProviderField[];
  docsUrl?: string;
}

export const PROVIDERS: Record<string, ProviderDescriptor> = {
  square: {
    key: "square",
    label: "Square",
    blurb:
      "Sync your Square catalog into CAPRO and send confirmed orders straight to Square as real tickets.",
    iconKey: "square",
    capabilities: ["oauth", "catalog.pull", "booking.push", "webhook.receive"],
    connectMode: "oauth",
    available: true,
    docsUrl: "https://developer.squareup.com/docs",
  },

  generic_rest: {
    key: "generic_rest",
    label: "Custom webhook / REST",
    blurb:
      "Send every confirmed booking to any HTTPS endpoint as JSON. Use this for in-house systems, Zapier/Make, or a POS we don't support directly yet.",
    iconKey: "webhook",
    capabilities: ["booking.push"],
    connectMode: "form",
    available: true,
    fields: [
      {
        key: "url",
        label: "Endpoint URL",
        type: "url",
        required: true,
        placeholder: "https://example.com/hooks/capro",
        help: "Must be HTTPS. Receives a POST with the booking envelope.",
      },
      {
        key: "authType",
        label: "Authentication",
        type: "select",
        options: ["none", "bearer", "header"],
        required: true,
      },
      {
        key: "headerName",
        label: "Header name",
        type: "text",
        required: false,
        placeholder: "X-Api-Key",
        help: 'Only used when authentication is "header".',
      },
      {
        key: "token",
        label: "Token / API key",
        type: "secret",
        required: false,
        secret: true,
      },
      {
        key: "hmacSecret",
        label: "Signing secret (optional)",
        type: "secret",
        required: false,
        secret: true,
        help: "When set, requests carry X-CAPRO-Signature: sha256=<hmac of the raw body>.",
      },
    ],
  },

  toast: {
    key: "toast",
    label: "Toast",
    blurb: "Push confirmed orders into Toast POS and keep your menu in sync.",
    iconKey: "toast",
    capabilities: ["catalog.pull", "booking.push"],
    connectMode: "request_access",
    available: false,
    unavailableReason:
      "Toast requires an approved integration partnership before API access is granted. Request access and we'll start that process.",
    docsUrl: "https://doc.toasttab.com/doc/devguide/index.html",
  },

  touchbistro: {
    key: "touchbistro",
    label: "TouchBistro",
    blurb: "Push confirmed orders into TouchBistro.",
    iconKey: "touchbistro",
    capabilities: ["booking.push"],
    connectMode: "request_access",
    available: false,
    unavailableReason:
      "TouchBistro issues API keys case-by-case under a partner agreement. Request access and we'll join the queue on your behalf.",
  },

  clover: {
    key: "clover",
    label: "Clover",
    blurb: "Sync your Clover inventory and send orders to Clover.",
    iconKey: "clover",
    capabilities: ["oauth", "catalog.pull", "booking.push"],
    connectMode: "oauth",
    available: false,
    unavailableReason: "Coming soon.",
    docsUrl: "https://docs.clover.com/",
  },

  lightspeed: {
    key: "lightspeed",
    label: "Lightspeed Restaurant",
    blurb: "Sync your Lightspeed menu and send orders to Lightspeed.",
    iconKey: "lightspeed",
    capabilities: ["oauth", "catalog.pull", "booking.push"],
    connectMode: "oauth",
    available: false,
    unavailableReason: "Coming soon — pending Lightspeed partner registration.",
  },

  odoo: {
    key: "odoo",
    label: "Odoo",
    blurb:
      "Sync products and push bookings into Odoo Sales/CRM — for clinics, firms, and service businesses running Odoo as their ERP.",
    iconKey: "odoo",
    capabilities: ["catalog.pull", "booking.push", "customer.push"],
    connectMode: "form",
    available: false,
    unavailableReason: "Coming soon.",
    docsUrl: "https://www.odoo.com/documentation/master/developer/reference/external_api.html",
  },
};

export function isProvider(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

export function providerDescriptor(value: string | null | undefined): ProviderDescriptor | null {
  if (!value || !isProvider(value)) return null;
  return PROVIDERS[value];
}

/** Registry as an ordered list for the dashboard grid: available first. */
export const PROVIDER_LIST: ProviderDescriptor[] = Object.values(PROVIDERS).sort((a, b) => {
  if (a.available !== b.available) return a.available ? -1 : 1;
  return a.label.localeCompare(b.label);
});

export function hasCapability(provider: string, cap: Capability): boolean {
  return providerDescriptor(provider)?.capabilities.includes(cap) ?? false;
}
