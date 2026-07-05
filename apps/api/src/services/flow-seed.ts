import { eq } from 'drizzle-orm';
import { flowEdges, flowNodes, flowVersions, flows } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';

/**
 * Seed one example flow into a workspace.
 *
 * Called at workspace creation time, right after the welcome doc has been
 * inserted. The seeded flow is one `instruction` node + one `doc` node
 * referencing the welcome doc, with a single edge between them. It's
 * intentionally trivial — its purpose is to make every new workspace
 * have *something* an MCP client can call `list_flows` against, so the
 * read path can be verified end-to-end without the user having to
 * compose a flow by hand.
 *
 * Idempotent: if a flow with slug `example-onboarding` already exists in
 * the workspace, this function returns the existing flow's id without
 * touching anything. The backfill migration relies on this — running it
 * twice produces the same end state.
 *
 * Runs inside `withTenant` so RLS clamps writes to the right workspace.
 * The caller is responsible for the prior welcome-doc insert.
 */
export async function seedExampleFlow(
  workspaceId: string,
  userId: string,
  welcomeDocId: string,
): Promise<string> {
  return await withTenant(workspaceId, async (tx) => {
    // Idempotency: is there already an example-onboarding flow here?
    const existing = await tx
      .select({ id: flows.id })
      .from(flows)
      .where(eq(flows.slug, 'example-onboarding'))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [createdFlow] = await tx
      .insert(flows)
      .values({
        workspaceId,
        slug: 'example-onboarding',
        name: 'Example: workspace onboarding',
        description:
          'A simple example flow showing how Claude walks a sequence of docs. ' +
          'Edit or delete this flow to make it yours.',
        createdBy: userId,
      })
      .returning();
    if (!createdFlow) throw new Error('seed_flow_insert_failed');

    const [version] = await tx
      .insert(flowVersions)
      .values({
        flowId: createdFlow.id,
        workspaceId,
        versionNumber: 1,
        isPublished: true,
        createdBy: userId,
      })
      .returning();
    if (!version) throw new Error('seed_version_insert_failed');

    await tx.insert(flowNodes).values([
      {
        flowVersionId: version.id,
        clientNodeId: 'intro',
        kind: 'instruction',
        title: 'Welcome',
        positionX: 100,
        positionY: 100,
        data: {
          text:
            'This is an example flow. Each step in a flow has an instruction and ' +
            '(optionally) content. The first step is just this instruction; the next ' +
            'step pulls in the workspace welcome doc.',
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'read-welcome',
        kind: 'doc',
        title: 'Read the welcome doc',
        positionX: 300,
        positionY: 100,
        data: {
          doc_id: welcomeDocId,
          instruction:
            'Read the welcome doc to understand what Mnema is and how this workspace is structured.',
        },
      },
    ]);

    await tx.insert(flowEdges).values({
      flowVersionId: version.id,
      fromNodeId: 'intro',
      toNodeId: 'read-welcome',
      fromSocket: 'default',
    });

    // Point the flow at its published version. Once this row update lands,
    // list_flows can see the seeded flow.
    await tx
      .update(flows)
      .set({ publishedVersionId: version.id })
      .where(eq(flows.id, createdFlow.id));

    return createdFlow.id;
  });
}
