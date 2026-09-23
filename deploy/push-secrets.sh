#!/usr/bin/env bash
# Copy application secrets into Secret Manager from a local env file.
#
#   ./deploy/push-secrets.sh .env.gcp
#
# DATABASE_URL is deliberately NOT in this list: setup-gcp.sh generates it with
# the Cloud SQL socket path and password it created, and re-pushing a local
# value would point the app back at the old database.
source "$(dirname "$0")/config.sh"

ENV_FILE="${1:-.env.gcp}"
[[ -f "${ENV_FILE}" ]] || { echo "no such file: ${ENV_FILE}"; exit 1; }

SECRETS=(
  BETTER_AUTH_SECRET GEMINI_API_KEY
  TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_SMS_FROM
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  STRIPE_PRICE_STARTER STRIPE_PRICE_PREMIUM STRIPE_PRICE_PRO
  RESEND_API_KEY
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
  GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET
  FACEBOOK_CLIENT_ID FACEBOOK_CLIENT_SECRET
  CRON_SECRET VOICE_BRIDGE_SECRET
  CREDENTIAL_ENC_KEYS CREDENTIAL_ENC_ACTIVE
  SQUARE_APP_ID SQUARE_APP_SECRET SQUARE_WEBHOOK_SIGNATURE_KEY
)

pushed=0; skipped=()
for name in "${SECRETS[@]}"; do
  # Read from the env file without sourcing it, so odd characters in values
  # cannot execute anything.
  value="$(grep -E "^${name}=" "${ENV_FILE}" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
  if [[ -z "${value}" ]]; then skipped+=("${name}"); continue; fi
  if gcloud secrets describe "${name}" >/dev/null 2>&1; then
    printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=- >/dev/null
  else
    printf '%s' "${value}" | gcloud secrets create "${name}" --data-file=- >/dev/null
  fi
  pushed=$((pushed+1)); echo "   pushed ${name}"
done

echo
echo "${pushed} secret(s) pushed."
[[ ${#skipped[@]} -gt 0 ]] && printf 'empty/absent in %s (skipped): %s\n' "${ENV_FILE}" "${skipped[*]}"
echo "Reminder: back up CREDENTIAL_ENC_KEYS off-host. Losing it forces every"
echo "tenant to reconnect their POS."
