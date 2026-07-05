import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { CallsTable, type CallRow } from "@/components/dashboard/CallsTable";
import { DEMO_CALLS } from "@/lib/demo";

export const dynamic = "force-dynamic";

async function loadCalls(): Promise<{ calls: CallRow[]; isDemo: boolean }> {
  try {
    const businessProfileId = await currentProfileId();
    if (!businessProfileId) return { calls: DEMO_CALLS, isDemo: true };

    const sessions = await prisma.callSession.findMany({
      where: { businessProfileId },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
    if (sessions.length === 0) return { calls: DEMO_CALLS, isDemo: true };
    return {
      isDemo: false,
      calls: sessions.map((s) => ({
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
      })),
    };
  } catch {
    return { calls: DEMO_CALLS, isDemo: true };
  }
}

export default async function CallsPage() {
  const { calls, isDemo } = await loadCalls();
  return (
    <div className="px-5 py-6 sm:px-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call log</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-dim)]">Every conversation, transcribed and classified.</p>
        </div>
        {isDemo && (
          <span className="rounded-full border border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 px-3 py-1 text-xs font-medium text-[var(--color-gold-soft)]">
            Demo data
          </span>
        )}
      </div>
      <CallsTable calls={calls} />
    </div>
  );
}
