#!/usr/bin/env bash
# Build the Next.js image with Cloud Build and deploy it to Cloud Run.
# Cloud Build means no local Docker daemon is required.
source "$(dirname "$0")/config.sh"

TAG="$(git rev-parse --short HEAD)"
IMAGE="${IMAGE_BASE}/${APP_SERVICE}:${TAG}"

echo "== building ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" .

# Secrets are mounted as env vars from Secret Manager, so no value is ever
# stored in the service config or visible in `gcloud run services describe`.
SECRET_ENVS="BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest"
for s in DATABASE_URL GEMINI_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN \
         TWILIO_SMS_FROM STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
         STRIPE_PRICE_STARTER STRIPE_PRICE_PREMIUM STRIPE_PRICE_PRO \
         RESEND_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
         GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET FACEBOOK_CLIENT_ID \
         FACEBOOK_CLIENT_SECRET CRON_SECRET VOICE_BRIDGE_SECRET \
         CREDENTIAL_ENC_KEYS CREDENTIAL_ENC_ACTIVE SQUARE_APP_ID \
         SQUARE_APP_SECRET SQUARE_WEBHOOK_SIGNATURE_KEY; do
  gcloud secrets describe "$s" >/dev/null 2>&1 && SECRET_ENVS="${SECRET_ENVS},$s=$s:latest"
done

echo "== deploying ${APP_SERVICE}"
gcloud run deploy "${APP_SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --service-account "${RUNTIME_SA_EMAIL}" \
  --add-cloudsql-instances "${SQL_CONN}" \
  --set-secrets "${SECRET_ENVS}" \
  --set-env-vars "NODE_ENV=production,CRON_CADENCE_HOURS=1,GEMINI_TTS_BUDGET_MS=20000,SWEEP_TRIALS_WITH_REMINDERS=false" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 10 \
  --cpu 1 --memory 1Gi \
  --timeout 120s

URL="$(gcloud run services describe "${APP_SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo
echo "app URL: ${URL}"
echo
echo "Cloud Run does not inject its own URL, so these must be set explicitly"
echo "or Twilio callbacks and emailed links will point at localhost:"
echo "  gcloud run services update ${APP_SERVICE} --region ${REGION} \\"
echo "    --update-env-vars APP_BASE_URL=${URL},BETTER_AUTH_URL=${URL}"
