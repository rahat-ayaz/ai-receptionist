# ── AI Receptionist — Next.js app image (Cloud Run) ────────────────────────
# Built by Cloud Build, so no local Docker daemon is needed. Debian-slim
# rather than Alpine: Next's image pipeline pulls native modules that expect
# glibc, and the size win from musl is not worth debugging that.
FROM node:24-slim AS deps
WORKDIR /app
# prisma/ is copied with the manifests because `postinstall` runs
# `prisma generate`, which needs the schema present or npm ci fails.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:24-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# build:container, never `npm run build` — the default script runs
# `prisma db push --accept-data-loss`, which must not touch a database from
# inside an image build.
RUN npm run build:container

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Next reads PORT; Cloud Run injects it (8080 by default). HOSTNAME must be
# 0.0.0.0 or the server binds loopback and Cloud Run's health check fails.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image already ships a `node` user.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node

EXPOSE 8080
CMD ["node", "server.js"]
