/**
 * Phase 0 (Open-Core) — one-shot re-encryption of
 * workspace_members.calendar_refresh_token from the OLD secret-box KDF seed
 * (WORKOS_COOKIE_PASSWORD) to the NEW seed (SECRETBOX_MASTER_KEY).
 *
 *   pnpm --filter @boppl/api rekey:secretbox -- --dry-run
 *   pnpm --filter @boppl/api rekey:secretbox
 *
 * Requires BOTH seeds in env; exits nonzero if either is missing.
 *
 * Idempotent: a row already stored under the new seed (old-key decrypt fails,
 * new-key decrypt succeeds) is detected and skipped with a notice, not errored.
 * A row that decrypts under neither seed is reported as a FAILURE (nonzero exit).
 *
 * --dry-run decrypt-verifies every row under the old seed and writes nothing.
 *
 * NOTE: this script deliberately does NOT import lib/secret-box.ts — that module
 * is now hard-wired to the new seed only. Here we need BOTH KDFs, so the wire
 * format (scrypt 'mnema-calendar-enc' salt, AES-256-GCM, 12-byte IV,
 * base64url `iv.tag.enc`) is reproduced locally and must stay in lock-step with
 * secret-box.ts.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaceMembers } from '../db/schema.js';

const OLD_SEED = process.env.WORKOS_COOKIE_PASSWORD;
const NEW_SEED = process.env.SECRETBOX_MASTER_KEY;
if (!OLD_SEED || !NEW_SEED) {
  console.error(
    'rekey-secret-box: both WORKOS_COOKIE_PASSWORD (old seed) and SECRETBOX_MASTER_KEY (new seed) must be set.',
  );
  process.exit(1);
}

const OLD_ENC = scryptSync(OLD_SEED, 'mnema-calendar-enc', 32);
const NEW_ENC = scryptSync(NEW_SEED, 'mnema-calendar-enc', 32);

function decryptWith(blob: string, key: Buffer): string {
  const [ivB, tagB, encB] = blob.split('.');
  if (!ivB || !tagB || !encB) throw new Error('malformed ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64url'));
  d.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(encB, 'base64url')), d.final()]).toString('utf8');
}

function encryptWith(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

const DRY = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      workspaceId: workspaceMembers.workspaceId,
      tok: workspaceMembers.calendarRefreshToken,
    })
    .from(workspaceMembers)
    .where(isNotNull(workspaceMembers.calendarRefreshToken));

  console.log(
    `rekey-secret-box: ${rows.length} row(s) with a calendar_refresh_token${DRY ? '  [DRY RUN — no writes]' : ''}`,
  );

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const label = `member(ws=${r.workspaceId} user=${r.userId})`;
    const blob = r.tok as string;

    let plain: string;
    try {
      plain = decryptWith(blob, OLD_ENC);
    } catch {
      // Old-key decrypt failed — is it already migrated to the new seed?
      try {
        decryptWith(blob, NEW_ENC);
        console.log(`  skip   ${label}: already under new seed`);
        skipped += 1;
        continue;
      } catch {
        console.error(`  FAIL   ${label}: decrypts under neither old nor new seed`);
        failed += 1;
        continue;
      }
    }

    if (DRY) {
      console.log(`  ok     ${label}: readable under old seed (would re-encrypt)`);
      migrated += 1;
      continue;
    }

    const reblob = encryptWith(plain, NEW_ENC);
    await db.transaction(async (tx) => {
      await tx
        .update(workspaceMembers)
        .set({ calendarRefreshToken: reblob })
        .where(
          and(
            eq(workspaceMembers.workspaceId, r.workspaceId),
            eq(workspaceMembers.userId, r.userId),
          ),
        );
    });
    console.log(`  migr   ${label}: re-encrypted under new seed`);
    migrated += 1;
  }

  console.log(
    `rekey-secret-box: done. migrated=${migrated} skipped=${skipped} failed=${failed}${DRY ? ' (dry-run)' : ''}`,
  );
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('rekey-secret-box: fatal', err);
  process.exit(1);
});
