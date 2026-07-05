import { randomUUID } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from './r2-client.js';

export { isR2Configured } from './r2-client.js';

// ── Upload attachment to R2 ───────────────────────────────────────────────────
// Stores at: attachments/{workspaceId}/{uuid}.{ext}
// Returns the r2Key and a 1-hour signed download URL.
export async function uploadAttachment(
  workspaceId: string,
  buffer: Buffer,
  format: 'docx' | 'pdf',
  originalName?: string,
): Promise<{ r2Key: string; url: string }> {
  const ext = format === 'docx' ? 'docx' : 'pdf';
  const contentType =
    format === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf';

  const r2Key = `attachments/${workspaceId}/${randomUUID()}.${ext}`;

  await r2().send(
    new PutObjectCommand({
      Bucket:      R2_BUCKET(),
      Key:         r2Key,
      Body:        buffer,
      ContentType: contentType,
      ContentDisposition: originalName
        ? `attachment; filename="${originalName}"`
        : 'attachment',
    }),
  );

  const url = await getSignedAttachmentUrl(r2Key);
  return { r2Key, url };
}

// ── Upload image extracted from DOCX/PDF to R2 ────────────────────────────────
// Stores at: doc-images/{workspaceId}/{uuid}.{ext}
// Returns a public URL (images are embedded inline in docs and need public access).
export async function uploadDocImage(
  workspaceId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const r2Key = `doc-images/${workspaceId}/${randomUUID()}.${ext}`;

  await r2().send(
    new PutObjectCommand({
      Bucket:      R2_BUCKET(),
      Key:         r2Key,
      Body:        buffer,
      ContentType: mimeType,
    }),
  );

  return `${R2_PUBLIC_URL()}/${r2Key}`;
}

// ── Get signed download URL for an attachment (1-hour expiry) ─────────────────
export async function getSignedAttachmentUrl(r2Key: string): Promise<string> {
  return getSignedUrl(
    r2(),
    new GetObjectCommand({ Bucket: R2_BUCKET(), Key: r2Key }),
    { expiresIn: 3600 },
  );
}
