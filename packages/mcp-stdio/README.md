# @boppl/mcp-stdio

Mnema's MCP server over **stdio**, for clients that spawn a process rather than
call a URL — and for any crawler that needs to read the tool catalogue before
authenticating.

It starts with nothing: no database, no Redis, no environment variables.
`initialize` and `tools/list` are answered offline from a manifest captured at
build time; `tools/call` is forwarded over HTTPS to a Mnema workspace.

```bash
docker build -t mnema-mcp .          # from the repository root
docker run -i --rm mnema-mcp
```

| variable | required | meaning |
|---|---|---|
| `MNEMA_API_KEY` | for `tools/call` only | workspace API key (Settings → Access) |
| `MNEMA_API_URL` | no | workspace base URL, default `https://api.theboringpeople.in` |

Full notes, including why this cannot live inside the Fastify API:
[docs/connect/stdio.md](../../docs/connect/stdio.md).
