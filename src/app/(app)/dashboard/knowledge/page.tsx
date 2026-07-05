"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Upload, Link2, ClipboardType, Loader2, Trash2, FileText, Globe, Sparkles } from "lucide-react";

interface Blob {
  id: string;
  title: string;
  data: string;
  source: "MANUAL" | "PASTE" | "URL" | "DOCUMENT";
  active: boolean;
}

const SOURCE: Record<string, { label: string; icon: React.ReactNode }> = {
  DOCUMENT: { label: "Document", icon: <FileText className="h-3.5 w-3.5" /> },
  URL: { label: "Website", icon: <Globe className="h-3.5 w-3.5" /> },
  PASTE: { label: "Pasted", icon: <ClipboardType className="h-3.5 w-3.5" /> },
  MANUAL: { label: "Manual", icon: <BookOpen className="h-3.5 w-3.5" /> },
};

type Mode = "file" | "url" | "text";

export default function KnowledgePage() {
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("file");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const data = (await (await fetch("/api/knowledge")).json()) as { blobs: Blob[] };
    setBlobs(data.blobs ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function add() {
    setBusy(true);
    setNote("");
    try {
      let res: Response;
      if (mode === "file") {
        const file = fileRef.current?.files?.[0];
        if (!file) { setBusy(false); return; }
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/knowledge", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mode === "url" ? { url, title } : { text, title }),
        });
      }
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        setNote(data.error);
      } else {
        setUrl(""); setTitle(""); setText("");
        if (fileRef.current) fileRef.current.value = "";
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(b: Blob) {
    await fetch(`/api/knowledge/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !b.active }) });
    setBlobs((x) => x.map((y) => (y.id === b.id ? { ...y, active: !y.active } : y)));
  }
  async function remove(id: string) {
    await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    setBlobs((x) => x.filter((y) => y.id !== id));
  }

  return (
    <div className="w-full px-5 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Knowledge base</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          What your receptionist draws on for every answer. Upload documents, add a website, or paste
          text — the agent learns from everything here.
        </p>
      </div>

      {/* Add panel */}
      <div className="tile mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-[var(--color-gold)]" /> Train the agent
        </h2>
        <div className="mb-4 flex gap-2">
          {([["file", "Upload document", Upload], ["url", "From website", Link2], ["text", "Paste text", ClipboardType]] as const).map(
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
          <>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md" className="fld" />
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">PDF, Word, Excel, CSV, or text — up to 25MB.</p>
          </>
        )}
        {mode === "url" && (
          <div className="space-y-3">
            <input className="fld" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourbusiness.com/faq" />
            <input className="fld" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          </div>
        )}
        {mode === "text" && (
          <div className="space-y-3">
            <input className="fld" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Return policy)" />
            <textarea className="fld resize-y" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste any information the agent should know…" />
          </div>
        )}

        <button onClick={add} disabled={busy} className="btn-gold mt-4 !w-auto px-4">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Add to knowledge
        </button>
        {note && <p className="mt-3 text-sm text-red-400">{note}</p>}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-[var(--color-ink-dim)]">Loading…</p>
      ) : blobs.length === 0 ? (
        <div className="tile p-10 text-center text-sm text-[var(--color-ink-dim)]">
          No knowledge yet. Upload a document or paste text above to train your agent.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {blobs.map((b) => {
            const s = SOURCE[b.source] ?? SOURCE.MANUAL;
            return (
              <div key={b.id} className={`tile tile-hover p-5 ${b.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 font-semibold">
                    <BookOpen className="h-4 w-4 shrink-0 text-[var(--color-gold)]" />
                    <span className="truncate">{b.title}</span>
                  </div>
                  <button onClick={() => remove(b.id)} className="shrink-0 text-[var(--color-ink-faint)] hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-3 line-clamp-4 text-sm text-[var(--color-ink-dim)]">{b.data}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]">
                    {s.icon} {s.label}
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-ink-dim)]">
                    <input type="checkbox" checked={b.active} onChange={() => toggle(b)} className="h-3.5 w-3.5 accent-[var(--color-gold)]" />
                    {b.active ? "Active" : "Inactive"}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
