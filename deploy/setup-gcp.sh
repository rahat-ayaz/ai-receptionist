#!/usr/bin/env bash
# One-time project setup: APIs, image registry, Cloud SQL, service account.
# Safe to re-run — every step tolerates already existing.
source "$(dirname "$0")/config.sh"

echo "== project: ${PROJECT_ID}  region: ${REGION}"
gcloud config set project "${PROJECT_ID}" >/dev/null

echo "== enabling APIs (slow the first time)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  sqladmin.googleapis.com \
  cloudscheduler.googleapis.com

echo "== Artifact Registry"
gcloud artifacts repositories describe "${REPO}" --location "${REGION}" >/dev/null 2>&1 \
  || retry 5 20 gcloud artifacts repositories create "${REPO}" \
       --repository-format=docker --location "${REGION}" \
       --description="AI Receptionist container images"

echo "== Cloud SQL (Postgres)"
if ! gcloud sql instances describe "${SQL_INSTANCE}" >/dev/null 2>&1; then
  # No public IP: Cloud Run reaches this over the Cloud SQL connector's unix
  # socket, so the instance never needs to be exposed to the internet.
  retry 3 30 gcloud sql instances create "${SQL_INSTANCE}" \
    --database-version=POSTGRES_17 \
    --tier="${SQL_TIER}" \
    --region="${REGION}" \
    --storage-auto-increase \
    --backup-start-time=07:00 \
    --no-assign-ip
else
  echo "   instance ${SQL_INSTANCE} already exists"
fi

gcloud sql databases describe "${SQL_DB}" --instance "${SQL_INSTANCE}" >/dev/null 2>&1 \
  || gcloud sql databases create "${SQL_DB}" --instance "${SQL_INSTANCE}"

if ! gcloud sql users list --instance "${SQL_INSTANCE}" --format='value(name)' | grep -qx "${SQL_USER}"; then
  SQL_PASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
  gcloud sql users create "${SQL_USER}" --instance "${SQL_INSTANCE}" --password "${SQL_PASS}"
  # The app connects through the connector's socket, hence host=/cloudsql/...
  # rather than a hostname. `pg` understands this form.
  DB_URL="postgresql://${SQL_USER}:${SQL_PASS}@localhost/${SQL_DB}?host=/cloudsql/${SQL_CONN}&schema=public"
  printf '%s' "${DB_URL}" | gcloud secrets create DATABASE_URL --data-file=- 2>/dev/null \
    || printf '%s' "${DB_URL}" | gcloud secrets versions add DATABASE_URL --data-file=-
  echo "   created user ${SQL_USER} and stored DATABASE_URL in Secret Manager"
else
  echo "   user ${SQL_USER} already exists — leaving DATABASE_URL secret alone"
fi

echo "== runtime service account"
gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" >/dev/null 2>&1 \
  || retry 5 15 gcloud iam service-accounts create "${RUNTIME_SA}" \
       --display-name="AI Receptionist Cloud Run runtime"

for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${RUNTIME_SA_EMAIL}" --role "${role}" \
    --condition=None >/dev/null
done
echo "   ${RUNTIME_SA_EMAIL} granted cloudsql.client + secretmanager.secretAccessor"

echo
echo "Done. Next: ./deploy/push-secrets.sh  then  ./deploy/deploy-app.sh"
