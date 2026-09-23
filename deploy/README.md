# Deploying AI Receptionist to Google Cloud

Two Cloud Run services, one Cloud SQL database, secrets in Secret Manager,
crons in Cloud Scheduler. Images are built by Cloud Build, so **you do not need
Docker installed locally**.

| Piece | Where it runs | Why |
|---|---|---|
| Next.js app | Cloud Run (`ai-receptionist`) | Web app, dashboard, all `/api/*` routes |
| Voice bridge | Cloud Run (`voice-bridge`) | Long-lived WebSocket server. Vercel could not host this at all, which is why the low-latency voice path was unreachable in production. |
| PostgreSQL | Cloud SQL | Reached over the Cloud SQL connector's unix socket; the instance has no public IP |
| Secrets | Secret Manager | Mounted as env vars, never stored in service config |
| Crons | Cloud Scheduler | No job or frequency limit, unlike Vercel Hobby's two-per-day cap |

## Prerequisites

There is no Homebrew on this machine, and installing it needs admin rights, so
both tools are installed as local tarballs into `$HOME` instead. Nothing below
requires `sudo`. `deploy/config.sh` finds them automatically.

```bash
# 1. gcloud itself
curl -o /tmp/gcloud.tar.gz \
  https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
tar -xzf /tmp/gcloud.tar.gz -C ~
~/google-cloud-sdk/install.sh --quiet --usage-reporting=false

# 2. A Python gcloud will accept. macOS ships 3.9; gcloud requires 3.10-3.14,
#    and its own bundled interpreter cannot bootstrap itself on 3.9.
URL=$(curl -sL https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*cpython-3\.12\.[^"]*aarch64-apple-darwin-install_only\.tar\.gz"' \
  | grep -o 'https://[^"]*' | head -1)
curl -sL -o /tmp/py312.tar.gz "$URL"
mkdir -p ~/.local-python && tar -xzf /tmp/py312.tar.gz -C ~/.local-python

export CLOUDSDK_PYTHON=$HOME/.local-python/python/bin/python3
export PATH=$HOME/google-cloud-sdk/bin:$PATH
```

Add those last two exports to your shell profile — without `CLOUDSDK_PYTHON`
every `gcloud` call fails with a Python 3.9 error.

The database migration additionally needs `pg_dump` and `cloud-sql-proxy`,
which do not have no-admin tarballs. Either install Homebrew for those two, or
run `deploy/migrate-db.sh` from a machine that has them.

```bash
gcloud auth login                          # use printerspartscn@gmail.com
gcloud projects create ai-receptionist-prod --name="AI Receptionist"
export PROJECT_ID=ai-receptionist-prod
```

Link a billing account to the project in the console, or nothing below will
work — most of these APIs refuse to enable without it.

## 1. Provision

```bash
export PROJECT_ID=ai-receptionist-prod
./deploy/setup-gcp.sh
```

Enables the APIs, creates the image repository, creates the Cloud SQL instance
and database, generates the database password, writes `DATABASE_URL` into Secret
Manager, and creates the runtime service account with `cloudsql.client` and
`secretmanager.secretAccessor`.

Re-runnable: every step tolerates already existing.

## 2. Push the application secrets

Put the values in a local file — start from your current Vercel production
values, then replace `GEMINI_API_KEY` with the key from the new AI Studio
account:

```bash
cp .env.example .env.gcp     # fill it in; it is gitignored via .env*
./deploy/push-secrets.sh .env.gcp
```

`DATABASE_URL` is deliberately **not** pushed by this script. `setup-gcp.sh`
already wrote the correct one with the Cloud SQL socket path; pushing a local
value would point the app back at the old database.

Back up `CREDENTIAL_ENC_KEYS` somewhere outside GCP. Losing it makes every
tenant's stored POS token unrecoverable and forces them all to reconnect.

## 3. Migrate the database

```bash
SOURCE_DATABASE_URL='postgresql://...' ./deploy/migrate-db.sh
```

`pg_dump` from the current database, restore into Cloud SQL through the Auth
Proxy, then print row counts so you can compare. Rows written after the dump
begins are not copied, so stop traffic first or accept the gap.

The dump file is left on disk on purpose so you can verify before trusting it.
**Delete it afterwards — it contains every tenant's data.**

## 4. Deploy

```bash
./deploy/deploy-app.sh       # then run the printed command to set APP_BASE_URL
./deploy/deploy-bridge.sh    # then run the printed command to set PUBLIC_WSS_URL
./deploy/schedulers.sh
```

Order matters. The bridge needs the app's URL to fetch tenant context, and the
schedulers need the app's URL and `CRON_SECRET`.

Cloud Run does not inject its own URL, so `APP_BASE_URL` and `BETTER_AUTH_URL`
**must** be set explicitly. Each deploy script prints the exact command. Skip it
and Twilio callbacks plus emailed links silently point at `localhost:3000` —
`src/lib/app-url.ts` warns about this but cannot fix it.

## 5. Repoint the external services

Every one of these has a URL baked into a third-party dashboard. Update all of
them or the corresponding feature breaks quietly:

- **Twilio** — each number's voice webhook to `<app-url>/api/telephony`
- **Stripe** — webhook endpoint to `<app-url>/api/billing/webhook`, then push
  the new signing secret (it is per-endpoint) and redeploy
- **Square** — webhook notification URL, and `SQUARE_WEBHOOK_URL` must match it
  byte for byte; Square signs the URL together with the body
- **OAuth providers** — Google, GitHub and Facebook redirect URIs to
  `<app-url>/api/auth/callback/<provider>`

## What improves on Cloud Run

- **Real-time voice becomes possible.** The bridge finally has a home, so
  `PUBLIC_WSS_URL` can be set and calls stop falling back to the slow
  turn-based `<Gather>` path.
- **Crons run at their intended cadence.** `deploy-app.sh` sets
  `CRON_CADENCE_HOURS=1`, so the 3h booking reminder lands near 3h instead of up
  to a day early, and POS retries return to every 10 minutes.
- **Trial reminders get their own job**, so `SWEEP_TRIALS_WITH_REMINDERS=false`
  is set to stop the reminders route sweeping them too — two concurrent sweeps
  can double-send.
- **No function timeout.** `GEMINI_TTS_BUDGET_MS` is raised to 20s, since the
  8.5s default only exists to fit inside Vercel's ~10s function cap.

## Rolling back

Cloud Run keeps every revision:

```bash
gcloud run revisions list --service ai-receptionist --region northamerica-northeast1
gcloud run services update-traffic ai-receptionist --region northamerica-northeast1 \
  --to-revisions <REVISION>=100
```

Vercel is untouched by any of this and stays deployable from `main` until you
delete the project, so it remains a fallback during cutover.
