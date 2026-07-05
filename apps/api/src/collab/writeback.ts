import { config } from '../config/env.js';

export interface WritebackCtx {
  user_id: string;
  tenant_id: string;
  email: string;
  doc_id: string;
}

/** Sentinel returned when the doc is not loaded in Hocuspocus. */
export const NO_LIVE_DOC = 'no_live_doc' as const;

/**
 * Push markdown into a live Y.Doc via IPC to the collab process — REPLACE.
 *
 * The api and collab are SEPARATE processes — they can't share an in-process
 * registry. The collab server exposes an internal HTTP endpoint authenticated
 * by the COLLAB_INTERNAL_SECRET shared secret (Phase 0 split this off
 * WORKOS_COOKIE_PASSWORD). This function POSTs to that endpoint and
 * returns true if the live doc accepted the update, false if no live session
 * exists (caller should fall back to writing the docs row directly).
 *
 * The ctx is passed through to openDirectConnection so the resulting Y.Doc
 * mutation has a lastContext for the next onStoreDocument's RLS-scoped write.
 */
export async function writeMarkdownIntoLiveDoc(
  docId: string,
  markdown: string,
  ctx: WritebackCtx,
): Promise<boolean> {
  const collabUrl =
    process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${config.COLLAB_PORT}`;
  try {
    const res = await fetch(`${collabUrl}/_internal/writeback/${docId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boppl-internal-secret': config.COLLAB_INTERNAL_SECRET,
      },
      body: JSON.stringify({ markdown, ctx }),
    });
    if (res.status === 404) return false; // no live doc
    if (!res.ok) {
      console.error('[writeback] collab returned', res.status);
      return false;
    }
    const body = (await res.json()) as { applied?: boolean };
    return Boolean(body.applied);
  } catch (err: unknown) {
    console.error('[writeback] IPC failed', err);
    return false;
  }
}

/**
 * Initialise a live Y.Doc (or seed a brand-new one) via IPC — Phase 9.2.
 *
 * Unlike writeMarkdownIntoLiveDoc (REPLACE), this uses the /_internal/init/
 * endpoint which calls openDirectConnection even when the doc isn't already
 * loaded in Hocuspocus — perfect for newly-created docs that have never had a
 * live session.
 *
 * Returns true on success, false on network or 500 error.
 */
export async function initLiveDoc(
  docId: string,
  markdown: string | undefined,
  ctx: WritebackCtx,
): Promise<boolean> {
  const collabUrl =
    process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${config.COLLAB_PORT}`;
  try {
    const res = await fetch(`${collabUrl}/_internal/init/${docId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boppl-internal-secret': config.COLLAB_INTERNAL_SECRET,
      },
      body: JSON.stringify({ markdown: markdown ?? '', ctx }),
    });
    if (!res.ok) {
      console.error('[writeback] init collab returned', res.status);
      return false;
    }
    const body = (await res.json()) as { initialized?: boolean };
    return Boolean(body.initialized);
  } catch (err: unknown) {
    console.error('[writeback] init IPC failed', err);
    return false;
  }
}

/**
 * Replace a named section in a live Y.Doc via IPC — Phase 9.2.
 *
 * Returns:
 *   true              — section replaced successfully
 *   false             — IPC call failed (network error or collab 500)
 *   'anchor_not_found'— the section_anchor no longer exists in the live doc
 */
export async function replaceSectionInLiveDoc(
  docId: string,
  sectionAnchor: string,
  markdown: string,
  ctx: WritebackCtx,
): Promise<boolean | 'anchor_not_found'> {
  const collabUrl =
    process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${config.COLLAB_PORT}`;
  try {
    const res = await fetch(`${collabUrl}/_internal/replacesection/${docId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boppl-internal-secret': config.COLLAB_INTERNAL_SECRET,
      },
      body: JSON.stringify({ section_anchor: sectionAnchor, markdown, ctx }),
    });
    if (res.status === 404) return 'anchor_not_found';
    if (!res.ok) {
      console.error('[writeback] replacesection collab returned', res.status);
      return false;
    }
    const body = (await res.json()) as { applied?: boolean };
    return Boolean(body.applied);
  } catch (err: unknown) {
    console.error('[writeback] replacesection IPC failed', err);
    return false;
  }
}

/**
 * Replace the entire body of a live Y.Doc via IPC — Phase 9.2.
 *
 * Returns:
 *   true          — body replaced successfully
 *   false         — IPC call failed (network error or collab 500)
 *   'doc_changed' — the live doc's anchors didn't match expected_anchors
 *                   (the doc was modified by someone else since it was read)
 */
export async function replaceBodyInLiveDoc(
  docId: string,
  markdown: string,
  expectedAnchors: string[],
  ctx: WritebackCtx,
): Promise<boolean | 'doc_changed'> {
  const collabUrl =
    process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${config.COLLAB_PORT}`;
  try {
    const res = await fetch(`${collabUrl}/_internal/replacebody/${docId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boppl-internal-secret': config.COLLAB_INTERNAL_SECRET,
      },
      body: JSON.stringify({ markdown, expected_anchors: expectedAnchors, ctx }),
    });
    if (res.status === 409) return 'doc_changed';
    if (!res.ok) {
      console.error('[writeback] replacebody collab returned', res.status);
      return false;
    }
    const body = (await res.json()) as { applied?: boolean };
    return Boolean(body.applied);
  } catch (err: unknown) {
    console.error('[writeback] replacebody IPC failed', err);
    return false;
  }
}

/**
 * Append markdown blocks into a live Y.Doc via IPC — APPEND semantics.
 *
 * Phase 9.1: unlike writeMarkdownIntoLiveDoc (REPLACE), this inserts new
 * blocks after the specified anchor (or at the end of the doc) without
 * touching existing content.
 *
 * Returns:
 *   true          — blocks were appended successfully
 *   false         — IPC call failed (network error or collab 500)
 *   'no_live_doc' — the doc is not currently loaded in Hocuspocus; caller
 *                   should surface an error to the user asking them to open
 *                   the doc in the Mnema editor first.
 */
export async function appendMarkdownIntoLiveDoc(
  docId: string,
  markdown: string,
  ctx: WritebackCtx,
  afterAnchor?: string,
): Promise<boolean | typeof NO_LIVE_DOC> {
  const collabUrl =
    process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${config.COLLAB_PORT}`;
  try {
    const res = await fetch(`${collabUrl}/_internal/appendblocks/${docId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-boppl-internal-secret': config.COLLAB_INTERNAL_SECRET,
      },
      body: JSON.stringify({ markdown, ctx, after_anchor: afterAnchor }),
    });
    if (res.status === 404) return NO_LIVE_DOC;
    if (!res.ok) {
      console.error('[writeback] appendblocks collab returned', res.status);
      return false;
    }
    const body = (await res.json()) as { applied?: boolean };
    return Boolean(body.applied);
  } catch (err: unknown) {
    console.error('[writeback] appendblocks IPC failed', err);
    return false;
  }
}
