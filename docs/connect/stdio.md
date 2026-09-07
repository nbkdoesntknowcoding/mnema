# Run Mnema's MCP server over stdio

The hosted endpoint at `https://api.theboringpeople.in/mcp` speaks
streamable-HTTP and is behind OAuth 2.1. That is the right transport for
Claude, ChatGPT and other remote clients, but two things cannot use it:

- a desktop client that expects to **spawn a process** and talk on stdin/stdout;
- a directory or crawler that wants to **read the tool catalogue before
  authenticating** — which is what discovery means.

`packages/mcp-stdio` covers both. It starts with nothing: no database, no
Redis, no environment variables.

```bash
docker build -t mnema-mcp .
docker run -i --rm mnema-mcp
```

That container answers `initialize` and `tools/list` immediately. Calling a tool
needs a workspace:

```bash
docker run -i --rm \
  -e MNEMA_API_URL=https://api.theboringpeople.in \
  -e MNEMA_API_KEY=mnema_api_... \
  mnema-mcp
```

`MNEMA_API_KEY` comes from **Settings → Access** in your workspace. Point
`MNEMA_API_URL` at your own instance when self-hosting; it defaults to the
hosted API.

### Claude Desktop

```json
{
  "mcpServers": {
    "mnema": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MNEMA_API_KEY", "mnema-mcp"],
      "env": { "MNEMA_API_KEY": "mnema_api_..." }
    }
  }
}
```

## Why it is a separate process

The Fastify API cannot serve this, and the reason is worth stating plainly
because it is the whole design constraint.

Importing `apps/api/src/mcp/server.ts` pulls in, before any transport exists:

| what | where | what it does at import |
|---|---|---|
| env validation | `apps/api/src/config/env.ts` | `process.exit(1)` on the first missing variable |
| BullMQ + ioredis | `apps/api/src/queue/embeddings.ts` | opens a Redis connection |
| BullMQ + ioredis | `apps/api/src/queue/pdf-generation.ts` | opens a Redis connection |
| ioredis | `apps/api/src/mcp/tools/query-embedding.ts` | opens a Redis connection |
| Postgres pool | `apps/api/src/db/index.ts` | builds a `postgres.js` pool |

Reached by these chains:

```
mcp/server.ts → mcp/auth.ts → config/env.ts
mcp/server.ts → mcp/tools/index.ts → mcp/tools/record-decision.ts → lib/decisions.ts → queue/embeddings.ts
mcp/server.ts → mcp/tools/dev/index.ts → db/index.ts
```

So the stdio server imports **none** of it. Its `tools/list` is served from
`packages/mcp-stdio/src/tools.generated.json`, captured at build time from the
real `createMcpServer()` over an in-memory transport
(`apps/api/src/scripts/generate-mcp-manifest.ts`), and `tools/call` is forwarded
over HTTPS to a workspace. Everything that needs a service is on the call path,
established on first use.

A missing dependency therefore fails **one call**, with a stated cause and a
reason code on stderr (`stdio.not_configured`, `stdio.upstream_unreachable`,
`stdio.upstream_http_error`, `stdio.upstream_bad_payload`, `stdio.tool_error`).
It never stops the server from starting.

## Keeping the manifest honest

A build-time capture is a second copy of the truth, and second copies rot.
`apps/api/src/tests/mcp-stdio-manifest.test.ts` regenerates it and fails on any
drift. After adding, removing or re-describing a tool:

```bash
pnpm --filter @boppl/api mcp:manifest
```

> stdout carries the JSON-RPC stream and nothing else. Every diagnostic the
> stdio server writes goes to stderr — a stray `console.log` corrupts the
> protocol.
