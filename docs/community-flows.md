# Community Flows

Publish your flows to a shared, central catalog that **every Mnema instance** — cloud and
self-hosted — can browse and import from. It's the n8n-community-templates model: one hub, many
instances.

- **Browse & import**: anonymous / any signed-in user. No key needed.
- **Publish**: needs your free community-license key.
- **Moderation**: flows list immediately (auto-list); anyone can report; staff can take down.

---

## For users

### Browse & use a flow

1. Sidebar → **Community** (`/app/community`).
2. Search / filter by tag / sort by Popular or New.
3. Open a flow → **Use this flow**. It's copied into your workspace as a new **draft**.

Imported flows land in your editor. Any step that referenced a doc or folder in the original
workspace comes in **unbound** (marked "needs binding") — you point it at your own doc/folder before
publishing or fully running it. **No content from the original workspace is ever included** — only the
flow's structure and instructions travel.

### Publish your flow

1. Open a flow → publish a **version** (only the published version is uploaded).
2. Header → **Community** → add tags → **Publish to community**.
3. You get a public URL. Re-publishing updates the same listing. **Unpublish** anytime.

Before it uploads, your flow is **sanitized**: `doc`/`docs`/`capture` steps keep their title and
instruction but drop the concrete `doc_id` / `doc_ids` / `target_folder_id`. That's the privacy
guarantee — importers re-bind their own.

### Report a flow

On any listing → **Report this flow**. Staff review reports and can unlist or remove.

---

## For self-hosters

Everything ships in the core build; the hub itself is hosted by Mnema. Three env vars control it:

| Var | Default | Purpose |
|-----|---------|---------|
| `COMMUNITY_HUB_URL` | `https://api.theboringpeople.in` | Which hub to browse/publish against. Point elsewhere to use a different hub. |
| `COMMUNITY_HUB_ENABLED` | `true` | Set `false` to **fully disable** the feature (air-gapped installs) — the Community nav, pages, and API all go dark. |
| `COMMUNITY_HUB_KEY` | _(unset)_ | Your community-license key. **Required only to publish.** Browse/import work without it. |

Get a free community key from the community sign-up. Set `COMMUNITY_HUB_KEY` in `infra/.env`, then
restart the api. Settings → **Community** shows live status (enabled / hub URL / publishing
available).

The hub verifies your key offline (Ed25519, `verifyLicenseKey`) and stamps your email on your
listings for attribution and takedown — it is never shown publicly beyond the handle (local part).

---

## Moderation policy

Listings appear immediately. Reports go to a staff queue (admin center → Community). Staff can
**unlist** (hidden, recoverable), **remove** (gone), or **resolve** a report. Publishers can unpublish
their own listings at any time.

---

## How it fits the open-core split

- **Core** (ships to every self-hoster): the browse/import/publish **client** + the sanitize/rehydrate
  portability library. Lives in `apps/api/src/routes/community.ts`, `apps/api/src/lib/community/`,
  `apps/api/src/lib/flows/portability.ts`, and the web pages under `apps/web/src/…/community`.
- **EE / hosted** (SaaS only, stripped from the public build): the **hub** itself — the catalog API and
  moderation. Lives in `apps/api/src/routes/community-flows-hub.ts` and
  `apps/api/src/routes/admin/community.ts`, registered from `apps/api/src/ee/index.ts`.

A self-hosted instance never runs a hub; it points at one.
