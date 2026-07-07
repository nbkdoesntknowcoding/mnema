// DESIGN APPLIED: 2026-05-27

import { type JSX, useEffect, useRef, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';
import type { Task } from './TaskCard';

interface Member {
  userId:      string;
  displayName: string;
  email:       string;
}

interface TaskComment {
  id:         string;
  body:       string;
  authorId:   string;
  authorName: string | null;
  createdAt:  string;
}

interface TaskDetailModalProps {
  task:     Task;
  onClose:  () => void;
  onSave:   (taskId: string, updates: Partial<Task>) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: T.critical,
  high:     T.high,
  medium:   T.medium,
  low:      T.low,
};

const PRIORITY_BG: Record<string, string> = {
  critical: 'rgba(239,68,68,0.10)',
  high:     'rgba(249,115,22,0.10)',
  medium:   'rgba(251,191,36,0.10)',
  low:      'rgba(161,161,170,0.10)',
};

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function TaskDetailModal({ task, onClose, onSave, onDelete }: TaskDetailModalProps): JSX.Element {
  const [docTitle, setDocTitle]           = useState<string | null>(null);
  const [copied,   setCopied]             = useState(false);

  // Edit state
  const [editTitle,       setEditTitle]       = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description ?? '');
  const [editPriority,    setEditPriority]     = useState(task.priority);
  const [editAssignee,    setEditAssignee]     = useState<string | null>(task.assignedMemberId ?? null);

  // Members list
  const [members,      setMembers]      = useState<Member[]>([]);
  const [showAssignee, setShowAssignee] = useState(false);
  const assigneeRef                     = useRef<HTMLDivElement>(null);

  // Save / delete state
  const [saving,       setSaving]       = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);

  // Comments
  const [comments,       setComments]       = useState<TaskComment[]>([]);
  const [commentDraft,   setCommentDraft]   = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const isDirty =
    editTitle       !== task.title ||
    editDescription !== (task.description ?? '') ||
    editPriority    !== task.priority ||
    editAssignee    !== (task.assignedMemberId ?? null);

  // Sprint tags vs other tags
  const sprintTag  = task.tags?.find((t) => t.startsWith('sprint:'));
  const sprintName = sprintTag ? sprintTag.slice('sprint:'.length) : null;
  const otherTags  = (task.tags ?? []).filter((t) => !t.startsWith('sprint:'));

  // Fetch source doc title
  useEffect(() => {
    if (!task.docId) return;
    void fetch(`/api/docs/${task.docId}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { title?: string } | null) => { if (d?.title) setDocTitle(d.title); })
      .catch(() => { /* best effort */ });
  }, [task.docId]);

  // Fetch workspace members for assignee picker
  useEffect(() => {
    void apiFetch<{ members: Member[] }>('/api/members')
      .then((r) => setMembers(r.members))
      .catch(() => { /* ignore */ });
  }, []);

  // Fetch comments
  useEffect(() => {
    void apiFetch<{ comments: TaskComment[] }>(`/api/tasks/${task.id}/comments`)
      .then((r) => setComments(r.comments ?? []))
      .catch(() => { /* ignore */ });
  }, [task.id]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (confirmDelete) { setConfirmDelete(false); return; }
        if (showAssignee)  { setShowAssignee(false); return; }
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete, showAssignee]);

  // Close assignee dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setShowAssignee(false);
      }
    }
    if (showAssignee) document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showAssignee]);

  async function copyId() {
    await navigator.clipboard.writeText(task.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function postComment() {
    const body = commentDraft.trim();
    if (!body || postingComment) return;
    setPostingComment(true);
    try {
      const r = await apiFetch<{ comment: TaskComment }>(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      setComments((prev) => [...prev, r.comment]);
      setCommentDraft('');
    } catch {
      /* keep the draft so nothing is lost */
    } finally {
      setPostingComment(false);
    }
  }

  async function handleSave() {
    if (!isDirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(task.id, {
        title:            editTitle,
        description:      editDescription || undefined,
        priority:         editPriority as Task['priority'],
        assignedMemberId: editAssignee ?? undefined,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(task.id);
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const priorityColor = PRIORITY_COLORS[editPriority] ?? PRIORITY_COLORS.medium!;
  const priorityBg    = PRIORITY_BG[editPriority]     ?? PRIORITY_BG.medium!;
  const statusColors  = T.sbadge[task.status as keyof typeof T.sbadge] ?? T.sbadge.backlog;

  const assignedMember = members.find((m) => m.userId === editAssignee);

  return (
    /* ── Backdrop ── */
    <div
      onClick={onClose}
      style={{
        position:   'fixed',
        inset:      0,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex:     1000,
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding:    '24px 16px',
      }}
    >
      {/* ── Panel ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...glassCard,
          background:  T.surface1,
          border:      `0.5px solid ${T.glassBorderStrong}`,
          borderRadius: 20,
          width:       '100%',
          maxWidth:    640,
          maxHeight:   '92vh',
          display:     'flex',
          flexDirection: 'column',
          overflow:    'hidden',
          fontFamily:  T.fontUI,
          boxShadow:   '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.06)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding:        '20px 24px 16px',
          borderBottom:   `0.5px solid ${T.line}`,
          display:        'flex',
          alignItems:     'flex-start',
          gap:            12,
        }}>
          {/* Priority strip */}
          <div style={{
            width:        3,
            minHeight:    40,
            borderRadius: 2,
            background:   priorityColor,
            flexShrink:   0,
            marginTop:    3,
          }} />

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Sprint breadcrumb */}
            {sprintName && (
              <div style={{
                fontSize:      10,
                fontWeight:    600,
                color:         T.accent,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom:  6,
              }}>
                {sprintName}
              </div>
            )}

            {/* Editable Title */}
            <input
              aria-label="Task title"
              placeholder="Task title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{
                width:        '100%',
                margin:       0,
                fontSize:     17,
                fontWeight:   600,
                color:        T.textPrimary,
                lineHeight:   '1.35',
                fontFamily:   T.fontUI,
                letterSpacing: '-0.01em',
                background:   'transparent',
                border:       'none',
                outline:      'none',
                padding:      '2px 4px',
                borderRadius: 4,
                boxSizing:    'border-box',
                transition:   'background 0.15s',
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.background = T.surface2; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.background = 'transparent'; }}
            />

            {/* Meta row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {/* Status (read-only — use drag-drop to change) */}
              <span style={{
                display:      'inline-flex',
                alignItems:   'center',
                padding:      '2px 8px',
                borderRadius: 6,
                fontSize:     11,
                fontWeight:   500,
                background:   statusColors.bg,
                border:       `0.5px solid ${statusColors.border}`,
                color:        statusColors.text,
              }}>
                {task.status.replace('_', ' ')}
              </span>

              {/* Other tags */}
              {otherTags.map((tag) => (
                <span key={tag} style={{
                  fontSize:   10,
                  padding:    '2px 6px',
                  borderRadius: 4,
                  background: T.glass,
                  border:     `0.5px solid ${T.glassBorder}`,
                  color:      T.textMuted,
                  fontFamily: T.fontMono,
                }}>
                  {tag}
                </span>
              ))}

              {/* Task ID — click to copy */}
              <button
                onClick={() => { void copyId(); }}
                title="Copy task ID"
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border:     'none',
                  padding:    0,
                  cursor:     'pointer',
                  fontSize:   10,
                  color:      copied ? T.green : T.textDisabled,
                  fontFamily: T.fontMono,
                  lineHeight: 1,
                  transition: 'color 0.15s',
                }}
              >
                {copied ? 'copied!' : task.id.slice(0, 8) + '…'}
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              width:        28,
              height:       28,
              borderRadius: 8,
              border:       `0.5px solid ${T.glassBorder}`,
              background:   T.glass,
              color:        T.textMuted,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              fontSize:     15,
              flexShrink:   0,
              fontFamily:   T.fontUI,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div style={{
          flex:       1,
          overflowY:  'auto',
          padding:    '20px 24px',
          display:    'flex',
          flexDirection: 'column',
          gap:        20,
        }}>

          {/* Priority picker */}
          <div>
            <div style={sectionLabel}>Priority</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['low', 'medium', 'high', 'critical'] as const).map((p) => {
                const active = editPriority === p;
                const col    = PRIORITY_COLORS[p]!;
                return (
                  <button
                    key={p}
                    onClick={() => setEditPriority(p)}
                    style={{
                      flex:         1,
                      padding:      '6px 4px',
                      borderRadius: 8,
                      border:       active ? `0.5px solid ${col}80` : `0.5px solid ${T.glassBorder}`,
                      background:   active ? `${col}18` : T.glass,
                      color:        active ? col : T.textMuted,
                      fontSize:     11,
                      fontWeight:   active ? 600 : 400,
                      cursor:       'pointer',
                      fontFamily:   T.fontUI,
                      textTransform: 'capitalize',
                      transition:   'all 0.12s',
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Assignee picker */}
          <div>
            <div style={sectionLabel}>Assigned to</div>
            <div ref={assigneeRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowAssignee((v) => !v)}
                style={{
                  width:        '100%',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          8,
                  padding:      '9px 12px',
                  background:   T.surface2,
                  border:       `0.5px solid ${showAssignee ? T.accent + '60' : T.glassBorder}`,
                  borderRadius: 10,
                  cursor:       'pointer',
                  textAlign:    'left',
                  fontFamily:   T.fontUI,
                  transition:   'border-color 0.15s',
                }}
              >
                {assignedMember ? (
                  <>
                    <span style={avatarStyle}>{assignedMember.displayName.slice(0, 1).toUpperCase()}</span>
                    <span style={{ fontSize: 13, color: T.textPrimary, flex: 1 }}>{assignedMember.displayName}</span>
                    <span style={{ fontSize: 11, color: T.textMuted }}>{assignedMember.email}</span>
                  </>
                ) : editAssignee ? (
                  <>
                    <span style={avatarStyle}>?</span>
                    <span style={{ fontSize: 12, color: T.textMuted, fontFamily: T.fontMono, flex: 1 }}>{editAssignee}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: T.textDisabled, flex: 1 }}>Unassigned</span>
                )}
                <span style={{ fontSize: 10, color: T.textDisabled }}>▾</span>
              </button>

              {showAssignee && (
                <div style={{
                  position:     'absolute',
                  top:          '100%',
                  left:         0,
                  right:        0,
                  marginTop:    4,
                  background:   T.surface1,
                  border:       `0.5px solid ${T.glassBorderStrong}`,
                  borderRadius: 12,
                  zIndex:       10,
                  overflow:     'hidden',
                  boxShadow:    '0 8px 32px rgba(0,0,0,0.4)',
                }}>
                  {/* Unassign option */}
                  <button
                    onClick={() => { setEditAssignee(null); setShowAssignee(false); }}
                    style={{
                      ...dropdownItemStyle,
                      borderBottom: `0.5px solid ${T.line}`,
                      color: T.textMuted,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>—</span>
                    <span style={{ fontSize: 12 }}>Unassigned</span>
                  </button>
                  {members.map((m) => (
                    <button
                      key={m.userId}
                      onClick={() => { setEditAssignee(m.userId); setShowAssignee(false); }}
                      style={{
                        ...dropdownItemStyle,
                        background: editAssignee === m.userId ? `${T.accent}12` : 'transparent',
                      }}
                    >
                      <span style={avatarStyle}>{m.displayName.slice(0, 1).toUpperCase()}</span>
                      <span style={{ fontSize: 13, color: T.textPrimary, flex: 1, textAlign: 'left' }}>{m.displayName}</span>
                      <span style={{ fontSize: 11, color: T.textMuted }}>{m.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Instructions / Description */}
          <div>
            <div style={sectionLabel}>Instructions</div>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="No instructions yet. Add task details here…"
              rows={8}
              style={{
                width:       '100%',
                background:  T.surface2,
                border:      `0.5px solid ${T.glassBorder}`,
                borderRadius: 12,
                padding:     '12px 14px',
                fontSize:    13,
                color:       T.textSecondary,
                lineHeight:  '1.65',
                fontFamily:  T.fontUI,
                resize:      'vertical',
                outline:     'none',
                boxSizing:   'border-box',
                transition:  'border-color 0.15s',
              }}
              onFocus={(e)  => { (e.target as HTMLTextAreaElement).style.borderColor = `${T.accent}60`; }}
              onBlur={(e)   => { (e.target as HTMLTextAreaElement).style.borderColor = T.glassBorder; }}
            />
          </div>

          {/* Source doc link */}
          {task.docId && (
            <div>
              <div style={sectionLabel}>Source doc</div>
              <a
                href={`/app/content/${task.docId}`}
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            10,
                  padding:        '12px 16px',
                  background:     T.surface2,
                  border:         `0.5px solid ${T.glassBorder}`,
                  borderRadius:   12,
                  textDecoration: 'none',
                  transition:     'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = `${T.accent}60`;
                  (e.currentTarget as HTMLAnchorElement).style.background  = T.surface3;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = T.glassBorder;
                  (e.currentTarget as HTMLAnchorElement).style.background  = T.surface2;
                }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize:    13,
                    fontWeight:  500,
                    color:       T.textPrimary,
                    overflow:    'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:  'nowrap',
                  }}>
                    {docTitle ?? 'Source spec doc'}
                  </div>
                  <div style={{
                    fontSize:   10,
                    color:      T.textMuted,
                    fontFamily: T.fontMono,
                    marginTop:  2,
                  }}>
                    {task.docId}
                  </div>
                </div>
                <span style={{ color: T.accent, fontSize: 13, flexShrink: 0 }}>↗</span>
              </a>
            </div>
          )}

          {/* PR link */}
          {task.githubPrUrl && (
            <div>
              <div style={sectionLabel}>Pull Request</div>
              <a
                href={task.githubPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:        'flex',
                  alignItems:     'center',
                  gap:            8,
                  padding:        '10px 14px',
                  background:     T.surface2,
                  border:         `0.5px solid ${T.glassBorder}`,
                  borderRadius:   12,
                  textDecoration: 'none',
                  fontSize:       13,
                  color:          T.accent,
                  fontWeight:     500,
                }}
              >
                <span>🔗</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {task.githubPrUrl}
                </span>
                <span>↗</span>
              </a>
            </div>
          )}

          {/* Blocker note */}
          {task.status === 'audit_fix' && task.blockerDescription && (
            <div>
              <div style={{ ...sectionLabel, color: T.red }}>⚠ Blocker</div>
              <div style={{
                background:   'rgba(248,113,113,0.06)',
                border:       `0.5px solid ${T.red}40`,
                borderRadius: 12,
                padding:      '12px 16px',
                fontSize:     13,
                color:        T.red,
                lineHeight:   '1.5',
                whiteSpace:   'pre-wrap',
              }}>
                {task.blockerDescription}
              </div>
            </div>
          )}

          {/* Comments — review notes; on Audit/Fix, guidance for the next attempt */}
          <div>
            <div style={sectionLabel}>
              Comments{comments.length > 0 ? ` · ${comments.length}` : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {comments.map((c) => (
                <div key={c.id} style={{
                  background:   T.surface1,
                  border:       `0.5px solid ${T.line}`,
                  borderRadius: 10,
                  padding:      '10px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.textPrimary }}>
                      {c.authorName ?? 'Member'}
                    </span>
                    <span style={{ fontSize: 10.5, color: T.textMuted, fontFamily: T.fontMono }}>
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: T.textSecondary, lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {c.body}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  aria-label="Add a comment"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void postComment(); }}
                  placeholder={task.status === 'audit_fix'
                    ? 'Add guidance for the next attempt…'
                    : 'Add a comment…'}
                  style={{
                    flex:         1,
                    background:   T.surface2,
                    border:       `0.5px solid ${T.line}`,
                    borderRadius: 8,
                    padding:      '9px 12px',
                    color:        T.textPrimary,
                    fontFamily:   T.fontUI,
                    fontSize:     12.5,
                    outline:      'none',
                  }}
                />
                <button
                  onClick={() => { void postComment(); }}
                  disabled={!commentDraft.trim() || postingComment}
                  style={{
                    padding:      '6px 16px',
                    borderRadius: 8,
                    border:       `0.5px solid ${T.glassBorder}`,
                    background:   T.surface2,
                    color:        T.textPrimary,
                    fontSize:     12,
                    fontWeight:   500,
                    fontFamily:   T.fontUI,
                    cursor:       (!commentDraft.trim() || postingComment) ? 'default' : 'pointer',
                    opacity:      (!commentDraft.trim() || postingComment) ? 0.5 : 1,
                  }}
                >
                  {postingComment ? '…' : 'Post'}
                </button>
              </div>
            </div>
          </div>

          {/* Save error */}
          {saveError && (
            <div style={{
              background:   'rgba(248,113,113,0.08)',
              border:       `0.5px solid ${T.red}40`,
              borderRadius: 8,
              padding:      '8px 12px',
              fontSize:     12,
              color:        T.red,
            }}>
              {saveError}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding:      '12px 24px',
          borderTop:    `0.5px solid ${T.line}`,
          display:      'flex',
          alignItems:   'center',
          gap:          8,
        }}>
          {/* Delete section */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              style={{
                padding:      '6px 14px',
                borderRadius: 8,
                border:       `0.5px solid ${T.red}40`,
                background:   'rgba(248,113,113,0.06)',
                color:        T.red,
                fontSize:     12,
                cursor:       'pointer',
                fontFamily:   T.fontUI,
                opacity:      deleting ? 0.5 : 1,
              }}
            >
              Delete
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: T.textMuted }}>Sure?</span>
              <button
                onClick={() => { void handleDelete(); }}
                disabled={deleting}
                style={{
                  padding:      '6px 12px',
                  borderRadius: 8,
                  border:       `0.5px solid ${T.red}80`,
                  background:   `${T.red}18`,
                  color:        T.red,
                  fontSize:     12,
                  fontWeight:   600,
                  cursor:       'pointer',
                  fontFamily:   T.fontUI,
                }}
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{
                  padding:      '6px 12px',
                  borderRadius: 8,
                  border:       `0.5px solid ${T.glassBorder}`,
                  background:   T.glass,
                  color:        T.textMuted,
                  fontSize:     12,
                  cursor:       'pointer',
                  fontFamily:   T.fontUI,
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 11, color: T.textDisabled, fontFamily: T.fontMono }}>
              Created {new Date(task.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
              {task.estimatedCostUsd != null && ` · $${task.estimatedCostUsd.toFixed(4)} est.`}
            </span>
          </div>

          {/* Cancel edits */}
          <button
            onClick={onClose}
            style={{
              padding:      '6px 14px',
              borderRadius: 8,
              border:       `0.5px solid ${T.glassBorder}`,
              background:   T.glass,
              color:        T.textSecondary,
              fontSize:     12,
              cursor:       'pointer',
              fontFamily:   T.fontUI,
            }}
          >
            Close
          </button>

          {/* Save button */}
          <button
            onClick={() => { void handleSave(); }}
            disabled={!isDirty || saving}
            style={{
              padding:      '6px 18px',
              borderRadius: 8,
              border:       'none',
              background:   isDirty ? T.accent : T.glass,
              color:        isDirty ? '#0A0B0D' : T.textDisabled,
              fontSize:     12,
              fontWeight:   600,
              cursor:       isDirty ? 'pointer' : 'default',
              fontFamily:   T.fontUI,
              transition:   'all 0.15s',
              opacity:      saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared micro-styles ───────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize:      10,
  fontWeight:    600,
  color:         T.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom:  8,
};

const avatarStyle: React.CSSProperties = {
  width:          24,
  height:         24,
  borderRadius:   '50%',
  background:     `${T.accent}25`,
  border:         `0.5px solid ${T.accent}50`,
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  fontSize:       11,
  fontWeight:     600,
  color:          T.accent,
  flexShrink:     0,
  lineHeight:     '24px',
  textAlign:      'center',
};

const dropdownItemStyle: React.CSSProperties = {
  width:       '100%',
  display:     'flex',
  alignItems:  'center',
  gap:         8,
  padding:     '9px 12px',
  background:  'transparent',
  border:      'none',
  cursor:      'pointer',
  fontFamily:  T.fontUI,
  transition:  'background 0.1s',
};
