# syntax=docker/dockerfile:1

# Single image for the whole Lumio monorepo. Run it as two containers, chosen by
# the command arg: `web` (Next.js server) or `worker` (ingest/watch). Also
# supports `ingest`, `seed`, and `migrate` one-off commands.
# Built from the repo ROOT (it installs the entire pnpm workspace):
#   docker build -t lumio .
ARG NODE_VERSION=24

# ---- base: node + pnpm + openssl (Prisma needs libssl) ----
# libjxl-tools (djxl) and libheif-examples (heif-convert) are the external
# decoders the ingest pipeline shells out to for .jxl / .heic / .heif — libvips
# can't read those. On macOS dev these come from the built-in `sips`; in this
# Linux image they must be installed, or ingest fails with "no external decoder".
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates libjxl-tools libheif-examples \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9
WORKDIR /app

# ---- deps: install the full workspace (cached on the manifests) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json      packages/db/package.json
COPY packages/shared/package.json  packages/shared/package.json
COPY packages/ingest/package.json  packages/ingest/package.json
COPY apps/web/package.json         apps/web/package.json
COPY apps/worker/package.json      apps/worker/package.json
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---- build: Prisma client + Next production build ----
FROM deps AS build
COPY . .
# Dummy URL: every DB-touching route is force-dynamic, so the build never
# connects — Prisma only needs the var present to construct its client.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
RUN pnpm --filter @lumio/db exec prisma generate \
 && pnpm --filter @lumio/web exec next build --webpack

# ---- runner: same contents, dispatched by the entrypoint ----
FROM build AS runner
ENV NODE_ENV=production \
    PHOTOS_DIR=/data/photos \
    CACHE_DIR=/data/cache
# web/worker apply migrations first (advisory-locked, safe to run concurrently).
COPY <<'EOF' /usr/local/bin/entrypoint.sh
#!/bin/sh
set -e
case "${1:-web}" in
  web)
    pnpm --filter @lumio/db exec prisma migrate deploy
    exec pnpm --filter @lumio/web exec next start -p "${PORT:-3000}"
    ;;
  worker)
    pnpm --filter @lumio/db exec prisma migrate deploy
    exec pnpm --filter @lumio/worker exec tsx src/watch-main.ts
    ;;
  ingest)
    exec pnpm --filter @lumio/worker exec tsx src/main.ts
    ;;
  seed)
    exec pnpm --filter @lumio/worker exec tsx scripts/seed-photos.ts
    ;;
  migrate)
    exec pnpm --filter @lumio/db exec prisma migrate deploy
    ;;
  *)
    exec "$@"
    ;;
esac
EOF
RUN chmod +x /usr/local/bin/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["web"]
