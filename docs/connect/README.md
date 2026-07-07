# Connect an AI client to Mnema

Mnema speaks the **Model Context Protocol (MCP)**, so any MCP-aware assistant can
read and (with permission) write your workspace live. Point the client at your
server's MCP endpoint and approve the connection once.

- **MCP endpoint:** `https://<your-mnema-host>/mcp` (self-host default: `http://localhost:8080/mcp`)
- **Auth:** OAuth — the client opens your browser, you log in to Mnema, pick a workspace, and approve. No API key needed for MCP clients.

Pick your client:

- [Claude](./claude.md) — Desktop, Claude Code, claude.ai
- [ChatGPT](./chatgpt.md) — Business/Enterprise connectors
- [Cursor](./cursor.md)
- [Windsurf](./windsurf.md)
- [Antigravity](./antigravity.md) — includes the `mnema-direct-upload` skill for popup-free batch uploads
- [Embed in your own app](./api-integration.md) — via the REST API + an API key

Not connecting an assistant? Use the [REST API](../api/) directly.

## How the OAuth connect works (all clients)

1. You add the MCP URL in the client.
2. The client discovers the auth server and opens `/oauth/authorize` in your browser.
3. Mnema sends you to log in — on a self-host instance that's the email+password page at `/auth/local` (or your OIDC provider); on cloud it's the hosted login.
4. You pick the workspace and approve the requested scopes.
5. The client receives a token and is connected. Repeat sessions skip the consent screen.
