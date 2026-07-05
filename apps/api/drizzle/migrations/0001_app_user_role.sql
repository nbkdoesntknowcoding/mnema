-- A non-superuser role that RLS actually applies to.
-- The DATABASE_URL connection logs in as `boppl` (a Postgres superuser via the
-- Docker `POSTGRES_USER` default), which bypasses RLS even when policies are
-- forced. Tenant-scoped queries must `SET LOCAL ROLE app_user` first so RLS
-- engages. Migrations and pre-auth bootstrap operations stay on the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_user;
GRANT USAGE,  SELECT, UPDATE                          ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE                                         ON ALL FUNCTIONS IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,  SELECT, UPDATE         ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE                        ON FUNCTIONS TO app_user;

-- Allow the connection role to switch to app_user via SET ROLE inside a tx.
GRANT app_user TO boppl;
