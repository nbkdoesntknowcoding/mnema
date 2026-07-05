-- 0053_docs_rls_doc_level_acl.sql — H2 of Fix_IAM_Audit_Remediation.
-- Access-request approval writes a DOC-level doc_acl grant, but RLS only consulted
-- PROJECT-level grants via app_can_see_project — so a grantee still got 404 on a doc
-- filed in a project they aren't a member of. This adds a doc-level ACL check to the
-- docs SELECT policy (the doc's own id is in scope here), so a doc-level grant makes
-- the single doc visible without granting the whole project.
-- Only SELECT visibility is changed; insert/update/delete policies are unchanged
-- (a read grant must not confer write). Applied by hand via psql, as boppl.

DROP POLICY IF EXISTS docs_tenant_select ON docs;
CREATE POLICY docs_tenant_select ON docs FOR SELECT
  USING (
    workspace_id = app_current_tenant_id()
    AND (
      app_can_see_project(project_id)
      OR app_acl_permits('doc', id)   -- H2: explicit doc-level grant on this doc
    )
  );
