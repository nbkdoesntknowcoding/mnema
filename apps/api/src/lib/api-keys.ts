/**
 * API key generation and resolution utilities.
 * Keys follow the format: mnema_api_ + 48 random hex chars (total 58 chars).
 * Only the SHA-256 hash is stored. The plaintext is returned once at creation.
 */

import crypto from 'crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(48).toString('hex'); // 96 hex chars
  const plaintext = `mnema_api_${random}`;
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, 16); // "mnema_api_" + 6 chars
  return { plaintext, hash, prefix };
}

export async function resolveApiKey(
  bearerToken: string,
): Promise<{ userId: string; workspaceId: string; projectId: string | null; actAsUser: boolean; scopes: string[] } | null> {
  if (!bearerToken?.startsWith('mnema_api_')) return null;

  const hash = crypto.createHash('sha256').update(bearerToken).digest('hex');

  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, hash),
      isNull(apiKeys.revokedAt),
      or(
        isNull(apiKeys.expiresAt),
        gt(apiKeys.expiresAt, new Date()),
      ),
    ),
  });

  if (!key) return null;

  // Update last used timestamp async (fire and forget)
  db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {});

  return {
    userId: key.createdBy,
    workspaceId: key.workspaceId,
    projectId: key.projectId ?? null,
    actAsUser: key.actAsUser ?? false,
    scopes: key.scopes,
  };
}

/**
 * Validate that requested scopes are a subset of allowed scope values.
 */
const VALID_SCOPES = new Set(['read', 'write', 'tasks']);

export function validateScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) return ['read'];
  const valid = scopes.filter((s): s is string => typeof s === 'string' && VALID_SCOPES.has(s));
  return valid.length > 0 ? valid : ['read'];
}

/**
 * Expand API key coarse scopes to internal MCP tool-level scopes.
 *
 * API key scopes  → internal scopes consumed by requireScope() / requireWriteScope()
 *   read          → docs:read  (default — can search and read docs)
 *   write         → docs:read + workspace:write  (can use propose_doc_write etc)
 *   tasks         → docs:read + workspace:write + tasks  (write + dev task tools)
 *
 * This matches the expansion logic for OAuth tokens in require-bearer.ts so
 * tool handlers don't need to distinguish between token types.
 */
export function expandApiKeyScopes(rawScopes: string[]): string[] {
  const expanded = new Set<string>(['docs:read']); // always included
  for (const s of rawScopes) {
    if (s === 'write' || s === 'tasks') {
      expanded.add('workspace:write');
      expanded.add('docs:write');
    }
    if (s === 'tasks') {
      expanded.add('tasks');
    }
  }
  return [...expanded];
}
