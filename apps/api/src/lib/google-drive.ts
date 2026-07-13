/**
 * Phase 10 — Google Drive client (googleapis SDK).
 *
 * Bring-your-own OAuth app, same shape as lib/google-calendar.ts: the OAuth
 * client credentials come from env (optional) and callers must check
 * `driveConfigured()` first and 503 when unset. The refresh token is stored
 * encrypted (secret-box) on workspace_members.drive_refresh_token.
 *
 * Scope is configurable (GOOGLE_DRIVE_SCOPE):
 *   - 'drive.file' (default): least privilege — Mnema only sees files it created
 *     or that the user explicitly opened with it.
 *   - 'drive': full access — lets users pull pre-existing Drive folders; needs
 *     Google's restricted-scope review to ship to real users in production.
 */
import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { config } from '../config/env.js';

export type DriveClient = drive_v3.Drive;

const SCOPE_URLS: Record<'drive.file' | 'drive', string> = {
  'drive.file': 'https://www.googleapis.com/auth/drive.file',
  drive: 'https://www.googleapis.com/auth/drive',
};

// File extensions synced by default when a link doesn't set its own allow-list.
// v1 syncs text (→ Mnema docs) and docx/pdf (→ attachments, the formats the
// attachment pipeline models). More binary types can follow as a separate change.
export const DEFAULT_ACCEPTED_TYPES = ['md', 'markdown', 'txt', 'pdf', 'docx'];

/** Extensions that become Mnema docs (text). Everything else becomes an attachment. */
const TEXT_EXTS = new Set(['md', 'markdown', 'txt']);

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  pdf: 'application/pdf', csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

export function driveConfigured(): boolean {
  return Boolean(
    config.GOOGLE_DRIVE_CLIENT_ID &&
    config.GOOGLE_DRIVE_CLIENT_SECRET &&
    config.GOOGLE_DRIVE_REDIRECT_URI,
  );
}

export function driveScopeUrl(): string {
  return SCOPE_URLS[config.GOOGLE_DRIVE_SCOPE];
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isTextExt(ext: string): boolean {
  return TEXT_EXTS.has(ext.toLowerCase());
}

export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** True if `ext` is allowed for this link (empty allow-list = built-in defaults). */
export function isAcceptedType(ext: string, acceptedTypes: string[]): boolean {
  const list = acceptedTypes.length > 0 ? acceptedTypes : DEFAULT_ACCEPTED_TYPES;
  return list.includes(ext.toLowerCase());
}

function oauthClient() {
  return new google.auth.OAuth2(
    config.GOOGLE_DRIVE_CLIENT_ID,
    config.GOOGLE_DRIVE_CLIENT_SECRET,
    config.GOOGLE_DRIVE_REDIRECT_URI,
  );
}

/** Google consent URL to start the Drive-link flow (offline → refresh token). */
export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'select_account consent', // chooser → consent, and force a refresh_token
    scope: [driveScopeUrl()],
    state,
    include_granted_scopes: true,
  });
}

/** Exchange an auth code for tokens. Returns the offline refresh token. */
export async function exchangeCode(code: string): Promise<{ refresh_token?: string; access_token?: string }> {
  const { tokens } = await oauthClient().getToken(code);
  return { refresh_token: tokens.refresh_token ?? undefined, access_token: tokens.access_token ?? undefined };
}

/** An authenticated Drive v3 client from a stored refresh token (auto-refreshes access). */
export function driveClientFromRefresh(refreshToken: string): DriveClient {
  const auth = oauthClient();
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
}

export interface DriveFolder { id: string; name: string }

/** List the user's Drive folders under `parentId` (or 'root') — for the picker. */
export async function listDriveFolders(drive: DriveClient, parentId = 'root'): Promise<DriveFolder[]> {
  const res = await drive.files.list({
    q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`,
    fields: 'files(id, name)',
    orderBy: 'name',
    pageSize: 200,
    spaces: 'drive',
  });
  return (res.data.files ?? [])
    .filter((f): f is { id: string; name: string } => Boolean(f.id && f.name))
    .map((f) => ({ id: f.id, name: f.name }));
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum: string | null;
  modifiedTime: string | null;
  size: number | null;
  trashed: boolean;
}

const FILE_FIELDS = 'id, name, mimeType, md5Checksum, modifiedTime, size, trashed';

function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id!,
    name: f.name ?? 'untitled',
    mimeType: f.mimeType ?? 'application/octet-stream',
    md5Checksum: f.md5Checksum ?? null,
    modifiedTime: f.modifiedTime ?? null,
    size: f.size ? Number(f.size) : null,
    trashed: Boolean(f.trashed),
  };
}

/** List non-folder files directly under a Drive folder (paginates fully). */
export async function listFilesInFolder(drive: DriveClient, driveFolderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${driveFolderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: `nextPageToken, files(${FILE_FIELDS})`,
      pageSize: 200,
      spaces: 'drive',
      pageToken,
    });
    for (const f of res.data.files ?? []) if (f.id) out.push(toDriveFile(f));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** Download a Drive file's bytes. */
export async function downloadDriveFile(drive: DriveClient, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Create a Drive folder (optionally under `parentId`). Returns its id. */
export async function createDriveFolder(drive: DriveClient, name: string, parentId?: string): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });
  return res.data.id!;
}

/** Upload a new file into a Drive folder. Returns the new file id + md5. */
export async function uploadToFolder(
  drive: DriveClient, driveFolderId: string, name: string, mimeType: string, body: Buffer,
): Promise<{ id: string; md5Checksum: string | null }> {
  const res = await drive.files.create({
    requestBody: { name, parents: [driveFolderId] },
    media: { mimeType, body: Readable.from(body) },
    fields: 'id, md5Checksum',
  });
  return { id: res.data.id!, md5Checksum: res.data.md5Checksum ?? null };
}

/** Overwrite an existing Drive file's content. Returns its new md5. */
export async function updateDriveFile(
  drive: DriveClient, fileId: string, mimeType: string, body: Buffer,
): Promise<{ md5Checksum: string | null }> {
  const res = await drive.files.update({
    fileId,
    media: { mimeType, body: Readable.from(body) },
    fields: 'id, md5Checksum',
  });
  return { md5Checksum: res.data.md5Checksum ?? null };
}
