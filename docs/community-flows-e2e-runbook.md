# Community Flows — manual E2E runbook (P4-4)

The automated boundary test (`apps/api/src/lib/flows/community-e2e.test.ts`) proves the
sanitize → validate → rehydrate → bind loop and the no-leak guarantee. This runbook is the live
two-party check that also exercises the HTTP hub + moderation.

Prereqs: hub deployed (migration `0071` applied); at least one workspace with a valid
`COMMUNITY_HUB_KEY` set (the "publisher"); a second workspace/instance to import from (the "consumer").

1. **Publisher builds a flow** with an `instruction`, a `decision`, a `doc` (bound to a private doc),
   and a `capture` node. Publish a version.
2. **Publish to community** (header → Community → tags → Publish). Note the returned URL.
3. **Leak check** — on the hub DB:
   ```sql
   SELECT template_json FROM community_flows WHERE slug = '<slug>';
   ```
   Assert the JSON contains **no** UUIDs and **no** private doc content — only titles + instructions.
   (`grep -Eo '[0-9a-f-]{36}'` over the value should return nothing.)
4. **Consumer browses** `/app/community`, finds the flow (search/tag), opens the detail page. The
   `doc`/`capture` steps show a **needs binding** badge; instruction/decision render fully.
5. **Consumer imports** ("Use this flow") → lands in the editor on a new draft. Confirm:
   - instruction/decision steps are identical;
   - doc/capture steps exist but are unbound;
   - the flow **opens and walks** without error while unbound (graceful fallback).
6. **Consumer binds** the doc node to one of *their* docs, saves. Confirm publish is now allowed
   (unbound → strict validation would have blocked it).
7. **Import counter** — reload the listing; `import_count` incremented.
8. **Report + takedown** — consumer clicks **Report**. Staff open admin center → Community, see the
   report, **unlist** the flow. Confirm it disappears from `/app/community` browse and its detail
   page 404s. Resolve the report.
9. **Unpublish** — publisher opens the flow → Community → **Unpublish**. Confirm the listing is gone.

Pass = every assertion above holds, especially step 3 (the privacy gate).
