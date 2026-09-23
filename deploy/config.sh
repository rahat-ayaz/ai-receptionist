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
# Montreal: this is a Canadian business and the tax engine is Canada-specific
# (HST/QST), so tenant data stays in-country by default. Cloud Run, Cloud SQL
# and Cloud Scheduler are all available here.
: "${REGION:=northamerica-northeast1}"
: "${REPO:=app}"                       # Artifact Registry repository
: "${SQL_INSTANCE:=ai-receptionist-db}"
: "${SQL_TIER:=db-g1-small}"           # shared-core; fine for this workload
# New instances default to ENTERPRISE_PLUS, whose tiers start at
# db-perf-optimized-N-2 and cost many times more. ENTERPRISE is the edition
# that permits shared-core tiers, so it has to be named explicitly.
: "${SQL_EDITION:=ENTERPRISE}"
: "${SQL_DB:=airecept}"
: "${SQL_USER:=airecept}"
: "${APP_SERVICE:=ai-receptionist}"
: "${BRIDGE_SERVICE:=voice-bridge}"
: "${RUNTIME_SA:=ai-receptionist-run}"

export PROJECT_ID REGION REPO SQL_INSTANCE SQL_TIER SQL_EDITION SQL_DB SQL_USER \
       APP_SERVICE BRIDGE_SERVICE RUNTIME_SA

# Freshly enabled APIs are not usable the instant `services enable` returns —
# the first call against one often fails IAM_PERMISSION_DENIED while the service
# agent propagates. Retry those rather than making the operator re-run.
#
# Only transient failures are retried. A rejected request — a bad tier, a name
# already taken, a malformed flag — will be rejected identically every time, so
# retrying it just delays the error the operator needs to read.
TRANSIENT='IAM_PERMISSION_DENIED|SERVICE_DISABLED|HTTPError 5|unavailable|deadline exceeded|try again|RESOURCE_EXHAUSTED|not ready'
retry() {
  local tries="${1}" delay="${2}"; shift 2
  local n=1 out rc
  while :; do
    # `out=$(...) && rc=0 || rc=$?` rather than testing $? afterwards: under
    # `set -e` a bare failing compound aborts the script, which swallowed the
    # underlying error entirely the first time this was written.
    out="$("$@" 2>&1)" && rc=0 || rc=$?
    if [[ ${rc} -eq 0 ]]; then
      if [[ -n "${out}" ]]; then printf '%s\n' "${out}"; fi
      return 0
    fi
    if ! grep -qiE "${TRANSIENT}" <<<"${out}"; then
      printf '%s\n' "${out}" >&2
      echo "   not a transient failure — not retrying" >&2
      return "${rc}"
    fi
    if (( n >= tries )); then
      printf '%s\n' "${out}" >&2
      echo "   still failing after ${tries} attempts" >&2
      return "${rc}"
    fi
    echo "   transient failure (attempt ${n}/${tries}); retrying in ${delay}s"
    sleep "${delay}"; n=$(( n + 1 ))
  done
}

IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
SQL_CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
export IMAGE_BASE SQL_CONN RUNTIME_SA_EMAIL
