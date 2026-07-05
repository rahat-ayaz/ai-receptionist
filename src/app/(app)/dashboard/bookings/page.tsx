"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CalendarCheck, Loader2, CheckCircle2, X, Clock } from "lucide-react";
import { PROVINCES } from "@/lib/tax";
import { priceOrder, summarizeOrder, type LineItemInput } from "@/lib/pricing";

interface Customer {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}
interface Booking {
  id: string;
  reference: string | null;
  type: "ORDER" | "APPOINTMENT";
  status: "PENDING" | "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "COMPLETED";
  scheduledAt: string;
  lineItems: { name: string; qty: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  taxAmount: number;
  total: number;
  taxLabel: string;
  province: string;
  notes: string | null;
  confirmationSentAt: string | null;
  customer: Customer;
}
interface CatalogItem {
  id: string;
  name: string;
  price: number | null;
}

const STATUS_STYLE: Record<Booking["status"], string> = {
  PENDING: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  CONFIRMED: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  RESCHEDULED: "text-sky-400 border-sky-400/40 bg-sky-400/10",
  CANCELLED: "text-red-400 border-red-400/40 bg-red-400/10",
  COMPLETED: "text-[var(--color-ink-dim)] border-[var(--color-slate-line)] bg-[var(--color-navy-700)]",
};

const money = (n: number) => `$${n.toFixed(2)}`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | Booking["status"]>("ALL");
  const [search, setSearch] = useState("");

  // Create-form state
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<"ORDER" | "APPOINTMENT">("ORDER");
  const [province, setProvince] = useState("ON");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<LineItemInput[]>([]);
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState("1");
  const [saving, setSaving] = useState(false);

  // Reschedule inline state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWhen, setEditWhen] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit-form state
  const [editType, setEditType] = useState<"ORDER" | "APPOINTMENT">("ORDER");
  const [editProvince, setEditProvince] = useState("ON");
  const [editNotes, setEditNotes] = useState("");
  const [editCart, setEditCart] = useState<LineItemInput[]>([]);
  const [editPickId, setEditPickId] = useState("");
  const [editPickQty, setEditPickQty] = useState("1");

  async function load() {
    setLoading(true);
    const [b, c] = await Promise.all([fetch("/api/bookings"), fetch("/api/catalog")]);
    const bd = (await b.json()) as { bookings: Booking[] };
    const cd = (await c.json()) as { items: CatalogItem[] };
    setBookings(bd.bookings ?? []);
    setCatalog(cd.items ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  const preview = useMemo(() => priceOrder(cart, province), [cart, province]);

  function addToCart() {
    const item = catalog.find((c) => c.id === pickId);
    const qty = parseInt(pickQty, 10);
    if (!item || !qty || qty < 1) return;
    setCart((c) => [...c, { name: item.name, qty, unitPrice: item.price ?? 0 }]);
    setPickId("");
    setPickQty("1");
  }

  async function create() {
    if (!phone || !scheduledAt) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, email, type, province, scheduledAt, items: cart, notes }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        alert(data.error);
      } else {
        setPhone(""); setName(""); setEmail(""); setNotes(""); setCart([]); setScheduledAt("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: object) {
    setBusyId(id);
    try {
      await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEditingId(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const shown = bookings.filter(
    (b) =>
      (filter === "ALL" || b.status === filter) &&
      (!q ||
        (b.reference ?? "").toLowerCase().includes(q) ||
        (b.customer.name ?? "").toLowerCase().includes(q) ||
        b.customer.phone.toLowerCase().includes(q)),
  );

  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Bookings &amp; Orders</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          Customers are tracked by phone number. Pricing and {`Canadian`} tax are calculated automatically.
        </p>
      </div>

      {/* Create card */}
      <div className="tile mb-8 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-[var(--color-gold)]" /> New booking
        </h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Customer phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+15145550123" className="fld" /></Field>
          <Field label="Name (optional)"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="fld" /></Field>
          <Field label="Email (optional)"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@email.com" className="fld" /></Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as "ORDER" | "APPOINTMENT")} className="fld">
              <option value="ORDER">Order</option>
              <option value="APPOINTMENT">Appointment</option>
            </select>
          </Field>
          <Field label="Date &amp; time"><input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="fld" /></Field>
          <Field label="Province (tax)">
            <select value={province} onChange={(e) => setProvince(e.target.value)} className="fld">
              {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        {/* Item picker */}
        <div className="mt-4 grid gap-3 sm:grid-cols-[3fr_1fr_auto]">
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} className="fld">
            <option value="">Add item from menu…</option>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}{c.price != null ? ` — $${c.price.toFixed(2)}` : ""}</option>)}
          </select>
          <input value={pickQty} onChange={(e) => setPickQty(e.target.value)} inputMode="numeric" className="fld" placeholder="Qty" />
          <button onClick={addToCart} disabled={!pickId} className="btn-outline !w-auto px-4">Add</button>
        </div>
        {catalog.length === 0 && (
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">No menu items yet — add some under “Menu”.</p>
        )}

        {/* Cart + live totals */}
        {cart.length > 0 && (
          <div className="mt-4 rounded-lg border border-[var(--color-slate-line)] bg-[var(--color-navy-700)]/40 p-4">
            {preview.lineItems.map((i, idx) => (
              <div key={idx} className="flex items-center justify-between py-1 text-sm">
                <span>{i.qty} × {i.name} <span className="text-[var(--color-ink-faint)]">@ {money(i.unitPrice)}</span></span>
                <span className="flex items-center gap-3">
                  {money(i.lineTotal)}
                  <button onClick={() => setCart((c) => c.filter((_, k) => k !== idx))} className="text-[var(--color-ink-faint)] hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
                </span>
              </div>
            ))}
            <div className="mt-2 border-t border-[var(--color-slate-line)] pt-2 text-sm">
              <Row label="Subtotal" value={money(preview.subtotal)} />
              <Row label={preview.tax.label} value={money(preview.tax.amount)} />
              <Row label="Total" value={money(preview.total)} bold />
            </div>
            <p className="mt-3 text-xs italic text-[var(--color-gold-soft)]">“{summarizeOrder(preview)}”</p>
          </div>
        )}

        <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergy: nuts" className="fld mt-4" /></Field>

        <button onClick={create} disabled={saving || !phone || !scheduledAt} className="btn-gold mt-5 !w-auto px-5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create booking
        </button>
      </div>

      {/* Lookup */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Look up by order # (e.g. ORD-0001), name, or phone…"
        className="fld mb-4"
      />

      {/* Filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(["ALL", "PENDING", "CONFIRMED", "RESCHEDULED", "CANCELLED", "COMPLETED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === s ? "border-[var(--color-gold)] text-[var(--color-gold-soft)]" : "border-[var(--color-slate-line)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"}`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-[var(--color-ink-dim)]">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="tile p-10 text-center text-sm text-[var(--color-ink-dim)]">No bookings here yet.</div>
      ) : (
        <div className="space-y-4">
          {shown.map((b) => (
            <div key={b.id} className="tile p-5">
              {editingId === b.id ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-[var(--color-gold)]">Edit Booking {b.reference}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Type">
                      <select value={editType} onChange={(e) => setEditType(e.target.value as "ORDER" | "APPOINTMENT")} className="fld">
                        <option value="ORDER">Order</option>
                        <option value="APPOINTMENT">Appointment</option>
                      </select>
                    </Field>
                    <Field label="Date &amp; time">
                      <input type="datetime-local" value={editWhen} onChange={(e) => setEditWhen(e.target.value)} className="fld" />
                    </Field>
                    <Field label="Province (tax)">
                      <select value={editProvince} onChange={(e) => setEditProvince(e.target.value)} className="fld">
                        {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Notes (optional)">
                      <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Allergy: nuts" className="fld" />
                    </Field>
                  </div>

                  {/* Edit Items picker */}
                  <div className="border-t border-[var(--color-slate-line)] pt-3">
                    <h4 className="text-xs font-semibold mb-2">Edit Order Items</h4>
                    <div className="grid gap-3 sm:grid-cols-[3fr_1fr_auto]">
                      <select value={editPickId} onChange={(e) => setEditPickId(e.target.value)} className="fld">
                        <option value="">Add item from menu…</option>
                        {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}{c.price != null ? ` — $${c.price.toFixed(2)}` : ""}</option>)}
                      </select>
                      <input value={editPickQty} onChange={(e) => setEditPickQty(e.target.value)} inputMode="numeric" className="fld" placeholder="Qty" />
                      <button
                        onClick={() => {
                          const item = catalog.find((c) => c.id === editPickId);
                          const qty = parseInt(editPickQty, 10);
                          if (!item || !qty || qty < 1) return;
                          setEditCart((c) => [...c, { name: item.name, qty, unitPrice: item.price ?? 0 }]);
                          setEditPickId("");
                          setEditPickQty("1");
                        }}
                        disabled={!editPickId}
                        className="btn-outline !w-auto px-4"
                      >
                        Add
                      </button>
                    </div>

                    {/* Edit Cart preview */}
                    {editCart.length > 0 && (
                      <div className="mt-3 rounded-lg border border-[var(--color-slate-line)] bg-[var(--color-navy-700)]/40 p-3">
                        {editCart.map((i, idx) => (
                          <div key={idx} className="flex items-center justify-between py-1 text-xs">
                            <span>{i.qty} × {i.name} <span className="text-[var(--color-ink-faint)]">@ {money(i.unitPrice)}</span></span>
                            <button
                              onClick={() => setEditCart((c) => c.filter((_, k) => k !== idx))}
                              className="text-[var(--color-ink-faint)] hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-[var(--color-slate-line)]">
                    <ActionBtn
                      onClick={() => patch(b.id, {
                        type: editType,
                        scheduledAt: editWhen,
                        province: editProvince,
                        notes: editNotes,
                        items: editCart
                      })}
                      busy={busyId === b.id}
                    >
                      Save Changes
                    </ActionBtn>
                    <ActionBtn onClick={() => setEditingId(null)}>Cancel</ActionBtn>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        <CalendarCheck className="h-4 w-4 text-[var(--color-gold)]" />
                        {b.reference && (
                          <span className="rounded bg-[var(--color-navy-700)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-gold-soft)]">{b.reference}</span>
                        )}
                        {b.customer.name || b.customer.phone}
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[b.status]}`}>{b.status}</span>
                        <span className="rounded-full border border-[var(--color-slate-line)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]">{b.type}</span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
                        {b.customer.phone} · {fmtWhen(b.scheduledAt)}
                        {b.confirmationSentAt && <span className="ml-2 text-emerald-400">✓ confirmed</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{money(b.total)}</p>
                      <p className="text-[11px] text-[var(--color-ink-faint)]">incl. {b.taxLabel} {money(b.taxAmount)}</p>
                    </div>
                  </div>

                  {b.lineItems.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {b.lineItems.map((i, idx) => (
                        <span key={idx} className="rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]">
                          {i.qty}× {i.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {b.notes && <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Note: {b.notes}</p>}

                  {/* Actions */}
                  {b.status !== "CANCELLED" && b.status !== "COMPLETED" && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {!b.confirmationSentAt && (
                        <ActionBtn onClick={() => patch(b.id, { action: "confirm" })} busy={busyId === b.id}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                        </ActionBtn>
                      )}
                      <ActionBtn onClick={() => {
                        setEditingId(b.id);
                        setEditWhen(b.scheduledAt.slice(0, 16));
                        setEditType(b.type);
                        setEditProvince(b.province);
                        setEditNotes(b.notes || "");
                        setEditCart(b.lineItems.map(i => ({ name: i.name, qty: i.qty, unitPrice: i.unitPrice })));
                      }}>
                        <Clock className="h-3.5 w-3.5" /> Edit / Reschedule
                      </ActionBtn>
                      <ActionBtn onClick={() => patch(b.id, { status: "CANCELLED" })} busy={busyId === b.id} danger>
                        <Trash2 className="h-3.5 w-3.5" /> Cancel
                      </ActionBtn>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">{label}</span>
      {children}
    </label>
  );
}
function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? "font-bold" : "text-[var(--color-ink-dim)]"}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
function ActionBtn({ children, onClick, busy, danger }: { children: React.ReactNode; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition disabled:opacity-50 ${danger ? "border-red-400/40 text-red-400 hover:bg-red-400/10" : "border-[var(--color-slate-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-gold)]/50 hover:text-[var(--color-ink)]"}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  );
}
