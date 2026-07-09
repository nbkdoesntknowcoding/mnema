# Web (Astro, node standalone adapter) — self-host image.
# Cloud builds on Vercel; this Dockerfile is the self-host equivalent.
#
# NOTE: Astro bakes every `import.meta.env.PUBLIC_*` into the client bundle at
# BUILD time. They are passed as build args (sourced from .env by the compose)
# and default to the localhost self-host URLs. A custom-host deploy must rebuild
# the web image after changing any PUBLIC_* value.

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /app

ARG PUBLIC_API_URL=http://localhost:8080
ARG PUBLIC_COLLAB_URL=ws://localhost:1234
ARG PUBLIC_AUTH_PROVIDER=password
ARG PUBLIC_SITE_URL=http://localhost:4321
ENV PUBLIC_API_URL=$PUBLIC_API_URL \
    PUBLIC_COLLAB_URL=$PUBLIC_COLLAB_URL \
    PUBLIC_AUTH_PROVIDER=$PUBLIC_AUTH_PROVIDER \
    PUBLIC_SITE_URL=$PUBLIC_SITE_URL

# Workspace manifests first (layer-cache friendly)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/schema/package.json ./packages/schema/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Source + configs
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/
COPY tsconfig.base.json ./

# Shared packages first (web imports their compiled output), then the web build.
RUN pnpm --filter @boppl/schema build && pnpm --filter @boppl/shared build
RUN pnpm --filter @boppl/web build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/schema/package.json ./packages/schema/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --prod

# Compiled output + workspace packages — owned by `node` at copy time (near-free),
# instead of a separate recursive `chown -R /app` layer.
COPY --chown=node:node --from=builder /app/apps/web/dist ./apps/web/dist
COPY --chown=node:node --from=builder /app/packages/shared ./packages/shared
COPY --chown=node:node --from=builder /app/packages/schema/dist ./packages/schema/dist

# Run as the image's built-in unprivileged `node` user (uid 1000). Build output is
# COPYed --chown=node:node above; the prod node_modules stays root-owned and
# world-readable. Nothing is written under /app at runtime — sessions are sealed
# iron-session cookies, not Astro's filesystem session store — so read-only
# node_modules is all the runtime needs. This drops the ~124s recursive
# `chown -R /app`. Port 4321 is >1024, so binding as non-root is fine.
USER node

EXPOSE 4321
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321

CMD ["node", "apps/web/dist/server/entry.mjs"]
