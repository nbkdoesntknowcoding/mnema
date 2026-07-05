-- =========================================================================
-- Phase 6.1 — Backfill an example flow into every existing workspace
-- =========================================================================
-- The Phase 6.1 onboarding path seeds `example-onboarding` into every new
-- workspace at creation time. This migration runs the equivalent for
-- workspaces that existed before 6.1 — one example flow per workspace,
-- using the workspace's welcome doc (or its most-recently-updated doc as
-- a fallback) as the referenced doc for the second node.
--
-- Idempotent: the `ON CONFLICT (workspace_id, slug) DO NOTHING` clause on
-- the flow insert + the post-condition that flow_nodes/flow_edges only
-- insert under newly-created versions makes re-running this migration a
-- no-op.
--
-- Runs as table owner (no GUC set) — RLS doesn't apply to migrations.
-- =========================================================================

DO $$
DECLARE
  ws         RECORD;
  flow_uuid  UUID;
  ver_uuid   UUID;
  doc_uuid   UUID;
  user_uuid  UUID;
BEGIN
  FOR ws IN
    SELECT w.id AS workspace_id
    FROM workspaces w
    -- Only workspaces without an example-onboarding flow already.
    WHERE NOT EXISTS (
      SELECT 1 FROM flows f
      WHERE f.workspace_id = w.id
        AND f.slug = 'example-onboarding'
    )
  LOOP
    -- Pick a doc to reference. Prefer the welcome doc by path; fall back
    -- to the most-recently-updated non-deleted doc; skip workspaces with
    -- no docs (no useful flow to seed).
    SELECT id INTO doc_uuid
    FROM docs
    WHERE workspace_id = ws.workspace_id
      AND deleted_at IS NULL
      AND path = 'welcome.md'
    LIMIT 1;

    IF doc_uuid IS NULL THEN
      SELECT id INTO doc_uuid
      FROM docs
      WHERE workspace_id = ws.workspace_id
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 1;
    END IF;

    IF doc_uuid IS NULL THEN
      CONTINUE;
    END IF;

    -- Pick an owner as created_by. Owners always exist for any workspace
    -- with members (every workspace has at least one owner by construction).
    SELECT user_id INTO user_uuid
    FROM workspace_members
    WHERE workspace_id = ws.workspace_id
      AND role = 'owner'
    ORDER BY joined_at ASC
    LIMIT 1;

    IF user_uuid IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO flows (workspace_id, slug, name, description, created_by)
    VALUES (
      ws.workspace_id,
      'example-onboarding',
      'Example: workspace onboarding',
      'A simple example flow showing how Claude walks a sequence of docs. '
        || 'Edit or delete this flow to make it yours.',
      user_uuid
    )
    RETURNING id INTO flow_uuid;

    INSERT INTO flow_versions (flow_id, version_number, is_published, created_by)
    VALUES (flow_uuid, 1, TRUE, user_uuid)
    RETURNING id INTO ver_uuid;

    INSERT INTO flow_nodes (flow_version_id, client_node_id, kind, title, position_x, position_y, data)
    VALUES
      (
        ver_uuid,
        'intro',
        'instruction',
        'Welcome',
        100,
        100,
        jsonb_build_object(
          'text',
          'This is an example flow. Each step in a flow has an instruction and '
            || '(optionally) content. The first step is just this instruction; the next '
            || 'step pulls in the workspace welcome doc.'
        )
      ),
      (
        ver_uuid,
        'read-welcome',
        'doc',
        'Read the welcome doc',
        300,
        100,
        jsonb_build_object(
          'doc_id', doc_uuid,
          'instruction',
            'Read the welcome doc to understand what Mnema is and how this workspace is structured.'
        )
      );

    INSERT INTO flow_edges (flow_version_id, from_node_id, to_node_id, from_socket)
    VALUES (ver_uuid, 'intro', 'read-welcome', 'default');

    UPDATE flows SET published_version_id = ver_uuid WHERE id = flow_uuid;
  END LOOP;
END $$;
