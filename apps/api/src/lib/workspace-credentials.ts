/**
 * Phase 1 (Open-Core BYOK) — workspace credential store. v1 covers the
 * meeting-agent LLM key only (provider 'llm', OpenAI-compatible). Keys are
 * encrypted at rest via lib/secret-box.ts (SECRETBOX_MASTER_KEY); plaintext is
 * only ever materialised transiently by getWorkspaceLlmCredential on the server.
 *
 * Enforcement is app-layer: callers pass a workspace_id they are authorised for
 * (settings routes require workspace admin; the meeting worker + internal
 * key endpoint resolve the workspace server-side). See table `workspace_credentials`.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { workspaceCredentials } from '../db/schema.js';
import { getSecretStore } from './secret-store/index.js';

export const LLM_PROVIDER = 'llm';

export interface LlmCredential {
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
}

/** Resolve + decrypt a workspace's BYOK LLM credential, or null if unset. */
export async function getWorkspaceLlmCredential(
  workspaceId: string,
): Promise<LlmCredential | null> {
  const rows = await db
    .select({
      enc: workspaceCredentials.encryptedKey,
      baseUrl: workspaceCredentials.baseUrl,
      model: workspaceCredentials.model,
    })
    .from(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, workspaceId),
        eq(workspaceCredentials.provider, LLM_PROVIDER),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { apiKey: await getSecretStore().decrypt(row.enc), baseUrl: row.baseUrl, model: row.model };
}

/** True if a BYOK LLM key exists for the workspace (no decryption). */
export async function hasWorkspaceLlmCredential(workspaceId: string): Promise<boolean> {
  const rows = await db
    .select({ w: workspaceCredentials.workspaceId })
    .from(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, workspaceId),
        eq(workspaceCredentials.provider, LLM_PROVIDER),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Non-secret metadata for the settings UI — presence + base_url/model, no key. */
export async function getWorkspaceLlmCredentialMeta(
  workspaceId: string,
): Promise<{ present: boolean; baseUrl: string | null; model: string | null }> {
  const rows = await db
    .select({ baseUrl: workspaceCredentials.baseUrl, model: workspaceCredentials.model })
    .from(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, workspaceId),
        eq(workspaceCredentials.provider, LLM_PROVIDER),
      ),
    )
    .limit(1);
  const row = rows[0];
  return { present: Boolean(row), baseUrl: row?.baseUrl ?? null, model: row?.model ?? null };
}

/** Encrypt + upsert a workspace's BYOK LLM credential. */
export async function setWorkspaceLlmCredential(
  workspaceId: string,
  cred: { apiKey: string; baseUrl?: string | null; model?: string | null },
): Promise<void> {
  const encryptedKey = await getSecretStore().encrypt(cred.apiKey);
  await db
    .insert(workspaceCredentials)
    .values({
      workspaceId,
      provider: LLM_PROVIDER,
      encryptedKey,
      baseUrl: cred.baseUrl ?? null,
      model: cred.model ?? null,
    })
    .onConflictDoUpdate({
      target: [workspaceCredentials.workspaceId, workspaceCredentials.provider],
      set: {
        encryptedKey,
        baseUrl: cred.baseUrl ?? null,
        model: cred.model ?? null,
        updatedAt: new Date(),
      },
    });
}

/** Remove a workspace's BYOK LLM credential. */
export async function deleteWorkspaceLlmCredential(workspaceId: string): Promise<void> {
  await db
    .delete(workspaceCredentials)
    .where(
      and(
        eq(workspaceCredentials.workspaceId, workspaceId),
        eq(workspaceCredentials.provider, LLM_PROVIDER),
      ),
    );
}
