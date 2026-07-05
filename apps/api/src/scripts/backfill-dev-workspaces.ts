/**
 * Backfill script for existing dev_project workspaces.
 *
 * Finds all dev_project workspaces that are missing any of:
 *   - hook token
 *   - any of the 6 required folders
 *   - Build Flow
 *
 * And creates the missing items.
 *
 * Run:          npx tsx src/scripts/backfill-dev-workspaces.ts
 * Dry run:      npx tsx src/scripts/backfill-dev-workspaces.ts --dry-run
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { folders, flows, workspaces } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { generateHookToken } from '../lib/dev/hook-token.js';
import { seedBuildFlow } from '../services/dev-flow-seed.js';

const isDryRun = process.argv.includes('--dry-run');

const DEV_FOLDERS = ['Architecture', 'PRD', 'Tasks', 'Build Prompts', 'Skills', 'Decisions'];
// createdBy is nullable on folders and flows — use null for scripted seeding
const SYSTEM_USER_ID = null as unknown as string;

interface BackfillResult {
  workspaceId: string;
  hookTokenGenerated: boolean;
  foldersCreated: string[];
  flowCreated: boolean;
  error?: string;
}

async function backfillWorkspace(workspaceId: string): Promise<BackfillResult> {
  const result: BackfillResult = {
    workspaceId,
    hookTokenGenerated: false,
    foldersCreated: [],
    flowCreated: false,
  };

  try {
    // Check hook token
    const wsRow = await withSystemPrivilege((tx) =>
      tx
        .select({ hookToken: workspaces.hookToken })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
        .then((r) => r[0]),
    );

    if (wsRow && wsRow.hookToken === null) {
      if (!isDryRun) {
        const { hash } = generateHookToken();
        await withSystemPrivilege((tx) =>
          tx
            .update(workspaces)
            .set({ hookToken: hash, updatedAt: new Date() })
            .where(eq(workspaces.id, workspaceId)),
        );
      }
      result.hookTokenGenerated = true;
    }

    // Check folders
    const existingFolders = await withTenant(workspaceId, (tx) =>
      tx
        .select({ name: folders.name })
        .from(folders)
        .where(and(
          eq(folders.workspaceId, workspaceId),
          isNull(folders.deletedAt),
        )),
    );

    const existingNames = new Set(existingFolders.map((f) => f.name));
    const missingFolders = DEV_FOLDERS.filter((n) => !existingNames.has(n));

    if (missingFolders.length > 0) {
      if (!isDryRun) {
        await withTenant(workspaceId, (tx) =>
          tx.insert(folders).values(
            missingFolders.map((name) => ({
              workspaceId,
              name,
              createdBy: SYSTEM_USER_ID,
            })),
          ),
        );
      }
      result.foldersCreated = missingFolders;
    }

    // Check Build Flow
    const existingFlow = await withTenant(workspaceId, (tx) =>
      tx
        .select({ id: flows.id })
        .from(flows)
        .where(eq(flows.slug, 'build-flow'))
        .limit(1),
    );

    if (existingFlow.length === 0) {
      if (!isDryRun) {
        await seedBuildFlow(workspaceId, SYSTEM_USER_ID);
      }
      result.flowCreated = true;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

async function main() {
  console.log(`\n🔍 Backfill dev_project workspaces${isDryRun ? ' (DRY RUN — no writes)' : ''}\n`);

  const devWorkspaces = await withSystemPrivilege((tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.mode, 'dev_project')),
  );

  console.log(`Found ${devWorkspaces.length} dev_project workspace(s)\n`);

  let needsWork = 0;
  let totalFixed = 0;
  let errors = 0;

  for (const ws of devWorkspaces) {
    const result = await backfillWorkspace(ws.id);

    const needsFix =
      result.hookTokenGenerated ||
      result.foldersCreated.length > 0 ||
      result.flowCreated;

    if (!needsFix && !result.error) {
      console.log(`✅ ${ws.id} (${ws.name}) — complete, nothing to do`);
      continue;
    }

    needsWork++;

    if (result.error) {
      errors++;
      console.log(`❌ ${ws.id} (${ws.name}) — ERROR: ${result.error}`);
      continue;
    }

    totalFixed++;
    const actions: string[] = [];
    if (result.hookTokenGenerated) actions.push('hook token generated');
    if (result.foldersCreated.length > 0) actions.push(`folders: ${result.foldersCreated.join(', ')}`);
    if (result.flowCreated) actions.push('Build Flow created');

    const prefix = isDryRun ? '🔍 WOULD FIX' : '✔';
    console.log(`${prefix} ${ws.id} (${ws.name}): ${actions.join(' | ')}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total workspaces:  ${devWorkspaces.length}`);
  console.log(`Needed backfill:   ${needsWork}`);
  if (!isDryRun) {
    console.log(`Fixed:             ${totalFixed}`);
    console.log(`Errors:            ${errors}`);
  } else {
    console.log(`(dry run — no writes performed)`);
  }

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
