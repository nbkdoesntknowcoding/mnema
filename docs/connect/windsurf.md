# Connect Windsurf to Mnema

Your endpoint is `https://<your-mnema-host>/mcp` (self-host default `http://localhost:8080/mcp`).

## Steps

1. Open **Windsurf → Settings → Cascade → MCP servers** (or the **Manage MCP servers** panel).
2. **Add server** → HTTP transport → URL: `https://<your-mnema-host>/mcp`.
3. Windsurf opens the browser OAuth flow → sign in to Mnema → pick workspace → **Approve**.

### Or edit the config file

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "mnema": { "serverUrl": "https://<your-mnema-host>/mcp" }
  }
}
```

Refresh MCP servers in Windsurf, then authenticate.

## Verify

In Cascade: *"Use Mnema to search my docs for release notes."*

## Known quirks

<!-- QUIRK (Nischay): fill in the Windsurf-specific gotchas from your testing —
     exact config key (`serverUrl` vs `url`), the refresh step, any transport
     limitation. Replace this block. -->

## Troubleshooting

- **Server not appearing:** ensure the JSON is valid and Windsurf's MCP list was refreshed; check the URL ends in `/mcp`.
