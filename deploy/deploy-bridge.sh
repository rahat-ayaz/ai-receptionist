#!/usr/bin/env bash
# Build and deploy the voice bridge. This is the service Vercel could not host.
source "$(dirname "$0")/config.sh"

TAG="$(git rev-parse --short HEAD)"
IMAGE="${IMAGE_BASE}/${BRIDGE_SERVICE}:${TAG}"
APP_URL="$(gcloud run services describe "${APP_SERVICE}" --region "${REGION}" \
             --format='value(status.url)' 2>/dev/null || true)"
[[ -n "${APP_URL}" ]] || { echo "deploy the app first — the bridge calls its /api/voice/* routes"; exit 1; }

echo "== building ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --config - . <<YAML
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "-f", "deploy/Dockerfile.bridge", "-t", "${IMAGE}", "."]
images: ["${IMAGE}"]
YAML

echo "== deploying ${BRIDGE_SERVICE}"
# session-affinity keeps a caller's WebSocket pinned to one instance; without it
# a reconnect can land on an instance that knows nothing about the call.
# timeout is the max WebSocket lifetime, so it bounds the longest call.
gcloud run deploy "${BRIDGE_SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --service-account "${RUNTIME_SA_EMAIL}" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,VOICE_BRIDGE_SECRET=VOICE_BRIDGE_SECRET:latest,TWILIO_ACCOUNT_SID=TWILIO_ACCOUNT_SID:latest,TWILIO_AUTH_TOKEN=TWILIO_AUTH_TOKEN:latest" \
  --set-env-vars "NODE_ENV=production,APP_INTERNAL_URL=${APP_URL}" \
  --allow-unauthenticated \
  --session-affinity \
  --min-instances 1 \
  --max-instances 10 \
  --cpu 1 --memory 512Mi \
  --timeout 3600s

BRIDGE_URL="$(gcloud run services describe "${BRIDGE_SERVICE}" --region "${REGION}" --format='value(status.url)')"
WSS="wss://${BRIDGE_URL#https://}"
echo
echo "bridge: ${BRIDGE_URL}"
echo "health: $(curl -s -o /dev/null -w '%{http_code}' "${BRIDGE_URL}/health")"
echo
echo "Point the app at it to enable the real-time voice path:"
echo "  gcloud run services update ${APP_SERVICE} --region ${REGION} \\"
echo "    --update-env-vars PUBLIC_WSS_URL=${WSS}"
