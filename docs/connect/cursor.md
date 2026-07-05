# Connect Cursor to Mnema

Your endpoint is `https://<your-mnema-host>/mcp` (self-host default `http://localhost:8080/mcp`).

## Steps

1. Open **Cursor → Settings → MCP** (or **Features → MCP**).
2. **Add new MCP server** → type **HTTP** → URL: `https://<your-mnema-host>/mcp`.
3. Save. Cursor opens the browser OAuth flow → sign in to Mnema → pick workspace → **Approve**.
4. Mnema's tools appear in Cursor's MCP panel and Composer/Agent can call them.

### Or edit the config file

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mnema": { "url": "https://<your-mnema-host>/mcp" }
  }
}
```

Reload Cursor, then authenticate when prompted.

## Verify

In Composer/Agent: *"Use Mnema to list my documents."*

## Known quirks

<!-- QUIRK (Nischay): fill in the Cursor-specific gotchas from your testing —
     exact menu path in your Cursor version, whether the config uses `url` vs
     `serverUrl`, any reload requirement. Replace this block. -->

## Troubleshooting

- **Server shows as failed:** confirm the URL ends in `/mcp` and the host is reachable from your machine; `POST /mcp` should return `401` until authenticated.
- **No auth prompt:** remove and re-add the server to re-trigger the OAuth flow.
