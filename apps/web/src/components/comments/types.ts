/**
 * Shared DTO shapes that mirror the /api/comment-threads responses.
 * Kept thin — anything richer (author lookups, presence) gets layered on
 * in the components themselves.
 */

export interface CommentDTO {
  id: string;
  body: string;
  author_id: string;
  created_at: string;
  edited_at: string | null;
}

export interface ThreadDTO {
  id: string;
  doc_id?: string;
  anchor_start: string;
  anchor_end: string;
  resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  comments: CommentDTO[];
}
