"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Link2,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Trash2,
  Webhook,
} from "lucide-react";

interface ProviderField {
  key: string;
  label: string;
  type: "text" | "url" | "secret" | "select";
  options?: string[];
  required: boolean;
  placeholder?: string;
  help?: string;
  secret?: boolean;
}

interface Provider {
  key: string;
  label: string;
  blurb: string;
  iconKey: string;
  capabilities: string[];
  connectMode: "oauth" | "form" | "request_access";
  available: boolean;
  unavailableReason?: string;
  fields?: ProviderField[];
  docsUrl?: string;
}

interface Integration {
  id: string;
  provider: string;
  status: "PENDING" | "ACTIVE" | "NEEDS_REAUTH" | "DISABLED" | "ACCESS_PENDING";
  label: string | null;
  externalAccountId: string | null;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  catalogSyncEnabled: boolean;
  bookingPushEnabled: boolean;
  lastCatalogSyncAt: string | null;
  lastBookingPushAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

interface Failure {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
  reference: string | null;
  total: number | null;
}

/** Human wording for the error codes the OAuth callback can redirect with. */
const OAUTH_ERRORS: Record<string, string> = {
  square_not_configured:
    "Square isn't set up on this deployment yet — SQUARE_APP_ID and SQUARE_APP_SECRET are missing.",
  crypto_not_configured:
    "Credential encryption isn't configured on this deployment, so we can't store the connection safely.",
  state_mismatch: "The connection request couldn't be verified. Please try again.",
  state_expired: "The connection request timed out. Please try again.",
  state_already_used: "That connection link was already used. Please start again.",
  unknown_state: "The connection request wasn't recognized. Please try again.",
  session_mismatch: "You were signed into a different account when the connection finished.",
  missing_code: "Square didn't return an authorization code.",
  token_exchange_failed: "Square rejected the authorization. Please try again.",
  access_denied: "The Square authorization was declined.",
};

const CAP_LABELS: Record<string, string> = {
  "catalog.pull": "Syncs your menu in",
  "booking.push": "Sends orders out",
  "booking.cancel": "Syncs cancellations",
  "customer.push": "Syncs customers",
  "webhook.receive": "Live updates",
};

export default function IntegrationsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, Record<string, string>>>({});
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations");
    const data = await res.json();
    setProviders(data.providers ?? []);
    setIntegrations(data.integrations ?? []);
    setFailures(data.failures ?? []);
    setConfigured(data.configured !== false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The OAuth callback redirects back here with ?connected= or ?error=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const err = params.get("error");
    if (connected) setNotice({ kind: "ok", text: `${connected} connected.` });
    else if (err) setNotice({ kind: "error", text: OAUTH_ERRORS[err] ?? `Connection failed: ${err}` });
    if (connected || err) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const byProvider = new Map(integrations.map((i) => [i.provider, i]));

  function setField(provider: string, key: string, value: string) {
    setForm((f) => ({ ...f, [provider]: { ...(f[provider] ?? {}), [key]: value } }));
  }

  /**
   * Seed defaults when a form opens. A <select> renders its first option as the
   * displayed value, but without this the state stays empty and submitting the
   * untouched default fails validation with a confusing "required" error.
   */
  function openProviderForm(p: Provider) {
    setForm((f) => {
      const seeded = { ...(f[p.key] ?? {}) };
      for (const field of p.fields ?? []) {
        if (field.type === "select" && !seeded[field.key]) {
          seeded[field.key] = field.options?.[0] ?? "";
        }
      }
      return { ...f, [p.key]: seeded };
    });
    setOpenForm(p.key);
  }

  async function connectForm(provider: Provider) {
    setBusy(provider.key);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider.key, values: form[provider.key] ?? {} }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error);
        return;
      }
      setOpenForm(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function test(integration: Integration) {
    setBusy(integration.id);
    setTestResult((t) => ({ ...t, [integration.id]: "" }));
    try {
      const res = await fetch(`/api/integrations/${integration.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult((t) => ({
        ...t,
        [integration.id]: data.ok ? `Connected to ${data.accountLabel}` : `Failed: ${data.error}`,
      }));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sync(integration: Integration, resume = false) {
    setBusy(integration.id);
    setTestResult((t) => ({ ...t, [integration.id]: "Syncing…" }));
    try {
      const res = await fetch(`/api/integrations/${integration.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resume }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult((t) => ({ ...t, [integration.id]: data.error }));
        return;
      }
      const s = data.summary;
      const parts = [
        `${s.created} added`,
        `${s.updated} updated`,
        s.deactivated ? `${s.deactivated} deactivated` : null,
        s.skipped ? `${s.skipped} unchanged` : null,
        s.ambiguous ? `${s.ambiguous} possible duplicates — review` : null,
        s.pricesDiscarded ? `${s.pricesDiscarded} prices ignored for this niche` : null,
      ].filter(Boolean);

      setTestResult((t) => ({
        ...t,
        [integration.id]:
          s.status === "PARTIAL"
            ? `Partly synced (${parts.join(", ")}). ${s.error ?? "Sync again to continue."}`
            : s.status === "FAILED"
              ? `Sync failed: ${s.error}`
              : `Synced — ${parts.join(", ")}.`,
      }));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(integration: Integration, patch: Partial<Integration>) {
    setBusy(integration.id);
    try {
      await fetch(`/api/integrations/${integration.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(integration: Integration) {
    if (!confirm("Disconnect this integration? Linked items will be unlinked.")) return;
    setBusy(integration.id);
    try {
      await fetch(`/api/integrations/${integration.id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function requestAccess(provider: Provider) {
    setBusy(provider.key);
    try {
      const res = await fetch("/api/integrations/request-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: provider.key }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function retryFailure(id: string) {
    setBusy(id);
    try {
      await fetch("/api/integrations/failures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          Connect your POS, CRM or ERP so confirmed orders land where your team already works.
        </p>
      </div>

      {notice && (
        <div
          className={`tile mb-6 p-4 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-500/30 text-emerald-200"
              : "border-amber-500/30 text-amber-200"
          }`}
        >
          {notice.kind === "ok" ? (
            <Check className="mr-2 inline h-4 w-4" />
          ) : (
            <AlertTriangle className="mr-2 inline h-4 w-4" />
          )}
          {notice.text}
        </div>
      )}

      {!configured && (
        <div className="tile mb-6 border-amber-500/30 p-4 text-sm text-amber-200">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Integrations aren&apos;t configured on this deployment yet — credential encryption keys are
          missing. Set <code>CREDENTIAL_ENC_KEYS</code> and <code>CREDENTIAL_ENC_ACTIVE</code>.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[var(--color-ink-dim)]">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((p) => {
            const integration = byProvider.get(p.key);
            const connected = integration && integration.status !== "ACCESS_PENDING";
            const needsReauth = integration?.status === "NEEDS_REAUTH";

            return (
              <div
                key={p.key}
                className={`tile p-5 ${!p.available && !integration ? "opacity-55" : ""} ${
                  needsReauth ? "border-amber-500/40" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 font-semibold">
                    {p.key === "generic_rest" ? (
                      <Webhook className="h-4.5 w-4.5 text-[var(--color-gold)]" />
                    ) : p.available ? (
                      <Plug className="h-4.5 w-4.5 text-[var(--color-gold)]" />
                    ) : (
                      <Lock className="h-4.5 w-4.5 text-[var(--color-ink-faint)]" />
                    )}
                    {p.label}
                  </div>
                  <StatusPill integration={integration} available={p.available} />
                </div>

                <p className="mt-2 text-sm text-[var(--color-ink-dim)]">{p.blurb}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {p.capabilities
                    .filter((c) => CAP_LABELS[c])
                    .map((c) => (
                      <span
                        key={c}
                        className="rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]"
                      >
                        {CAP_LABELS[c]}
                      </span>
                    ))}
                </div>

                {needsReauth && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                    {integration?.lastErrorMessage ?? "This connection needs to be re-authorized."}
                  </p>
                )}

                {!p.available && !integration && p.unavailableReason && (
                  <p className="mt-3 text-xs text-[var(--color-ink-faint)]">{p.unavailableReason}</p>
                )}

                {/* ── Connected controls ───────────────────────────────── */}
                {connected && integration && (
                  <div className="mt-4 space-y-3 border-t border-[var(--color-slate-line)] pt-3">
                    <div className="text-xs text-[var(--color-ink-dim)]">
                      {integration.label ?? integration.externalAccountId ?? "Connected"}
                      {integration.lastCatalogSyncAt && (
                        <span className="ml-2 text-[var(--color-ink-faint)]">
                          · menu synced {new Date(integration.lastCatalogSyncAt).toLocaleString()}
                        </span>
                      )}
                      {integration.lastBookingPushAt && (
                        <span className="ml-2 text-[var(--color-ink-faint)]">
                          · last sent {new Date(integration.lastBookingPushAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {testResult[integration.id] && (
                      <p className="text-xs text-[var(--color-ink-dim)]">{testResult[integration.id]}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => test(integration)}
                        disabled={busy === integration.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-slate-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-navy-700)] disabled:opacity-60"
                      >
                        {busy === integration.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Test connection
                      </button>

                      {p.capabilities.includes("catalog.pull") && (
                        <button
                          onClick={() => sync(integration)}
                          disabled={busy === integration.id || !integration.catalogSyncEnabled}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-slate-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-navy-700)] disabled:opacity-60"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Sync now
                        </button>
                      )}

                      {p.capabilities.includes("booking.push") && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
                          <input
                            type="checkbox"
                            checked={integration.bookingPushEnabled}
                            onChange={(e) => toggle(integration, { bookingPushEnabled: e.target.checked })}
                          />
                          Send orders
                        </label>
                      )}

                      {p.capabilities.includes("catalog.pull") && (
                        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
                          <input
                            type="checkbox"
                            checked={integration.catalogSyncEnabled}
                            onChange={(e) => toggle(integration, { catalogSyncEnabled: e.target.checked })}
                          />
                          Sync menu
                        </label>
                      )}

                      <button
                        onClick={() => disconnect(integration)}
                        className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Disconnect
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Connect actions ──────────────────────────────────── */}
                {!connected && p.available && p.connectMode === "form" && (
                  <div className="mt-4">
                    {openForm === p.key ? (
                      <div className="space-y-3 border-t border-[var(--color-slate-line)] pt-3">
                        {(p.fields ?? []).map((f) => (
                          <label key={f.key} className="block">
                            <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">
                              {f.label}
                              {f.required && <span className="text-[var(--color-gold)]"> *</span>}
                            </span>
                            {f.type === "select" ? (
                              <select
                                className="cap-input"
                                value={form[p.key]?.[f.key] ?? f.options?.[0] ?? ""}
                                onChange={(e) => setField(p.key, f.key, e.target.value)}
                              >
                                {(f.options ?? []).map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                className="cap-input"
                                type={f.type === "secret" ? "password" : "text"}
                                placeholder={f.placeholder}
                                value={form[p.key]?.[f.key] ?? ""}
                                onChange={(e) => setField(p.key, f.key, e.target.value)}
                              />
                            )}
                            {f.help && (
                              <span className="mt-1 block text-[11px] text-[var(--color-ink-faint)]">{f.help}</span>
                            )}
                          </label>
                        ))}
                        <div className="flex gap-2">
                          <button
                            onClick={() => connectForm(p)}
                            disabled={busy === p.key}
                            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-4 py-2 text-sm font-semibold text-[var(--color-midnight)] hover:brightness-110 disabled:opacity-60"
                          >
                            {busy === p.key ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Link2 className="h-4 w-4" />
                            )}
                            Connect
                          </button>
                          <button
                            onClick={() => setOpenForm(null)}
                            className="rounded-lg border border-[var(--color-slate-line)] px-3 py-2 text-sm text-[var(--color-ink-dim)] hover:bg-[var(--color-navy-700)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => openProviderForm(p)}
                        className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-4 py-2 text-sm font-semibold text-[var(--color-midnight)] hover:brightness-110"
                      >
                        <Link2 className="h-4 w-4" /> Set up
                      </button>
                    )}
                  </div>
                )}

                {!connected && p.available && p.connectMode === "oauth" && (
                  <div className="mt-4">
                    {p.capabilities.includes("catalog.pull") && (
                      <p className="mb-3 rounded-lg border border-[var(--color-slate-line)] bg-[var(--color-navy-700)]/40 p-2.5 text-xs text-[var(--color-ink-dim)]">
                        <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-amber-400" />
                        {p.label} becomes the source of truth for linked items. Names and prices you
                        edit in CAPRO will be overwritten on each sync. Items you added only in CAPRO
                        are left alone.
                      </p>
                    )}
                    <a
                      href={`/api/integrations/${p.key}/connect`}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-4 py-2 text-sm font-semibold text-[var(--color-midnight)] hover:brightness-110"
                    >
                      <Link2 className="h-4 w-4" /> Connect {p.label}
                    </a>
                  </div>
                )}

                {!p.available && p.connectMode === "request_access" && (
                  <button
                    onClick={() => requestAccess(p)}
                    disabled={busy === p.key || integration?.status === "ACCESS_PENDING"}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-slate-line)] px-3 py-2 text-sm text-[var(--color-ink-dim)] hover:bg-[var(--color-navy-700)] disabled:opacity-60"
                  >
                    {integration?.status === "ACCESS_PENDING" ? (
                      <>
                        <Clock className="h-4 w-4" /> Access requested
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" /> Request access
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Failed deliveries ──────────────────────────────────────────── */}
      {failures.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Orders that didn&apos;t reach your POS
          </h2>
          <div className="tile divide-y divide-[var(--color-slate-line)]">
            {failures.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {f.reference ?? "Order"}
                    {f.total != null && (
                      <span className="ml-2 text-[var(--color-ink-dim)]">${f.total.toFixed(2)}</span>
                    )}
                    <span className="ml-2 text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                      {f.provider}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-ink-dim)]">
                    {f.errorMessage ?? f.errorCode ?? "Delivery failed"}
                    <span className="ml-2 text-[var(--color-ink-faint)]">
                      · {f.attempts} attempt{f.attempts === 1 ? "" : "s"}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => retryFailure(f.id)}
                  disabled={busy === f.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-slate-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-navy-700)] disabled:opacity-60"
                >
                  {busy === f.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Retry
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .cap-input {
          width: 100%;
          border-radius: 8px;
          border: 1px solid var(--color-slate-line);
          background: rgba(12, 21, 42, 0.6);
          padding: 0.6rem 0.75rem;
          font-size: 0.875rem;
          color: var(--color-ink);
          outline: none;
        }
        .cap-input:focus { border-color: var(--color-gold); }
      `}</style>
    </div>
  );
}

function StatusPill({ integration, available }: { integration?: Integration; available: boolean }) {
  if (!integration) {
    return available ? null : (
      <span className="rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-faint)]">
        Coming soon
      </span>
    );
  }

  const map: Record<Integration["status"], { text: string; cls: string }> = {
    ACTIVE: { text: "Connected", cls: "bg-emerald-500/15 text-emerald-300" },
    NEEDS_REAUTH: { text: "Needs reconnect", cls: "bg-amber-500/15 text-amber-300" },
    DISABLED: { text: "Disabled", cls: "bg-[var(--color-slate-panel)] text-[var(--color-ink-faint)]" },
    PENDING: { text: "Pending", cls: "bg-[var(--color-slate-panel)] text-[var(--color-ink-dim)]" },
    ACCESS_PENDING: { text: "Access requested", cls: "bg-[var(--color-slate-panel)] text-[var(--color-ink-dim)]" },
  };
  const s = map[integration.status];

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${s.cls}`}>
      {integration.status === "ACTIVE" && <Check className="h-3 w-3" />}
      {s.text}
    </span>
  );
}
