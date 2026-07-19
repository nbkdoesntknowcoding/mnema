-- ── Per-token dev-tool toggle ──────────────────────────────────────────────────
-- Lets a single MCP token opt in or out of the AgentLens dev tools
-- (get_next_task, claim_task, create_task, …) independently of the workspace
-- mode. NULL = inherit the workspace default (dev tools on iff mode =
-- 'dev_project'), so every existing token keeps its current behaviour. TRUE =
-- force on for this token, FALSE = force off. Fully additive; idempotent.

ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS dev_tools_enabled boolean;
