import Link from "next/link";
import { ArrowRight, PhoneCall, Clock, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/Brand";
import { PricingCards } from "@/components/PricingCards";

const FEATURES = [
  { icon: PhoneCall, title: "Answers every call", body: "A natural-voice AI receptionist powered by Gemini picks up on the first ring — no menus, no hold music." },
  { icon: Clock, title: "24/7 availability", body: "Continuous coverage loops so you never miss a lead, after hours or at peak volume." },
  { icon: MessageSquareText, title: "Instant SMS triggers", body: "Fire booking links, addresses, or quotes by text the moment a caller asks." },
  { icon: ShieldCheck, title: "Spam mitigation", body: "Robocalls are detected and filtered, keeping your telemetry and your time clean." },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-5 py-6">
      {/* Nav */}
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-3 text-sm">
          <Link href="#pricing" className="hidden text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] sm:block">
            Pricing
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-[var(--color-slate-line)] px-3.5 py-2 font-medium hover:border-[var(--color-gold)]/60"
          >
            Dashboard
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-[var(--color-gold)] px-3.5 py-2 font-semibold text-[var(--color-midnight)] hover:brightness-110"
          >
            Get started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="py-20 text-center sm:py-28">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-slate-line)] px-3 py-1 text-xs text-[var(--color-gold-soft)]">
          <Sparkles className="h-3.5 w-3.5" /> Enterprise AI receptionist
        </span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Never miss a call.
          <br />
          <span className="text-[var(--color-gold)]">Let CAPRO answer.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-[var(--color-ink-dim)] sm:text-lg">
          A zero-friction AI receptionist that learns your business in seconds, answers every call in a natural
          voice, books appointments, and texts your customers — around the clock.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-gold)] px-5 py-3 font-semibold text-[var(--color-midnight)] hover:brightness-110"
          >
            Train your agent <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-[var(--color-slate-line)] px-5 py-3 font-medium hover:border-[var(--color-gold)]/60"
          >
            View dashboard
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="tile tile-hover p-6">
            <div className="grid h-10 w-10 place-items-center rounded-[10px] bg-[var(--color-navy-700)] text-[var(--color-gold)]">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm text-[var(--color-ink-dim)]">{f.body}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 sm:py-28">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple, scalable pricing</h2>
          <p className="mt-3 text-[var(--color-ink-dim)]">
            Every tier includes 24/7 coverage, SMS summaries, transcripts, and telemetry capture.
          </p>
        </div>
        <PricingCards />
      </section>

      <footer className="border-t border-[var(--color-slate-line)] py-8 text-center text-sm text-[var(--color-ink-faint)]">
        © {new Date().getFullYear()} TorqAI Technologies Inc. · torqai.ca
      </footer>
    </main>
  );
}
