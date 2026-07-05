/**
 * Proposal tokens and content store for the propose/commit write-preview
 * pattern (Phase 10).
 *
 * Token format: base64url(payload_json) + '.' + hex(HMAC-SHA256(payload_json, JWT_SECRET))
 *
 * Security properties:
 *   - Server-signed: cannot be forged without the HMAC secret.
 *   - Scoped: binds user_id, tenant_id, doc_id, operation, content_hash.
 *   - Expiring: 10-minute TTL.
 *   - Single-use: nonce tracked in usedNonces; committed nonces are rejected.
 *
 * Content store: the propose tool stores the proposed markdown here so the
 * commit tool can retrieve it without the UI re-transmitting the content.
 * In-memory, 10-minute TTL. (Production: replace with Redis TTL store.)
 */

import { createHash, createHmac, randomUUID } from 'crypto';
import { config } from '../../config/env.js';

export const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Token payload ─────────────────────────────────────────────────────────────
export interface ProposalPayload {
  u: string;   // user_id
  w: string;   // tenant_id (workspace_id)
  d: string;   // doc_id ('' for create)
  op: string;  // operation type
  h: string;   // sha256 hex of the proposed content
  iat: number; // issued-at (ms)
  exp: number; // expires-at (ms)
  n: string;   // nonce UUID for single-use tracking
  a?: string;  // section_anchor (for replace_section)
  f?: string;  // folder_id (for trash_folder)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ── Single-use nonce store ────────────────────────────────────────────────────
const usedNonces = new Map<string, number>(); // nonce → expiry_ms

function pruneNonces(): void {
  const now = Date.now();
  for (const [n, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(n);
  }
}

// ── Proposal content store ────────────────────────────────────────────────────
// Stores proposed markdown indexed by nonce. Retrieve at commit time.
interface ContentStoreEntry {
  markdown: string;
  anchor_id?: string;
  doc_name?: string;
  expected_anchors?: string[];
  folder_id?: string;
  exp: number;
}
const contentStore = new Map<string, ContentStoreEntry>();

export function storeProposalContent(
  nonce: string,
  markdown: string,
  expMs: number,
  anchorId?: string,
  docName?: string,
  expectedAnchors?: string[],
  folderId?: string,
): void {
  contentStore.set(nonce, {
    markdown,
    anchor_id: anchorId,
    doc_name: docName,
    expected_anchors: expectedAnchors,
    folder_id: folderId,
    exp: expMs,
  });
  if (contentStore.size > 1000) {
    const now = Date.now();
    for (const [k, v] of contentStore) {
      if (v.exp < now) contentStore.delete(k);
    }
  }
}

export function getProposalContent(
  nonce: string,
): { markdown: string; anchor_id?: string; doc_name?: string; expected_anchors?: string[]; folder_id?: string } | null {
  const entry = contentStore.get(nonce);
  if (!entry) return null;
  if (Date.now() > entry.exp) { contentStore.delete(nonce); return null; }
  return {
    markdown: entry.markdown,
    anchor_id: entry.anchor_id,
    doc_name: entry.doc_name,
    expected_anchors: entry.expected_anchors,
    folder_id: entry.folder_id,
  };
}

// ── Issue a token ─────────────────────────────────────────────────────────────
export function issueProposalToken(
  base: Omit<ProposalPayload, 'iat' | 'exp' | 'n'>,
): { token: string; nonce: string; exp: number } {
  const nonce = randomUUID();
  const exp = Date.now() + TOKEN_TTL_MS;
  const full: ProposalPayload = { ...base, iat: Date.now(), exp, n: nonce };
  const payloadB64 = b64url(JSON.stringify(full));
  const sig = createHmac('sha256', config.JWT_SECRET).update(payloadB64).digest('hex');
  return { token: `${payloadB64}.${sig}`, nonce, exp };
}

// ── Validate and redeem a token ───────────────────────────────────────────────
export type TokenValidationResult =
  | { ok: true; payload: ProposalPayload }
  | { ok: false; reason: string };

export function redeemProposalToken(
  token: string,
  expectedUserId: string,
  expectedTenantId: string,
): TokenValidationResult {
  pruneNonces();

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed_token' };
  const [payloadB64, sig] = parts as [string, string];

  const expectedSig = createHmac('sha256', config.JWT_SECRET).update(payloadB64).digest('hex');
  if (sig !== expectedSig) return { ok: false, reason: 'invalid_signature' };

  let payload: ProposalPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as ProposalPayload;
  } catch {
    return { ok: false, reason: 'malformed_payload' };
  }

  if (Date.now() > payload.exp) return { ok: false, reason: 'token_expired' };
  if (payload.u !== expectedUserId) return { ok: false, reason: 'user_mismatch' };
  if (payload.w !== expectedTenantId) return { ok: false, reason: 'workspace_mismatch' };
  if (usedNonces.has(payload.n)) return { ok: false, reason: 'token_already_used' };

  usedNonces.set(payload.n, payload.exp);
  return { ok: true, payload };
}
