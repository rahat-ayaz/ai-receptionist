"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { PLANS, PLAN_ORDER, type PlanTier } from "@/lib/plans";

export function PricingCards({ currentTier }: { currentTier?: PlanTier | null }) {
  const [loading, setLoading] = useState<PlanTier | null>(null);
  const [error, setError] = useState("");

  async function subscribe(tier: PlanTier) {
    setError("");
    setLoading(tier);
    try {
      // Existing subscriber → change the plan in place (Stripe prorates).
      if (currentTier) {
        const res = await fetch("/api/billing/change", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier }),
        });
        if (res.status === 401) {
          window.location.href = "/login?redirect=/billing";
          return;
        }
        const data = (await res.json()) as { ok?: boolean; needsCheckout?: boolean; error?: string };
        if (data.ok) {
          window.location.reload();
          return;
        }
        if (!data.needsCheckout) {
          setError(data.error ?? "Could not change plan.");
          setLoading(null);
          return;
        }
        // No active subscription → fall through to Checkout.
      }

      // First-time subscriber → Stripe Checkout.
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      if (res.status === 401) {
        window.location.href = "/login?redirect=/billing";
        return;
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Could not start checkout.");
        setLoading(null);
      }
    } catch {
      setError("Network error — please try again.");
      setLoading(null);
    }
  }

  return (
    <div>
      {error && <p className="mb-4 text-center text-sm text-red-400">{error}</p>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((tier) => {
          const plan = PLANS[tier];
          const featured = tier === "PRO";
          const isCurrent = currentTier === tier;
          return (
            <div
              key={tier}
              className={`tile tile-hover flex flex-col p-6 ${
                isCurrent
                  ? "border-[var(--color-gold)] gold-glow"
                  : featured
                    ? "gold-glow border-[var(--color-gold)]/50"
                    : ""
              }`}
            >
              {isCurrent ? (
                <span className="mb-3 inline-block w-fit rounded-full border border-[var(--color-gold)] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-gold-soft)]">
                  Current plan
                </span>
              ) : featured ? (
                <span className="mb-3 inline-block w-fit rounded-full bg-[var(--color-gold)] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-midnight)]">
                  Most popular
                </span>
              ) : null}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <div className="mt-2 flex items-end gap-1">
                {plan.price > 0 ? (
                  <>
                    <span className="text-3xl font-bold">${plan.price}</span>
                    <span className="mb-1 text-sm text-[var(--color-ink-dim)]">/mo</span>
                  </>
                ) : (
                  <span className="text-3xl font-bold">Custom</span>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
                {plan.price > 0 ? (
                  `${plan.callCap} minutes included · $${plan.overage.toFixed(2)} per extra min`
                ) : (
                  "Tailored for large organizations."
                )}
              </p>

              {plan.price > 0 && (
                <div className="mt-3 inline-block w-fit rounded bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-gold-soft)]">
                  First 7 days FREE
                </div>
              )}

              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-gold)]" />
                    {h}
                  </li>
                ))}
              </ul>

              {plan.price > 0 ? (
                <button
                  onClick={() => subscribe(tier)}
                  disabled={loading !== null || isCurrent}
                  className={`mt-6 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
                    featured && !isCurrent
                      ? "bg-[var(--color-gold)] text-[var(--color-midnight)] hover:brightness-110"
                      : "border border-[var(--color-slate-line)] text-[var(--color-ink)] hover:border-[var(--color-gold)]/60"
                  }`}
                >
                  {loading === tier ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isCurrent
                    ? "Current plan"
                    : currentTier
                      ? `${plan.price > PLANS[currentTier].price ? "Upgrade" : "Downgrade"} to ${plan.name}`
                      : `Subscribe Now`}
                </button>
              ) : (
                <a
                  href="mailto:sales@torqai.ca"
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-slate-line)] px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)] transition hover:border-[var(--color-gold)]/60"
                >
                  Contact Sales
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
