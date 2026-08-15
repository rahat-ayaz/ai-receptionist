import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/twilio";
import { isComplimentaryUser } from "@/lib/billing";
import { cronCadenceMs } from "@/lib/cron-cadence";
import { appBaseUrl } from "@/lib/app-url";

const HOUR_MS = 60 * 60 * 1000;
const TRIAL_MS = 7 * 24 * HOUR_MS;

type TrialTier = {
  key: "3d" | "24h" | "3h";
  offsetMs: number;
  sentField: "trial3dReminderSentAt" | "trial24hReminderSentAt" | "trial3hReminderSentAt";
};

/** Trial-expiry tiers, most urgent first. */
const TIERS: TrialTier[] = [
  { key: "3h", offsetMs: 3 * HOUR_MS, sentField: "trial3hReminderSentAt" },
  { key: "24h", offsetMs: 24 * HOUR_MS, sentField: "trial24hReminderSentAt" },
  { key: "3d", offsetMs: 72 * HOUR_MS, sentField: "trial3dReminderSentAt" },
];

const WIDEST_OFFSET_MS = Math.max(...TIERS.map((t) => t.offsetMs));

export type TrialReminderSummary = {
  scanned: number;
  sent: Record<TrialTier["key"], number>;
  failed: number;
};

/**
 * Describe the real time remaining rather than restating the tier's nominal
 * offset. A tier fires as soon as it would come due before the next cron run,
 * so on a daily schedule the "3 hours" tier routinely goes out a day ahead —
 * saying "3 hours" then would simply be false.
 */
function describeRemaining(ms: number): string {
  const hours = ms / HOUR_MS;
  if (hours >= 48) {
    const days = Math.round(hours / 24);
    return `${days} days`;
  }
  if (hours >= 2) return `${Math.round(hours)} hours`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} minutes`;
}

/**
 * Send trial-expiry reminders. Mirrors the booking reminder sweep: a tier
 * fires when it would come due before the next run, at most one reminder goes
 * out per user per run, and coarser pending tiers are marked superseded so the
 * user never receives a "3 days left" notice after a "2 hours left" one.
 */
export async function runTrialReminders(now = new Date()): Promise<TrialReminderSummary> {
  const cadenceMs = cronCadenceMs();

  // trialEndsAt = createdAt + TRIAL_MS, so bound the scan by createdAt: the
  // trial must still be running and must come due within the widest tier.
  const candidates = await prisma.user.findMany({
    where: {
      createdAt: {
        gt: new Date(now.getTime() - TRIAL_MS),
        lte: new Date(now.getTime() + WIDEST_OFFSET_MS + cadenceMs - TRIAL_MS),
      },
      OR: [
        { trial3dReminderSentAt: null },
        { trial24hReminderSentAt: null },
        { trial3hReminderSentAt: null },
      ],
    },
    include: { subscription: true },
  });

  const sent: Record<TrialTier["key"], number> = { "3d": 0, "24h": 0, "3h": 0 };
  let failed = 0;
  let scanned = 0;

  for (const user of candidates) {
    const hasSub = user.subscription && user.subscription.status !== "CANCELED";
    if (hasSub) continue;
    // Complimentary accounts never expire, so warning them is noise.
    if (isComplimentaryUser(user.email)) continue;

    scanned += 1;

    const msRemaining = user.createdAt.getTime() + TRIAL_MS - now.getTime();
    if (msRemaining <= 0) continue;

    // Coarsest due tier — see the same selection in the booking sweep. Every
    // tier coarser than a due one is also due, so taking the most urgent would
    // spend the finer tiers on one early message.
    const due = TIERS.filter(
      (t) => msRemaining <= t.offsetMs + cadenceMs && user[t.sentField] === null,
    );
    if (due.length === 0) continue;
    const tier = due[due.length - 1];

    try {
      await sendTrialReminder(user, describeRemaining(msRemaining), appBaseUrl());
    } catch (err) {
      console.error(`[trial-reminders] ${user.email} (${tier.key}) failed:`, err);
      failed += 1;
      continue;
    }

    // The tier just sent, plus any whose moment has already passed and would
    // now only produce a duplicate.
    const stamped = TIERS.filter(
      (t) => user[t.sentField] === null && (t === tier || t.offsetMs >= msRemaining),
    );
    const data: {
      trial3dReminderSentAt?: Date;
      trial24hReminderSentAt?: Date;
      trial3hReminderSentAt?: Date;
    } = {};
    for (const t of stamped) data[t.sentField] = now;
    await prisma.user.update({ where: { id: user.id }, data });

    sent[tier.key] += 1;
  }

  return { scanned, sent, failed };
}

async function sendTrialReminder(
  user: { email: string; name?: string | null; phoneNumber?: string | null },
  timeLeft: string,
  base: string,
) {
  const name = user.name || "there";
  const billingLink = `${base}/billing`;

  const emailSubject = `Your CAPRO free trial is ending in ${timeLeft}`;
  const emailBody = `Hi ${name},

This is a reminder that your 7-day CAPRO free trial will expire in ${timeLeft}.

To prevent any service interruption to your AI receptionist and access to your dashboard, please choose a plan and subscribe.

Subscribe here: ${billingLink}

Thanks,
The CAPRO Team`;

  // A failure on either channel must not block the other, nor prevent the
  // caller from stamping the tier — an unstamped tier retries every run.
  try {
    await sendEmail({ to: user.email, subject: emailSubject, text: emailBody });
  } catch (err) {
    console.error(`[trial-reminders] email to ${user.email} failed:`, err);
  }

  if (user.phoneNumber) {
    const smsBody = `CAPRO Reminder: Your free trial is ending in ${timeLeft}. Subscribe now to keep your AI receptionist active: ${billingLink}`;
    try {
      await sendSms(user.phoneNumber, smsBody);
    } catch (err) {
      console.error(`[trial-reminders] SMS to ${user.phoneNumber} failed:`, err);
    }
  }
}
