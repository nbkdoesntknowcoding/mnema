# Connect ChatGPT to Mnema

Available on ChatGPT plans that support custom **connectors / MCP** (Business,
Enterprise, Team). Your endpoint is `https://<your-mnema-host>/mcp` — ChatGPT uses
the Streamable-HTTP path, also served at `https://<your-mnema-host>/mcp/http`.

## Steps

1. In ChatGPT, open **Settings → Connectors** (workspace admin may need to enable custom connectors).
2. **Add / Create connector** → enter the MCP server URL: `https://<your-mnema-host>/mcp`.
3. Authorize: a browser flow opens Mnema's login → sign in → pick your workspace → **Approve**.
4. In a chat, enable the Mnema connector and ask it to search or read your docs.

## Verify

Ask: *"Search my Mnema workspace for onboarding."* It should return matching docs.

## Known quirks

<!-- QUIRK (Nischay): fill in the ChatGPT-specific gotchas from your testing —
     which plan tier you verified, whether it required /mcp vs /mcp/http, any
     admin-approval or allowlist step, response-size limits. Replace this block. -->

## Troubleshooting

- **Connector won't add:** ensure custom connectors are enabled for your ChatGPT workspace, and the URL is HTTPS on a publicly reachable host (ChatGPT's servers must reach it — `localhost` won't work; use your public URL or a tunnel).
- **CORS / preflight errors:** the server allows the ChatGPT origins by default; if self-hosting behind a proxy, ensure it forwards `OPTIONS` and the `Authorization` header.
