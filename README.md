# Mnema

Your AI assistant answers from its training data, not your team's. Mnema is a
self-hostable knowledge workspace that publishes your docs, decisions, and
step-by-step workflows to any MCP-aware AI client (Claude, ChatGPT, Cursor,
Windsurf, Cline) over the Model Context Protocol — so your agents read *your*
context, live, with no uploads or copy-paste.

This is the **open-core** repository (fair-code, [Mnema Community License](./LICENSE)).
It is the full core product and runs on its own; the enterprise modules are separate.

<!-- ASSET: hero screenshot (editor + connected Claude) -->
<!-- ASSET: 30s demo GIF (ask Claude → it reads a doc → proposes an edit → Approve) -->

## Quickstart (self-host, ~90 seconds)

Requirements: **Docker + Docker Compose**.

```bash
git clone https://github.com/nbkdoesntknowcoding/mnema.git
cd mnema
./scripts/self-host-init.sh          # generates secrets + the OAuth keypair, writes .env
docker compose up -d --build         # postgres, redis, api, collab, workers, web
```

Then:

- Open **http://localhost:4321** and create an account at **`/auth/local`** (email + password).
- Connect an MCP client to your server: **`http://localhost:8080/mcp`**
  (in Claude/Cursor, add it as a custom MCP/connector URL; you'll be sent back here to log in and approve).

That's it — the first workspace comes with a welcome doc and an example flow, so your
first connection has something real to read.

Optional: set `VOYAGE_API_KEY` (semantic search) and `GEMINI_API_KEY` (autocomplete)
in `.env` — bring your own keys. Both stay disabled until set.

## Documentation

- **[Connect an AI client](./docs/connect/)** — [Claude](./docs/connect/claude.md), [ChatGPT](./docs/connect/chatgpt.md), [Cursor](./docs/connect/cursor.md), [Windsurf](./docs/connect/windsurf.md)
- **[Embed Mnema in your own app](./docs/connect/api-integration.md)** — REST API + an API key
- **[REST API reference](./docs/api/)** — every public endpoint, auth, scopes, examples

## What's in the core (this repo) vs. licensed

The free layer carries the full product; the gates sit on what organizations and
R&D need. Plainly:

| Capability                                         | Core (this repo) | Licensed |
| :------------------------------------------------- | :--------------: | :------: |
| Docs, real-time editor, folders, search            | ✅ | ✅ |
| Flows (build + walk step-by-step via MCP)          | ✅ | ✅ |
| MCP server (read + propose/commit writes)          | ✅ | ✅ |
| Built-in email+password auth, or generic OIDC      | ✅ | ✅ |
| Self-host, single-workspace, unlimited docs        | ✅ | ✅ |
| Version history + document export                   | ✅ free with a community license | ✅ |
| Knowledge graph (build, report, traverse)          | ❌ | ✅ |
| Meeting intelligence (bot, transcription, summaries) | ❌ | ✅ |
| Org / IAM / SSO, audit logs, multi-workspace       | ❌ | ✅ |

The knowledge graph, meeting intelligence, org/IAM+SSO, audit, and multi-workspace
mode are commercial add-ons — the core runs perfectly without them, and its CI
proves it builds and boots with the enterprise modules entirely absent. Licensing:
[LICENSE](./LICENSE) for the core; enterprise inquiries via the website.

> Docs, flows, collaboration, and live MCP are free forever, registered or not.
> Version history and export are also free — we just ask for your email (a free
> community license, entered in **Settings**). Your history is recorded from day
> one; registering reveals it.

## Self-host notes

- **HTTPS / reverse proxy.** Behind TLS, expose the collab WebSocket as
  `wss://<your-host>/collab` (WebSocket upgrade enabled) and set
  `PUBLIC_COLLAB_URL=wss://<your-host>/collab`, then **rebuild the web app**
  (`PUBLIC_*` vars are baked in at build time). Otherwise the browser falls back to
  `ws://localhost:1234`, which is blocked as mixed content on an HTTPS page — and
  every document shows "disconnected." Re-run `./scripts/self-host-init.sh --url https://<your-host>`
  to regenerate `.env` for a public host.
- **Backups.** Everything lives in Postgres + the named volumes. Back up with
  `docker compose exec postgres pg_dump -U mnema mnema > backup.sql` and snapshot the
  `pgdata` / `redis_data` volumes.
- **Requirements.** Comes up on a 4 GB machine. Migrations apply automatically on
  first `up` (idempotent).

## Run it with an AI agent (alternative)

Open the repo in **Claude Code** (or any coding agent) and paste:

> **Set up and run Mnema (this repo) for self-hosting.** Confirm Docker is running,
> then run `./scripts/self-host-init.sh --defaults` and `docker compose up -d --build`.
> Wait for all services healthy, open the web URL, create an account at `/auth/local`,
> and report the URLs. Fix any error you hit and continue.

## Stack

pnpm monorepo — **api** (Fastify + Drizzle/Postgres), **collab** (Hocuspocus/Yjs),
**workers** (BullMQ/Redis), **web** (Astro + React). Node 22, Postgres 16 + pgvector, Redis 7.

## License

The core is licensed under the **Mnema Community License** (a Sustainable-Use
fair-code license): free to use, modify, and self-host for your own internal or
personal use; commercial hosting/reselling requires an agreement. See [LICENSE](./LICENSE),
[CONTRIBUTING.md](./CONTRIBUTING.md), and [TRADEMARK.md](./TRADEMARK.md).

"Mnema" is a trademark of the maintainer — forks may use the code, not the name.
