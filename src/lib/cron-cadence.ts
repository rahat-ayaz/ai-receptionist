/**
 * How often the reminder cron actually runs.
 *
 * Reminder tiers are expressed as an offset before the event ("24h before").
 * A naive query — "events within the next 24h that haven't been reminded" —
 * silently skips anyone whose tier window is narrower than the gap between
 * runs: on a once-daily cron the 3h tier only ever matches events landing in
 * that one 3-hour slice of the day.
 *
 * So a tier fires as soon as it *would come due before the next run*, which
 * means the schedule has to be known here. Keep this in sync with the cron
 * entries in vercel.json — Vercel Hobby caps crons at one run per day, hence
 * the 24h default. Lower it after moving to a plan that allows a tighter
 * schedule and every reminder automatically lands closer to its true offset.
 */
export function cronCadenceHours(): number {
  const raw = Number(process.env.CRON_CADENCE_HOURS);
  if (!Number.isFinite(raw) || raw <= 0) return 24;
  return raw;
}

export function cronCadenceMs(): number {
  return cronCadenceHours() * 60 * 60 * 1000;
}
