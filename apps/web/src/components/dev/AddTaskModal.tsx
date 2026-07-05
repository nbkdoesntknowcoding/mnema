// DESIGN APPLIED: 2026-05-27

import { type JSX, useState } from 'react';
import { T, glassCard } from '../../lib/dev-tokens';

interface ProjectOption { id: string; name: string; color: string; }

interface AddTaskModalProps {
  onAdd: (title: string, description?: string, priority?: string, projectId?: string | null) => Promise<void>;
  onClose: () => void;
  projects?: ProjectOption[];
  defaultProjectId?: string | null;
}

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

const PRIORITY_COLORS: Record<string, string> = {
  low:      T.low,
  medium:   T.medium,
  high:     T.high,
  critical: T.critical,
};

export function AddTaskModal({ onAdd, onClose, projects = [], defaultProjectId = null }: AddTaskModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(defaultProjectId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(title.trim(), description.trim() || undefined, priority, selectedProjectId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width:        '100%',
    padding:      '9px 12px',
    borderRadius: 10,
    background:   T.surface2,
    border:       `0.5px solid ${T.glassBorder}`,
    color:        T.textPrimary,
    fontSize:     13,
    outline:      'none',
    boxSizing:    'border-box',
    fontFamily:   T.fontUI,
    lineHeight:   '1.5',
  };

  return (
    <div
      style={{
        position:      'fixed',
        inset:         0,
        zIndex:        100,
        background:    'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        display:       'flex',
        alignItems:    'center',
        justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        ...glassCard,
        background:  T.surface1,
        border:      `0.5px solid ${T.glassBorderStrong}`,
        borderRadius: 20,
        padding:     28,
        width:       480,
        maxWidth:    '90vw',
        fontFamily:  T.fontUI,
      }}>
        <h2 style={{
          margin:      '0 0 20px',
          fontSize:    16,
          fontWeight:  600,
          color:       T.textPrimary,
          letterSpacing: '-0.01em',
        }}>
          Add task to backlog
        </h2>

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: T.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Title *
            </label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title…"
              required
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: T.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>

          {/* Project selector */}
          {projects.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Project</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setSelectedProjectId(null)}
                  style={{ padding: '5px 12px', borderRadius: 8, border: `0.5px solid ${selectedProjectId === null ? T.glassBorderStrong : T.glassBorder}`, background: selectedProjectId === null ? T.surface3 : T.glass, color: selectedProjectId === null ? T.textPrimary : T.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: T.fontUI }}>
                  No project
                </button>
                {projects.map((p) => (
                  <button key={p.id} type="button" onClick={() => setSelectedProjectId(p.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, border: `0.5px solid ${selectedProjectId === p.id ? T.glassBorderStrong : T.glassBorder}`, background: selectedProjectId === p.id ? T.surface3 : T.glass, color: selectedProjectId === p.id ? T.textPrimary : T.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: T.fontUI }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Priority */}
          <div style={{ marginBottom: 22 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Priority
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRIORITIES.map((p) => {
                const active = priority === p;
                const col = PRIORITY_COLORS[p]!;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      padding:      '5px 12px',
                      borderRadius: 8,
                      border:       active ? `0.5px solid ${col}80` : `0.5px solid ${T.glassBorder}`,
                      background:   active ? `${col}18` : T.glass,
                      color:        active ? col : T.textMuted,
                      fontSize:     12,
                      fontWeight:   active ? 600 : 400,
                      cursor:       'pointer',
                      fontFamily:   T.fontUI,
                      textTransform: 'capitalize',
                      transition:   'all 0.1s ease',
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p style={{ color: T.red, fontSize: 12, marginBottom: 14 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding:      '8px 16px',
                borderRadius: 10,
                border:       `0.5px solid ${T.glassBorder}`,
                background:   T.glass,
                color:        T.textSecondary,
                fontSize:     13,
                cursor:       'pointer',
                fontFamily:   T.fontUI,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              style={{
                padding:      '8px 18px',
                borderRadius: 10,
                border:       'none',
                background:   T.accent,
                color:        '#0A0B0D',
                fontSize:     13,
                fontWeight:   600,
                cursor:       submitting || !title.trim() ? 'not-allowed' : 'pointer',
                fontFamily:   T.fontUI,
                opacity:      submitting || !title.trim() ? 0.45 : 1,
                letterSpacing: '-0.01em',
              }}
            >
              {submitting ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
