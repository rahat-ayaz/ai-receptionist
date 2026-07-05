import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Phone, Clock, ShieldCheck, Activity, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { CallsTable, type CallRow } from "@/components/dashboard/CallsTable";
import { DEMO_CALLS, DEMO_STATS } from "@/lib/demo";
import { PLANS, type PlanTier } from "@/lib/plans";

export const dynamic = "force-dynamic";

interface DashboardData {
  businessName: string;
  twilioNumber: string | null;
  totalCalls: number;
  avgDuration: number;
  spamPct: number;
  activeNow: number;
  calls: CallRow[];
  usage: { used: number; included: number; tier: PlanTier } | null;
  isDemo: boolean;
}

async function loadDashboard(): Promise<DashboardData> {
  try {
    // Resolve the signed-in user's BusinessProfile.
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { ...DEMO_STATS, twilioNumber: "+1 (888) 321-0918", calls: DEMO_CALLS, usage: null, isDemo: true };
    }

    const profile = await prisma.businessProfile.findUnique({
      where: { userId: session.user.id },
      include: {
        user: { include: { subscription: true } },
        twilioNumbers: { where: { active: true }, select: { phoneNumber: true }, take: 1 },
      },
    });

    if (!profile) {
      // Authenticated but not onboarded yet.
      return {
        ...DEMO_STATS,
        businessName: session.user.name || "Your business",
        twilioNumber: null,
        calls: DEMO_CALLS,
        usage: null,
        isDemo: true,
      };
    }

    const sessions = await prisma.callSession.findMany({
      where: { businessProfileId: profile.id },
      orderBy: { startedAt: "desc" },
      take: 25,
    });

    const twilioNumber = profile.twilioNumbers[0]?.phoneNumber ?? null;

    if (sessions.length === 0) {
      return { ...DEMO_STATS, businessName: profile.name, twilioNumber, calls: DEMO_CALLS, usage: null, isDemo: true };
    }

    const totalCalls = sessions.length;
    const avgDuration = Math.round(
      sessions.reduce((a, s) => a + (s.durationSeconds ?? 0), 0) / totalCalls,
    );
    const spamPct = Math.round((sessions.filter((s) => s.isSpam).length / totalCalls) * 100);
    const activeNow = sessions.filter((s) => s.status === "IN_PROGRESS").length;

    const calls: CallRow[] = sessions.map((s) => ({
      id: s.id,
      callerNumber: s.callerNumber,
      startedAt: s.startedAt.toISOString(),
      durationSeconds: s.durationSeconds ?? 0,
      category: s.category,
      tags: s.tags,
      isSpam: s.isSpam,
      status: s.status,
      summary: s.summary,
      sentiment: s.sentiment,
      recordingUrl: s.recordingUrl ? `/api/calls/${s.id}/recording` : null,
      transcript: (s.transcript as { role: string; text: string; at: string }[]) ?? [],
    }));

    const sub = profile.user.subscription;
    return {
      businessName: profile.name,
      twilioNumber,
      totalCalls,
      avgDuration,
      spamPct,
      activeNow,
      calls,
      usage: sub ? { used: sub.callsUsed, included: sub.callsIncluded, tier: sub.tier } : null,
      isDemo: false,
    };
  } catch {
    // No reachable database — render the demo experience.
    return { ...DEMO_STATS, twilioNumber: "+1 (888) 321-0918", calls: DEMO_CALLS, usage: null, isDemo: true };
  }
}

function fmtDuration(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const profile = await prisma.businessProfile.findUnique({
    where: { userId: session.user.id },
  });

  if (!profile) {
    redirect("/onboarding");
  }

  const d = await loadDashboard();
  const { billing } = await searchParams;
  const usage = d.usage ?? { used: 7, included: PLANS.STARTER.callCap, tier: "STARTER" as PlanTier };
  const usagePct = Math.min(100, Math.round((usage.used / usage.included) * 100));

  return (
    <div className="px-5 py-6 sm:px-8">
      {billing === "success" && (
        <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
          Subscription active — your plan is now live. Thanks for subscribing to CAPRO.
        </div>
      )}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{d.businessName}</h1>
          {d.twilioNumber && (
            <p className="mt-1 font-mono text-base text-[var(--color-gold-soft)]">
              Receptionist number: <span className="text-lg font-bold">{d.twilioNumber}</span>
            </p>
          )}
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">Live receptionist telemetry</p>
        </div>
        {d.isDemo && (
          <span className="rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--color-gold-soft)]">
            Demo data
          </span>
        )}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile icon={<Phone className="h-5 w-5" />} label="Total calls" value={String(d.totalCalls)} />
        <StatTile icon={<Clock className="h-5 w-5" />} label="Avg line time" value={fmtDuration(d.avgDuration)} />
        <StatTile icon={<ShieldCheck className="h-5 w-5" />} label="Spam mitigated" value={`${d.spamPct}%`} />
        <StatTile icon={<Activity className="h-5 w-5" />} label="Active now" value={String(d.activeNow)} accent />
      </div>

      {/* Usage gauge */}
      <div className="tile mt-4 p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">
            {PLANS[usage.tier].name} plan usage
          </span>
          <span className="text-[var(--color-ink-dim)]">
            {usage.used} / {usage.included} calls · ${PLANS[usage.tier].overage.toFixed(2)} overage
          </span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-navy-700)]">
          <div
            className="h-full rounded-full bg-[var(--color-gold)] transition-all"
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {/* Calls */}
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
        Recent calls
      </h2>
      <CallsTable calls={d.calls} />
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`tile tile-hover p-5 ${accent ? "gold-glow" : ""}`}>
      <div
        className={`grid h-10 w-10 place-items-center rounded-[10px] ${
          accent ? "bg-[var(--color-gold)] text-[var(--color-midnight)]" : "bg-[var(--color-navy-700)] text-[var(--color-gold)]"
        }`}
      >
        {icon}
      </div>
      <p className="mt-3.5 text-2xl font-bold">{value}</p>
      <p className="text-xs text-[var(--color-ink-dim)]">{label}</p>
    </div>
  );
}
