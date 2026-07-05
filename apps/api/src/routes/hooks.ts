/**
 * Hook receiver routes — Phase 2 AgentLens Execution Tracking.
 *
 * POST /api/hooks/claude-code — receives events from Claude Code hooks.
 *   Auth: Bearer token validated against workspaces.hook_token (SHA-256 hash).
 *   Fail-open: ALWAYS returns 202 so the agent is never blocked.
 *   202-first: reply sent BEFORE token validation — token validation runs in
 *     setImmediate (fire-and-forget) to guarantee < 50ms response time.
 *   Rate limit: 120 req/min per IP.
 *   Payload limit: 10MB (413 if exceeded — only non-202 besides 429).
 *
 * POST /api/hooks/cursor  — Phase 4: same format as claude-code, agent='cursor'
 * POST /api/hooks/aider   — Phase 4: Aider payload translation
 * POST /api/hooks/generic — generic passthrough (always 202)
 *
 * GET /install/claude-hooks.sh  — installer for Claude Code
 * GET /install/cursor-hooks.sh  — installer for Cursor
 */

import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { verifyHookToken } from '../lib/dev/hook-token.js';
import { enqueueHookEvent } from '../queue/hook-events.js';

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const PAYLOAD_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB

// Simple in-memory rate limiter (per-IP). Phase 3 can swap to Redis if needed.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

/**
 * Resolves a plaintext hook token to a workspace ID.
 * Scans dev_project workspaces and compares SHA-256 hashes.
 * Returns null if no matching workspace found (fail-open at call site).
 */
async function resolveHookToken(token: string): Promise<string | null> {
  const wsRows = await withSystemPrivilege((tx) =>
    tx
      .select({ id: workspaces.id, hookToken: workspaces.hookToken })
      .from(workspaces)
      .where(eq(workspaces.mode, 'dev_project'))
      .limit(200), // bounded scan — dev workspaces are rare
  );

  for (const ws of wsRows) {
    if (ws.hookToken && verifyHookToken(token, ws.hookToken)) {
      return ws.id;
    }
  }

  return null;
}

export const hooksRoutes: FastifyPluginAsync = async (app) => {
  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/hooks/claude-code
  // ──────────────────────────────────────────────────────────────────────────
  app.post(
    '/api/hooks/claude-code',
    {
      // 10MB payload limit — returns 413 if exceeded (only non-202 response)
      bodyLimit: PAYLOAD_LIMIT_BYTES,
    },
    async (req, reply) => {
      const ip = req.ip;

      // Rate limit — 429 is the only non-202 response besides 413
      if (!checkRateLimit(ip)) {
        return reply.code(429).send({ message: 'Rate limit exceeded. The agent is still working.' });
      }

      // ── 202-FIRST pattern ──────────────────────────────────────────────────
      // Send 202 IMMEDIATELY — before any async work.
      // This guarantees the agent never waits for our processing.
      reply.code(202).send({ ok: true });

      // Everything below runs after the response is flushed.
      setImmediate(async () => {
        try {
          // 1. Extract Bearer token
          const authHeader = req.headers.authorization;
          const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
          if (!token) {
            req.log.warn({ ip }, 'hooks/claude-code: missing Bearer token');
            return;
          }

          // 2. Resolve workspace from token
          const workspaceId = await resolveHookToken(token);
          if (!workspaceId) {
            req.log.warn(
              { ip, tokenPrefix: token.slice(0, 12) },
              'hooks/claude-code: no matching workspace for token',
            );
            return;
          }

          // 3. Enqueue for async processing (BullMQ)
          await enqueueHookEvent({
            workspaceId,
            adapter:    'claude-code',
            payload:    req.body,
            receivedAt: new Date().toISOString(),
          });
        } catch (err) {
          // Swallow all errors — never propagate back to the agent
          req.log.error({ err }, 'hooks/claude-code: enqueue failed (swallowed)');
        }
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/hooks/cursor — same PostToolUse format as claude-code, agent='cursor'
  // Separate route for per-adapter analytics in Phase 5.
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/hooks/cursor', async (req, reply) => {
    // 202-first — never block Cursor
    void reply.code(202).send({ ok: true });

    const ip = req.ip;
    if (!checkRateLimit(ip)) return; // silently drop after 202

    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > PAYLOAD_LIMIT_BYTES) return;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return;

    setImmediate(async () => {
      try {
        const workspaceId = await resolveHookToken(token);
        if (!workspaceId) return;

        // Tag payload with agent='cursor' so worker creates session correctly
        const body = req.body as Record<string, unknown> ?? {};
        const taggedPayload = { ...body, agent: 'cursor' };

        await enqueueHookEvent({
          workspaceId,
          adapter: 'cursor',
          payload: taggedPayload,
          receivedAt: new Date().toISOString(),
        });
      } catch { /* fail-open */ }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/hooks/aider — Aider payload translation
  // Aider sends tool_use events with a different payload shape.
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/hooks/aider', async (req, reply) => {
    void reply.code(202).send({ ok: true });

    const ip = req.ip;
    if (!checkRateLimit(ip)) return;

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return;

    setImmediate(async () => {
      try {
        const workspaceId = await resolveHookToken(token);
        if (!workspaceId) return;

        // Aider payload shape (from devmanager/adapters/aider.go):
        // { type, tool, args, result, cost?, tokens?: { prompt, completion }, session_id?, developer_id? }
        const aiderBody = req.body as {
          type?: string;
          tool?: string;
          args?: Record<string, unknown>;
          result?: string;
          cost?: number;
          tokens?: { prompt: number; completion: number };
          session_id?: string;
          developer_id?: string;
        } ?? {};

        // Translate to Mnema normalised HookEvent (PostToolUse shape)
        const normalisedPayload = {
          hook_event_name:  'PostToolUse',
          tool_name:        aiderBody.tool ?? 'unknown',
          tool_input:       aiderBody.args ?? {},
          tool_output:      aiderBody.result ?? '',
          session_id:       aiderBody.session_id,
          developer_id:     aiderBody.developer_id,
          agent:            'aider',
          // Map Aider token fields to Mnema token fields
          input_tokens:     aiderBody.tokens?.prompt ?? 0,
          output_tokens:    aiderBody.tokens?.completion ?? 0,
          cost_usd:         aiderBody.cost,
        };

        await enqueueHookEvent({
          workspaceId,
          adapter: 'aider',
          payload: normalisedPayload,
          receivedAt: new Date().toISOString(),
        });
      } catch { /* fail-open */ }
    });
  });

  app.post('/api/hooks/generic', async (_req, reply) => {
    return reply.code(202).send({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /install/claude-hooks.sh — shell script installer
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/install/claude-hooks.sh', async (_req, reply) => {
    const script = `#!/bin/bash
# Mnema Claude Code hook installer
# Usage: MNEMA_HOOK_TOKEN=mnema_hook_xxx MNEMA_WORKSPACE_ID=ws_xxx bash <(curl -sf https://mnema.example.com/install/claude-hooks.sh)

if [ -z "$MNEMA_HOOK_TOKEN" ] || [ -z "$MNEMA_WORKSPACE_ID" ]; then
  echo "Error: MNEMA_HOOK_TOKEN and MNEMA_WORKSPACE_ID must be set"
  exit 1
fi

HOOKS_DIR="$HOME/.claude/hooks"
mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/mnema-post-tool.sh" << 'HOOK'
#!/bin/bash
# Mnema AgentLens hook — fires after every Claude Code tool call
curl -sf -X POST "https://mnema.example.com/api/hooks/claude-code" \\
  -H "Authorization: Bearer $MNEMA_HOOK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"hook_event_name\\": \\"PostToolUse\\",
    \\"session_id\\": \\"$CLAUDE_SESSION_ID\\",
    \\"developer_id\\": \\"$MNEMA_DEVELOPER_ID\\",
    \\"tool_name\\": \\"$CLAUDE_TOOL_NAME\\",
    \\"workspace_id\\": \\"$MNEMA_WORKSPACE_ID\\"
  }" > /dev/null 2>&1 &
# Background fork — never block Claude Code
HOOK

chmod +x "$HOOKS_DIR/mnema-post-tool.sh"

echo "\\n✓ Mnema hooks installed at $HOOKS_DIR/mnema-post-tool.sh"
echo "\\n  Add to your shell profile (~/.zshrc or ~/.bashrc):"
echo "  export MNEMA_HOOK_TOKEN=\\$MNEMA_HOOK_TOKEN"
echo "  export MNEMA_DEVELOPER_ID=<your-name-or-machine-id>"
echo "  export MNEMA_WORKSPACE_ID=\\$MNEMA_WORKSPACE_ID"
echo ""
echo "  Then configure Claude Code to run the hook on PostToolUse."
`;

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(script);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /install/cursor-hooks.sh — Cursor-specific installer
  // Same as claude-hooks.sh but targets ~/.cursor/hooks/ and /api/hooks/cursor
  // ──────────────────────────────────────────────────────────────────────────
  app.get('/install/cursor-hooks.sh', async (_req, reply) => {
    const script = `#!/bin/bash
# Mnema Cursor hook installer
# Usage: MNEMA_HOOK_TOKEN=mnema_hook_xxx MNEMA_WORKSPACE_ID=ws_xxx bash <(curl -sf https://mnema.example.com/install/cursor-hooks.sh)

if [ -z "$MNEMA_HOOK_TOKEN" ] || [ -z "$MNEMA_WORKSPACE_ID" ]; then
  echo "Error: MNEMA_HOOK_TOKEN and MNEMA_WORKSPACE_ID must be set"
  exit 1
fi

HOOKS_DIR="$HOME/.cursor/hooks"
mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/mnema-post-tool.sh" << 'HOOK'
#!/bin/bash
# Mnema AgentLens hook for Cursor — fires after every tool call
curl -sf -X POST "https://mnema.example.com/api/hooks/cursor" \\
  -H "Authorization: Bearer $MNEMA_HOOK_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"hook_event_name\\": \\"PostToolUse\\",
    \\"session_id\\": \\"$CURSOR_SESSION_ID\\",
    \\"developer_id\\": \\"$MNEMA_DEVELOPER_ID\\",
    \\"tool_name\\": \\"$CURSOR_TOOL_NAME\\",
    \\"workspace_id\\": \\"$MNEMA_WORKSPACE_ID\\"
  }" > /dev/null 2>&1 &
HOOK

chmod +x "$HOOKS_DIR/mnema-post-tool.sh"

echo "\\n✓ Mnema hooks installed at $HOOKS_DIR/mnema-post-tool.sh"
echo "\\n  Add to your shell profile:"
echo "  export MNEMA_HOOK_TOKEN=\\$MNEMA_HOOK_TOKEN"
echo "  export MNEMA_DEVELOPER_ID=<your-name>"
echo "  export MNEMA_WORKSPACE_ID=\\$MNEMA_WORKSPACE_ID"
`;

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(script);
  });
};
