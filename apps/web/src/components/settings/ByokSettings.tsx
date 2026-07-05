/**
 * Meeting-AI BYOK panel (Phase 1). Everyone sees status + the free-tier monthly
 * meeting cap; workspace admins set/rotate/remove the workspace's own
 * OpenAI-compatible LLM key (used by the meeting agent + summaries). The key is
 * write-only from the UI — the API never returns it. Auth flows through the Astro
 * proxy via credentials:'include'.
 */
import { type CSSProperties, type JSX, useEffect, useState } from 'react';

interface Status {
  present: boolean;
  baseUrl: string | null;
  model: string | null;
  plan: string;
  cap: { used: number; limit: number | null; capped: boolean };
}

const card: CSSProperties = {
  padding: 16,
  border: '0.5px solid var(--border, rgba(0,0,0,0.08))',
  borderRadius: 10,
  maxWidth: 520,
};
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 };
const input: CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  borderRadius: 8,
  fontSize: 12.5,
  fontFamily: 'var(--mono, monospace)',
  border: '0.5px solid var(--border, rgba(0,0,0,0.08))',
  background: 'var(--surface, #fff)',
  color: 'var(--ink)',
  boxSizing: 'border-box',
};
const primaryBtn: CSSProperties = {
  padding: '7px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  color: '#fff',
  background: 'var(--accent, #6366f1)',
  border: 'none',
  cursor: 'pointer',
};

export function ByokSettings(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load(): Promise<void> {
    try {
      const r = await fetch('/api/settings/byok/llm', { credentials: 'include' });
      if (!r.ok) throw new Error(String(r.status));
      setStatus((await r.json()) as Status);
    } catch {
      setLoadErr('Could not load settings.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(): Promise<void> {
    if (!apiKey.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings/byok/llm', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || null,
          model: model.trim() || null,
        }),
      });
      if (!r.ok) {
        throw new Error(r.status === 403 ? 'Only workspace admins can change this.' : `Save failed (${r.status}).`);
      }
      setApiKey('');
      setMsg({ kind: 'ok', text: 'Saved.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings/byok/llm', { method: 'DELETE', credentials: 'include' });
      if (!r.ok) {
        throw new Error(r.status === 403 ? 'Only workspace admins can change this.' : `Remove failed (${r.status}).`);
      }
      setBaseUrl('');
      setModel('');
      setMsg({ kind: 'ok', text: 'Removed.' });
      await load();
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Remove failed.' });
    } finally {
      setBusy(false);
    }
  }

  if (loadErr) return <div style={{ color: '#ef4444', fontSize: 13 }}>{loadErr}</div>;
  if (!status) return <div style={{ color: 'var(--ink-soft)', fontSize: 13 }}>Loading…</div>;

  const isFree = status.plan === 'free';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 520 }}>
      {isFree && status.cap.limit != null && (
        <div style={{ ...card, background: status.cap.capped ? 'rgba(239,68,68,0.06)' : 'var(--surface-elevated, transparent)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Free tier — meeting usage</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 4 }}>
            {status.cap.used} / {status.cap.limit} meetings this month.
            {status.cap.capped ? ' Limit reached — upgrade or wait until next month.' : ''}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Meeting AI — your LLM key</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 14 }}>
          {isFree
            ? 'On the free tier, the meeting agent and summaries run on your own OpenAI-compatible key. Speech-to-text and text-to-speech stay on us.'
            : 'Optionally use your own OpenAI-compatible key for the meeting agent and summaries. Leave empty to use the Mnema-provided model.'}
        </div>

        {status.present && (
          <div style={{ fontSize: 12.5, color: 'var(--ink)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#16a34a' }} />
            Key configured
            {status.model ? ` · model ${status.model}` : ''}
            {status.baseUrl ? ` · ${status.baseUrl}` : ''}
          </div>
        )}

        <div style={label}>API key</div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={status.present ? 'Enter a new key to rotate' : 'sk-…'}
          style={input}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>
              Base URL <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>(optional)</span>
            </div>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" style={input} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>
              Model <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>(optional)</span>
            </div>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4.1" style={input} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button onClick={() => void save()} disabled={busy || !apiKey.trim()} style={{ ...primaryBtn, opacity: busy || !apiKey.trim() ? 0.6 : 1 }}>
            {busy ? 'Saving…' : status.present ? 'Update key' : 'Save key'}
          </button>
          {status.present && (
            <button
              onClick={() => void remove()}
              disabled={busy}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                color: '#ef4444',
                background: 'transparent',
                border: '0.5px solid var(--border, rgba(0,0,0,0.08))',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          )}
          {msg && <span style={{ fontSize: 12.5, color: msg.kind === 'ok' ? '#16a34a' : '#ef4444' }}>{msg.text}</span>}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 14 }}>
          Keys are encrypted at rest and used only for your meeting sessions. Admins only.
        </div>
      </div>
    </div>
  );
}
