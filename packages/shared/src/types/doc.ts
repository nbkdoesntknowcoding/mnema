export interface DocSummary {
  id: string;
  path: string;
  title: string;
  created_at: string;
  updated_at: string;
  source_attachment_format?: 'docx' | 'pdf' | null;
}

export interface SourceAttachment {
  id: string;
  format: 'docx' | 'pdf';
  originalName: string | null;
  sizeBytes: number | null;
}

export interface DocFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface DocFull extends DocSummary {
  markdown: string;
  content_hash: string | null;
  is_public?: boolean;
  public_token?: string | null;
  folder?: DocFolder | null;
  sourceAttachment?: SourceAttachment | null;
}

export interface DocCreatePayload {
  title?: string;
  markdown?: string;
}

export interface DocSavePayload {
  title: string;
  markdown?: string;
}

export interface DocSaveResponse {
  id: string;
  title: string;
  content_hash: string | null;
  updated_at: string;
}
