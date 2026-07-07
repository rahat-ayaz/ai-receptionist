"use client";

import { useState } from "react";
import { PhoneOutgoing, X, Loader2, CheckCircle2 } from "lucide-react";

export function OutboundCallButton() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleCall(e: React.FormEvent) {
    e.preventDefault();
    if (!phone) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/telephony/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name, context }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to initiate outbound call.");
      } else {
        setSuccess(true);
        setTimeout(() => {
          setOpen(false);
          setSuccess(false);
          setPhone("");
          setName("");
          setContext("");
        }, 2000);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-gold)] px-3.5 py-2 text-xs font-semibold text-[var(--color-midnight)] hover:brightness-110 transition"
      >
        <PhoneOutgoing className="h-4 w-4" /> Dial Customer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-xl border border-[var(--color-slate-line)] bg-[var(--color-midnight)] p-6 shadow-2xl">
            <button
              onClick={() => setOpen(false)}
              className="absolute right-4 top-4 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="text-lg font-bold flex items-center gap-2">
              <PhoneOutgoing className="h-5 w-5 text-[var(--color-gold)]" /> Initiate Outbound Call
            </h3>
            <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
              The AI receptionist will dial the customer and converse with them.
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            {success ? (
              <div className="my-8 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-400 animate-bounce" />
                <p className="mt-3 text-sm font-semibold text-emerald-300">Call Initiated successfully!</p>
                <p className="mt-1 text-xs text-[var(--color-ink-dim)]">Dialing client...</p>
              </div>
            ) : (
              <form onSubmit={handleCall} className="mt-5 space-y-4">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">
                    Customer Name (optional)
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="fld mt-1.5"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">
                    Customer Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +15555555555"
                    className="fld mt-1.5"
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-semibold text-[var(--color-ink-faint)]">
                    Initial Context / Instructions (optional)
                  </label>
                  <textarea
                    rows={3}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="e.g. Ask the client if they received our invoice."
                    className="fld mt-1.5 resize-none"
                  />
                </div>

                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-[var(--color-slate-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-gold flex items-center justify-center gap-1.5 !w-auto px-5"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOutgoing className="h-3.5 w-3.5" />}
                    Call Now
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
