-- Phase 4 Chunk G: Materialized view for optimization rules.
-- Replaces per-query PERCENTILE_CONT scans with a pre-computed view
-- refreshed hourly by the cron worker.

CREATE MATERIALIZED VIEW IF NOT EXISTS workspace_session_stats AS
SELECT
  workspace_id,
  COUNT(*)                                                        AS session_count,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_cost_usd)    AS median_cost_usd,
  AVG(total_cost_usd)                                             AS avg_cost_usd,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_input_tokens) AS median_input_tokens,
  AVG(total_input_tokens)                                         AS avg_input_tokens,
  MAX(total_cost_usd)                                             AS max_cost_usd,
  MIN(started_at)                                                 AS first_session_at,
  MAX(started_at)                                                 AS last_session_at
FROM agent_sessions
WHERE
  status IN ('completed', 'failed')
  AND started_at > NOW() - INTERVAL '30 days'
GROUP BY workspace_id;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS workspace_session_stats_ws_idx
  ON workspace_session_stats (workspace_id);

-- Refresh function called by hourly cron
CREATE OR REPLACE FUNCTION refresh_workspace_session_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY workspace_session_stats;
END;
$$ LANGUAGE plpgsql;
