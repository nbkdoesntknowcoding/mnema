#!/usr/bin/env bash
# Phase 3 (Open-Core) — core-only boundary check.
#
# Two assertions for the mnema/mnema-ee split:
#   1. No CORE file statically imports a gated (ee) module. Gated code is reached
#      only via the dynamic ee entrypoints (src/ee/*) through lib/load-ee.ts.
#   2. The core compiles with the ee ENTRYPOINTS removed (proves the seam).
#
# Run from apps/api. Exit 0 = clean; 1 = boundary violation(s) or tsc failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1. core → gated static-import scan =="
# Gated module paths. A core file importing any of these (outside src/ee/ and the
# gated modules themselves) is a boundary violation to de-tangle.
VIOLATIONS=$(grep -rnE "from '.*(routes/graph|routes/meetings|routes/org|routes/admin|lib/graph/|queue/graph|tools/graph|tools/meeting-context|meeting-end/worker|graph/worker)" src --include="*.ts" \
  | grep -v "/ee/" \
  | grep -vE "src/(routes/(graph|meetings|org|admin)|mcp/tools/(graph|meeting-context)|lib/graph/|queue/graph|workers/(graph|meeting-end))" \
  | grep -v "\.test\.ts" || true)

if [ -n "$VIOLATIONS" ]; then
  echo "!! core files still statically import gated modules:"
  echo "$VIOLATIONS" | sed 's/^/     /'
  echo "   (de-tangle each via the doc bus / a hook / the ee entrypoints)"
else
  echo "   no core→gated static imports ✓"
fi

echo "== 2. tsc with ee entrypoints removed =="
BAK="$(mktemp -d)"
mv src/ee/index.ts src/ee/collab.ts src/ee/workers.ts src/ee/mcp-tools.ts "$BAK"/ 2>/dev/null || true
set +e
pnpm exec tsc -p tsconfig.json --noEmit
TSC_RC=$?
set -e
mv "$BAK"/*.ts src/ee/ 2>/dev/null || true
rmdir "$BAK" 2>/dev/null || true

if [ "$TSC_RC" -ne 0 ]; then
  echo "!! core does NOT compile with ee entrypoints absent"
  exit 1
fi
echo "   core compiles ee-entrypoint-absent ✓"

[ -z "$VIOLATIONS" ] || { echo "== boundary INCOMPLETE (see violations above) =="; exit 1; }
echo "== core-only boundary CLEAN =="
