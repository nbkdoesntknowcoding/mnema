/**
 * DOCX/PDF MCP tools — available in both workspace modes.
 *
 *   upload_doc_file     — upload a base64-encoded DOCX/PDF, ingest as a Mnema doc
 *   export_doc          — export a doc as DOCX or PDF (both async via the worker; polls up to 30s)
 *   get_doc_source_file — get download URL for the original source file of an uploaded doc
 */

import { eq, and } from 'drizzle-orm';
import type { McpAuthContext } from '../auth.js';
import { withTenant } from '../../db/with-tenant.js';
import { withSystemPrivilege } from '../../db/with-system-privilege.js';
import { attachments, docs, folders } from '../../db/schema.js';
import { ingestDocx } from '../../lib/documents/ingest-docx.js';
import { ingestPdf } from '../../lib/documents/ingest-pdf.js';
import { uploadAttachment, getSignedAttachmentUrl, isR2Configured } from '../../lib/storage/r2-attachments.js';
import { pdfGenerationQueue } from '../../queue/pdf-generation.js';
import { requireRegisteredFeature } from '../../lib/entitlement-gate.js';
import { contentHash, emptyYjsState } from '../../lib/yjs.js';
import { randomUUID } from 'node:crypto';

const MCP_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

// ── upload_doc_file ───────────────────────────────────────────────────────────

export const UPLOAD_DOC_FILE_TOOL = {
  name:        'upload_doc_file',
  description: 'Upload a base64-encoded DOCX or PDF file and ingest it as a Mnema doc. ' +
               'The file is converted to Markdown and stored. ' +
               'Returns the created doc ID so you can read it with get_doc.\n\n' +
               'Use this when the user gives you a DOCX or PDF (or its base64) to bring into ' +
               'Mnema as a doc. Filename must end in .docx or .pdf; max 20MB.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      content_base64: { type: 'string', description: 'Base64-encoded DOCX or PDF content.' },
      filename:       { type: 'string', description: 'Original filename, must end in .docx or .pdf.' },
      folder_id:      { type: 'string', description: 'Optional target folder UUID.' },
    },
    required: ['content_base64', 'filename'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Upload DOCX/PDF file' },
};

export async function uploadDocFile(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<{ content: string; structuredContent: Record<string, unknown>; error?: string }> {
  if (!isR2Configured()) {
    return {
      content: 'Error: R2 storage is not configured on this server. Cannot upload files.',
      structuredContent: { error: 'storage_not_configured' },
      error: 'storage_not_configured',
    };
  }

  const { content_base64, filename, folder_id } = rawArgs as {
    content_base64: string;
    filename: string;
    folder_id?: string;
  };

  const buffer = Buffer.from(content_base64, 'base64');
  if (buffer.length > MCP_UPLOAD_LIMIT_BYTES) {
    return {
      content: 'File too large for MCP upload. Use the REST API at POST /api/document-files/upload instead.',
      structuredContent: { error: 'file_too_large' },
      error: 'file_too_large',
    };
  }

  const lc = filename.toLowerCase();
  const isDocx = lc.endsWith('.docx');
  const isPdf  = lc.endsWith('.pdf');
  if (!isDocx && !isPdf) {
    return {
      content: 'Only .docx and .pdf files are supported.',
      structuredContent: { error: 'unsupported_format' },
      error: 'unsupported_format',
    };
  }

  const format: 'docx' | 'pdf' = isDocx ? 'docx' : 'pdf';
  const workspaceId = ctx.tenant_id;

  const { r2Key } = await uploadAttachment(workspaceId, buffer, format, filename);

  const [attachment] = await withTenant(workspaceId, (tx) =>
    tx.insert(attachments).values({
      workspaceId, type: 'source', format, originalName: filename,
      r2Key, sizeBytes: buffer.length, status: 'processing',
    }).returning(),
  );
  if (!attachment) throw new Error('Failed to create attachment record');

  let markdown = '', title = filename.replace(/\.(docx|pdf)$/i, '');
  let usedOcr = false, pageCount: number | null = null;

  if (isDocx) {
    const r = await ingestDocx(buffer, workspaceId, filename);
    markdown = r.markdown; title = r.title;
  } else {
    const r = await ingestPdf(buffer, workspaceId, filename);
    markdown = r.markdown; title = r.title; usedOcr = r.usedOcr; pageCount = r.pageCount;
  }

  const [doc] = await withTenant(workspaceId, async (tx) => {
    // Hierarchy: inherit the target folder's project (null if unfiled).
    let projectId: string | null = null;
    if (folder_id) {
      const f = await tx.select({ projectId: folders.projectId }).from(folders)
        .where(eq(folders.id, folder_id)).limit(1);
      projectId = f[0]?.projectId ?? null;
    }
    return tx.insert(docs).values({
      workspaceId, path: `upload-${randomUUID()}`, title, markdown,
      yjsState: emptyYjsState(), contentHash: contentHash(markdown),
      createdBy: ctx.user_id, updatedBy: ctx.user_id,
      folderId: folder_id ?? null, projectId, sourceAttachmentId: attachment.id,
    }).returning();
  });
  if (!doc) throw new Error('Failed to create doc');

  await withTenant(workspaceId, (tx) =>
    tx.update(attachments).set({
      docId: doc.id, status: 'ready', usedOcr,
      pageCount: pageCount ?? undefined, updatedAt: new Date(),
    }).where(eq(attachments.id, attachment.id)),
  );

  const ocrNote = usedOcr ? ' (OCR used — document appears to be scanned.)' : '';
  const pageNote = pageCount ? ` (${pageCount} pages)` : '';
  const content =
    `Uploaded '${filename}'. Created doc '${title}'${pageNote}.${ocrNote} ` +
    `Doc ID: ${doc.id}. Use get_doc to read the full content.`;

  return {
    content,
    structuredContent: { docId: doc.id, attachmentId: attachment.id, title, pageCount, usedOcr },
  };
}

// ── export_doc ────────────────────────────────────────────────────────────────

export const EXPORT_DOC_TOOL = {
  name:        'export_doc',
  description: 'Export a Mnema doc as DOCX or PDF. Both formats are generated by a background ' +
               'worker; this call waits up to 30s for the file to be ready (PDF may take longer ' +
               'than DOCX). Returns a signed download URL valid for 1 hour.\n\n' +
               'Use this when the user wants a downloadable DOCX or PDF of a doc to share or keep.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: { type: 'string', description: 'UUID of the doc to export.' },
      format: { type: 'string', enum: ['docx', 'pdf'], description: 'Export format.' },
    },
    required: ['doc_id', 'format'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Export doc as DOCX or PDF' },
};

export async function exportDoc(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<{ content: string; structuredContent: Record<string, unknown>; error?: string }> {
  if (!isR2Configured()) {
    return {
      content: 'Error: R2 storage is not configured on this server.',
      structuredContent: { error: 'storage_not_configured' },
      error: 'storage_not_configured',
    };
  }

  const { doc_id, format } = rawArgs as { doc_id: string; format: 'docx' | 'pdf' };
  const workspaceId = ctx.tenant_id;

  // A3.1 — document export is a community-registered feature.
  const gate = await requireRegisteredFeature(workspaceId, 'export');
  if (!gate.allowed) {
    return { content: `Error: ${gate.reason}`, structuredContent: { error: 'entitlement_required', feature: 'export' }, error: 'entitlement_required' };
  }

  const [doc] = await withTenant(workspaceId, (tx) =>
    tx.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
      .from(docs)
      .where(and(eq(docs.id, doc_id), eq(docs.workspaceId, workspaceId)))
      .limit(1),
  );
  if (!doc) {
    return { content: `Doc ${doc_id} not found.`, structuredContent: { error: 'not_found' }, error: 'not_found' };
  }

  const [attachment] = await withTenant(workspaceId, (tx) =>
    tx.insert(attachments).values({
      workspaceId, docId: doc_id, type: 'export', format,
      r2Key: '', status: 'pending',
    }).returning(),
  );
  if (!attachment) throw new Error('Failed to create attachment record');

  // Both formats render in the worker now: PDF (Chromium) and DOCX (diagrams need Chromium too, so
  // DOCX moved from a sync API call to the same enqueue+poll path).
  await pdfGenerationQueue.add('generate-export', {
    attachmentId: attachment.id, docId: doc_id, workspaceId, title: doc.title, format,
  });

  const TIMEOUT_MS = 30_000;
  const POLL_INTERVAL_MS = 1_000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const [row] = await withSystemPrivilege((tx) =>
      tx.select({ status: attachments.status, r2Key: attachments.r2Key })
        .from(attachments).where(eq(attachments.id, attachment.id)).limit(1),
    );
    if (row?.status === 'ready' && row.r2Key) {
      const downloadUrl = await getSignedAttachmentUrl(row.r2Key);
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      return {
        content: `Exported '${doc.title}' as ${format.toUpperCase()}. Download: ${downloadUrl} (valid 1 hour)`,
        structuredContent: { format, downloadUrl, attachmentId: attachment.id, expiresAt },
      };
    }
    if (row?.status === 'failed') {
      return {
        content: `PDF generation failed: ${row.r2Key || 'unknown error'}`,
        structuredContent: { error: 'generation_failed', attachmentId: attachment.id },
        error: 'generation_failed',
      };
    }
  }

  return {
    content: `PDF generation is taking longer than expected. Check status with attachment ID: ${attachment.id}`,
    structuredContent: { status: 'timeout', attachmentId: attachment.id },
  };
}

// ── get_doc_source_file ───────────────────────────────────────────────────────

export const GET_DOC_SOURCE_FILE_TOOL = {
  name:        'get_doc_source_file',
  description: 'Get a signed download URL for the original source file (DOCX/PDF) ' +
               'that was uploaded to create a doc. Returns an error if the doc was not created from an upload.\n\n' +
               'Use this when the user wants the ORIGINAL uploaded file, not the Mnema markdown. ' +
               'Do NOT use for normal reading — call get_doc.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_id: { type: 'string', description: 'UUID of the doc.' },
    },
    required: ['doc_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Get doc source file' },
};

export async function getDocSourceFile(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<{ content: string; structuredContent: Record<string, unknown>; error?: string }> {
  if (!isR2Configured()) {
    return {
      content: 'Error: R2 storage is not configured on this server.',
      structuredContent: { error: 'storage_not_configured' },
      error: 'storage_not_configured',
    };
  }

  const { doc_id } = rawArgs as { doc_id: string };
  const workspaceId = ctx.tenant_id;

  const [doc] = await withTenant(workspaceId, (tx) =>
    tx.select({ sourceAttachmentId: docs.sourceAttachmentId })
      .from(docs)
      .where(and(eq(docs.id, doc_id), eq(docs.workspaceId, workspaceId)))
      .limit(1),
  );
  if (!doc) {
    return { content: `Doc ${doc_id} not found.`, structuredContent: { error: 'not_found' }, error: 'not_found' };
  }
  if (!doc.sourceAttachmentId) {
    return {
      content: 'This doc was not created from an uploaded file. No source file available.',
      structuredContent: { error: 'no_source_file' },
      error: 'no_source_file',
    };
  }

  const [att] = await withTenant(workspaceId, (tx) =>
    tx.select({
      id: attachments.id, format: attachments.format,
      originalName: attachments.originalName, sizeBytes: attachments.sizeBytes,
      r2Key: attachments.r2Key,
    })
      .from(attachments)
      .where(eq(attachments.id, doc.sourceAttachmentId!))
      .limit(1),
  );
  if (!att) {
    return { content: 'Source attachment record not found.', structuredContent: { error: 'not_found' }, error: 'not_found' };
  }

  const downloadUrl = await getSignedAttachmentUrl(att.r2Key);
  const sizeNote = att.sizeBytes ? ` (${Math.round(att.sizeBytes / 1024)} KB)` : '';

  return {
    content: `Source file: '${att.originalName ?? 'file'}' (${att.format}${sizeNote}). Download: ${downloadUrl} (valid 1 hour)`,
    structuredContent: {
      attachmentId: att.id, format: att.format,
      filename: att.originalName, sizeBytes: att.sizeBytes, downloadUrl,
    },
  };
}
