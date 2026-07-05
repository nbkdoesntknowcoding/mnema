# Mnema REST API (v1)

The public REST API lets any application read and write your workspace's docs,
flows, and tasks — the same data your AI clients see over MCP. It's the integration
path when you want to embed Mnema in your own product rather than connect an
MCP-aware assistant.

- **Base URL:** `https://<your-mnema-host>/api/public/v1` (self-host default: `http://localhost:8080/api/public/v1`)
- **Auth:** `Authorization: Bearer mnema_api_…` (an API key)
- **Rate limit:** 60 requests/minute per key (`429` with a `Retry-After` header when exceeded)
- **Content type:** `application/json`

Internal (`/api/_internal/*`) and enterprise routes are not part of this API and are not documented here.

## Authentication

Create a key in the app: **Settings → API Keys → New key**. Pick a scope; the
plaintext key is shown **once** at creation (store it — it can't be retrieved
again). Send it as a Bearer token on every request:

```bash
curl https://<your-mnema-host>/api/public/v1/docs \
  -H "Authorization: Bearer mnema_api_xxxxxxxxxxxxxxxx"
```

### Scopes

A key carries one of three coarse scopes; each is a superset of the one above it:

| Scope   | Grants                                             |
| :------ | :------------------------------------------------- |
| `read`  | list/read/search docs, folders, flows              |
| `write` | everything in `read` + create/update/append docs   |
| `tasks` | everything in `write` + the task lifecycle endpoints |

A request needing a scope the key lacks returns `403 forbidden`.

## Response envelope

Every success response is wrapped:

```json
{
  "data": { "...": "endpoint-specific payload" },
  "meta": { "workspaceId": "…", "requestId": "req_1", "timestamp": "2026-07-04T15:00:00.000Z" }
}
```

Errors are:

```json
{ "error": { "code": "not_found", "message": "Document not found" } }
```

| HTTP | `code`            | When |
| :--- | :---------------- | :--- |
| 400  | `invalid_request` | Missing/invalid parameters |
| 401  | `unauthorized`    | Missing or invalid/revoked key |
| 403  | `forbidden`       | Key lacks the required scope |
| 404  | `not_found`       | Resource doesn't exist |
| 409  | `invalid_request` | Task not in the required state |
| 429  | `rate_limited`    | Over 60 req/min (see `Retry-After`) |
| 500  | `internal`        | Unexpected server error |

> A machine-readable OpenAPI spec is served at `/api/public/openapi.json` and `/api/public/openapi.yaml`.

---

## Docs

### `GET /docs` — list docs
Scope: `read`. Query: `limit` (default 20, max 100), `format=gpt` (caps to 10).

```bash
curl "https://<host>/api/public/v1/docs?limit=20" -H "Authorization: Bearer mnema_api_…"
```
```json
{ "data": { "docs": [ { "id": "…", "title": "Welcome to Mnema", "path": "welcome.md", "updatedAt": "2026-07-04T…" } ],
            "next_cursor": null },
  "meta": { "workspaceId": "…", "requestId": "req_1", "timestamp": "…" } }
```

### `GET /docs/search` — search docs
Scope: `read`. Query: `q` (required), `limit` (default 10, max 50; `format=gpt` caps to 10). Hybrid keyword + semantic.

```bash
curl "https://<host>/api/public/v1/docs/search?q=onboarding" -H "Authorization: Bearer mnema_api_…"
```
```json
{ "data": { "results": [ { "id": "…", "title": "Onboarding", "path": "onboarding.md",
                           "preview": "First 300 chars…", "score": 0.87 } ] },
  "meta": { "…": "…" } }
```

### `GET /docs/:id` — read a doc
Scope: `read`. `format=gpt` truncates `markdown` to 8000 chars and adds `"truncated": true`. `404` if missing.

```json
{ "data": { "id": "…", "title": "Welcome to Mnema", "path": "welcome.md",
            "markdown": "# Welcome…", "updatedAt": "…" }, "meta": { "…": "…" } }
```

### `POST /docs` — create a doc
Scope: `write`. Body: `title` (required), `markdown` (optional), `folderId` (optional). Returns `201`.

```bash
curl -X POST "https://<host>/api/public/v1/docs" -H "Authorization: Bearer mnema_api_…" \
  -H "content-type: application/json" -d '{"title":"Release notes","markdown":"# v1.0"}'
```
```json
{ "data": { "id": "…", "title": "Release notes", "path": "release-notes-abc.md" }, "meta": { "…": "…" } }
```

### `PATCH /docs/:id` — update a doc
Scope: `write`. Body: `markdown` and/or `title` (at least one; `400` if neither). `404` if missing.

```json
{ "data": { "ok": true, "updatedAt": "…" }, "meta": { "…": "…" } }
```

### `POST /docs/:id/append` — append markdown
Scope: `write`. Body: `markdown` (required). Appends after a blank line.

```json
{ "data": { "ok": true }, "meta": { "…": "…" } }
```

## Folders

### `GET /folders` — list folders with doc counts
Scope: `read`.

```json
{ "data": { "folders": [ { "id": "…", "name": "Guides", "docCount": 4 } ] }, "meta": { "…": "…" } }
```

## Flows

### `GET /flows` — list flows
Scope: `read`. → `{ "data": { "flows": [ { "id": "…", "slug": "onboarding", "name": "Onboarding" } ] } }`

### `GET /flows/:slug` — get a flow
Scope: `read`. Returns the full flow record. `404` if missing.

### `GET /flows/:slug/steps/:stepIndex` — get one step
Scope: `read`. `stepIndex` is 1-based (`400` if `< 1` or non-numeric; `404` if the step doesn't exist). Returns the step's instruction + linked content.

## Tasks

Task endpoints require the `tasks` scope. Statuses: `backlog → in_progress → done`, plus `audit_fix` (blocked).

### `GET /tasks/next` — next task in a column
Query: `status` (default `backlog`). → `{ "data": { "task": { … } | null } }`

### `POST /tasks/:id/claim` — claim (→ in_progress)
Body: `developerId` (optional). `409` if the task isn't in `backlog`.

### `POST /tasks/:id/complete` — complete (→ done)
Body: `summary` (optional), `githubPrUrl` (optional). `409` if not `in_progress`.

### `POST /tasks/:id/block` — block (→ audit_fix)
Body: `description` (required). `409` if not `in_progress`; `400` if no description.

## Unified function call

### `POST /call` — single dispatch endpoint
For function-calling clients (e.g. Gemini). Body: `{ "function": "<name>", "parameters": { … } }`.

| `function`              | Scope   | Parameters |
| :---------------------- | :------ | :--------- |
| `search_knowledge_base` | `read`  | `query`, `limit` (max 10) |
| `get_doc`               | `read`  | `doc_id` |
| `list_docs`             | `read`  | `limit` (max 50) |
| `get_flow_step`         | `read`  | `flow_slug`, `step_index` |
| `create_doc`            | `write` | `title`, `content` |

```bash
curl -X POST "https://<host>/api/public/v1/call" -H "Authorization: Bearer mnema_api_…" \
  -H "content-type: application/json" \
  -d '{"function":"search_knowledge_base","parameters":{"query":"pricing","limit":5}}'
```
Unknown `function` → `404`.

---

Prefer to connect an AI assistant instead of calling the API directly? See the
[connect guides](../connect/) for Claude, ChatGPT, Cursor, Windsurf, and embedding Mnema in your own app.
