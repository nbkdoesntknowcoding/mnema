-- 0072 — Community Flows: track whether a local flow is published to the hub.
-- When a workspace publishes a flow to the community, we store the returned hub
-- slug here so the UI can show "published to community" state + an unpublish
-- affordance, and badge the flow on the list page. Core migration (flows is a
-- core table) — applies on self-host too. Idempotent (apply via psql).

ALTER TABLE "flows" ADD COLUMN IF NOT EXISTS "community_slug" text;
