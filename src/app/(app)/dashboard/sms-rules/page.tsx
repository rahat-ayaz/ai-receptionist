"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, MessageSquareText, Loader2 } from "lucide-react";

interface Rule {
  id: string;
  label: string;
  matchKeywords: string[];
  messageTemplate: string;
  fireOn: "DURING_CALL" | "AFTER_CALL";
  active: boolean;
}

export default function SmsRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [keywords, setKeywords] = useState("");
  const [template, setTemplate] = useState("");
  const [fireOn, setFireOn] = useState<"DURING_CALL" | "AFTER_CALL">("DURING_CALL");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/sms-rules");
    const data = (await res.json()) as { rules: Rule[] };
    setRules(data.rules ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!label || !keywords || !template) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sms-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          matchKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
          messageTemplate: template,
          fireOn,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) {
        alert(data.error);
      } else {
        setLabel("");
        setKeywords("");
        setTemplate("");
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/sms-rules/${id}`, { method: "DELETE" });
    setRules((r) => r.filter((x) => x.id !== id));
  }

  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">SMS Trigger Rules</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          Dispatch an out-of-band text when a caller mentions a keyword. Tokens:{" "}
          <code className="text-[var(--color-gold-soft)]">{"{{businessName}}"}</code>,{" "}
          <code className="text-[var(--color-gold-soft)]">{"{{callerNumber}}"}</code>.
        </p>
      </div>

      {/* Builder card */}
      <div className="tile mb-8 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4 text-[var(--color-gold)]" /> New rule
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Send booking link"
              className="cap-input"
            />
          </Field>
          <Field label="Fire timing">
            <select
              value={fireOn}
              onChange={(e) => setFireOn(e.target.value as "DURING_CALL" | "AFTER_CALL")}
              className="cap-input"
            >
              <option value="DURING_CALL">During call</option>
              <option value="AFTER_CALL">After call</option>
            </select>
          </Field>
          <Field label="Match keywords (comma separated)">
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="book, appointment, schedule"
              className="cap-input"
            />
          </Field>
          <Field label="Message template">
            <input
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Book here: https://torqai.ca/book"
              className="cap-input"
            />
          </Field>
        </div>
        <button
          onClick={create}
          disabled={saving}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-4 py-2.5 text-sm font-semibold text-[var(--color-midnight)] hover:brightness-110 disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add rule
        </button>
      </div>

      {/* Existing rules */}
      {loading ? (
        <p className="text-sm text-[var(--color-ink-dim)]">Loading…</p>
      ) : rules.length === 0 ? (
        <div className="tile p-10 text-center text-sm text-[var(--color-ink-dim)]">No trigger rules yet.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rules.map((r) => (
            <div key={r.id} className="tile tile-hover p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <MessageSquareText className="h-4 w-4 text-[var(--color-gold)]" />
                  {r.label}
                </div>
                <button onClick={() => remove(r.id)} className="text-[var(--color-ink-faint)] hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.matchKeywords.map((k) => (
                  <span key={k} className="rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]">
                    {k}
                  </span>
                ))}
              </div>
              <p className="mt-3 rounded-lg border border-[var(--color-slate-line)] bg-[var(--color-navy-700)]/40 p-2.5 text-sm text-[var(--color-ink)]">
                {r.messageTemplate}
              </p>
              <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                {r.fireOn === "DURING_CALL" ? "During call" : "After call"}
              </p>
            </div>
          ))}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">{label}</span>
      {children}
    </label>
  );
}
