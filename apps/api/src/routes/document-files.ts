import { eq, and } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import multipart from '@fastify/multipart';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import mammoth from 'mammoth';
import { r2, R2_BUCKET } from '../lib/storage/r2-client.js';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { attachments, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { config } from '../config/env.js';
import { requireRegisteredFeature } from '../lib/entitlement-gate.js';
import { ingestDocx } from '../lib/documents/ingest-docx.js';
import { ingestPdf } from '../lib/documents/ingest-pdf.js';
import { pdfGenerationQueue } from '../queue/pdf-generation.js';
import {
  uploadAttachment,
  getSignedAttachmentUrl,
  isR2Configured,
} from '../lib/storage/r2-attachments.js';
import { contentHash, emptyYjsState } from '../lib/yjs.js';

export const documentFilesRoutes: FastifyPluginAsync = async (app) => {
  // Register multipart only for this plugin scope
  await app.register(multipart, {
    limits: {
      fileSize: (config.MAX_UPLOAD_SIZE_MB + 10) * 1024 * 1024, // slight headroom; exact check below
      files:    1,
    },
  });

  function requireR2(reply: FastifyReply): boolean {
    if (!isR2Configured()) {
      void reply.status(503).send({ error: 'storage_not_configured', message: 'R2 storage is not configured on this server.' });
      return false;
    }
    return true;
  }

  // ── POST /api/document-files/upload ────────────────────────────────────────
  app.post('/api/document-files/upload', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const MAX_BYTES = config.MAX_UPLOAD_SIZE_MB * 1024 * 1024;

    let file: Awaited<ReturnType<typeof req.file>> | undefined;
    try {
      file = await req.file({ limits: { fileSize: (config.MAX_UPLOAD_SIZE_MB + 10) * 1024 * 1024 } });
    } catch {
      return reply.status(400).send({ error: 'no_file', message: 'No file provided' });
    }
    if (!file) return reply.status(400).send({ error: 'no_file', message: 'No file provided' });

    // Fields come from the multipart form alongside the file — NOT from req.body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formFields = (file as any).fields as Record<string, { value?: string }> | undefined;
    const folderId  = formFields?.folderId?.value  ?? null;
    const projectId = formFields?.projectId?.value ?? null;

    const buffer = await file.toBuffer();

    if (buffer.length > MAX_BYTES) {
      return reply.status(413).send({
        error:   'file_too_large',
        message: `File exceeds ${config.MAX_UPLOAD_SIZE_MB}MB limit`,
      });
    }

    const mime     = file.mimetype;
    const filename = file.filename ?? 'upload';
    const isDocx =
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      filename.toLowerCase().endsWith('.docx');
    const isPdf =
      mime === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf');

    if (!isDocx && !isPdf) {
      return reply.status(415).send({
        error:   'unsupported_format',
        message: 'Only .docx and .pdf files are supported',
      });
    }

    const format: 'docx' | 'pdf' = isDocx ? 'docx' : 'pdf';
    const workspaceId = req.auth.tenant_id;

    // Upload original to R2
    const { r2Key } = await uploadAttachment(workspaceId, buffer, format, filename);

    // Insert attachment row (status = processing)
    const [attachment] = await withTenant(workspaceId, (tx) =>
      tx.insert(attachments).values({
        workspaceId,
        type:         'source',
        format,
        originalName: filename,
        r2Key,
        sizeBytes:    buffer.length,
        mimeType:     mime,
        status:       'processing',
      }).returning(),
    );
    if (!attachment) return reply.status(500).send({ error: 'db_error' });

    let markdown  = '';
    let title     = filename.replace(/\.(docx|pdf)$/i, '');
    let imageUrls: string[] = [];
    let warnings:  string[] = [];
    let usedOcr   = false;
    let pageCount: number | null = null;

    try {
      if (isDocx) {
        const result = await ingestDocx(buffer, workspaceId, filename);
        markdown  = result.markdown;
        title     = result.title;
        imageUrls = result.imageUrls;
        warnings  = result.warnings;
      } else {
        const result = await ingestPdf(buffer, workspaceId, filename);
        markdown  = result.markdown;
        title     = result.title;
        imageUrls = result.imageUrls;
        usedOcr   = result.usedOcr;
        pageCount = result.pageCount;
      }
    } catch (err) {
      await withTenant(workspaceId, (tx) =>
        tx.update(attachments)
          .set({ status: 'failed', errorMessage: String(err), updatedAt: new Date() })
          .where(eq(attachments.id, attachment.id)),
      );
      req.log.error({ err }, 'ingestion failed');
      return reply.status(422).send({
        error:   'ingestion_failed',
        message: String(err),
      });
    }

    // folderId and projectId already extracted from multipart fields above

    // Create doc
    const path = `upload-${randomUUID()}`;
    const yjsState = emptyYjsState();
    const [doc] = await withTenant(workspaceId, (tx) =>
      tx.insert(docs).values({
        workspaceId,
        path,
        title,
        markdown,
        yjsState,
        contentHash:        contentHash(markdown),
        createdBy:          req.auth!.sub,
        updatedBy:          req.auth!.sub,
        folderId:           folderId ?? null,
        sourceAttachmentId: attachment.id,
      }).returning(),
    );
    if (!doc) return reply.status(500).send({ error: 'doc_create_failed' });

    // Update attachment with docId + status
    await withTenant(workspaceId, (tx) =>
      tx.update(attachments)
        .set({
          docId:      doc.id,
          status:     'ready',
          usedOcr,
          pageCount:  pageCount ?? undefined,
          updatedAt:  new Date(),
        })
        .where(eq(attachments.id, attachment.id)),
    );

    return reply.send({
      attachmentId: attachment.id,
      docId:        doc.id,
      title,
      usedOcr,
      pageCount,
      warnings,
    });
  });

  // ── GET /api/document-files/:attachmentId ─────────────────────────────────
  app.get('/api/document-files/:attachmentId', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };
    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx.select().from(attachments)
        .where(and(
          eq(attachments.id, attachmentId),
          eq(attachments.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });

    const downloadUrl = row.r2Key
      ? await getSignedAttachmentUrl(row.r2Key)
      : null;

    return reply.send({ attachment: row, downloadUrl });
  });

  // ── GET /api/document-files/:attachmentId/download ────────────────────────
  app.get('/api/document-files/:attachmentId/download', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };
    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx.select({ r2Key: attachments.r2Key })
        .from(attachments)
        .where(and(
          eq(attachments.id, attachmentId),
          eq(attachments.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });

    const url = await getSignedAttachmentUrl(row.r2Key);
    return reply.redirect(url, 302);
  });

  // ── POST /api/document-files/export ───────────────────────────────────────
  app.post('/api/document-files/export', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    // A3.1 — document export is a community-registered feature.
    const g = await requireRegisteredFeature(req.auth.tenant_id, 'export');
    if (!g.allowed) return reply.code(402).send({ error: 'entitlement_required', feature: 'export', reason: g.reason });
    if (!requireR2(reply)) return;

    const { docId, format } = req.body as { docId?: string; format?: string };
    if (!docId || !format || !['docx', 'pdf'].includes(format)) {
      return reply.status(400).send({ error: 'invalid_params', message: 'docId and format (docx|pdf) required' });
    }

    const workspaceId = req.auth.tenant_id;

    const [doc] = await withTenant(workspaceId, (tx) =>
      tx.select({ id: docs.id, title: docs.title, markdown: docs.markdown })
        .from(docs)
        .where(and(eq(docs.id, docId), eq(docs.workspaceId, workspaceId)))
        .limit(1),
    );
    if (!doc) return reply.status(404).send({ error: 'doc_not_found' });

    // Create pending attachment record
    const [attachment] = await withTenant(workspaceId, (tx) =>
      tx.insert(attachments).values({
        workspaceId,
        docId,
        type:   'export',
        format: format as 'docx' | 'pdf',
        r2Key:  '', // filled in after upload
        status: 'pending',
      }).returning(),
    );
    if (!attachment) return reply.status(500).send({ error: 'db_error' });

    // Both formats render in the worker now — DOCX diagrams need Chromium (mermaid/svg → PNG), which
    // the API process doesn't have. The client polls /export/:id/status for both formats.
    await pdfGenerationQueue.add('generate-export', {
      attachmentId: attachment.id,
      docId,
      workspaceId,
      title: doc.title,
      format: format as 'pdf' | 'docx',
    });
    return reply.send({ attachmentId: attachment.id, status: 'pending' });
  });

  // ── GET /api/document-files/export/:attachmentId/status ──────────────────
  app.get('/api/document-files/export/:attachmentId/status', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };
    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx.select({
        status:       attachments.status,
        r2Key:        attachments.r2Key,
        errorMessage: attachments.errorMessage,
      })
        .from(attachments)
        .where(and(
          eq(attachments.id, attachmentId),
          eq(attachments.workspaceId, req.auth!.tenant_id),
        ))
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });

    const downloadUrl =
      row.status === 'ready' && row.r2Key
        ? await getSignedAttachmentUrl(row.r2Key)
        : undefined;

    return reply.send({ status: row.status, downloadUrl, errorMessage: row.errorMessage });
  });

  // ── GET /api/document-files/:attachmentId/viewer-url ──────────────────────
  // Returns a fresh signed URL for the original file (called on tab open).
  app.get('/api/document-files/:attachmentId/viewer-url', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };
    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx.select({ r2Key: attachments.r2Key, format: attachments.format, originalName: attachments.originalName })
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), eq(attachments.workspaceId, req.auth!.tenant_id)))
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });

    // Override Content-Disposition to inline so the browser displays rather than downloads
    const url = await getSignedUrl(
      r2(),
      new GetObjectCommand({
        Bucket: R2_BUCKET(),
        Key: row.r2Key,
        ResponseContentDisposition: 'inline',
        ResponseContentType: 'application/pdf',
      }),
      { expiresIn: 3600 },
    );
    return reply.send({ url, format: row.format, originalName: row.originalName });
  });

  // ── GET /api/document-files/:attachmentId/html ────────────────────────────
  // Converts a DOCX attachment to HTML for the in-browser viewer.
  app.get('/api/document-files/:attachmentId/html', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireR2(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };
    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx.select({ r2Key: attachments.r2Key, format: attachments.format })
        .from(attachments)
        .where(and(eq(attachments.id, attachmentId), eq(attachments.workspaceId, req.auth!.tenant_id)))
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });
    if (row.format !== 'docx') return reply.status(400).send({ error: 'not_docx', message: 'Only DOCX files can be converted to HTML' });

    // Fetch DOCX buffer from R2
    const s3Res = await r2().send(new GetObjectCommand({ Bucket: R2_BUCKET(), Key: row.r2Key }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of s3Res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const { value: bodyHtml } = await mammoth.convertToHtml({ buffer });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 14px;
    line-height: 1.7;
    color: #1a1a1a;
    background: #fff;
    max-width: 820px;
    margin: 0 auto;
    padding: 40px 48px 80px;
  }
  h1 { font-size: 2em; margin: 0 0 .5em; }
  h2 { font-size: 1.5em; margin: 1.5em 0 .4em; }
  h3 { font-size: 1.17em; margin: 1.2em 0 .3em; }
  p  { margin: 0 0 .9em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
  th { background: #f3f4f6; font-weight: 600; text-align: left; padding: 6px 10px; border: 1px solid #d1d5db; }
  td { padding: 5px 10px; border: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #fafafa; }
  pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px; font-size: 12px; overflow-x: auto; }
  code { font-family: 'Courier New', monospace; font-size: 12px; background: #f6f8fa; padding: 1px 4px; border-radius: 3px; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; }
  ul, ol { padding-left: 1.5em; margin: 0 0 .9em; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;

    return reply.type('text/html').send(html);
  });
};
