# ── Mnema MCP server (stdio) ──────────────────────────────────────────────────
#
# A self-contained MCP server that starts with NOTHING: no database, no Redis,
# no environment variables, no sidecars. `docker run -i` it and drive the
# protocol on stdin/stdout.
#
#   docker build -t mnema-mcp .
#   docker run -i --rm mnema-mcp
#
# `initialize` and `tools/list` are answered offline from a manifest captured at
# build time (packages/mcp-stdio/src/tools.generated.json). `tools/call` needs a
# workspace and is configured at run time — its absence degrades a call, never
# the boot:
#
#   docker run -i --rm -e MNEMA_API_KEY=... -e MNEMA_API_URL=... mnema-mcp
#
# For the full self-hosted product (API + web + Postgres + Redis + workers),
# this is the wrong file — use docker-compose.yml. This image is the MCP
# endpoint alone.
#
# node:22-slim, NOT node:20-slim: package.json declares `engines.node >= 22` and
# .nvmrc pins 22. A 20 base would ship a runtime the repo itself says it does
# not support.

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# Workspace manifests first, so a source-only edit reuses the install layer.
# Every workspace member's package.json must be present or --frozen-lockfile
# considers the lockfile out of date, even when filtering to one package.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/mcp-stdio/package.json ./packages/mcp-stdio/
COPY packages/schema/package.json ./packages/schema/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# --ignore-scripts: no package may run a postinstall in this build. Several
# transitive deps of the wider workspace fetch binaries from the network when
# allowed to (playwright browsers, most visibly). The stdio server needs none of
# them, and a build that reaches the network mid-install is not reproducible.
# --filter ...: the MCP server depends only on @modelcontextprotocol/sdk; the
# other ~90 production deps of apps/api are never installed.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @boppl/mcp-stdio...

COPY tsconfig.base.json ./
COPY packages/mcp-stdio/ ./packages/mcp-stdio/

RUN pnpm --filter @boppl/mcp-stdio build

# Re-resolve to production dependencies only, dropping typescript and @types.
RUN pnpm install --frozen-lockfile --ignore-scripts --prod --filter @boppl/mcp-stdio...

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

# The compiled server, its shipped tool manifest, and the SDK. Nothing else —
# no source, no toolchain, no pnpm.
#
# The workspace path is preserved exactly: pnpm links a package's node_modules
# entries to ../../node_modules/.pnpm/... with RELATIVE symlinks. Flattening
# packages/mcp-stdio/node_modules to /app/node_modules would leave every one of
# them pointing one directory above the image root, and the server would fail to
# resolve the SDK at startup.
COPY --from=builder --chown=node:node /app/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder --chown=node:node /app/packages/mcp-stdio ./packages/mcp-stdio

# Unprivileged by default; nothing is written to disk at run time.
USER node

# No HEALTHCHECK and no EXPOSE on purpose: this process speaks stdio, has no
# port, and a probe that wrote to stdout would corrupt the JSON-RPC stream.
ENTRYPOINT ["node", "packages/mcp-stdio/dist/index.js"]
