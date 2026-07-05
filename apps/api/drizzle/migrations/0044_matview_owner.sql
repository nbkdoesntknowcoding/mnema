-- 0044_matview_owner.sql
-- The hourly stats cron failed with "must be owner of materialized view
-- workspace_session_stats" — REFRESH MATERIALIZED VIEW requires ownership, but
-- the refresh ran as a non-owner role. Make boppl own the matview + its refresh
-- function, and mark the function SECURITY DEFINER so it always refreshes with
-- the owner's rights regardless of which role the cron connection is using.
-- Run as boppl (the POSTGRES_USER / DB owner).
ALTER MATERIALIZED VIEW workspace_session_stats OWNER TO boppl;
ALTER FUNCTION refresh_workspace_session_stats() OWNER TO boppl;
ALTER FUNCTION refresh_workspace_session_stats() SECURITY DEFINER;
