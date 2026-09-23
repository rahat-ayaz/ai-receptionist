#!/usr/bin/env bash
# Shared settings for every deploy script. Override any of these by exporting
# them before running, e.g.  PROJECT_ID=my-proj ./deploy/setup-gcp.sh
set -euo pipefail

# gcloud refuses to run on Python 3.9, which is all macOS ships. A standalone
# 3.12 lives in ~/.local-python (see deploy/README.md), and gcloud itself is a
# local tarball install rather than a Homebrew cask — neither needs admin
# rights. Override either path by exporting it beforehand.
: "${CLOUDSDK_PYTHON:=$HOME/.local-python/python/bin/python3}"
export CLOUDSDK_PYTHON
if ! command -v gcloud >/dev/null 2>&1; then
  [[ -x "$HOME/google-cloud-sdk/bin/gcloud" ]]     || { echo "gcloud not found — see deploy/README.md (Prerequisites)"; exit 1; }
  PATH="$HOME/google-cloud-sdk/bin:$PATH"; export PATH
fi

: "${PROJECT_ID:?Set PROJECT_ID to your GCP project id}"
# Montreal: TorqAI is a Canadian company and the tax engine is Canada-specific
# (HST/QST), so tenant data stays in-country by default. Cloud Run, Cloud SQL
# and Cloud Scheduler are all available here.
: "${REGION:=northamerica-northeast1}"
: "${REPO:=app}"                       # Artifact Registry repository
: "${SQL_INSTANCE:=ai-receptionist-db}"
: "${SQL_TIER:=db-g1-small}"           # smallest tier with dedicated-ish perf
: "${SQL_DB:=airecept}"
: "${SQL_USER:=airecept}"
: "${APP_SERVICE:=ai-receptionist}"
: "${BRIDGE_SERVICE:=voice-bridge}"
: "${RUNTIME_SA:=ai-receptionist-run}"

export PROJECT_ID REGION REPO SQL_INSTANCE SQL_TIER SQL_DB SQL_USER \
       APP_SERVICE BRIDGE_SERVICE RUNTIME_SA

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export IMAGE_BASE SQL_CONN RUNTIME_SA_EMAIL
