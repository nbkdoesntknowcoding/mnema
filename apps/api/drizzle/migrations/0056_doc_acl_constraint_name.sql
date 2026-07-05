-- 0056_doc_acl_constraint_name.sql — SCHEMA-3 cleanup of Fix_IAM_Audit_Remediation.
-- 0036 created the doc_acl uniqueness as an anonymous inline UNIQUE(...), so Postgres
-- auto-named it (doc_acl_resource_type_..._key), drifting from the Drizzle schema's
-- declared name doc_acl_resource_principal_uq. Functionally harmless (onConflict targets
-- columns), but rename it so DB and schema agree. Idempotent — no-op if already named.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'doc_acl'::regclass
    AND contype = 'u'
    AND conname <> 'doc_acl_resource_principal_uq'
  LIMIT 1;
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE doc_acl RENAME CONSTRAINT %I TO doc_acl_resource_principal_uq', c);
  END IF;
END $$;
