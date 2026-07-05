/**
 * Pending-AI-version signal map.
 *
 * When an MCP IPC write handler (appendblocks, replacesection, replacebody,
 * init-with-content) completes successfully, it calls `markAiWrite(docId,
 * toolName)`. When `onStoreDocument` fires for that doc (after the debounce),
 * `persistence.ts` checks this map and — if an entry is present — creates a
 * `doc_versions` row tagged `author_kind = 'ai'` regardless of the 50-store
 * cycle.
 *
 * This is process-local (resets on restart), which is correct: the signal
 * only needs to survive the 3–15 s debounce window between the IPC write and
 * the Hocuspocus store flush. A server restart in that window means the
 * version is silently skipped — acceptable for a best-effort audit trail.
 *
 * We store `toolName` only; `user_id` / `tenant_id` come from
 * `data.lastContext` inside `onStoreDocument` (the ctx passed to
 * `openDirectConnection` at write time).
 */

const pending = new Map<string, string>(); // docId → toolName

export function markAiWrite(docId: string, toolName: string): void {
  pending.set(docId, toolName);
}

/**
 * Consume and return the pending tool name for a doc, or null if none.
 * Removes the entry so a second `onStoreDocument` call for the same doc
 * (e.g. a human edit 1 s after the AI write) does not double-version.
 */
export function consumeAiWrite(docId: string): string | null {
  const toolName = pending.get(docId) ?? null;
  if (toolName !== null) pending.delete(docId);
  return toolName;
}
