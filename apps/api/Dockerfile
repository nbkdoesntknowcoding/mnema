# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# Copy workspace manifests first (layer-cache friendly)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/schema/package.json ./packages/schema/
COPY apps/api/package.json ./apps/api/

# Install all deps (including devDeps needed for tsc)
RUN pnpm install --frozen-lockfile

# Copy source + configs
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY tsconfig.base.json ./

# Build packages/schema first (API imports from its compiled output)
RUN pnpm --filter @boppl/schema build

# Build the API
RUN pnpm --filter @boppl/api build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runner

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/schema/package.json ./packages/schema/
COPY apps/api/package.json ./apps/api/

# Production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder — owned by `node` at copy time (near-free),
# instead of a separate recursive `chown -R /app` layer.
COPY --chown=node:node --from=builder /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=builder /app/packages/shared ./packages/shared
COPY --chown=node:node --from=builder /app/packages/schema/dist ./packages/schema/dist

# Migrations folder needed at runtime for drizzle
COPY --chown=node:node apps/api/drizzle ./apps/api/drizzle

# Static templates (not emitted by tsc — copy from source)
COPY --chown=node:node apps/api/src/templates ./apps/api/dist/templates
# Email HTML templates (inliner reads dist/emails/html/*.html at runtime)
COPY --chown=node:node apps/api/src/emails/html ./apps/api/dist/emails/html

HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=40s \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run as the image's built-in unprivileged `node` user (uid 1000). App code and
# build output are COPYed --chown=node:node above; the prod node_modules stays
# root-owned and world-readable, which is all the runtime needs — nothing is
# written under /app at runtime (uploads → object storage, sessions → sealed
# cookies). This drops the ~170s recursive `chown -R /app`. Port 8080 is >1024,
# so the non-root bind is fine.
USER node

EXPOSE 8080
ENV NODE_ENV=production

CMD ["node", "apps/api/dist/server.js"]
