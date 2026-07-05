"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, AudioLines, CheckCircle2, Play } from "lucide-react";
import { VOICES, TONES } from "@/lib/voices";

interface Settings {
  receptionistName: string;
  voiceId: string;
  voiceSpeed: number;
  tone: string;
  greetingMessage: string;
  recordCalls: boolean;
  forwardingNumber: string;
  forwardingNumbers: Record<string, string>;
}

export default function AgentSettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function previewVoice() {
    if (!s || previewing) return;
    setPreviewing(true);
    try {
      const text = s.greetingMessage?.trim() || "Hi! Thanks for calling. How can I help you today?";
      const res = await fetch(`/api/tts?voice=${encodeURIComponent(s.voiceId)}&text=${encodeURIComponent(text)}`);
      if (!res.ok) throw new Error("tts failed");
      const url = URL.createObjectURL(await res.blob());
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPreviewing(false);
      audio.onerror = () => setPreviewing(false);
      await audio.play();
    } catch {
      setPreviewing(false);
      alert("Could not preview this voice. Make sure GEMINI_API_KEY is set.");
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/agent-settings");
      const data = (await res.json()) as { settings: Settings | null };
      setS(data.settings);
      setLoading(false);
    })();
  }, []);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      await fetch("/api/agent-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !s) {
    return <div className="px-5 py-6 text-sm text-[var(--color-ink-dim)] sm:px-8">Loading…</div>;
  }

  return (
    <div className="w-full px-5 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <AudioLines className="h-6 w-6 text-[var(--color-gold)]" /> Agent &amp; Voice
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
          Change how your receptionist sounds and behaves on calls — anytime.
        </p>
      </div>

      <div className="tile space-y-6 p-6">
        <Field label="Receptionist name" hint="The name the agent introduces itself with.">
          <input className="fld" value={s.receptionistName} onChange={(e) => set("receptionistName", e.target.value)} placeholder="Ava" />
        </Field>

        <Field label="Voice" hint="The voice callers hear, powered by Google Gemini. Press play to preview.">
          <div className="flex gap-2">
            <select className="fld" value={s.voiceId} onChange={(e) => set("voiceId", e.target.value)}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {v.note}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={previewVoice}
              disabled={previewing}
              className="btn-outline !w-auto shrink-0 px-4"
              aria-label="Preview voice"
            >
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Preview
            </button>
          </div>
        </Field>

        <Field label="Tone" hint="Shapes the agent's wording and personality.">
          <select className="fld" value={s.tone} onChange={(e) => set("tone", e.target.value)}>
            {TONES.map((t) => (
              <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </Field>

        <Field label="Greeting" hint="The first thing the agent says when it answers.">
          <textarea className="fld resize-y" rows={2} value={s.greetingMessage} onChange={(e) => set("greetingMessage", e.target.value)} />
        </Field>

        <Field label="Call Forwarding Number" hint="Phone number (E.164 format, e.g., +15555555555) to forward calls to if the agent cannot answer or if a transfer is requested.">
          <input className="fld" value={s.forwardingNumber || ""} onChange={(e) => set("forwardingNumber", e.target.value)} placeholder="+15555555555" />
        </Field>

        <Field label="Department Call Forwarding" hint="Direct specific departments (e.g. sales, support) to unique numbers.">
          <div className="space-y-3">
            {Object.entries(s.forwardingNumbers || {}).map(([dept, num]) => (
              <div key={dept} className="flex gap-2 items-center">
                <input
                  type="text"
                  className="fld !w-1/3"
                  value={dept}
                  disabled
                  placeholder="Department"
                />
                <input
                  type="text"
                  className="fld"
                  value={num}
                  onChange={(e) => {
                    const updated = { ...s.forwardingNumbers, [dept]: e.target.value };
                    set("forwardingNumbers", updated);
                  }}
                  placeholder="+15555555555"
                />
                <button
                  type="button"
                  onClick={() => {
                    const updated = { ...s.forwardingNumbers };
                    delete updated[dept];
                    set("forwardingNumbers", updated);
                  }}
                  className="btn-outline !w-auto shrink-0 px-3 text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}

            <div className="flex gap-2 items-center pt-2">
              <input
                type="text"
                id="new-dept-name"
                className="fld !w-1/3 text-sm"
                placeholder="e.g. Sales"
              />
              <input
                type="text"
                id="new-dept-phone"
                className="fld text-sm"
                placeholder="e.g. +15550100"
              />
              <button
                type="button"
                onClick={() => {
                  const nameInput = document.getElementById("new-dept-name") as HTMLInputElement;
                  const phoneInput = document.getElementById("new-dept-phone") as HTMLInputElement;
                  const name = nameInput.value.trim().toLowerCase();
                  const phone = phoneInput.value.trim();
                  if (name && phone) {
                    const updated = { ...s.forwardingNumbers, [name]: phone };
                    set("forwardingNumbers", updated);
                    nameInput.value = "";
                    phoneInput.value = "";
                  } else {
                    alert("Please enter both department name and phone number.");
                  }
                }}
                className="btn-outline !w-auto shrink-0 px-3 text-sm"
              >
                Add Dept
              </button>
            </div>
          </div>
        </Field>

        <label className="flex items-center justify-between">
          <span>
            <span className="block text-sm font-medium">Record calls</span>
            <span className="text-xs text-[var(--color-ink-dim)]">Store an audio recording of each call.</span>
          </span>
          <input type="checkbox" checked={s.recordCalls} onChange={(e) => set("recordCalls", e.target.checked)} className="h-5 w-5 accent-[var(--color-gold)]" />
        </label>

        <div className="flex items-center gap-3 border-t border-[var(--color-slate-line)] pt-5">
          <button onClick={save} disabled={saving} className="btn-gold !w-auto px-5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {hint && <p className="mb-2 text-xs text-[var(--color-ink-dim)]">{hint}</p>}
      {children}
    </div>
  );
}
