// TODO: Claude Design — apply Mnema glassmorphism design system
// Background: var(--bg) #0a0a0a
// Cards: rgba(255,255,255,0.04) + backdrop-filter: blur(24px)

import { type JSX, useEffect, useState } from 'react';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreateResult {
  key: ApiKey;
  plaintext: string;
}

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

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const SCOPE_LABELS: Record<string, string> = {
  read:  'Read',
  write: 'Write',
  tasks: 'Tasks',
};

const SCOPE_COLOURS: Record<string, string> = {
  read:  'rgba(99,102,241,0.15)',
  write: 'rgba(34,197,94,0.15)',
  tasks: 'rgba(234,179,8,0.15)',
};

// ── Create modal ──────────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreate: (result: CreateResult) => void;
}

function CreateModal({ onClose, onCreate }: CreateModalProps): JSX.Element {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Name is required'); return; }
    if (scopes.length === 0) { setError('Select at least one scope'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<CreateResult>('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresAt: expiresAt || undefined,
        }),
      });
      onCreate(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--surface-elevated, #161616)',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
          borderRadius: '16px',
          padding: '32px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
      >
        <h2 style={{ margin: '0 0 24px', fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
          Create API key
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Name
          </label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder='e.g. "ChatGPT Integration"'
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
              borderRadius: '8px', padding: '8px 12px',
              fontSize: '14px', color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Scopes
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {Object.entries(SCOPE_LABELS).map(([scope, label]) => {
              const active = scopes.includes(scope);
              return (
                <button
                  key={scope}
                  onClick={() => { toggleScope(scope); }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '20px',
                    border: '1px solid',
                    borderColor: active ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)',
                    background: active ? SCOPE_COLOURS[scope] : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '13px', cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Read: list/get/search docs • Write: create/update docs • Tasks: claim/complete tasks
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Expiry (optional)
          </label>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => { setExpiresAt(e.target.value); }}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
              borderRadius: '8px', padding: '8px 12px',
              fontSize: '14px', color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        {error && (
          <p style={{ marginBottom: '16px', fontSize: '13px', color: '#f87171' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: 'var(--text-secondary)',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleCreate(); }}
            disabled={submitting}
            style={{
              padding: '8px 20px', borderRadius: '8px',
              background: 'rgba(99,102,241,0.8)', color: '#fff',
              border: 'none', fontSize: '14px', cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Plaintext reveal modal ─────────────────────────────────────────────────────

interface PlaintextModalProps {
  plaintext: string;
  onClose: () => void;
}

function PlaintextModal({ plaintext, onClose }: PlaintextModalProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => { setCopied(false); }, 2000);
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          background: 'var(--surface-elevated, #161616)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '16px', padding: '32px',
          width: '100%', maxWidth: '520px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span style={{ fontSize: '20px' }}>🔑</span>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Save your API key
          </h2>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          This key will <strong>not</strong> be shown again. Copy it now and store it securely.
        </p>

        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.2)',
            borderRadius: '8px', padding: '12px 16px',
            marginBottom: '20px',
          }}
        >
          <code
            style={{
              flex: 1, wordBreak: 'break-all',
              fontFamily: 'monospace', fontSize: '13px',
              color: '#86efac',
            }}
          >
            {plaintext}
          </code>
          <button
            onClick={() => { void handleCopy(); }}
            style={{
              padding: '4px 10px', borderRadius: '6px',
              border: '1px solid rgba(34,197,94,0.3)',
              background: 'transparent', color: '#86efac',
              fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <label
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer',
            marginBottom: '20px',
          }}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => { setConfirmed(e.target.checked); }}
          />
          I've saved this key somewhere secure
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={!confirmed}
            style={{
              padding: '8px 20px', borderRadius: '8px',
              background: confirmed ? 'rgba(99,102,241,0.8)' : 'rgba(99,102,241,0.3)',
              color: '#fff', border: 'none',
              fontSize: '14px', cursor: confirmed ? 'pointer' : 'not-allowed',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ApiKeys(): JSX.Element {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<ApiKey[]>('/api/api-keys')
      .then((data) => { setKeys(data); setError(null); })
      .catch((err: Error) => { setError(err.message); })
      .finally(() => { setLoading(false); });
  }, []);

  function handleCreated(result: CreateResult) {
    setKeys((prev) => [result.key, ...prev]);
    setShowCreate(false);
    setNewPlaintext(result.plaintext);
  }

  async function handleRevoke(keyId: string) {
    setRevoking(keyId);
    try {
      await apiFetch(`/api/api-keys/${keyId}`, { method: 'DELETE' });
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>API Keys</h2>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
            Connect ChatGPT, Gemini, or any REST client to your Mnema workspace.
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); }}
          style={{
            padding: '8px 16px', borderRadius: '8px',
            background: 'rgba(99,102,241,0.8)', color: '#fff',
            border: 'none', fontSize: '14px', cursor: 'pointer',
          }}
        >
          + Create API key
        </button>
      </div>

      {loading && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading…</p>
      )}

      {error && (
        <p style={{ color: '#f87171', fontSize: '14px' }}>{error}</p>
      )}

      {!loading && keys.length === 0 && !error && (
        <div
          style={{
            textAlign: 'center', padding: '48px 24px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '12px',
          }}
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
            No API keys yet. Create one to connect AI apps to this workspace.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {keys.map((key) => (
          <div
            key={key.id}
            style={{
              display: 'flex', alignItems: 'center', gap: '16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px', padding: '14px 18px',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                  {key.name}
                </span>
                {key.expiresAt && new Date(key.expiresAt) < new Date() && (
                  <span
                    style={{
                      fontSize: '11px', padding: '1px 6px', borderRadius: '4px',
                      background: 'rgba(239,68,68,0.15)', color: '#f87171',
                    }}
                  >
                    Expired
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <code style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                  {key.prefix}…
                </code>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {key.scopes.map((scope) => (
                    <span
                      key={scope}
                      style={{
                        fontSize: '11px', padding: '1px 7px', borderRadius: '20px',
                        background: SCOPE_COLOURS[scope] ?? 'rgba(255,255,255,0.08)',
                        color: 'var(--text-secondary)',
                        border: '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      {SCOPE_LABELS[scope] ?? scope}
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                  Last used: {relativeTime(key.lastUsedAt)}
                </span>
              </div>
            </div>

            {confirmRevoke === key.id ? (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Revoke?</span>
                <button
                  onClick={() => { void handleRevoke(key.id); }}
                  disabled={revoking === key.id}
                  style={{
                    padding: '4px 10px', borderRadius: '6px',
                    background: 'rgba(239,68,68,0.8)', color: '#fff',
                    border: 'none', fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  {revoking === key.id ? '…' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setConfirmRevoke(null); }}
                  style={{
                    padding: '4px 10px', borderRadius: '6px',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: 'var(--text-secondary)',
                    fontSize: '12px', cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setConfirmRevoke(key.id); }}
                style={{
                  padding: '4px 10px', borderRadius: '6px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: 'var(--text-secondary)',
                  fontSize: '12px', cursor: 'pointer',
                }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => { setShowCreate(false); }}
          onCreate={handleCreated}
        />
      )}

      {newPlaintext && (
        <PlaintextModal
          plaintext={newPlaintext}
          onClose={() => { setNewPlaintext(null); }}
        />
      )}
    </div>
  );
}
