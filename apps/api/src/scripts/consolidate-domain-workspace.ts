import { eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions, users, workspaceMembers, workspaces } from '../db/schema.js';
import { ACTIVE_STATUSES } from '../plugins/subscription.js';

/**
 * Admin CLI: consolidate a set of users (by email domain or explicit emails)
 * into a single target workspace as editors.
 *
 * Use case: a company bought a paid (Business) plan on one workspace, but its
 * employees each signed up into their own free personal workspace and are hitting
 * free-plan limits. This adds them as members of the paid workspace; combined with
 * the "prefer paid workspace at login" change, they then default into it.
 *
 * DRY-RUN by default. Pass --apply to write. Idempotent (onConflictDoNothing).
 *
 *   pnpm consolidate:domain --target <workspaceIdOrSlug> --domain example.com
 *   pnpm consolidate:domain --target <workspaceIdOrSlug> --emails a@x.com,b@x.com --apply
 */

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function main(): Promise<void> {
  const target = getFlag('target');
  const domain = getFlag('domain');
  const emailsArg = getFlag('emails');
  const apply = process.argv.includes('--apply');

  if (!domain && !emailsArg) {
    console.error('Usage: pnpm consolidate:domain [--target <workspaceIdOrSlug>] (--domain <domain> | --emails a@x,b@y) [--apply]');
    console.error('  --target is required for --apply. Omit it for a discovery dry-run that lists workspaces + active subscriptions.');
    process.exit(1);
  }
  if (apply && !target) {
    console.error('--apply requires --target <workspaceIdOrSlug>.');
    process.exit(1);
  }

  // ── Resolve target workspace (optional in discovery dry-run) ────────────────
  let ws: { id: string; slug: string; name: string; plan: string } | null = null;
  if (target) {
    const wsRows = await db
      .select({ id: workspaces.id, slug: workspaces.slug, name: workspaces.name, plan: workspaces.plan })
      .from(workspaces)
      .where(isUuid(target) ? eq(workspaces.id, target) : eq(workspaces.slug, target))
      .limit(1);
    ws = wsRows[0] ?? null;
    if (!ws) {
      console.error(`Target workspace not found: ${target}`);
      process.exit(1);
    }
    const targetSubs = await db
      .select({ status: subscriptions.status, planKey: subscriptions.planKey })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, ws.id));
    const targetActive = targetSubs.find((s) => ACTIVE_STATUSES.has(s.status as never));
    console.log(`\nTarget workspace: ${ws.name} (${ws.slug} / ${ws.id})`);
    console.log(`  plan column: ${ws.plan}`);
    console.log(
      targetActive
        ? `  active subscription: ${targetActive.planKey} (${targetActive.status}) ✓`
        : `  active subscription: NONE ✗  (consolidating here will NOT grant paid limits)`,
    );
  } else {
    console.log('\nDiscovery mode (no --target): listing matched users + their workspaces below.');
  }

  // ── Resolve target users ────────────────────────────────────────────────────
  const emailList = emailsArg?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) ?? [];
  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      domain
        ? ilike(users.email, `%@${domain}`)
        : or(...emailList.map((e) => eq(users.email, e))),
    );

  if (userRows.length === 0) {
    console.error('\nNo matching users found.');
    process.exit(1);
  }

  console.log(`\nMatched ${userRows.length} user(s):`);

  // Topology: which workspaces each user already belongs to, + which are paid.
  for (const u of userRows) {
    const mships = await db
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role, slug: workspaces.slug })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, u.id));
    const wsIds = mships.map((m) => m.workspaceId);
    const paidSet = new Set<string>();
    if (wsIds.length) {
      const subs = await db
        .select({ workspaceId: subscriptions.workspaceId, status: subscriptions.status })
        .from(subscriptions)
        .where(inArray(subscriptions.workspaceId, wsIds));
      for (const s of subs) if (ACTIVE_STATUSES.has(s.status as never)) paidSet.add(s.workspaceId);
    }
    const inTarget = ws ? wsIds.includes(ws.id) : false;
    const desc = mships
      .map((m) => `${m.slug}:${m.role}${paidSet.has(m.workspaceId) ? '(paid)' : ''}`)
      .join(', ') || '(none)';
    console.log(`  • ${u.email} → ${desc}${inTarget ? '  [already in target]' : ''}`);
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  if (!apply || !ws) {
    console.log('\nDRY-RUN. Re-run with --target <workspaceIdOrSlug> --apply to add the above users as editors.');
    process.exit(0);
  }

  let added = 0;
  for (const u of userRows) {
    const res = await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.id, userId: u.id, role: 'editor' })
      .onConflictDoNothing()
      .returning({ userId: workspaceMembers.userId });
    if (res.length) added++;
  }
  console.log(`\nAPPLIED. Added ${added} new member(s) as editor to ${ws.slug}. ${userRows.length - added} already member(s).`);
  console.log('They will default into this workspace on next login (re-login required to re-mint the session).');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
