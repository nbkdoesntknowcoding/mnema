import { type JSX, useEffect, useState } from 'react';
import { api, ApiError, type Role } from '../../lib/api';

interface Props {
  currentUserRole: Role;
}

interface Workspace {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
}

/**
 * Settings → Workspace.
 *
 * Owner-only mutations (name + slug). Editors and viewers see a read-only
 * view of the current workspace's basics. The backend (PATCH endpoint)
 * also enforces owner-only; this is the UX guard.
 *
 * Slug is the global URL identifier — collisions across workspaces return
 * 409. Name is purely display.
 */
export function WorkspaceSettings({ currentUserRole }: Props): JSX.Element {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canEdit = currentUserRole === 'owner';

  useEffect(() => {
    api
      .getCurrentWorkspace()
      .then((res) => {
        setWs(res.workspace);
        setName(res.workspace.name);
        setSlug(res.workspace.slug);
      })
      .catch(() => setError('Could not load workspace settings.'));
  }, []);

  const dirty =
    ws !== null && (name.trim() !== ws.name || slug.trim() !== ws.slug);

  async function handleSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!ws) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const payload: { name?: string; slug?: string } = {};
    if (name.trim() !== ws.name) payload.name = name.trim();
    if (slug.trim() !== ws.slug) payload.slug = slug.trim();

    try {
      const res = await api.updateCurrentWorkspace(payload);
      setWs((prev) =>
        prev
          ? { ...prev, name: res.workspace.name, slug: res.workspace.slug }
          : prev,
      );
      setName(res.workspace.name);
      setSlug(res.workspace.slug);
      setSuccess('Saved.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('That slug is already in use by another workspace.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Slug must be 2–40 lowercase letters, numbers, or hyphens.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You don't have permission to change workspace settings.");
      } else {
        setError('Could not save changes.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!ws) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Loading…
      </p>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <label
          htmlFor="ws-name"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Workspace name
        </label>
        <input
          id="ws-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          maxLength={80}
          className="w-full h-9 px-3 rounded-md text-sm focus:outline-none disabled:opacity-60"
          style={{
            background: 'var(--surface-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        />
      </div>

      <div>
        <label
          htmlFor="ws-slug"
          className="block text-sm font-medium mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          Workspace slug
        </label>
        <input
          id="ws-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={!canEdit}
          maxLength={40}
          pattern="[a-z0-9-]+"
          className="w-full h-9 px-3 rounded-md text-sm font-mono focus:outline-none disabled:opacity-60"
          style={{
            background: 'var(--surface-input)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        />
        <p
          className="mt-1.5 text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Lowercase letters, numbers, and hyphens. Used in URLs and is
          globally unique across all Mnema workspaces.
        </p>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !dirty}
            className="h-9 px-4 rounded-md text-sm font-medium transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--interactive-primary)',
              color: 'var(--text-inverse)',
            }}
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
          {error && (
            <span className="text-sm" style={{ color: 'var(--danger-default)' }}>
              {error}
            </span>
          )}
          {success && !error && (
            <span className="text-sm" style={{ color: 'var(--success-default)' }}>
              {success}
            </span>
          )}
        </div>
      )}

      <div
        className="pt-6 mt-6 space-y-2"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-tertiary)' }}>Plan</span>
          <span style={{ color: 'var(--text-secondary)' }}>{ws.plan}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-tertiary)' }}>Created</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {new Date(ws.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-tertiary)' }}>Workspace ID</span>
          <span
            className="font-mono"
            style={{ color: 'var(--text-secondary)' }}
          >
            {ws.id}
          </span>
        </div>
      </div>
    </form>
  );
}
