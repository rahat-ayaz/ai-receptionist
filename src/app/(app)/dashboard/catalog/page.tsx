"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Upload, Link2, ClipboardType, Sparkles, X, Save, Pencil } from "lucide-react";
import { nicheConfig, NICHE_OPTIONS } from "@/lib/niche";

interface Item {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  category: string | null;
  imageUrl: string | null;
}
interface Draft {
  name: string;
  price: number | null;
  category: string | null;
  description?: string | null;
  imageUrl?: string | null;
}

type ImportMode = "file" | "url" | "text";

export default function CatalogPage() {
  const router = useRouter();
  const [niche, setNiche] = useState("OTHER");
  const cfg = nicheConfig(niche);

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual add
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");

  const addImageRef = useRef<HTMLInputElement>(null);
  const editImageRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter(String(reader.result));
    };
    reader.readAsDataURL(file);
  }

  // Import
  const [mode, setMode] = useState<ImportMode>("file");
  const [url, setUrl] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState<Draft[] | null>(null);
  const [suggestedNiche, setSuggestedNiche] = useState<string | null>(null);
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/catalog");
      const data = (await res.json()) as { items: Item[]; niche: string };
      setItems(data.items ?? []);
      setNiche(data.niche ?? "OTHER");
    } catch (err) {
      console.error("Failed to load catalog items:", err);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function changeNiche(value: string) {
    setNiche(value);
    await fetch("/api/profile/niche", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: value }),
    });
    router.refresh(); // updates the sidebar tab label/icon
  }

  async function addManual() {
    if (!name) return;
    const p = parseFloat(price);
    setSaving(true);
    try {
      const res = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, price: cfg.hasPrice && !isNaN(p) ? p : null, category, imageUrl }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) alert(data.error);
      else {
        setName(""); setPrice(""); setCategory(""); setImageUrl("");
        if (addImageRef.current) addImageRef.current.value = "";
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/catalog/${id}`, { method: "DELETE" });
    setItems((x) => x.filter((i) => i.id !== id));
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setEditName(item.name);
    setEditPrice(item.price != null ? item.price.toString() : "");
    setEditCategory(item.category || "");
    setEditImageUrl(item.imageUrl || "");
  }

  async function saveEdit(id: string) {
    if (!editName) return;
    const p = parseFloat(editPrice);
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          price: cfg.hasPrice && !isNaN(p) ? p : null,
          category: editCategory,
          imageUrl: editImageUrl || null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        alert(data.error);
      } else {
        setEditingId(null);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Import ──
  async function runImport() {
    setImporting(true);
    setImportNote("");
    setReview(null);
    setSuggestedNiche(null);
    try {
      let res: Response;
      if (mode === "file") {
        const file = fileRef.current?.files?.[0];
        if (!file) { setImporting(false); return; }
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/catalog/import", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/catalog/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "url" ? { url } : { text: pasteText }),
        });
      }
      const data = (await res.json()) as { items?: Draft[]; suggestedNiche?: string; usedAi?: boolean; message?: string; error?: string };
      if (data.error) { setImportNote(data.error); return; }
      setReview(data.items ?? []);
      setSuggestedNiche(data.suggestedNiche ?? null);
      setImportNote(
        data.message ??
          `Extracted ${data.items?.length ?? 0} ${cfg.itemNounPlural}${data.usedAi ? " (AI)" : " (best-effort — add a GEMINI_API_KEY for smarter extraction)"}. Review and save.`,
      );
    } finally {
      setImporting(false);
    }
  }

  function editReview(idx: number, patch: Partial<Draft>) {
    setReview((r) => r!.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function saveReview() {
    if (!review?.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/catalog/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: review }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to save items.");
        return;
      }
      setReview(null);
      setPasteText(""); setUrl("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      alert("An error occurred while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{cfg.pageTitle}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">{cfg.pageDesc}</p>
        </div>
      </div>

      {/* Import panel */}
      <div className="tile mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Upload className="h-4 w-4 text-[var(--color-gold)]" /> Import {cfg.itemNounPlural}
        </h2>
        <div className="mb-4 flex gap-2">
          {([["file", "Upload file", Upload], ["url", "From URL", Link2], ["text", "Paste text", ClipboardType]] as const).map(
            ([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${mode === m ? "border-[var(--color-gold)] text-[var(--color-gold-soft)]" : "border-[var(--color-slate-line)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ),
          )}
        </div>

        {mode === "file" && (
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md" className="fld" />
        )}
        {mode === "url" && (
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbusiness.com/menu" className="fld" />
        )}
        {mode === "text" && (
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={5} placeholder={`Paste your ${cfg.itemNounPlural} list…`} className="fld resize-y" />
        )}

        <div className="mt-2 text-xs text-[var(--color-ink-faint)]">
          Accepts PDF, Word, Excel, CSV, text, or a website URL — up to 25MB.
        </div>

        <button onClick={runImport} disabled={importing} className="btn-gold mt-4 !w-auto px-4">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Extract
        </button>
        {importNote && <p className="mt-3 text-sm text-[var(--color-gold-soft)]">{importNote}</p>}

        {/* Suggested niche */}
        {suggestedNiche && suggestedNiche !== niche && (
          <p className="mt-2 text-sm">
            Detected business type: <strong>{nicheConfig(suggestedNiche).businessLabel}</strong>{" "}
            <button onClick={() => changeNiche(suggestedNiche)} className="text-[var(--color-gold)] underline">apply</button>
          </p>
        )}

        {/* Review table */}
        {review && review.length > 0 && (
          <div className="mt-5 rounded-lg border border-[var(--color-slate-line)] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              Review {review.length} {cfg.itemNounPlural}
            </p>
            <div className="space-y-2">
              {review.map((d, idx) => (
                <div key={idx} className="grid grid-cols-[2fr_1fr_auto] gap-2">
                  <input value={d.name} onChange={(e) => editReview(idx, { name: e.target.value })} className="fld !py-1.5" />
                  {cfg.hasPrice ? (
                    <input
                      value={d.price ?? ""}
                      onChange={(e) => editReview(idx, { price: e.target.value === "" ? null : parseFloat(e.target.value) })}
                      placeholder="Price"
                      inputMode="decimal"
                      className="fld !py-1.5"
                    />
                  ) : (
                    <input value={d.category ?? ""} onChange={(e) => editReview(idx, { category: e.target.value })} placeholder={cfg.categoryLabel} className="fld !py-1.5" />
                  )}
                  <button onClick={() => setReview((r) => r!.filter((_, i) => i !== idx))} className="px-2 text-[var(--color-ink-faint)] hover:text-red-400">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={saveReview} disabled={saving} className="btn-gold !w-auto px-4">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save {review.length} {cfg.itemNounPlural}
              </button>
              <button onClick={() => setReview(null)} className="btn-outline !w-auto px-4">Discard</button>
            </div>
          </div>
        )}
      </div>

      {/* Manual add */}
      <div className="tile mb-8 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-[var(--color-gold)]" /> Add {cfg.itemNoun}
        </h2>
        <div className={`grid gap-4 ${cfg.hasPrice ? "sm:grid-cols-[2fr_1fr_1fr]" : "sm:grid-cols-2"}`}>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={cfg.namePlaceholder} className="fld" /></Field>
          {cfg.hasPrice && <Field label="Price (CAD)"><input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.00" inputMode="decimal" className="fld" /></Field>}
          <Field label={cfg.categoryLabel}><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={cfg.categoryPlaceholder} className="fld" /></Field>
        </div>
        <div className="mt-4">
          <Field label="Photo (optional)">
            <div className="flex items-center gap-3">
              {imageUrl && (
                <img src={imageUrl} alt="Preview" className="h-12 w-12 rounded-full object-cover border border-[var(--color-slate-line)]" />
              )}
              <input
                ref={addImageRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, setImageUrl)}
                className="fld !py-1.5 text-sm cursor-pointer"
              />
              {imageUrl && (
                <button onClick={() => setImageUrl("")} className="text-xs text-red-400 hover:underline">Remove</button>
              )}
            </div>
          </Field>
        </div>
        <button onClick={addManual} disabled={saving} className="btn-gold mt-5 !w-auto px-4">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add {cfg.itemNoun}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-[var(--color-ink-dim)]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="tile p-10 text-center text-sm text-[var(--color-ink-dim)]">
          No {cfg.itemNounPlural} yet. Import from a document/URL or add manually above.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((i) => {
            const isEditing = editingId === i.id;
            if (isEditing) {
              return (
                <div key={i.id} className="tile p-4 space-y-3">
                  <div className="space-y-2">
                    <div>
                      <span className="block mb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">Name</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="fld !py-1.5 !px-2.5 text-sm"
                      />
                    </div>
                    <div>
                      <span className="block mb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">{cfg.categoryLabel}</span>
                      <input
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="fld !py-1.5 !px-2.5 text-sm"
                      />
                    </div>
                    {cfg.hasPrice && (
                      <div>
                        <span className="block mb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">Price (CAD)</span>
                        <input
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          placeholder="0.00"
                          inputMode="decimal"
                          className="fld !py-1.5 !px-2.5 text-sm"
                        />
                      </div>
                    )}
                    <div>
                      <span className="block mb-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">Photo</span>
                      <div className="flex items-center gap-2 mt-1">
                        {editImageUrl && (
                          <img src={editImageUrl} alt="Preview" className="h-9 w-9 rounded-full object-cover border border-[var(--color-slate-line)]" />
                        )}
                        <input
                          ref={editImageRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleFileChange(e, setEditImageUrl)}
                          className="text-xs text-[var(--color-ink-dim)] file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-[var(--color-navy-700)] file:text-[var(--color-gold-soft)] hover:file:brightness-110 cursor-pointer"
                        />
                        {editImageUrl && (
                          <button onClick={() => setEditImageUrl("")} className="text-xs text-red-400 hover:underline">Remove</button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => saveEdit(i.id)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded bg-[var(--color-gold)] px-2.5 py-1 text-xs font-semibold text-[var(--color-midnight)] hover:brightness-110 disabled:opacity-75"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="inline-flex items-center gap-1 rounded border border-[var(--color-slate-line)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={i.id} className="tile tile-hover flex items-center justify-between p-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Circular Avatar Photo or Placeholder */}
                  <div className="h-12 w-12 shrink-0 rounded-full overflow-hidden bg-[var(--color-navy-700)] border border-[var(--color-slate-line)]/50 flex items-center justify-center">
                    {i.imageUrl ? (
                      <img src={i.imageUrl} alt={i.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-[var(--color-gold-soft)] uppercase tracking-wide">
                        {i.name.slice(0, 2)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{i.name}</p>
                    {i.category && <p className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">{i.category}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {i.price != null && <span className="font-semibold text-[var(--color-gold-soft)]">${i.price.toFixed(2)}</span>}
                  <button onClick={() => startEdit(i)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-gold)]">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => remove(i.id)} className="text-[var(--color-ink-faint)] hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
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
