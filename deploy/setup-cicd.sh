#!/usr/bin/env bash
# Grant the Cloud Build service account what it needs to deploy Cloud Run.
# Run once, before creating the trigger.
source "$(dirname "$0")/config.sh"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
# Cloud Build runs as the Compute Engine default service account unless a
# trigger names another one.
CB_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "== granting ${CB_SA}"
for role in roles/run.developer roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${CB_SA}" --role "${role}" --condition=None >/dev/null
  echo "   ${role}"
done

# Deploying a service that runs AS the runtime SA requires impersonating it.
# Without this the deploy step fails with a confusing "permission denied on
# service account" rather than anything about Cloud Run.
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member "serviceAccount:${CB_SA}" --role roles/iam.serviceAccountUser >/dev/null
echo "   roles/iam.serviceAccountUser on ${RUNTIME_SA}"

echo
echo "Next: connect the repository (browser, one time), then:"
echo "  gcloud builds triggers create github \\"
echo "    --name=deploy-main \\"
echo "    --repo-owner=<owner> --repo-name=<repo> \\"
echo "    --branch-pattern='^main$' \\"
echo "    --build-config=cloudbuild.yaml \\"
echo "    --region=${REGION}"
