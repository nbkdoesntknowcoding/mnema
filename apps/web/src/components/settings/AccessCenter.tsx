import { useCallback, useEffect, useMemo, useState } from 'react';

/*
 * Unified Access surface (/app/settings/access) — the single place to see, date,
 * and revoke everything that can reach this workspace. Two credential types:
 *   • API keys      → REST scripts   (/api/api-keys)
 *   • Connected apps → MCP/AI clients (/api/mcp-tokens)
 * Styled to the shipped Mnema system (the connections `cc-*` language): flat,
 * bordered lists, mono meta, weight 500, 8px radii, amber accent, green status.
 */

const SCOPE_LABEL: Record<string, string> = { read: 'read', write: 'write', tasks: 'tasks' };
const EXPIRY_CHOICES = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
  { label: 'Never', days: null },
];
const DAY = 86_400_000;

type Cred = {
  id: string;
  name: string;
  prefix?: string | null;
  scopes: string[];
  created: string | null;
  lastUsed: string | null;
  expires: string | null;
};

// Read either camelCase or snake_case so this works regardless of which token
// list-endpoint casing is deployed.
function pick(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) { const v = o[k]; if (v != null) return String(v); }
  return null;
}
// Coerce an API response to an array whether it's a bare array or wrapped in
// { <key>: [...] }. Guards against reading `.keys`/`.tokens` off a bare array.
function asArray(v: unknown, key: string): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    const inner = (v as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return [];
}
function normalize(o: Record<string, unknown>): Cred {
  return {
    id: String(o.id),
    name: String(o.name ?? 'Untitled'),
    prefix: pick(o, 'prefix', 'key_prefix'),
    scopes: Array.isArray(o.scopes) ? (o.scopes as string[]) : [],
    created: pick(o, 'created_at', 'createdAt'),
    lastUsed: pick(o, 'last_used_at', 'lastUsedAt'),
    expires: pick(o, 'expires_at', 'expiresAt'),
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function relTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function expiry(iso: string | null): { label: string; tone: 'ok' | 'soon' | 'stale' | 'none' } {
  if (!iso) return { label: 'no expiry', tone: 'none' };
  const days = Math.round((new Date(iso).getTime() - Date.now()) / DAY);
  if (Number.isNaN(days)) return { label: 'no expiry', tone: 'none' };
  if (days < 0) return { label: 'expired', tone: 'stale' };
  if (days <= 14) return { label: `${days}d left`, tone: 'soon' };
  return { label: `${days}d left`, tone: 'ok' };
}

async function jfetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function AccessCenter() {
  const [keys, setKeys] = useState<Cred[]>([]);
  const [apps, setApps] = useState<Cred[]>([]);
  const [tab, setTab] = useState<'keys' | 'apps'>('keys');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [k, a] = await Promise.all([
        jfetch<unknown>('/api/api-keys').catch(() => []),
        jfetch<unknown>('/api/mcp-tokens').catch(() => ({ tokens: [] })),
      ]);
      // Endpoints differ in shape: /api/api-keys returns a bare array, while
      // /api/mcp-tokens returns { tokens: [...] }. Coerce both to an array —
      // never read `.keys`/`.tokens` off a bare array (an array's `.keys` is
      // Array.prototype.keys, a function, so `?? []` never fires → the old
      // `(k.keys ?? []).map` threw "map is not a function").
      setKeys(asArray(k, 'keys').map((x) => normalize(x as Record<string, unknown>)));
      setApps(asArray(a, 'tokens').map((x) => normalize(x as Record<string, unknown>)));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const posture = useMemo(() => {
    const all = [...keys, ...apps];
    const noExpiry = all.filter((c) => !c.expires).length;
    const stale = all.filter((c) => c.lastUsed && Date.now() - new Date(c.lastUsed).getTime() > 90 * DAY).length;
    const soon = all.filter((c) => { const e = expiry(c.expires); return e.tone === 'soon'; }).length;
    return { total: all.length, noExpiry, stale, soon };
  }, [keys, apps]);

  const revokeKey = async (id: string) => { await jfetch(`/api/api-keys/${id}`, { method: 'DELETE' }); load(); };
  const revokeApp = async (id: string) => { await jfetch(`/api/mcp-tokens/${id}`, { method: 'DELETE' }); load(); };
  const [rotated, setRotated] = useState<{ name: string; plaintext: string } | null>(null);
  const rotateKey = async (id: string, name: string) => {
    if (!confirm(`Rotate "${name}"? A new key is issued now; the old one keeps working for 1 hour so you can swap it in, then expires.`)) return;
    const res = await jfetch<{ plaintext: string }>(`/api/api-keys/${id}/rotate`, { method: 'POST' });
    setRotated({ name, plaintext: res.plaintext });
    load();
  };
  const [revoking, setRevoking] = useState(false);
  const revokeAll = async () => {
    if (!confirm('Revoke EVERY credential — API keys and connected apps? Anything still using this workspace must re-authenticate.')) return;
    setRevoking(true);
    try { await jfetch('/api/access/revoke-all', { method: 'POST' }); load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'Failed'); } finally { setRevoking(false); }
  };

  return (
    <div className="ac">
      <style>{styles}</style>

      <div className="ac-pre">Settings</div>
      <h1 className="ac-h1">Access</h1>
      <p className="ac-sub">Everything that can reach this workspace — API keys and connected apps — in one place to see, date, and revoke.</p>

      <div className="ac-top">
        <div className="ac-with"><b>{posture.total}</b><span>{posture.total === 1 ? 'credential' : 'credentials'} with access</span></div>
        <button className="ac-btn dang" onClick={revokeAll} disabled={revoking || posture.total === 0}>
          <Icon d="M18 6 6 18M6 6l12 12" />{revoking ? 'Revoking…' : 'Revoke everything'}
        </button>
      </div>

      {posture.total > 0 && (posture.noExpiry + posture.stale + posture.soon > 0) && (
        <div className="ac-posture">
          <span className="ac-dot" />
          <div className="ac-msg"><b>{posture.noExpiry + posture.stale + posture.soon} thing{posture.noExpiry + posture.stale + posture.soon === 1 ? '' : 's'} worth a look.</b></div>
          <div className="ac-pflags">
            {posture.stale > 0 && <span className="ac-pflag"><span className="n">{posture.stale}</span> unused 90+ days</span>}
            {posture.soon > 0 && <span className="ac-pflag"><span className="n">{posture.soon}</span> expiring soon</span>}
            <span className={`ac-pflag ${posture.noExpiry === 0 ? 'ok' : ''}`}><span className="n">{posture.noExpiry}</span> without expiry</span>
          </div>
        </div>
      )}

      <div className="ac-tabs" role="tablist">
        <button className="ac-tab" role="tab" aria-selected={tab === 'keys'} onClick={() => setTab('keys')}>API keys <span className="c">{keys.length}</span></button>
        <button className="ac-tab" role="tab" aria-selected={tab === 'apps'} onClick={() => setTab('apps')}>Connected apps <span className="c">{apps.length}</span></button>
      </div>

      {err && <p className="ac-err">{err} <button onClick={load}>Retry</button></p>}
      {loading ? <p className="ac-loading">Loading…</p> : tab === 'keys'
        ? <KeysTab keys={keys} onRevoke={revokeKey} onRotate={rotateKey} onCreated={load} />
        : <AppsTab apps={apps} onRevoke={revokeApp} />}

      {rotated && <RotatedReveal name={rotated.name} plaintext={rotated.plaintext} onClose={() => setRotated(null)} />}

      <div className="ac-danger">
        <div className="ac-dpre">Danger zone</div>
        <div className="ac-drow">
          <div><h3>Revoke everything</h3><p>Immediately kills every API key and connected app. Anything still using this workspace must re-authenticate.</p></div>
          <button className="ac-btn dang" onClick={revokeAll} disabled={revoking || posture.total === 0}>Revoke everything</button>
        </div>
      </div>
    </div>
  );
}

// ─── API keys tab ─────────────────────────────────────────────────────────────
function KeysTab({ keys, onRevoke, onRotate, onCreated }: { keys: Cred[]; onRevoke: (id: string) => void; onRotate: (id: string, name: string) => void; onCreated: () => void }) {
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <div className="ac-lead-row">
        <p className="ac-lead">REST keys (<code>mnema_api_…</code>) for scripts &amp; server-to-server. Shown once at creation — we store only a hash.</p>
        {!creating && <button className="ac-btn pri" onClick={() => setCreating(true)}><Icon d="M12 5v14M5 12h14" sw={2.4} />New key</button>}
      </div>
      {creating && <CreateKey onDone={() => { setCreating(false); onCreated(); }} onCancel={() => setCreating(false)} />}
      {keys.length === 0 && !creating
        ? <div className="ac-empty">No API keys yet. Create one for a script or server integration.</div>
        : <div className="ac-list">{keys.map((k) => <Row key={k.id} cred={k} kind="key" onRevoke={() => onRevoke(k.id)} onRotate={() => onRotate(k.id, k.name)} />)}</div>}
    </section>
  );
}

// Reveal for a rotated key — the new plaintext, shown once.
function RotatedReveal({ name, plaintext, onClose }: { name: string; plaintext: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const copy = () => void navigator.clipboard.writeText(plaintext).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <div className="ac-modal-scrim" onClick={(e) => { if (e.target === e.currentTarget && ack) onClose(); }}>
      <div className="ac-modal">
        <h3>Rotated “{name}”</h3>
        <p className="hint">A fresh key is live now. The old one keeps working for <b>1 hour</b>, then expires — swap this in before then.</p>
        <div className="ac-reveal" style={{ marginTop: 0 }}>
          <div className="rl"><Icon d="M20 6 9 17l-5-5" sw={2.2} w={12} />New key — copy it now</div>
          <div className="kv"><code>{plaintext}</code><button className="ac-btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
          <label className="ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've saved this key somewhere secure</label>
        </div>
        <div className="ac-cta"><button className="ac-btn pri" disabled={!ack} onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function CreateKey({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [days, setDays] = useState<number | null>(90);
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (s: string) => setScopes((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
  const create = async () => {
    if (!name.trim()) { setError('Give the key a name.'); return; }
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { name: name.trim(), scopes };
      if (days) body.expiresAt = new Date(Date.now() + days * DAY).toISOString();
      const res = await jfetch<{ plaintext: string }>('/api/api-keys', { method: 'POST', body: JSON.stringify(body) });
      setPlain(res.plaintext);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to create'); } finally { setBusy(false); }
  };
  const copy = () => { if (plain) { void navigator.clipboard.writeText(plain).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); } };

  if (plain) {
    return (
      <div className="ac-create">
        <div className="ac-reveal">
          <div className="rl"><Icon d="M20 6 9 17l-5-5" sw={2.2} w={12} />Key created — copy it now</div>
          <div className="kv"><code>{plain}</code><button className="ac-btn sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
          <label className="ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I've saved this key somewhere secure</label>
        </div>
        <div className="ac-cta"><button className="ac-btn pri" disabled={!ack} onClick={onDone}>Done</button></div>
      </div>
    );
  }
  return (
    <div className="ac-create">
      <h3>New API key</h3>
      <p className="hint">Grants a script access to this workspace. Copy it once — we can't show it again.</p>
      <div className="fld"><label>Name</label><input className="ac-in" value={name} placeholder="CI — nightly export" onChange={(e) => setName(e.target.value)} /></div>
      <div className="fld"><label>Scope</label>
        <div className="ac-scopes">{['read', 'write', 'tasks'].map((s) => (
          <button key={s} type="button" className={`ac-scope ${scopes.includes(s) ? s : 'off'}`} onClick={() => toggle(s)}>{SCOPE_LABEL[s]}</button>
        ))}</div>
      </div>
      <div className="fld"><label>Expires</label>
        <div className="ac-seg">{EXPIRY_CHOICES.map((c) => (
          <button key={c.label} type="button" className={c.days == null ? 'never' : ''} aria-pressed={days === c.days} onClick={() => setDays(c.days)}>{c.label}</button>
        ))}</div>
        {days == null && <div className="never-note">A key with no expiry is a permanent credential. We recommend 90 days.</div>}
      </div>
      {error && <p className="ac-inline-err">{error}</p>}
      <div className="ac-cta"><button className="ac-btn ghost" onClick={onCancel}>Cancel</button><button className="ac-btn pri" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create key'}</button></div>
    </div>
  );
}

// ─── Connected apps tab ───────────────────────────────────────────────────────
function AppsTab({ apps, onRevoke }: { apps: Cred[]; onRevoke: (id: string) => void }) {
  return (
    <section>
      <p className="ac-lead">AI clients connected over OAuth or a bearer token. One live credential per app — reconnecting replaces it, never stacks.</p>
      {apps.length === 0
        ? <div className="ac-empty">No apps connected. In your client's connector settings, paste <code>api.theboringpeople.in/mcp</code> and sign in.</div>
        : <div className="ac-list">{apps.map((a) => <Row key={a.id} cred={a} kind="app" onRevoke={() => onRevoke(a.id)} />)}</div>}
      <p className="ac-foot">To connect a new app: open its connector settings, paste <code>api.theboringpeople.in/mcp</code>, and sign in — the token is issued automatically.</p>
    </section>
  );
}

// ─── Shared row ───────────────────────────────────────────────────────────────
function Row({ cred, kind, onRevoke, onRotate }: { cred: Cred; kind: 'key' | 'app'; onRevoke: () => void; onRotate?: () => void }) {
  const e = expiry(cred.expires);
  const initials = cred.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || 'Ap';
  return (
    <div className="ac-row">
      <div className="ac-main">
        <div className="ac-rtop">
          {kind === 'app' && <span className="ac-cico">{initials}</span>}
          <span className="ac-name">{cred.name}</span>
          {cred.prefix && <span className="ac-prefix">{cred.prefix}…</span>}
        </div>
        {cred.scopes.length > 0 && <div className="ac-scopes small">{cred.scopes.map((s) => {
          const base = s.split(':')[0]; const cls = base === 'read' ? 'read' : base === 'write' || base === 'docs' ? 'write' : base === 'tasks' || base === 'flows' ? 'tasks' : 'off';
          return <span key={s} className={`ac-scope ${cls}`}>{s}</span>;
        })}</div>}
        <div className="ac-meta">
          <span><span className="k">{kind === 'app' ? 'Connected' : 'Created'}</span><span className="v">{fmtDate(cred.created)}</span></span>
          <span><span className="k">{kind === 'app' ? 'Last active' : 'Last used'}</span><span className="v">{relTime(cred.lastUsed)}</span></span>
        </div>
      </div>
      <div className="ac-right">
        <span className={`ac-exp ${e.tone}`}><span className="pip" />{e.label}</span>
        {onRotate && <button className="ac-btn ghost sm" onClick={onRotate}>Rotate</button>}
        <button className="ac-btn dang sm" onClick={onRevoke}>{kind === 'app' ? 'Disconnect' : 'Revoke'}</button>
      </div>
    </div>
  );
}

function Icon({ d, sw = 2, w = 13 }: { d: string; sw?: number; w?: number }) {
  return <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

const styles = `
.ac{max-width:760px;}
.ac-pre{font:500 10.5px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:12px;}
.ac-h1{margin:0 0 8px;font:500 26px/1.05 var(--sans);letter-spacing:-.02em;color:var(--ink);}
.ac-sub{margin:0 0 26px;font:400 14px/1.6 var(--sans);color:var(--ink-soft);max-width:44rem;}
.ac-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap;}
.ac-with{display:flex;align-items:baseline;gap:9px;}
.ac-with b{font:600 22px/1 var(--mono);color:var(--ink);}
.ac-with span{font:400 12.5px/1 var(--sans);color:var(--ink-muted);}
.ac-btn{font:500 12px/1 var(--sans);border-radius:8px;padding:9px 12px;cursor:pointer;border:1px solid var(--line-strong);background:var(--surface-2);color:var(--ink);display:inline-flex;align-items:center;gap:7px;transition:background .12s,border-color .12s;}
.ac-btn:hover{background:var(--surface-3);}
.ac-btn:disabled{opacity:.5;cursor:not-allowed;}
.ac-btn svg{width:13px;height:13px;}
.ac-btn.pri{background:var(--accent);color:var(--on-ink);border-color:var(--accent);}
.ac-btn.pri:hover{background:color-mix(in oklab,var(--accent) 88%,white);}
.ac-btn.dang{background:transparent;color:var(--status-warn);border-color:rgba(255,122,138,.28);}
.ac-btn.dang:hover{background:rgba(255,122,138,.1);}
.ac-btn.ghost{background:transparent;border-color:transparent;color:var(--ink-muted);}
.ac-btn.ghost:hover{background:var(--surface-2);color:var(--ink);}
.ac-btn.sm{padding:6px 9px;font-size:11.5px;}
.ac-posture{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(245,166,35,.26);background:rgba(245,166,35,.06);border-radius:8px;margin-bottom:24px;flex-wrap:wrap;}
.ac-posture .ac-dot{width:7px;height:7px;border-radius:50%;background:#F5A623;flex:none;}
.ac-posture .ac-msg{font:400 13px/1.4 var(--sans);color:var(--ink-soft);flex:1;min-width:160px;}
.ac-posture .ac-msg b{color:var(--ink);font-weight:500;}
.ac-pflags{display:flex;gap:14px;flex-wrap:wrap;}
.ac-pflag{font:400 12px/1 var(--sans);color:var(--ink-muted);display:inline-flex;align-items:center;gap:6px;}
.ac-pflag .n{font:500 12px/1 var(--mono);color:var(--ink-soft);}
.ac-pflag.ok .n{color:var(--status-sync);}
.ac-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:20px;}
.ac-tab{appearance:none;background:none;border:none;cursor:pointer;color:var(--ink-muted);font:500 12.5px/1 var(--sans);padding:10px 12px;position:relative;display:flex;align-items:center;gap:7px;}
.ac-tab .c{font:500 10.5px/1 var(--mono);color:var(--ink-muted);background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:1px 6px;}
.ac-tab[aria-selected="true"]{color:var(--ink);}
.ac-tab[aria-selected="true"] .c{color:var(--ink-soft);}
.ac-tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:var(--accent);border-radius:2px;}
.ac-lead-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;}
.ac-lead{margin:0;font:400 12.5px/1.5 var(--sans);color:var(--ink-muted);max-width:46rem;}
.ac-lead code,.ac-foot code,.ac-empty code{font-family:var(--mono);font-size:11.5px;background:var(--surface-3);border-radius:4px;padding:1px 5px;color:var(--ink-soft);}
.ac-list{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);}
.ac-row{display:grid;grid-template-columns:1fr auto;gap:8px 16px;align-items:center;padding:13px 15px;border-bottom:1px solid var(--line);}
.ac-row:last-child{border-bottom:0;}
.ac-row:hover{background:rgba(255,255,255,.015);}
.ac-main{min-width:0;}
.ac-rtop{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.ac-name{font:500 13px/1 var(--sans);color:var(--ink);}
.ac-prefix{font:400 11.5px/1 var(--mono);color:var(--ink-muted);background:var(--surface-2);border:1px solid var(--line);border-radius:5px;padding:3px 6px;}
.ac-cico{width:26px;height:26px;border-radius:6px;background:var(--surface-2);border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;font:600 10.5px/1 var(--mono);color:var(--ink-soft);flex:none;}
.ac-meta{margin-top:8px;display:flex;gap:18px;flex-wrap:wrap;}
.ac-meta > span{display:inline-flex;gap:6px;align-items:baseline;}
.ac-meta .k{font:500 9.5px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);}
.ac-meta .v{font:400 12px/1 var(--mono);color:var(--ink-soft);}
.ac-right{display:flex;align-items:center;gap:8px;}
.ac-scopes{display:flex;gap:5px;flex-wrap:wrap;}
.ac-scopes.small{margin-top:9px;}
.ac-scope{font:500 9.5px/1 var(--mono);letter-spacing:.05em;text-transform:uppercase;border-radius:4px;padding:5px 7px;border:1px solid var(--line-strong);background:transparent;color:var(--ink-muted);cursor:pointer;}
.ac-scope.read{color:#7C9CFF;border-color:rgba(124,156,255,.3);background:rgba(124,156,255,.1);}
.ac-scope.write{color:var(--accent);border-color:var(--accent-line,rgba(255,179,112,.32));background:rgba(255,179,112,.12);}
.ac-scope.tasks{color:var(--status-sync);border-color:rgba(107,227,155,.3);background:rgba(107,227,155,.1);}
.ac-scope.off{opacity:.75;}
.ac-exp{font:400 11.5px/1 var(--mono);display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:var(--ink-soft);}
.ac-exp .pip{width:6px;height:6px;border-radius:50%;background:var(--status-sync);}
.ac-exp.soon{color:var(--status-warn);}.ac-exp.soon .pip{background:var(--status-warn);}
.ac-exp.stale{color:var(--ink-muted);}.ac-exp.stale .pip{background:var(--ink-faint);}
.ac-exp.none{color:var(--ink-muted);}.ac-exp.none .pip{background:var(--ink-faint);}
.ac-empty{border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:22px;font:400 13px/1.6 var(--sans);color:var(--ink-muted);text-align:center;}
.ac-foot{margin-top:12px;font:400 12px/1.6 var(--sans);color:var(--ink-muted);}
.ac-loading{font:400 13px var(--sans);color:var(--ink-muted);padding:16px 0;}
.ac-err{font:400 12.5px var(--sans);color:var(--status-warn);}
.ac-err button{all:unset;cursor:pointer;color:var(--ink-soft);text-decoration:underline;margin-left:6px;}
.ac-inline-err{font:400 12px var(--sans);color:var(--status-warn);margin:0 0 10px;}
.ac-create{border:1px solid var(--accent-line,rgba(255,179,112,.32));background:var(--surface);border-radius:8px;padding:16px 18px;margin-bottom:14px;}
.ac-create h3{margin:0 0 3px;font:500 13.5px/1 var(--sans);color:var(--ink);}
.ac-create .hint{margin:0 0 14px;font:400 12px/1.5 var(--sans);color:var(--ink-muted);}
.ac-create .fld{margin-bottom:14px;}
.ac-create .fld>label{display:block;font:500 9.5px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:7px;}
.ac-in{width:100%;box-sizing:border-box;background:var(--canvas);border:1px solid var(--line);border-radius:7px;padding:9px 11px;color:var(--ink);font:400 13px var(--sans);outline:none;}
.ac-in:focus{border-color:var(--accent-line,rgba(255,179,112,.32));}
.ac-seg{display:inline-flex;background:var(--canvas);border:1px solid var(--line);border-radius:7px;padding:3px;}
.ac-seg button{all:unset;cursor:pointer;font:500 12px/1 var(--mono);padding:7px 11px;border-radius:5px;color:var(--ink-muted);}
.ac-seg button[aria-pressed="true"]{background:var(--surface-3);color:var(--ink);}
.ac-seg button.never{color:var(--ink-faint);}
.never-note{margin-top:8px;font:400 11px/1.5 var(--sans);color:var(--ink-faint);}
.ac-cta{display:flex;justify-content:flex-end;gap:8px;}
.ac-reveal{padding:14px 16px;border:1px solid rgba(107,227,155,.24);background:rgba(107,227,155,.06);border-radius:8px;margin-bottom:14px;}
.ac-reveal .rl{font:500 10px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--status-sync);margin-bottom:9px;display:flex;align-items:center;gap:7px;}
.ac-reveal .kv{display:flex;gap:8px;}
.ac-reveal code{flex:1;min-width:0;font:400 12px/1.5 var(--mono);color:var(--ink);background:var(--canvas);border:1px solid var(--line);border-radius:6px;padding:10px 12px;overflow-x:auto;white-space:nowrap;}
.ac-reveal .ack{margin-top:10px;font:400 12px/1 var(--sans);color:var(--ink-soft);display:flex;align-items:center;gap:7px;}
.ac-modal-scrim{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,6,7,.6);backdrop-filter:blur(3px);}
.ac-modal{width:min(480px,94vw);background:var(--surface);border:1px solid var(--line-strong);border-radius:12px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.6);}
.ac-modal h3{margin:0 0 3px;font:500 15px/1.3 var(--sans);color:var(--ink);}
.ac-modal .hint{margin:0 0 14px;font:400 12.5px/1.5 var(--sans);color:var(--ink-muted);}
.ac-modal .hint b{color:var(--ink-soft);font-weight:500;}
.ac-danger{margin-top:44px;padding:20px 0 0;border-top:1px solid rgba(255,122,138,.2);background:linear-gradient(180deg,rgba(255,122,138,.03),transparent 60%);}
.ac-dpre{font:500 10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--status-warn);margin-bottom:12px;}
.ac-drow{display:flex;align-items:center;justify-content:space-between;gap:16px;}
.ac-danger h3{margin:0 0 3px;font:500 13.5px/1.3 var(--sans);color:var(--ink);}
.ac-danger p{margin:0;font:400 12.5px/1.5 var(--sans);color:var(--ink-muted);max-width:38rem;}
@media (max-width:560px){.ac-row{grid-template-columns:1fr;}.ac-right{justify-content:flex-start;}}
`;
