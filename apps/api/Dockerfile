# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

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
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/schema/package.json ./packages/schema/
COPY apps/api/package.json ./apps/api/

# Production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/schema/dist ./packages/schema/dist

# Migrations folder needed at runtime for drizzle
COPY apps/api/drizzle ./apps/api/drizzle

# Static templates (not emitted by tsc — copy from source)
COPY apps/api/src/templates ./apps/api/dist/templates
# Email HTML templates (inliner reads dist/emails/html/*.html at runtime)
COPY apps/api/src/emails/html ./apps/api/dist/emails/html

HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=40s \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 8080
ENV NODE_ENV=production

CMD ["node", "apps/api/dist/server.js"]
