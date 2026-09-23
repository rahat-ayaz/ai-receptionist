#!/usr/bin/env bash
# Cloud Scheduler jobs, replacing vercel.json's crons.
#
# Vercel Hobby allowed two jobs at one run per day, which is why reminders had
# to fire as soon as they would come due before the next run, and why POS retries
# and Square token refresh dropped to daily. Cloud Scheduler has no such limit,
# so each job runs at its intended cadence and CRON_CADENCE_HOURS drops to 1
# (set by deploy-app.sh).
source "$(dirname "$0")/config.sh"

APP_URL="$(gcloud run services describe "${APP_SERVICE}" --region "${REGION}" --format='value(status.url)')"
CRON_SECRET="$(gcloud secrets versions access latest --secret=CRON_SECRET)"

job() {
  local name="$1" schedule="$2" path="$3"
  local args=(
    --location "${REGION}"
    --schedule "${schedule}"
    --time-zone "America/Toronto"
    --uri "${APP_URL}${path}"
    --http-method GET
    --update-headers "Authorization=Bearer ${CRON_SECRET}"
    --attempt-deadline 300s
  )
  if gcloud scheduler jobs describe "${name}" --location "${REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${name}" "${args[@]}" >/dev/null
    echo "   updated ${name} (${schedule})"
  else
    gcloud scheduler jobs create http "${name}" "${args[@]}" >/dev/null
    echo "   created ${name} (${schedule})"
  fi
}

# Outbox retry drain + Square token refresh + webhook-requested catalog pulls.
job airecept-integrations   "*/10 * * * *" "/api/cron/integrations"
# Booking reminders. Hourly means the 3h tier lands near 3h, not up to a day early.
job airecept-reminders      "0 * * * *"    "/api/cron/reminders"
# Trial expiry. It has its own job now rather than riding along with reminders.
job airecept-trials         "0 * * * *"    "/api/cron/trial-reminders"

echo
echo "Jobs use Authorization: Bearer \$CRON_SECRET. The x-vercel-cron bypass is"
echo "gated on the VERCEL env var, so it is inert here — see src/lib/cron-auth.ts."
