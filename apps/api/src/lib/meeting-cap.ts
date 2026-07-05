/**
 * Phase 1 (Open-Core BYOK) — free-tier meeting cap. While Recall.ai per-bot fees
 * are ours, a free-plan workspace may admit at most N meetings per calendar month.
 * Non-free plans are uncapped. This loosens once the in-house bot replaces Recall.
 *
 * "Meetings this month" = admitted meetings whose time (scheduled_start_at, else
 * started_at) falls in the current calendar month.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaces } from '../db/schema.js';

export const FREE_TIER_MEETINGS_PER_MONTH = 10;

export interface MeetingCapStatus {
  plan: string;
  /** true when a free-plan workspace has reached the monthly limit. */
  capped: boolean;
  used: number;
  /** null for uncapped (non-free) plans. */
  limit: number | null;
}

export async function getMeetingCapStatus(workspaceId: string): Promise<MeetingCapStatus> {
  const wrows = await db
    .select({ plan: workspaces.plan })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const plan = wrows[0]?.plan ?? 'free';
  if (plan !== 'free') return { plan, capped: false, used: 0, limit: null };

  const rows = await db.execute(sql`
    SELECT count(*)::int AS n FROM meetings
    WHERE workspace_id = ${workspaceId}::uuid
      AND admitted = true
      AND coalesce(scheduled_start_at, started_at) >= date_trunc('month', now())
      AND coalesce(scheduled_start_at, started_at) <  date_trunc('month', now()) + interval '1 month'`);
  const used = Number((rows as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  return { plan, capped: used >= FREE_TIER_MEETINGS_PER_MONTH, used, limit: FREE_TIER_MEETINGS_PER_MONTH };
}
