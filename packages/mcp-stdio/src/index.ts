#!/usr/bin/env node
/**
 * Mnema — standalone stdio MCP server.
 *
 * ⭐ THE POINT OF THIS FILE: an agent must be able to discover what a server
 * can do BEFORE it authenticates, and a directory crawler must be able to boot
 * it in a bare container with no Postgres, no Redis, and no environment.
 * The Fastify API cannot do that — importing `apps/api/src/mcp/server.ts`
 * reaches `config/env.ts`, which calls `process.exit(1)` on the first missing
 * variable, and drags in three ioredis clients that dial on import
 * (queue/embeddings.ts, queue/pdf-generation.ts, mcp/tools/query-embedding.ts).
 * See docs/mcp-stdio.md for the traced chains.
 *
 * So this process imports NONE of the API. It answers:
 *
 *   initialize  — from constants baked into the shipped manifest
 *   tools/list  — from tools.generated.json, captured at build time from the
 *                 real server over an in-memory transport
 *   tools/call  — forwarded over HTTPS to a Mnema workspace
 *
 * Everything that needs a database is therefore on the CALL path, established
 * on first use and never at startup. A missing dependency fails one call with
 * a stated reason; it never stops the server from starting.
 *
 * Configuration (both optional — absence degrades calls, never boot):
 *   MNEMA_API_URL   base URL of the workspace       (default: the hosted API)
 *   MNEMA_API_KEY   Bearer token for tools/call     (no default)
 *
 * ⚠️ stdout carries the JSON-RPC stream and NOTHING else. Every diagnostic in
 * this file goes to stderr. A stray console.log here corrupts the protocol.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_API_URL = 'https://api.theboringpeople.in';

interface ManifestTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}
interface Manifest {
  serverName: string;
  serverTitle: string;
  serverVersion: string;
  instructions: string;
  tools: ManifestTool[];
}

/** Stable, greppable reason codes. Every degraded path emits exactly one. */
type Reason =
  | 'stdio.not_configured'
  | 'stdio.upstream_unreachable'
  | 'stdio.upstream_http_error'
  | 'stdio.upstream_bad_payload'
  | 'stdio.tool_error';

const counts = new Map<Reason, number>();
function noteReason(reason: Reason, detail: string): void {
  const n = (counts.get(reason) ?? 0) + 1;
  counts.set(reason, n);
  // stderr only — stdout is the protocol channel.
  process.stderr.write(`[mnema-mcp] reason=${reason} count=${n} ${detail}\n`);
}

function loadManifest(): Manifest {
  // Read rather than `import ... with { type: 'json' }`: the build copies the
  // JSON next to this file, and a plain read works identically under node,
  // bundlers, and a `node dist/index.js` invocation from any cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(resolve(here, 'tools.generated.json'), 'utf8');
  return JSON.parse(raw) as Manifest;
}

/**
 * Forward one tools/call to a Mnema workspace.
 *
 * Returns an MCP tool result either way — a transport failure is reported to
 * the model as a failed call with a readable cause, not thrown. Throwing here
 * would surface as an internal error and tell the caller nothing.
 */
async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; content: { type: 'text'; text: string }[] }> {
  const apiKey = process.env.MNEMA_API_KEY;
  const baseUrl = (process.env.MNEMA_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');

  if (!apiKey) {
    noteReason('stdio.not_configured', `tool=${toolName} MNEMA_API_KEY is unset`);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `Mnema is not connected, so \`${toolName}\` cannot run.\n\n` +
            'The tool catalogue is served offline, but calling a tool needs a workspace. Set:\n' +
            '  MNEMA_API_KEY   an API key from Settings → Access in your Mnema workspace\n' +
            `  MNEMA_API_URL   your workspace API base URL (default ${DEFAULT_API_URL})\n`,
        },
      ],
    };
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    noteReason('stdio.upstream_unreachable', `tool=${toolName} url=${baseUrl}/mcp ${message}`);
    return {
      isError: true,
      content: [{ type: 'text', text: `Could not reach Mnema at ${baseUrl}/mcp — ${message}` }],
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    noteReason('stdio.upstream_http_error', `tool=${toolName} status=${res.status}`);
    const hint =
      res.status === 401 || res.status === 403
        ? ' — check MNEMA_API_KEY, and that it has the scope this tool needs'
        : '';
    return {
      isError: true,
      content: [{ type: 'text', text: `Mnema returned HTTP ${res.status}${hint}. ${text.slice(0, 400)}` }],
    };
  }

  let payload: { result?: { content?: unknown; isError?: boolean }; error?: { message?: string } };
  try {
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    noteReason('stdio.upstream_bad_payload', `tool=${toolName} ${message}`);
    return { isError: true, content: [{ type: 'text', text: `Unreadable response from Mnema — ${message}` }] };
  }

  if (payload.error) {
    noteReason('stdio.tool_error', `tool=${toolName} ${payload.error.message ?? 'unknown'}`);
    return {
      isError: true,
      content: [{ type: 'text', text: payload.error.message ?? 'Mnema returned an error with no message.' }],
    };
  }

  const content = payload.result?.content;
  if (Array.isArray(content)) {
    return {
      ...(payload.result?.isError ? { isError: true } : {}),
      content: content as { type: 'text'; text: string }[],
    };
  }

  // A 200 with no content array is not success — say so rather than returning
  // an empty result that reads as "the tool ran and found nothing".
  noteReason('stdio.upstream_bad_payload', `tool=${toolName} result had no content array`);
  return {
    isError: true,
    content: [{ type: 'text', text: 'Mnema returned a response with no content.' }],
  };
}

async function main(): Promise<void> {
  const manifest = loadManifest();

  // The low-level Server, not McpServer: registerTool() takes a Zod shape and
  // re-derives the published schema. Here the manifest's JSON Schema must go
  // out verbatim, because it is a byte-for-byte capture of what the hosted
  // server advertises.
  const server = new Server(
    { name: manifest.serverName, title: manifest.serverTitle, version: manifest.serverVersion },
    { capabilities: { tools: {} }, instructions: manifest.instructions },
  );

  // tools/list — pure data. No network, no credentials, no services.
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: manifest.tools }));

  // tools/call — the only path that needs the outside world.
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const known = manifest.tools.some((t) => t.name === name);
    if (!known) {
      noteReason('stdio.tool_error', `unknown tool=${name}`);
      return { isError: true, content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] };
    }
    return forwardToolCall(name, (args ?? {}) as Record<string, unknown>);
  });

  // Clean shutdown: when the client closes stdin the transport closes, and this
  // process must exit 0 rather than linger — any other code reads to a
  // supervisor as a crash.
  //
  // Set on the SERVER, not on the transport. `server.connect()` installs its own
  // `transport.onclose` to run the SDK's teardown; assigning ours afterwards
  // would silently replace it, and pending requests would never be rejected.
  // `Protocol.onclose` is the consumer hook the SDK calls from that teardown.
  server.onclose = () => {
    process.stderr.write('[mnema-mcp] stdin closed — exiting 0\n');
    process.exit(0);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const configured = Boolean(process.env.MNEMA_API_KEY);
  process.stderr.write(
    `[mnema-mcp] ready — ${manifest.tools.length} tools; tools/call ` +
      (configured
        ? `forwards to ${(process.env.MNEMA_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')}/mcp\n`
        : `is unconfigured (set MNEMA_API_KEY); introspection works regardless\n`),
  );

}

// A boot failure must still be legible: no silent exit, and a non-zero code so
// a supervisor sees it. Nothing above this point touches the network or a
// database, so reaching here means the shipped manifest itself is broken.
main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[mnema-mcp] fatal reason=stdio.boot_failed ${message}\n`);
  process.exit(1);
});
