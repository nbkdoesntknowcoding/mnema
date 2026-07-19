-- ── One-time MCP-token de-duplication ─────────────────────────────────────────
-- Before this, POST /api/mcp-tokens stacked a new token on every reconnect, so a
-- client (e.g. Cursor) accumulated many active tokens for the same name. The
-- route now revokes the prior active token with the same (workspace, user, name)
-- on create; this cleans up the historical accumulation the same way.
--
-- Keeps the MOST RECENT active token per (workspace_id, user_id, name); revokes
-- the older duplicates. Idempotent — re-running does nothing once deduped.
--
-- ⚠️ Applying this revokes users' older duplicate tokens: any client still using
-- an older duplicate must reconnect once. Apply only with explicit sign-off.

UPDATE mcp_tokens AS t
SET revoked_at = NOW()
WHERE t.revoked_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM mcp_tokens AS newer
    WHERE newer.workspace_id = t.workspace_id
      AND newer.user_id      = t.user_id
      AND newer.name         = t.name
      AND newer.revoked_at IS NULL
      AND (newer.created_at, newer.id) > (t.created_at, t.id)
  );
