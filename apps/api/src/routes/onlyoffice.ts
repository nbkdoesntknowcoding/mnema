import { eq, and } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { attachments, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { config } from '../config/env.js';
import { ingestDocx } from '../lib/documents/ingest-docx.js';
import { contentHash, emptyYjsState } from '../lib/yjs.js';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../lib/storage/r2-client.js';

function requireOnlyOffice(reply: FastifyReply): boolean {
  if (!config.ONLYOFFICE_API_URL || !config.ONLYOFFICE_JWT_SECRET) {
    void reply.status(503).send({ error: 'onlyoffice_not_configured' });
    return false;
  }
  return true;
}

function jwtSecret(): Uint8Array {
  return new TextEncoder().encode(config.ONLYOFFICE_JWT_SECRET!);
}

export const onlyofficeRoutes: FastifyPluginAsync = async (app) => {

  // ── GET /api/onlyoffice/:attachmentId/config ─────────────────────────────
  // Returns a signed OnlyOffice editor config for the given DOCX attachment.
  app.get('/api/onlyoffice/:attachmentId/config', async (req, reply) => {
    if (!req.auth) return reply.status(401).send({ error: 'unauthorized' });
    if (!requireOnlyOffice(reply)) return;

    const { attachmentId } = req.params as { attachmentId: string };

    const [row] = await withTenant(req.auth.tenant_id, (tx) =>
      tx
        .select({
          id:           attachments.id,
          r2Key:        attachments.r2Key,
          format:       attachments.format,
          originalName: attachments.originalName,
          updatedAt:    attachments.updatedAt,
          workspaceId:  attachments.workspaceId,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, attachmentId),
            eq(attachments.workspaceId, req.auth!.tenant_id),
          ),
        )
        .limit(1),
    );

    if (!row) return reply.status(404).send({ error: 'not_found' });
    if (row.format !== 'docx') return reply.status(400).send({ error: 'not_docx' });

    // document.key must change whenever the file changes so OnlyOffice
    // doesn't serve a stale cached version.
    const docKey = `${row.id}-${new Date(row.updatedAt!).getTime()}`;

    // Internal base: OnlyOffice container → api container via Docker network
    const internalBase = config.ONLYOFFICE_INTERNAL_URL ?? 'http://api:8080';

    // Proxy the DOCX through our own API instead of a presigned R2 URL.
    // This avoids AWS SDK checksum headers that Cloudflare R2 rejects (400).
    const docUrl      = `${internalBase}/api/onlyoffice/${row.id}/file?tenantId=${req.auth.tenant_id}`;
    const callbackUrl = `${internalBase}/api/onlyoffice/callback?attachmentId=${row.id}&tenantId=${req.auth.tenant_id}`;

    const editorConfig = {
      documentType: 'word',
      document: {
        fileType:  'docx',
        key:       docKey,
        title:     row.originalName ?? 'Document.docx',
        url:       docUrl,
        permissions: {
          edit:     true,
          download: true,
          print:    true,
        },
      },
      editorConfig: {
        callbackUrl,
        user: {
          id:   req.auth.sub,
          name: req.auth.email,
        },
        lang: 'en',
        mode: 'edit',
        customization: {
          autosave:  true,
          forcesave: false,
          logo:      { visible: false },
          toolbar:   { collaboration: { mailmerge: false } },
        },
      },
    };

    // Sign the config as a JWT — OnlyOffice verifies this with JWT_SECRET
    const token = await new SignJWT(editorConfig as any)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(jwtSecret());

    return reply.send({
      config: { ...editorConfig, token },
      apiUrl: config.ONLYOFFICE_API_URL,
    });
  });

  // ── GET /api/onlyoffice/:attachmentId/file ───────────────────────────────
  // Proxies the DOCX from R2 to OnlyOffice server over the Docker network.
  // Public (no cookie) — tenantId query param scopes access to the workspace.
  app.get('/api/onlyoffice/:attachmentId/file', async (req, reply) => {
    const { attachmentId } = req.params as { attachmentId: string };
    const { tenantId } = req.query as { tenantId?: string };
    if (!tenantId) return reply.status(400).send({ error: 'missing_tenant' });

    const [row] = await withTenant(tenantId, (tx) =>
      tx
        .select({ r2Key: attachments.r2Key, originalName: attachments.originalName })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, attachmentId),
            eq(attachments.workspaceId, tenantId),
          ),
        )
        .limit(1),
    );
    if (!row) return reply.status(404).send({ error: 'not_found' });

    const s3Res = await r2().send(
      new GetObjectCommand({ Bucket: R2_BUCKET(), Key: row.r2Key }),
    );

    void reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    void reply.header('Content-Disposition', `inline; filename="${row.originalName ?? 'document.docx'}"`);
    if (s3Res.ContentLength) void reply.header('Content-Length', String(s3Res.ContentLength));

    return reply.send(s3Res.Body);
  });

  // ── POST /api/onlyoffice/callback ─────────────────────────────────────────
  // Called by the OnlyOffice server when a document is saved.
  // This endpoint is intentionally unauthenticated (server-to-server call from
  // OnlyOffice container) but verifies the OnlyOffice JWT in the request body.
  app.post('/api/onlyoffice/callback', async (req, reply) => {
    const { attachmentId, tenantId } = req.query as { attachmentId: string; tenantId: string };
    if (!attachmentId || !tenantId) {
      return reply.status(400).send({ error: 1 });
    }
    if (!config.ONLYOFFICE_JWT_SECRET) {
      return reply.send({ error: 0 }); // not configured — ack and ignore
    }

    const body = req.body as any;

    // Verify the JWT that OnlyOffice includes in the Authorization header or body
    const authHeader = (req.headers['authorization'] ?? '') as string;
    const jwtToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : body?.token;

    if (jwtToken) {
      try {
        await jwtVerify(jwtToken, jwtSecret());
      } catch {
        req.log.warn({ attachmentId }, 'onlyoffice callback JWT verification failed');
        return reply.status(403).send({ error: 1 });
      }
    }

    const status: number = body?.status ?? 0;

    // Status 2 = document saved; 6 = force-save requested
    if (status !== 2 && status !== 6) {
      return reply.send({ error: 0 }); // ack non-save events without action
    }

    const downloadUrl: string | undefined = body?.url;
    if (!downloadUrl) {
      req.log.error({ attachmentId, status }, 'onlyoffice callback missing url');
      return reply.send({ error: 0 });
    }

    try {
      // 1. Download updated DOCX from OnlyOffice's temporary URL
      const fetchRes = await fetch(downloadUrl);
      if (!fetchRes.ok) throw new Error(`fetch failed: ${fetchRes.status}`);
      const arrayBuffer = await fetchRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Fetch attachment row to get r2Key and workspaceId
      const [att] = await withTenant(tenantId, (tx) =>
        tx
          .select({ r2Key: attachments.r2Key, docId: attachments.docId })
          .from(attachments)
          .where(
            and(
              eq(attachments.id, attachmentId),
              eq(attachments.workspaceId, tenantId),
            ),
          )
          .limit(1),
      );
      if (!att) {
        req.log.error({ attachmentId }, 'onlyoffice callback: attachment not found');
        return reply.send({ error: 0 });
      }

      // 3. Overwrite the existing R2 object with the new DOCX content
      await r2().send(
        new PutObjectCommand({
          Bucket:             R2_BUCKET(),
          Key:                att.r2Key,
          Body:               buffer,
          ContentType:        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ContentDisposition: 'attachment',
        }),
      );

      // 4. Re-ingest DOCX → extract fresh markdown and title
      const ingested = await ingestDocx(buffer, tenantId, 'document.docx');

      // 5. Update the doc's markdown and reset Yjs state
      if (att.docId) {
        const yjsState = emptyYjsState();
        await withTenant(tenantId, (tx) =>
          tx
            .update(docs)
            .set({
              markdown:    ingested.markdown,
              title:       ingested.title || undefined,
              yjsState,
              contentHash: contentHash(ingested.markdown),
              updatedAt:   new Date(),
            })
            .where(eq(docs.id, att.docId!)),
        );
      }

      // 6. Bump attachment updatedAt so next config call gets a fresh document.key
      await withTenant(tenantId, (tx) =>
        tx
          .update(attachments)
          .set({ updatedAt: new Date() })
          .where(eq(attachments.id, attachmentId)),
      );

      req.log.info({ attachmentId, docId: att.docId }, 'onlyoffice save: synced');
    } catch (err) {
      req.log.error({ err, attachmentId }, 'onlyoffice save: failed');
      // Still return { error: 0 } — returning error: 1 causes OnlyOffice to retry endlessly
    }

    return reply.send({ error: 0 });
  });
};
