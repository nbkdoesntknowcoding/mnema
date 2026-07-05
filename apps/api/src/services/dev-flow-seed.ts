import { eq } from 'drizzle-orm';
import { flowEdges, flowNodes, flowVersions, flows } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';

/**
 * Seeds the default "Build Flow" into a newly created dev_project workspace.
 *
 * The flow models the full AgentLens task lifecycle:
 *   read docs → claim task → work → decision (done? / blocked?)
 *   → complete_task OR log_blocker
 *
 * Idempotent: if a flow with slug `build-flow` already exists in this
 * workspace, returns the existing flow id without modifying anything.
 */
export async function seedBuildFlow(
  workspaceId: string,
  userId: string,
): Promise<string> {
  return await withTenant(workspaceId, async (tx) => {
    // Idempotency check
    const existing = await tx
      .select({ id: flows.id })
      .from(flows)
      .where(eq(flows.slug, 'build-flow'))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [createdFlow] = await tx
      .insert(flows)
      .values({
        workspaceId,
        slug: 'build-flow',
        name: 'Build Flow',
        description:
          'Default dev workflow: read specs → claim task → work → complete or log blocker.',
        createdBy: userId,
      })
      .returning();
    if (!createdFlow) throw new Error('build_flow_insert_failed');

    const [version] = await tx
      .insert(flowVersions)
      .values({
        flowId: createdFlow.id,
        workspaceId,
        versionNumber: 1,
        isPublished: true,
        createdBy: userId,
        publishMessage: 'Auto-seeded on dev project creation',
      })
      .returning();
    if (!version) throw new Error('build_flow_version_insert_failed');

    // Six nodes matching the AgentLens task lifecycle
    await tx.insert(flowNodes).values([
      {
        flowVersionId: version.id,
        clientNodeId: 'read-docs',
        kind: 'instruction',
        title: 'Read specs',
        positionX: 100,
        positionY: 100,
        data: {
          text: 'Read the PRD and Architecture docs before starting any task.',
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'claim-task',
        kind: 'instruction',
        title: 'Claim next task',
        positionX: 300,
        positionY: 100,
        data: {
          text: 'Claim the next task via get_next_task and claim_task.',
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'work-task',
        kind: 'instruction',
        title: 'Work on task',
        positionX: 500,
        positionY: 100,
        data: {
          text: 'Work on the task. Log milestones via log_milestone.',
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'decision',
        kind: 'instruction',
        title: 'Task complete without blockers?',
        positionX: 700,
        positionY: 100,
        data: {
          text: 'Decide: did you complete the task without blockers?',
          branches: ['yes', 'no'],
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'complete-yes',
        kind: 'instruction',
        title: 'Complete task',
        positionX: 900,
        positionY: 0,
        data: {
          text: 'Call complete_task with the git commit hash.',
        },
      },
      {
        flowVersionId: version.id,
        clientNodeId: 'log-blocker',
        kind: 'instruction',
        title: 'Log blocker',
        positionX: 900,
        positionY: 200,
        data: {
          text: 'Call log_blocker with a description of what failed.',
        },
      },
    ]);

    // Edges: linear chain + decision branches
    await tx.insert(flowEdges).values([
      { flowVersionId: version.id, fromNodeId: 'read-docs',    toNodeId: 'claim-task',   fromSocket: 'default' },
      { flowVersionId: version.id, fromNodeId: 'claim-task',   toNodeId: 'work-task',    fromSocket: 'default' },
      { flowVersionId: version.id, fromNodeId: 'work-task',    toNodeId: 'decision',     fromSocket: 'default' },
      { flowVersionId: version.id, fromNodeId: 'decision',     toNodeId: 'complete-yes', fromSocket: 'yes' },
      { flowVersionId: version.id, fromNodeId: 'decision',     toNodeId: 'log-blocker',  fromSocket: 'no' },
    ]);

    // Point the flow at its published version
    await tx
      .update(flows)
      .set({ publishedVersionId: version.id })
      .where(eq(flows.id, createdFlow.id));

    return createdFlow.id;
  });
}
