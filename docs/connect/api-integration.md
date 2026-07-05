# Embed Mnema in your own application

When you're building a product (not connecting an off-the-shelf assistant), use the
**REST API** with an API key. Your app authenticates as a workspace and reads/writes
docs, flows, and tasks on its users' behalf — for example, giving your app's users
in-context access to a shared knowledge workspace.

See the full [REST API reference](../api/) for every endpoint. This page is the
quickstart.

## 1. Create an API key

In Mnema: **Settings → API Keys → New key**. Choose a scope (`read`, `write`, or
`tasks`) and copy the plaintext key — it's shown once.

## 2. Call the API

Base URL: `https://<your-mnema-host>/api/public/v1`. Send the key as a Bearer token.

### curl

```bash
# Search the workspace
curl "https://<your-mnema-host>/api/public/v1/docs/search?q=pricing" \
  -H "Authorization: Bearer mnema_api_xxxxxxxx"

# Create a doc (needs a `write` key)
curl -X POST "https://<your-mnema-host>/api/public/v1/docs" \
  -H "Authorization: Bearer mnema_api_xxxxxxxx" \
  -H "content-type: application/json" \
  -d '{"title":"Ticket #4821 summary","markdown":"# Summary\n..."}'
```

### TypeScript

```ts
const MNEMA = "https://<your-mnema-host>/api/public/v1";
const KEY = process.env.MNEMA_API_KEY!; // mnema_api_…

async function mnema<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${MNEMA}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json", ...init.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body?.error?.code}: ${body?.error?.message}`);
  return body.data as T;
}

// Search, then read the top hit
const { results } = await mnema<{ results: { id: string; title: string }[] }>(
  "/docs/search?q=onboarding",
);
const doc = await mnema<{ markdown: string }>(`/docs/${results[0].id}`);
console.log(doc.markdown);
```

## Notes

- **Scopes:** `read` → list/read/search; `write` → + create/update/append; `tasks` → + task lifecycle. A missing scope returns `403`.
- **Rate limit:** 60 requests/minute per key (`429` + `Retry-After`).
- **Response shape:** `{ data, meta }` on success; `{ error: { code, message } }` on failure.
- **Reference pattern:** this is how an embedding partner gives their own app's users access to a Mnema workspace — one key per workspace, scoped to what the integration needs.
