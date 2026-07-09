#!/bin/sh
# self-host-init.sh — one-shot Mnema self-host bootstrap.
#
# Generates all required secrets + the MCP OAuth keypair, writes .env from
# .env.example, and prints the next commands. POSIX sh; portable (no sed -i,
# no bashisms). Refuses to clobber an existing .env unless --force.
#
#   ./scripts/self-host-init.sh                 # interactive
#   ./scripts/self-host-init.sh --defaults      # localhost, no prompts
#   ./scripts/self-host-init.sh --url https://mnema.example.com --voyage-key vk-...
#   ./scripts/self-host-init.sh --force         # overwrite an existing .env
set -eu

FORCE=0; DEFAULTS=0; PUBLIC_URL=""; VOYAGE=""; GEMINI=""
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --defaults) DEFAULTS=1 ;;
    --url) shift; PUBLIC_URL="${1:-}" ;;
    --voyage-key) shift; VOYAGE="${1:-}" ;;
    --gemini-key) shift; GEMINI="${1:-}" ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v openssl >/dev/null 2>&1 || { echo "ERROR: openssl is required." >&2; exit 1; }
[ -f .env.example ] || { echo "ERROR: .env.example not found (run from the repo root)." >&2; exit 1; }
if [ -f .env ] && [ "$FORCE" -ne 1 ]; then
  echo "ERROR: .env already exists — refusing to overwrite. Re-run with --force." >&2
  exit 1
fi

rand() { openssl rand -hex 32; }

# ── secrets (all required at boot per config/env.ts) ──────────────────────────
WORKOS_COOKIE_PASSWORD="$(rand)"
COLLAB_INTERNAL_SECRET="$(rand)"
SECRETBOX_MASTER_KEY="$(rand)"
API_INTERNAL_SECRET="$(rand)"
JWT_SECRET="$(rand)"
POSTGRES_PASSWORD="$(rand)"
REDIS_PASSWORD="$(rand)"

# ── public URL (skip-able → localhost) ────────────────────────────────────────
if [ -z "$PUBLIC_URL" ] && [ "$DEFAULTS" -ne 1 ]; then
  printf 'Public base URL for the web app [blank = http://localhost:4321]: '
  read -r PUBLIC_URL || true
fi
WEB_URL="${PUBLIC_URL:-http://localhost:4321}"
API_URL="http://localhost:8080"
COLLAB_WS="ws://localhost:1234"
OAUTH_ISS="http://localhost:8080"
case "$WEB_URL" in
  https://*)
    host="${WEB_URL#https://}"; host="${host%%/*}"
    # Behind TLS you proxy /api and /collab under the same host (see README).
    API_URL="https://$host"
    COLLAB_WS="wss://$host/collab"
    OAUTH_ISS="https://$host"
    ;;
esac

# ── BYOK keys (skip-able → inert placeholder) ─────────────────────────────────
if [ -z "$VOYAGE" ] && [ "$DEFAULTS" -ne 1 ]; then
  printf 'Voyage AI embedding key [blank = search disabled]: '; read -r VOYAGE || true
fi
if [ -z "$GEMINI" ] && [ "$DEFAULTS" -ne 1 ]; then
  printf 'Gemini autocomplete key [blank = autocomplete disabled]: '; read -r GEMINI || true
fi
VOYAGE="${VOYAGE:-unused_on_self_host}"
GEMINI="${GEMINI:-unused_on_self_host}"

# ── OAuth keypair (required by the MCP OAuth server) ──────────────────────────
if [ ! -f keys/private.pem ] || [ "$FORCE" -eq 1 ]; then
  mkdir -p keys
  openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048 >/dev/null 2>&1
  openssl rsa -in keys/private.pem -pubout -out keys/public.pem >/dev/null 2>&1
  echo "  generated OAuth keypair → ./keys/{private,public}.pem"
fi

# ── write .env: start from the example, override generated/derived values ─────
cp .env.example .env
set_env() {
  # Portable in-place: awk rewrites the "KEY=..." line (values are opaque to awk,
  # so any special chars are safe). Appends the key if the example lacks it.
  k="$1"; v="$2"; tmp="$(mktemp)"
  awk -v k="$k" -v v="$v" '
    $0 ~ "^" k "=" { print k "=" v; found=1; next }
    { print }
    END { if (!found) print k "=" v }
  ' .env > "$tmp" && mv "$tmp" .env
}

set_env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_env REDIS_PASSWORD    "$REDIS_PASSWORD"
set_env DATABASE_URL      "postgresql://mnema:${POSTGRES_PASSWORD}@postgres:5432/mnema"
set_env REDIS_URL         "redis://:${REDIS_PASSWORD}@redis:6379"
set_env WORKOS_COOKIE_PASSWORD "$WORKOS_COOKIE_PASSWORD"
set_env COLLAB_INTERNAL_SECRET "$COLLAB_INTERNAL_SECRET"
set_env SECRETBOX_MASTER_KEY   "$SECRETBOX_MASTER_KEY"
set_env API_INTERNAL_SECRET    "$API_INTERNAL_SECRET"
set_env JWT_SECRET             "$JWT_SECRET"
set_env AUTH_PROVIDER          "password"
set_env PUBLIC_AUTH_PROVIDER   "password"
set_env PUBLIC_API_URL         "$API_URL"
set_env PUBLIC_COLLAB_URL      "$COLLAB_WS"
set_env WEB_BASE_URL           "$WEB_URL"
set_env PUBLIC_SITE_URL        "$WEB_URL"
set_env CORS_ORIGINS           "$WEB_URL"
set_env OAUTH_ISSUER           "$OAUTH_ISS"
set_env JWT_ISSUER             "$OAUTH_ISS"
set_env JWT_AUDIENCE           "$WEB_URL"
set_env VOYAGE_API_KEY         "$VOYAGE"
set_env GEMINI_API_KEY         "$GEMINI"
chmod 600 .env

echo ""
echo "  wrote .env (7 secrets generated; secrets never printed)"
echo ""
echo "Next:"
echo "  docker compose up -d --build        # (public repo: docker-compose.yml is the self-host stack)"
echo ""
echo "  [!] First build compiles the api, web, collab and workers images (the workers"
echo "      image also downloads Chromium), so a cold first build takes several minutes"
echo "      - much faster on later builds. Postgres and Redis go healthy in seconds,"
echo "      then the terminal will look idle for a few minutes while the images build."
echo "      That is normal - it is NOT a hang, so don't Ctrl-C. Watch progress with:"
echo "          docker compose logs -f"
echo ""
echo "When ready, open   ${WEB_URL}   and sign up at ${WEB_URL}/auth/local"
echo "Connect an MCP client (Claude/Cursor) to:   ${API_URL}/mcp"
