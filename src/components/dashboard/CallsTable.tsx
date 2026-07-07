"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Clock, ShieldAlert, PhoneIncoming, PhoneOutgoing, Volume2 } from "lucide-react";

export interface CallRow {
  id: string;
  callerNumber: string;
  startedAt: string;
  durationSeconds: number;
  category: string;
  tags: string[];
  isSpam: boolean;
  status: string;
  summary: string | null;
  sentiment: string;
  direction: "INBOUND" | "OUTBOUND";
  recordingUrl: string | null;
  transcript: { role: string; text: string; at: string }[];
}

const CATEGORY_STYLES: Record<string, string> = {
  SALES: "bg-emerald-400/10 text-emerald-300 border-emerald-400/20",
  GENERAL_INFO: "bg-sky-400/10 text-sky-300 border-sky-400/20",
  ISSUE: "bg-orange-400/10 text-orange-300 border-orange-400/20",
  URGENT: "bg-red-400/10 text-red-300 border-red-400/20",
  SPAM: "bg-zinc-400/10 text-zinc-300 border-zinc-400/20",
  UNCLASSIFIED: "bg-slate-400/10 text-slate-300 border-slate-400/20",
};

const SENTIMENT: Record<string, { emoji: string; label: string; cls: string }> = {
  POSITIVE: { emoji: "🙂", label: "Positive", cls: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  NEUTRAL: { emoji: "😐", label: "Neutral", cls: "text-slate-300 border-slate-400/30 bg-slate-400/10" },
  NEGATIVE: { emoji: "🙁", label: "Negative", cls: "text-red-300 border-red-400/30 bg-red-400/10" },
  MIXED: { emoji: "😕", label: "Mixed", cls: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
};
const sentimentOf = (s: string) => SENTIMENT[s] ?? SENTIMENT.NEUTRAL;

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallsTable({ calls }: { calls: CallRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (calls.length === 0) {
    return (
      <div className="tile p-10 text-center text-sm text-[var(--color-ink-dim)]">
        No calls yet. Provision a number to start receiving calls.
      </div>
    );
  }

  return (
    <div className="tile overflow-hidden">
      <div className="hidden grid-cols-12 gap-3 border-b border-[var(--color-slate-line)] px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)] sm:grid">
        <span className="col-span-3">Caller</span>
        <span className="col-span-3">When</span>
        <span className="col-span-2">Category</span>
        <span className="col-span-2">Duration</span>
        <span className="col-span-2 text-right">Transcript</span>
      </div>

      <div className="divide-y divide-[var(--color-slate-line)]">
        {calls.map((call) => {
          const isOpen = open === call.id;
          return (
            <div key={call.id}>
              <button
                onClick={() => setOpen(isOpen ? null : call.id)}
                className="grid w-full grid-cols-1 gap-2 px-5 py-4 text-left transition hover:bg-[var(--color-navy-700)]/40 sm:grid-cols-12 sm:items-center sm:gap-3"
              >
                <div className="col-span-3 flex items-center gap-2 font-medium">
                  {call.direction === "OUTBOUND" ? (
                    <PhoneOutgoing className="h-4 w-4 text-[var(--color-gold)]" />
                  ) : (
                    <PhoneIncoming className="h-4 w-4 text-sky-400" />
                  )}
                  {call.callerNumber}
                  {call.isSpam && <ShieldAlert className="h-4 w-4 text-zinc-400" aria-label="Spam" />}
                  <span className="text-sm" title={`Sentiment: ${sentimentOf(call.sentiment).label}`}>
                    {sentimentOf(call.sentiment).emoji}
                  </span>
                </div>
                <div className="col-span-3 text-sm text-[var(--color-ink-dim)]">
                  {new Date(call.startedAt).toLocaleString()}
                </div>
                <div className="col-span-2">
                  <span
                    className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                      CATEGORY_STYLES[call.category] ?? CATEGORY_STYLES.UNCLASSIFIED
                    }`}
                  >
                    {call.category.replace("_", " ")}
                  </span>
                </div>
                <div className="col-span-2 flex items-center gap-1.5 text-sm text-[var(--color-ink-dim)]">
                  <Clock className="h-3.5 w-3.5" /> {fmtDuration(call.durationSeconds)}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1 text-sm text-[var(--color-gold-soft)]">
                  View
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="bg-[var(--color-midnight)]/60 px-5 py-5">
                      <div className="mb-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sentimentOf(call.sentiment).cls}`}
                        >
                          {sentimentOf(call.sentiment).emoji} {sentimentOf(call.sentiment).label} sentiment
                        </span>
                      </div>
                      {call.recordingUrl && (
                        <div className="mb-4">
                          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                            <Volume2 className="h-3.5 w-3.5 text-[var(--color-gold)]" /> Recording
                          </p>
                          <audio
                            controls
                            preload="none"
                            src={call.recordingUrl}
                            className="h-10 w-full max-w-md"
                          />
                        </div>
                      )}
                      {call.summary && (
                        <p className="mb-4 rounded-lg border border-[var(--color-slate-line)] bg-[var(--color-navy-700)]/40 p-3 text-sm text-[var(--color-ink)]">
                          <span className="font-semibold text-[var(--color-gold)]">Summary · </span>
                          {call.summary}
                        </p>
                      )}
                      {call.tags.length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-1.5">
                          {call.tags.map((t) => (
                            <span key={t} className="rounded-md bg-[var(--color-slate-panel)] px-2 py-0.5 text-[11px] text-[var(--color-ink-dim)]">
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2.5">
                        {call.transcript.map((turn, i) => (
                          <div
                            key={i}
                            className={`flex ${turn.role === "agent" ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${
                                turn.role === "agent"
                                  ? "bg-[var(--color-navy-700)] text-[var(--color-ink)]"
                                  : "bg-[var(--color-gold)]/15 text-[var(--color-gold-soft)]"
                              }`}
                            >
                              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide opacity-60">
                                {turn.role}
                              </span>
                              {turn.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
