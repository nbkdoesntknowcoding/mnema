# Connect Claude to Mnema

Works with Claude Desktop, Claude Code (CLI), and claude.ai. Your MCP endpoint is
`https://<your-mnema-host>/mcp` (self-host default `http://localhost:8080/mcp`).

## Claude Desktop / claude.ai

1. Open **Settings → Connectors** (Claude Desktop) or **Settings → Connectors** (claude.ai).
2. **Add custom connector** → paste your MCP URL: `https://<your-mnema-host>/mcp`.
3. Click connect. A browser tab opens Mnema's login → sign in → pick your workspace → **Approve**.
4. Mnema's tools now appear in Claude (search docs, read/propose doc writes, walk flows, tasks).

## Claude Code (CLI)

```bash
claude mcp add --transport http mnema https://<your-mnema-host>/mcp
```

Then run `/mcp` inside Claude Code, select **mnema**, and authenticate — the same
browser login/approve flow. Verify with a tool call (e.g. ask it to run `whoami`
or list your docs).

## Verify it's connected

Ask Claude: *"Using the Mnema connector, list my documents."* You should see your
workspace's docs (including the seeded "Welcome to Mnema").

## Known quirks

<!-- QUIRK (Nischay): fill in the Claude-specific gotchas you hit while testing —
     e.g. Desktop vs Code differences, the token-expiry / quit-and-relaunch cache
     behavior, any URL-format requirement. Replace this block. -->

## Troubleshooting

- **`net::ERR_FAILED` or "can't connect":** confirm the URL is exactly `…/mcp` (no trailing space, correct host). On a running instance, `curl -s -o /dev/null -w '%{http_code}' https://<host>/mcp -X POST -d '{}'` should return `401` (needs a token — that's healthy).
- **Stuck after a fix / expired token:** fully quit and relaunch the client (a new chat reuses the same cached connection).
