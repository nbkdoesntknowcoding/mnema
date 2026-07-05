import { and, eq, isNull } from 'drizzle-orm';
import pino from 'pino';
import { withSystemPrivilege } from '../../../db/with-system-privilege.js';
import { optimizationFindings } from '../../../db/schema.js';
import { emitWorkspaceEvent } from '../../events.js';
import { stall, high_retry, cost_overrun, parallel, token_bloat, context_wide } from './engine.js';
import type { Finding } from './engine.js';

const log = pino({ name: 'optimization-runner' });

export async function runOptimizationForWorkspace(workspaceId: string): Promise<number> {
  const rules = [stall, high_retry, cost_overrun, parallel, token_bloat, context_wide];
  let newFindings = 0;

  for (const rule of rules) {
    try {
      const findings: Finding[] = await rule(workspaceId);

      for (const finding of findings) {
        // Dedup: don't insert if identical finding exists and is not dismissed
        const existing = await withSystemPrivilege((tx) =>
          tx
            .select({ id: optimizationFindings.id })
            .from(optimizationFindings)
            .where(and(
              eq(optimizationFindings.workspaceId, workspaceId),
              eq(optimizationFindings.rule, finding.rule),
              finding.sessionId
                ? eq(optimizationFindings.sessionId, finding.sessionId)
                : isNull(optimizationFindings.sessionId),
              finding.taskId
                ? eq(optimizationFindings.taskId, finding.taskId)
                : isNull(optimizationFindings.taskId),
              eq(optimizationFindings.dismissed, false),
            ))
            .limit(1),
        );

        if (existing.length === 0) {
          await withSystemPrivilege((tx) =>
            tx.insert(optimizationFindings).values({
              workspaceId: finding.workspaceId,
              sessionId: finding.sessionId ?? null,
              taskId: finding.taskId ?? null,
              rule: finding.rule,
              description: finding.description,
              suggestedAction: finding.suggestedAction,
              roiScore: finding.roiScore,
              metadata: finding.metadata,
            }),
          );
          newFindings++;
        }
      }
    } catch (err) {
      log.error({ err, rule: rule.name, workspaceId }, 'Optimization rule failed');
    }
  }

  if (newFindings > 0) {
    emitWorkspaceEvent(workspaceId, {
      type: 'optimization_findings_updated',
      data: { newCount: newFindings },
    });
  }

  return newFindings;
}
