import { headers } from "next/headers";
import type Stripe from "stripe";
import { CheckCircle2, Download, ExternalLink } from "lucide-react";
import { PricingCards } from "@/components/PricingCards";
import { ManageButton } from "@/components/billing/ManageButton";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { PLANS, type PlanTier } from "@/lib/plans";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10" },
  PAST_DUE: { label: "Past due", cls: "text-amber-400 border-amber-400/40 bg-amber-400/10" },
  CANCELED: { label: "Canceled", cls: "text-red-400 border-red-400/40 bg-red-400/10" },
  UNPAID: { label: "Unpaid", cls: "text-red-400 border-red-400/40 bg-red-400/10" },
  INCOMPLETE: { label: "Incomplete", cls: "text-[var(--color-ink-dim)] border-[var(--color-slate-line)] bg-[var(--color-navy-700)]" },
};

const INVOICE_STATUS: Record<string, string> = {
  paid: "text-emerald-400 border-emerald-400/40 bg-emerald-400/10",
  open: "text-amber-400 border-amber-400/40 bg-amber-400/10",
  void: "text-red-400 border-red-400/40 bg-red-400/10",
  uncollectible: "text-red-400 border-red-400/40 bg-red-400/10",
  draft: "text-[var(--color-ink-dim)] border-[var(--color-slate-line)] bg-[var(--color-navy-700)]",
};

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

const money = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** Pull the customer's invoices from Stripe for the history table. */
async function loadInvoices(userId: string): Promise<Stripe.Invoice[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stripeCustomerId: true } });
  if (!user?.stripeCustomerId) return [];
  try {
    const list = await getStripe().invoices.list({ customer: user.stripeCustomerId, limit: 24 });
    return list.data;
  } catch (err) {
    console.error("[billing] could not load invoices:", err);
    return [];
  }
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ trial?: string }>;
}) {
  const { trial } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  const sub = session
    ? await prisma.subscription.findUnique({ where: { userId: session.user.id } })
    : null;
  const invoices = session ? await loadInvoices(session.user.id) : [];

  const hasActivePlan = sub && sub.status !== "CANCELED" && sub.stripeSubscriptionId;
  const currentTier = (hasActivePlan ? sub!.tier : null) as PlanTier | null;

  return (
    <main className="w-full px-5 py-8 sm:px-8">
      {trial === "expired" && (
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          <p className="font-semibold">Your 7-day free trial has expired.</p>
          <p className="mt-1 text-xs opacity-90">
            Please choose a subscription plan below to reactivate your AI receptionist and restore access to your dashboard.
          </p>
        </div>
      )}
      {/* Current subscription panel */}
      {hasActivePlan && sub && (
        <div className="tile mt-8 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold">{PLANS[sub.tier as PlanTier].name} plan</h2>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_LABEL[sub.status]?.cls ?? ""
                  }`}
                >
                  {STATUS_LABEL[sub.status]?.label ?? sub.status}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--color-ink-dim)]">
                {sub.callsIncluded} calls / mo · ${PLANS[sub.tier as PlanTier].price}/mo ·{" "}
                {sub.cancelAtPeriodEnd
                  ? `Cancels ${fmtDate(sub.periodEnd)}`
                  : `Renews ${fmtDate(sub.periodEnd)}`}
              </p>
            </div>
            <ManageButton />
          </div>
        </div>
      )}

      {/* Billing history */}
      {invoices.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
            Billing history
          </h2>
          <div className="tile overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-slate-line)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-slate-line)]/50 last:border-0">
                    <td className="px-5 py-3 text-[var(--color-ink-dim)]">
                      {inv.created ? fmtDate(new Date(inv.created * 1000)) : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-[var(--color-ink-dim)]">{inv.number ?? "—"}</td>
                    <td className="px-5 py-3 font-medium">{money(inv.total ?? 0, inv.currency)}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${INVOICE_STATUS[inv.status ?? "draft"] ?? ""}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {inv.hosted_invoice_url && (
                          <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]">
                            <ExternalLink className="h-3.5 w-3.5" /> View
                          </a>
                        )}
                        {inv.invoice_pdf && (
                          <a href={inv.invoice_pdf} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-gold-soft)] hover:text-[var(--color-gold)]">
                            <Download className="h-3.5 w-3.5" /> PDF
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {hasActivePlan ? "Change your plan" : "Choose your plan"}
        </h1>
        <p className="mt-3 text-[var(--color-ink-dim)]">
          {hasActivePlan
            ? "Switch tiers anytime. Overage is metered per call beyond your monthly cap."
            : "Start a subscription. Overage is metered per call beyond your monthly cap."}
        </p>
        {session && !hasActivePlan && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--color-gold-soft)]">
            <CheckCircle2 className="h-4 w-4" /> Secure checkout powered by Stripe
          </p>
        )}
      </div>

      <PricingCards currentTier={currentTier} />
    </main>
  );
}
