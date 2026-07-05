// Sprint 5 F.1 — Projects page component
// - Fetches project folders so "Docs" links to the real folder
// - Card CRUD: edit (rename/desc/color/icon), duplicate, archive
// - Fonts: T.fontUI (Geist) only — no Instrument Serif

import { type JSX, useEffect, useRef, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

interface TaskCounts {
  backlog?: number;
  in_progress?: number;
  review?: number;
  audit_fix?: number;
  done?: number;
}

interface Folder {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  icon: string;
  githubRepoUrl: string | null;
  status: string;
  boardOrder: number;
  taskCounts: TaskCounts;
  folders?: Folder[];
}

const PROJECT_COLORS = [
  '#f0997b','#fbbf24','#4ade80','#a78bfa',
  '#60a5fa','#f87171','#34d399','#fb923c','#e879f9','#52525b',
] as const;

const ICON_OPTIONS = [
  { key: 'folder',  svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg> },
  { key: 'code',    svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> },
  { key: 'rocket',  svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg> },
  { key: 'brain',   svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/></svg> },
  { key: 'bolt',    svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg> },
  { key: 'layers',  svg: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg> },
];

const iconMap = Object.fromEntries(ICON_OPTIONS.map((o) => [o.key, o.svg]));

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

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ counts }: { counts: TaskCounts }) {
  const total = (counts.backlog ?? 0) + (counts.in_progress ?? 0) + (counts.review ?? 0) + (counts.done ?? 0);
  if (total === 0) return <div style={{ height: 3, borderRadius: 3, background: T.surface3 }} />;
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <div style={{ height: 3, borderRadius: 3, overflow: 'hidden', display: 'flex', background: T.surface3 }}>
      {(counts.done ?? 0) > 0 && <div style={{ width: pct(counts.done!), background: T.green }} />}
      {(counts.review ?? 0) > 0 && <div style={{ width: pct(counts.review!), background: T.violet }} />}
      {(counts.in_progress ?? 0) > 0 && <div style={{ width: pct(counts.in_progress!), background: T.amber }} />}
    </div>
  );
}

// ── Shared modal shell ────────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ ...glassCard, background: T.surface1, border: `0.5px solid ${T.glassBorderStrong}`, borderRadius: 18, padding: 28, width: 500, maxWidth: '90vw', fontFamily: T.fontUI }}>
        {children}
      </div>
    </div>
  );
}

// ── Project form (shared by Create + Edit) ────────────────────────────────────

interface AllFolder {
  id: string;
  name: string;
  parent_folder_id: string | null;
  doc_count: number;
}

interface ProjectFormProps {
  initial?: Partial<Project>;
  submitLabel: string;
  onSubmit: (data: {
    name: string; description: string; color: string; icon: string;
    githubRepoUrl: string; folderIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}

function ProjectForm({ initial, submitLabel, onSubmit, onClose }: ProjectFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]!);
  const [icon, setIcon] = useState(initial?.icon ?? 'folder');
  const [githubRepoUrl, setGithubRepoUrl] = useState(initial?.githubRepoUrl ?? '');
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(
    new Set(initial?.folders?.map((f) => f.id) ?? []),
  );
  const [allFolders, setAllFolders] = useState<AllFolder[]>([]);
  const [folderSearch, setFolderSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all workspace folders on mount
  useEffect(() => {
    apiFetch<{ folders: AllFolder[] }>('/api/folders')
      .then((d) => setAllFolders(d.folders ?? []))
      .catch(() => {});
  }, []);

  const filteredFolders = allFolders.filter((f) =>
    f.name.toLowerCase().includes(folderSearch.toLowerCase()),
  );

  function toggleFolder(id: string) {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const input: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 9,
    background: T.surface2, border: `0.5px solid ${T.glassBorder}`,
    color: T.textPrimary, fontSize: 13, outline: 'none',
    boxSizing: 'border-box', fontFamily: T.fontUI, lineHeight: '1.5',
  };
  const label: React.CSSProperties = {
    display: 'block', fontSize: 11, color: T.textMuted, marginBottom: 5,
    fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase',
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      await onSubmit({
        name: name.trim(), description: description.trim(), color, icon,
        githubRepoUrl: githubRepoUrl.trim(),
        folderIds: Array.from(selectedFolderIds),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }}>
      <div style={{ marginBottom: 13 }}>
        <label style={label}>Name *</label>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BOPPL Context Engine" autoFocus required />
      </div>
      <div style={{ marginBottom: 13 }}>
        <label style={label}>Description</label>
        <textarea style={{ ...input, height: 60, resize: 'none' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </div>

      {/* Folder picker */}
      <div style={{ marginBottom: 13 }}>
        <label style={label}>
          Link folders
          {selectedFolderIds.size > 0 && (
            <span style={{ marginLeft: 6, color: T.accent, fontWeight: 600 }}>{selectedFolderIds.size} selected</span>
          )}
        </label>
        <div style={{ border: `0.5px solid ${T.glassBorder}`, borderRadius: 9, overflow: 'hidden', background: T.surface2 }}>
          {/* Search inside picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: `0.5px solid ${T.glassBorder}` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              value={folderSearch}
              onChange={(e) => setFolderSearch(e.target.value)}
              placeholder="Search folders…"
              style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 12.5, color: T.textPrimary, fontFamily: T.fontUI }}
            />
          </div>
          {/* Folder list */}
          <div style={{ maxHeight: 168, overflowY: 'auto' }}>
            {filteredFolders.length === 0 ? (
              <p style={{ margin: 0, padding: '12px 12px', fontSize: 12, color: T.textMuted, textAlign: 'center' }}>
                {allFolders.length === 0 ? 'No folders in workspace yet' : 'No folders match'}
              </p>
            ) : (
              filteredFolders.map((f) => {
                const selected = selectedFolderIds.has(f.id);
                return (
                  <button key={f.id} type="button" onClick={() => toggleFolder(f.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '8px 12px', border: 'none', textAlign: 'left',
                      background: selected ? `rgba(255,179,112,0.08)` : 'transparent',
                      cursor: 'pointer', fontFamily: T.fontUI,
                      borderBottom: `0.5px solid ${T.line}`,
                    }}
                  >
                    {/* Checkbox */}
                    <span style={{
                      width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                      border: `1.5px solid ${selected ? T.accent : T.glassBorder}`,
                      background: selected ? T.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {selected && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0A0B0D" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </span>
                    {/* Folder icon */}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={selected ? T.accent : T.textMuted} strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>
                    <span style={{ flex: 1, fontSize: 13, color: selected ? T.textPrimary : T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono, flexShrink: 0 }}>{f.doc_count} doc{f.doc_count !== 1 ? 's' : ''}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
        <p style={{ margin: '5px 0 0', fontSize: 11, color: T.textMuted }}>
          Selected folders open when you click the project. New folders are auto-created if none selected.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 13 }}>
        <div style={{ flex: 1 }}>
          <label style={label}>Colour</label>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)}
                style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: color === c ? `2.5px solid ${T.textPrimary}` : '2.5px solid transparent', cursor: 'pointer', padding: 0 }} />
            ))}
          </div>
        </div>
        <div>
          <label style={label}>Icon</label>
          <div style={{ display: 'flex', gap: 5 }}>
            {ICON_OPTIONS.map((opt) => (
              <button key={opt.key} type="button" onClick={() => setIcon(opt.key)}
                style={{ width: 30, height: 30, borderRadius: 7, border: `0.5px solid ${icon === opt.key ? T.glassBorderStrong : T.glassBorder}`, background: icon === opt.key ? T.surface3 : T.surface2, color: icon === opt.key ? T.textPrimary : T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {opt.svg}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <label style={label}>GitHub repo URL</label>
        <input style={input} value={githubRepoUrl} onChange={(e) => setGithubRepoUrl(e.target.value)} placeholder="https://github.com/org/repo" />
      </div>

      {error && <p style={{ fontSize: 12, color: T.red, margin: '0 0 10px' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onClose}
          style={{ padding: '7px 16px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`, background: 'transparent', color: T.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: T.fontUI }}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !name.trim()}
          style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: T.accent, color: '#0A0B0D', fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: T.fontUI }}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteConfirm({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    await apiFetch(`/api/projects/${project.id}`, { method: 'DELETE' });
    onDone();
    onClose();
  }
  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: T.textPrimary }}>Archive project?</h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: T.textSecondary, lineHeight: 1.5 }}>
        <strong style={{ color: T.textPrimary }}>{project.name}</strong> will be archived. Tasks keep their project association and can be restored later.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`, background: 'transparent', color: T.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: T.fontUI }}>Cancel</button>
        <button onClick={() => { void confirm(); }} disabled={busy}
          style={{ padding: '7px 16px', borderRadius: 7, border: `0.5px solid rgba(248,113,113,0.4)`, background: 'rgba(248,113,113,0.12)', color: T.red, fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: T.fontUI }}>
          {busy ? 'Archiving…' : 'Archive'}
        </button>
      </div>
    </Modal>
  );
}

// ── Card 3-dot menu ───────────────────────────────────────────────────────────

function CardMenu({ onEdit, onDuplicate, onManageAccess, onDelete }: { onEdit: () => void; onDuplicate: () => void; onManageAccess: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
    padding: '8px 13px', background: 'transparent', border: 'none',
    color: T.textSecondary, fontSize: 12.5, cursor: 'pointer', fontFamily: T.fontUI,
    whiteSpace: 'nowrap',
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{ width: 26, height: 26, borderRadius: 6, border: `0.5px solid ${T.glassBorder}`, background: open ? T.surface3 : 'transparent', color: T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.fontUI }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60, background: T.surface2, border: `0.5px solid ${T.glassBorder}`, borderRadius: 10, overflow: 'hidden', minWidth: 148, boxShadow: '0 8px 28px rgba(0,0,0,0.45)' }}>
          <button style={item} onClick={() => { setOpen(false); onEdit(); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.surface3)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
            Edit
          </button>
          <button style={item} onClick={() => { setOpen(false); onDuplicate(); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.surface3)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Duplicate
          </button>
          <button style={item} onClick={() => { setOpen(false); onManageAccess(); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.surface3)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Manage access
          </button>
          <div style={{ height: '0.5px', background: T.glassBorder, margin: '2px 0' }} />
          <button style={{ ...item, color: T.red }} onClick={() => { setOpen(false); onDelete(); }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(248,113,113,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

// ── Members / access modal (Stage B5) ──────────────────────────────────────────

type ProjectRole = 'viewer' | 'editor' | 'admin';
interface ProjectMember {
  userId: string;
  role: ProjectRole;
  email: string;
  displayName: string | null;
  joinedAt: string;
}

function MembersModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch<{ members: ProjectMember[] }>(`/api/projects/${project.id}/members`);
      setMembers(res.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed_to_load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [project.id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/projects/${project.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed_to_add');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(userId: string, newRole: ProjectRole) {
    try {
      await apiFetch(`/api/projects/${project.id}/members/${userId}`, {
        method: 'PATCH', body: JSON.stringify({ role: newRole }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed_to_update');
    }
  }

  async function remove(userId: string) {
    try {
      await apiFetch(`/api/projects/${project.id}/members/${userId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed_to_remove');
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: 11, color: T.textMuted, fontFamily: T.fontUI };
  const inputStyle: React.CSSProperties = {
    flex: 1, padding: '7px 11px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`,
    background: T.surface3, color: T.textPrimary, fontSize: 13, fontFamily: T.fontUI, outline: 'none',
  };
  const selectStyle: React.CSSProperties = {
    padding: '7px 9px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`,
    background: T.surface3, color: T.textPrimary, fontSize: 12.5, fontFamily: T.fontUI, cursor: 'pointer',
  };

  return (
    <Modal onClose={onClose}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: T.textPrimary, fontFamily: T.fontUI }}>
        Access · {project.name}
      </h2>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: T.textMuted, fontFamily: T.fontUI, lineHeight: 1.5 }}>
        Members listed here can see this project's docs and tasks. Workspace owners and editors
        always have access. People must already be in the workspace to be added.
      </p>

      {/* Add member */}
      <form onSubmit={(e) => { void add(e); }} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input type="email" placeholder="member@email.com" value={email}
          onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <select value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} style={selectStyle}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
        <button type="submit" disabled={busy || !email.trim()}
          style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: T.accent, color: '#0A0B0D', fontSize: 13, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy || !email.trim() ? 0.55 : 1, fontFamily: T.fontUI }}>
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: T.red, fontFamily: T.fontUI }}>{error.replace(/_/g, ' ')}</p>
      )}

      {/* Member list */}
      {loading ? (
        <p style={{ color: T.textMuted, fontSize: 13, fontFamily: T.fontUI }}>Loading…</p>
      ) : members.length === 0 ? (
        <p style={{ color: T.textMuted, fontSize: 13, fontFamily: T.fontUI }}>
          No explicit members yet. Only workspace owners/editors can see this project.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>{members.length} member{members.length !== 1 ? 's' : ''}</span>
          {members.map((m) => (
            <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: T.surface3, border: `0.5px solid ${T.glassBorder}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: T.textPrimary, fontFamily: T.fontUI, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.displayName ?? m.email}</div>
                {m.displayName && <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{m.email}</div>}
              </div>
              <select value={m.role} onChange={(e) => { void changeRole(m.userId, e.target.value as ProjectRole); }} style={{ ...selectStyle, padding: '5px 8px', fontSize: 12 }}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <button onClick={() => { void remove(m.userId); }} title="Remove"
                style={{ width: 28, height: 28, borderRadius: 6, border: `0.5px solid ${T.glassBorder}`, background: 'transparent', color: T.textMuted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = T.red; e.currentTarget.style.background = 'rgba(248,113,113,0.08)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.background = 'transparent'; }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button onClick={onClose}
          style={{ padding: '7px 16px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`, background: 'transparent', color: T.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: T.fontUI }}>
          Done
        </button>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProjectsPage(): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [managing, setManaging] = useState<Project | null>(null);

  async function load() {
    try {
      // Fetch projects + their folders in parallel
      const data = await apiFetch<{ projects: Project[] }>('/api/projects?status=active');
      const withFolders = await Promise.all(
        data.projects.map(async (p) => {
          try {
            const d = await apiFetch<{ folders: Folder[] }>(`/api/projects/${p.id}`);
            return { ...p, folders: d.folders ?? [] };
          } catch {
            return { ...p, folders: [] };
          }
        }),
      );
      setProjects(withFolders);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Link a set of folder IDs to a project (and unlink any previously linked folders not in the new set)
  async function syncFolders(projectId: string, selectedIds: string[], existingFolders: Folder[]) {
    const existingIds = new Set(existingFolders.map((f) => f.id));
    const toLink   = selectedIds.filter((id) => !existingIds.has(id));
    const toUnlink = existingFolders.filter((f) => !selectedIds.includes(f.id)).map((f) => f.id);
    await Promise.all([
      ...toLink.map((id) => apiFetch(`/api/folders/${id}/project`, { method: 'PATCH', body: JSON.stringify({ project_id: projectId }) })),
      ...toUnlink.map((id) => apiFetch(`/api/folders/${id}/project`, { method: 'PATCH', body: JSON.stringify({ project_id: null }) })),
    ]);
  }

  async function handleCreate(data: { name: string; description: string; color: string; icon: string; githubRepoUrl: string; folderIds: string[] }) {
    const result = await apiFetch<{ project: { id: string } }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ ...data, description: data.description || undefined, githubRepoUrl: data.githubRepoUrl || undefined }),
    });
    // Link selected folders to the new project
    if (data.folderIds.length > 0) {
      await Promise.all(
        data.folderIds.map((id) => apiFetch(`/api/folders/${id}/project`, { method: 'PATCH', body: JSON.stringify({ project_id: result.project.id }) })),
      );
    }
    await load();
  }

  async function handleEdit(p: Project, data: { name: string; description: string; color: string; icon: string; githubRepoUrl: string; folderIds: string[] }) {
    await apiFetch(`/api/projects/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, description: data.description || null, githubRepoUrl: data.githubRepoUrl || null }),
    });
    // Sync folder links
    await syncFolders(p.id, data.folderIds, p.folders ?? []);
    await load();
  }

  async function handleDuplicate(p: Project) {
    await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: `${p.name} (copy)`,
        description: p.description ?? undefined,
        color: p.color,
        icon: p.icon,
        githubRepoUrl: p.githubRepoUrl ?? undefined,
      }),
    });
    await load();
  }

  return (
    <div style={{ padding: '28px 32px', fontFamily: T.fontUI, background: T.bg, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: T.textPrimary, letterSpacing: '-0.02em', fontFamily: T.fontUI }}>Projects</h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: T.textMuted }}>{projects.length} active project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: T.accent, color: '#0A0B0D', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.fontUI }}>
          + New project
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <p style={{ color: T.textMuted, fontSize: 13 }}>Loading…</p>
      ) : projects.length === 0 ? (
        <div style={{ ...glassCard, padding: '48px 32px', textAlign: 'center', maxWidth: 440, margin: '0 auto' }}>
          <p style={{ margin: '0 0 8px', fontSize: 15, color: T.textPrimary, fontWeight: 600 }}>No projects yet</p>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: T.textMuted }}>Create a project to organise tasks and docs together.</p>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: T.accent, color: '#0A0B0D', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.fontUI }}>
            Create first project
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {projects.map((p) => {
            const totalTasks = Object.values(p.taskCounts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
            // Link to first project folder; fall back to /app/content if none
            const firstFolder = p.folders?.[0];
            const docsHref = firstFolder ? `/app/content?folder=${firstFolder.id}` : '/app/content';

            return (
              <div key={p.id}
                onClick={(e) => {
                  // Don't navigate if user clicked a link/button inside the card
                  if ((e.target as HTMLElement).closest('a, button')) return;
                  window.location.href = docsHref;
                }}
                style={{ ...glassCard, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 11, cursor: 'pointer' }}
              >

                {/* Header: icon + color dot + name + menu */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div style={{ color: p.color, flexShrink: 0 }}>{iconMap[p.icon] ?? iconMap['folder']}</div>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: T.textPrimary, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <CardMenu
                    onEdit={() => setEditing(p)}
                    onDuplicate={() => { void handleDuplicate(p); }}
                    onManageAccess={() => setManaging(p)}
                    onDelete={() => setDeleting(p)}
                  />
                </div>

                {/* Description */}
                {p.description && (
                  <p style={{ margin: 0, fontSize: 12, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</p>
                )}

                {/* Folders list — shows linked folders */}
                {p.folders && p.folders.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {p.folders.map((f) => (
                      <a key={f.id} href={`/app/content?folder=${f.id}`}
                        style={{ fontSize: 11, color: T.textMuted, textDecoration: 'none', padding: '2px 8px', borderRadius: 5, background: T.surface3, border: `0.5px solid ${T.glassBorder}`, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: T.fontUI }}
                        title={`Open folder: ${f.name}`}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>
                        {f.name}
                      </a>
                    ))}
                  </div>
                )}

                {/* Progress bar */}
                <ProgressBar counts={p.taskCounts} />

                {/* Footer */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.fontMono }}>{totalTasks} task{totalTasks !== 1 ? 's' : ''}</span>
                    {p.githubRepoUrl && (
                      <a href={p.githubRepoUrl} target="_blank" rel="noopener noreferrer" style={{ color: T.textMuted, display: 'flex', alignItems: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12"/></svg>
                      </a>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={docsHref}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.textSecondary, fontWeight: 500, textDecoration: 'none', padding: '4px 10px', borderRadius: 7, border: `0.5px solid ${T.glassBorder}`, background: T.glass, fontFamily: T.fontUI }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                      Docs
                    </a>
                    <a href={`/app/kanban?project=${p.slug}`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.accent, fontWeight: 600, textDecoration: 'none', padding: '4px 10px', borderRadius: 7, border: `0.5px solid rgba(255,179,112,0.3)`, background: 'rgba(255,179,112,0.08)', fontFamily: T.fontUI }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="13" rx="1"/><rect x="17" y="3" width="5" height="9" rx="1"/></svg>
                      Kanban
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: T.textPrimary }}>New project</h2>
          <ProjectForm submitLabel="Create project" onClose={() => setShowCreate(false)}
            onSubmit={async (data) => { await handleCreate(data); setShowCreate(false); }} />
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: T.textPrimary }}>Edit project</h2>
          <ProjectForm initial={editing} submitLabel="Save changes" onClose={() => setEditing(null)}
            onSubmit={async (data) => { await handleEdit(editing, data); setEditing(null); }} />
        </Modal>
      )}

      {/* Archive confirm */}
      {deleting && (
        <DeleteConfirm project={deleting} onClose={() => setDeleting(null)} onDone={() => { void load(); }} />
      )}

      {/* Members / access modal */}
      {managing && (
        <MembersModal project={managing} onClose={() => setManaging(null)} />
      )}
    </div>
  );
}
