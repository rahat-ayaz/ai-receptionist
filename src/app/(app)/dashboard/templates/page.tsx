"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Pencil, Palette, MessageSquareText, Mail, Upload, X } from "lucide-react";
import { renderBrandedEmail, applyTokens } from "@/lib/branding";

interface Template {
  id: string;
  channel: "SMS" | "EMAIL";
  purpose: string;
  name: string;
  subject: string | null;
  body: string;
}

const PURPOSES = [
  { value: "GENERAL", label: "General" },
  { value: "BOOKING_CONFIRMATION", label: "Booking confirmation" },
  { value: "BOOKING_REMINDER", label: "Booking reminder" },
];
const purposeLabel = (p: string) => PURPOSES.find((x) => x.value === p)?.label ?? "General";

// Sample values used to render the live email preview.
const SAMPLE = {
  customerName: "Jane Doe",
  type: "order",
  reference: "ORD-0001",
  when: "Sat, Jul 5, 6:30 p.m.",
  items: "2× Large Pizza, 1× Garlic Bread",
  subtotal: "$36.00",
  tax: "$4.68",
  taxLabel: "HST (13%)",
  total: "$40.68",
};
interface Brand {
  brandColor: string | null;
  brandAccentColor: string | null;
  logoData: string | null;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState<Brand>({ brandColor: null, brandAccentColor: null, logoData: null });
  const [businessName, setBusinessName] = useState("Your business");

  const [previewSubject, setPreviewSubject] = useState("");
  const [previewBody, setPreviewBody] = useState("");

  const handlePreviewChange = useCallback((s: string, b: string) => {
    setPreviewSubject(s);
    setPreviewBody(b);
  }, []);

  async function load() {
    setLoading(true);
    const data = (await (await fetch("/api/templates")).json()) as { templates: Template[] };
    setTemplates(data.templates ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
    (async () => {
      const d = (await (await fetch("/api/brand")).json()) as { brand: (Brand & { name?: string }) | null };
      if (d.brand) {
        setBrand({ brandColor: d.brand.brandColor, brandAccentColor: d.brand.brandAccentColor, logoData: d.brand.logoData });
        if (d.brand.name) setBusinessName(d.brand.name);
      }
    })();
  }, []);

  // Sync default preview from first email template if none set
  useEffect(() => {
    if (templates.length > 0 && !previewSubject && !previewBody) {
      const emailTpl = templates.find((t) => t.channel === "EMAIL");
      if (emailTpl) {
        setPreviewSubject(emailTpl.subject ?? "");
        setPreviewBody(emailTpl.body);
      }
    }
  }, [templates, previewSubject, previewBody]);

  return (
    <div className="w-full px-5 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Templates &amp; Branding</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          Reusable SMS &amp; email templates, and the brand used on outbound emails. Tokens:{" "}
          <code className="text-[var(--color-gold-soft)]">{"{{businessName}}"}</code>,{" "}
          <code className="text-[var(--color-gold-soft)]">{"{{customerName}}"}</code>,{" "}
          <code className="text-[var(--color-gold-soft)]">{"{{reference}}"}</code>.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <BrandCard brand={brand} onChange={setBrand} />
          {loading ? (
            <p className="text-sm text-[var(--color-ink-dim)]">Loading templates…</p>
          ) : (
            <>
              <TemplateSection channel="SMS" title="SMS templates" items={templates.filter((t) => t.channel === "SMS")} onChanged={load} />
              <TemplateSection
                channel="EMAIL"
                title="Email templates"
                items={templates.filter((t) => t.channel === "EMAIL")}
                onChanged={load}
                brand={brand}
                businessName={businessName}
                onPreviewChange={handlePreviewChange}
              />
            </>
          )}
        </div>
        <div>
          <div className="sticky top-6 tile p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Mail className="h-4 w-4 text-[var(--color-gold)]" /> Live Email Preview
            </h2>
            <iframe
              title="Email preview"
              className="h-[550px] w-full rounded-lg border border-[var(--color-slate-line)] bg-white"
              srcDoc={renderBrandedEmail({
                brand,
                businessName: businessName ?? "Your business",
                heading: applyTokens(previewSubject || "Your order is confirmed", { businessName: businessName ?? "Your business", ...SAMPLE }),
                body: applyTokens(previewBody || "Your email body preview appears here — start typing or edit a template.", { businessName: businessName ?? "Your business", ...SAMPLE }),
              })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Brand ──────────────────────────────────────────────────────────────────
function BrandCard({ brand, onChange }: { brand: Brand; onChange: (b: Brand) => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function save(patch: Partial<Brand>) {
    onChange({ ...brand, ...patch });
    setSaving(true); setSaved(false);
    await fetch("/api/brand", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    setSaving(false); setSaved(true);
  }

  function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => save({ logoData: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="tile mb-6 p-6">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Palette className="h-4 w-4 text-[var(--color-gold)]" /> Email branding
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-ink-faint)]" /> : saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
      </h2>
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Primary colour</span>
          <input type="color" value={brand.brandColor ?? "#b96be7"} onChange={(e) => save({ brandColor: e.target.value })} className="h-10 w-16 cursor-pointer rounded border border-[var(--color-slate-line)] bg-transparent" />
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Accent colour</span>
          <input type="color" value={brand.brandAccentColor ?? "#d9b3f0"} onChange={(e) => save({ brandAccentColor: e.target.value })} className="h-10 w-16 cursor-pointer rounded border border-[var(--color-slate-line)] bg-transparent" />
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Logo</span>
          <div className="flex items-center gap-3">
            {brand.logoData ? (
              <span className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logoData} alt="Logo" className="h-10 w-auto max-w-[120px] rounded bg-white/90 object-contain p-1" />
                <button onClick={() => save({ logoData: null })} className="text-[var(--color-ink-faint)] hover:text-red-400"><X className="h-4 w-4" /></button>
              </span>
            ) : (
              <span className="text-xs text-[var(--color-ink-faint)]">No logo</span>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogo} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="btn-outline !w-auto px-3 py-1.5 text-xs"><Upload className="h-3.5 w-3.5" /> Upload</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Template section (SMS or EMAIL) ────────────────────────────────────────
function TemplateSection({
  channel,
  title,
  items,
  onChanged,
  brand,
  businessName,
  onPreviewChange,
}: {
  channel: "SMS" | "EMAIL";
  title: string;
  items: Template[];
  onChanged: () => void;
  brand?: Brand;
  businessName?: string;
  onPreviewChange?: (subject: string, body: string) => void;
}) {
  const isEmail = channel === "EMAIL";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("GENERAL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isEmail && onPreviewChange) {
      onPreviewChange(subject, body);
    }
  }, [subject, body, isEmail, onPreviewChange]);

  function reset() { setEditingId(null); setName(""); setPurpose("GENERAL"); setSubject(""); setBody(""); }

  async function save() {
    if (!name || !body) return;
    setBusy(true);
    try {
      if (editingId) {
        await fetch(`/api/templates/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, purpose, subject, body }) });
      } else {
        await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, purpose, name, subject, body }) });
      }
      reset();
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  function edit(t: Template) { setEditingId(t.id); setName(t.name); setPurpose(t.purpose); setSubject(t.subject ?? ""); setBody(t.body); }
  async function remove(id: string) { await fetch(`/api/templates/${id}`, { method: "DELETE" }); onChanged(); }

  return (
    <div className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {isEmail ? <Mail className="h-4 w-4 text-[var(--color-gold)]" /> : <MessageSquareText className="h-4 w-4 text-[var(--color-gold)]" />} {title}
      </h2>

      <div className="tile mb-4 p-5">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 items-end">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[var(--color-ink-dim)]">
                {editingId ? "Edit template" : "New template"}
              </span>
              <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[var(--color-ink-dim)]">Used for</span>
              <select className="fld !py-2" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
          {isEmail && <input className="fld" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />}
          <textarea className="fld resize-y" rows={isEmail ? 4 : 2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={isEmail ? "Email body…" : "Hi {{customerName}}, your order at {{businessName}} is ready!"} />
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={save} disabled={busy || !name || !body} className="btn-gold !w-auto px-4">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {editingId ? "Save" : "Add template"}
          </button>
          {editingId && <button onClick={reset} className="btn-outline !w-auto px-4">Cancel</button>}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-faint)]">No {channel.toLowerCase()} templates yet.</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((t) => (
            <div key={t.id} className="tile tile-hover p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {t.name}
                    {t.purpose !== "GENERAL" && (
                      <span className="rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-gold-soft)]">
                        {purposeLabel(t.purpose)}
                      </span>
                    )}
                  </p>
                  {t.subject && <p className="text-xs text-[var(--color-ink-dim)]">Subject: {t.subject}</p>}
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-dim)]">{t.body}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button onClick={() => edit(t)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => remove(t.id)} className="text-[var(--color-ink-faint)] hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
