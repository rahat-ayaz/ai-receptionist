"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { NICHE_OPTIONS } from "@/lib/niche";

export default function OnboardingPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [input, setInput] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("+18883210918");
  const [niche, setNiche] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("niche") || "RESTAURANT";
    }
    return "RESTAURANT";
  });
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function train() {
    if (!businessName || !input) return;
    setStatus("working");
    setMessage("Reading your business and building the rule matrix…");
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName, input, niche, phoneNumber }),
      });
      const data = (await res.json()) as { ok?: boolean; demo?: boolean; error?: string; message?: string };
      if (data.ok) {
        setStatus("done");
        setMessage(
          data.demo
            ? `${data.message ?? "Preview mode."} Taking you to the dashboard…`
            : "Your AI receptionist is trained. Redirecting to your dashboard…",
        );
        setTimeout(() => router.push("/dashboard"), 1800);
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error — please try again.");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
      <div className="py-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-slate-line)] px-3 py-1 text-xs text-[var(--color-gold-soft)]">
          <Sparkles className="h-3.5 w-3.5" /> Zero-friction setup
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Train your receptionist in one step</h1>
        <p className="mt-2 text-[var(--color-ink-dim)]">
          Paste a description of your business — or just drop your website URL. We&apos;ll do the rest.
        </p>

        <div className="tile mt-8 p-6">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Business name</span>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="TorqAI Technologies"
              className="ob-input"
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">Choose a receptionist phone number</span>
            <select
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="ob-input cursor-pointer"
            >
              <option value="+18883210918">+1 (888) 321-0918</option>
              <option value="+18885550199">+1 (888) 555-0199</option>
              <option value="+18884567890">+1 (888) 456-7890</option>
              <option value="+18887890123">+1 (888) 789-0123</option>
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">What kind of business is this?</span>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="ob-input cursor-pointer"
            >
              {NICHE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-ink-dim)]">
              Describe your business, or paste a website URL
            </span>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={7}
              placeholder="https://yourcompany.com  —  or  —  We're a dental clinic open Mon–Fri 9–5, we offer cleanings, whitening…"
              className="ob-input resize-y"
            />
          </label>

          <button
            onClick={train}
            disabled={status === "working" || status === "done"}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-5 py-3 text-sm font-semibold text-[var(--color-midnight)] hover:brightness-110 disabled:opacity-70"
          >
            {status === "working" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Train my agent
          </button>

          {message && (
            <p
              className={`mt-4 text-sm ${
                status === "error" ? "text-red-400" : "text-[var(--color-gold-soft)]"
              }`}
            >
              {message}
            </p>
          )}
        </div>
      </div>

      <style>{`
        .ob-input {
          width: 100%;
          border-radius: 8px;
          border: 1px solid var(--color-slate-line);
          background: rgba(12, 21, 42, 0.6);
          padding: 0.7rem 0.85rem;
          font-size: 0.9rem;
          color: var(--color-ink);
          outline: none;
        }
        select.ob-input {
          appearance: none;
          background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%239aa6bf' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
          background-position: right 0.85rem center;
          background-repeat: no-repeat;
          background-size: 1.25rem;
          padding-right: 2.5rem;
        }
        .ob-input:focus { border-color: var(--color-gold); }
      `}</style>
    </main>
  );
}
