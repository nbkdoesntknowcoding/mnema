/**
 * OAuth consent screen HTML.
 *
 * Rendered server-side as a raw HTML string from the authorize route
 * when the user needs to grant or review access. Styled to match the
 * Mnema design system (dark surface, Geist Sans).
 */
import type { FastifyReply } from 'fastify';
import { scopeLabel, parseScopes } from './scopes.js';

interface ConsentParams {
  requestId: string;
  clientName: string;
  userEmail: string;
  scope: string;
  resource: string | null | undefined;
  workspaces: Array<{ id: string; name: string; slug: string; role: string }>;
}

const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);

export function renderConsentScreen(reply: FastifyReply, params: ConsentParams): void {
  const { requestId, clientName, userEmail, scope, workspaces } = params;
  const scopeList = parseScopes(scope).filter((s) => s !== 'offline_access');
  const requestsWrite = scopeList.includes('workspace:write');

  const workspaceOptions = workspaces
    .map(
      (ws, i) =>
        `<label class="ws-option">
          <input type="radio" name="workspace_id" value="${esc(ws.id)}" data-role="${esc(ws.role)}" ${i === 0 ? 'checked' : ''} required>
          <span class="ws-name">${esc(ws.name)}</span>
          <span class="ws-slug">@${esc(ws.slug)}</span>
          <span class="ws-role${WRITE_ROLES.has(ws.role) ? '' : ' ws-role-viewer'}">${esc(ws.role)}</span>
        </label>`,
    )
    .join('');

  // Build scope items; tag the write item so JS can show/hide it per workspace
  const scopeItems = scopeList
    .map((s) => {
      const isWrite = s === 'workspace:write';
      return `<li class="scope-item${isWrite ? ' scope-write-item' : ''}" ${isWrite ? 'id="scope-write-item"' : ''}><span class="scope-dot">●</span>${esc(scopeLabel(s))}</li>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize — Mnema</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --surface: #0f0f0f;
      --surface-2: #1a1a1a;
      --border: #2a2a2a;
      --ink: #f0f0f0;
      --ink-muted: #888;
      --accent: #6366f1;
      --accent-hover: #818cf8;
      --danger: #ef4444;
    }
    body {
      background: var(--surface);
      color: var(--ink);
      font-family: 'Geist', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 420px;
    }
    .logo { font-size: 1.1rem; font-weight: 600; margin-bottom: 1.5rem; color: var(--ink); letter-spacing: -0.02em; }
    .logo span { color: var(--ink-muted); font-weight: 400; }
    h1 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.3rem; }
    .client-name { font-family: 'Geist Mono', monospace; font-size: 0.85rem; color: var(--accent); }
    .user-tag { font-size: 0.8rem; color: var(--ink-muted); margin-bottom: 1.5rem; margin-top: 0.4rem; }
    .section-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-muted); margin-bottom: 0.5rem; }
    .scope-list { list-style: none; margin-bottom: 1.5rem; }
    .scope-item { font-size: 0.875rem; padding: 0.35rem 0; display: flex; gap: 0.5rem; align-items: baseline; }
    .scope-dot { color: var(--accent); font-size: 0.5rem; flex-shrink: 0; }
    .ws-options { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .ws-option { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 0.875rem; transition: border-color 0.15s; }
    .ws-option:has(input:checked) { border-color: var(--accent); }
    .ws-option input { accent-color: var(--accent); }
    .ws-name { font-weight: 500; }
    .ws-slug { color: var(--ink-muted); font-size: 0.8rem; }
    .ws-role { font-size: 0.7rem; color: var(--ink-muted); margin-left: auto; background: #2a2a2a; padding: 0.15rem 0.4rem; border-radius: 4px; }
    .ws-role-viewer { color: #f59e0b; background: rgba(245,158,11,0.1); }
    .viewer-note { font-size: 0.78rem; color: #f59e0b; margin-bottom: 0.75rem; display: none; padding: 0.4rem 0.6rem; background: rgba(245,158,11,0.08); border-radius: 6px; border: 1px solid rgba(245,158,11,0.2); }
    .actions { display: flex; gap: 0.75rem; }
    .btn-approve { flex: 1; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0.65rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    .btn-approve:hover { background: var(--accent-hover); }
    .btn-deny { flex: 0 0 auto; background: transparent; color: var(--ink-muted); border: 1px solid var(--border); border-radius: 8px; padding: 0.65rem 1rem; font-size: 0.875rem; cursor: pointer; transition: border-color 0.15s; }
    .btn-deny:hover { border-color: var(--danger); color: var(--danger); }
    .divider { border: none; border-top: 1px solid var(--border); margin: 1.25rem 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">mnema <span>/ authorize</span></div>
    <h1><span class="client-name">${esc(clientName)}</span> wants access</h1>
    <p class="user-tag">Signed in as ${esc(userEmail)}</p>

    <form method="POST" action="/oauth/authorize/approve">
      <input type="hidden" name="request_id" value="${esc(requestId)}">
      <input type="hidden" id="scope-input" name="scope" value="${esc(scope)}">
      ${requestsWrite ? `<div class="viewer-note" id="viewer-note">⚠ Viewer role — write access will not be granted for this workspace.</div>` : ''}

      <div class="section-label">Permissions</div>
      <ul class="scope-list">${scopeItems}</ul>

      <hr class="divider">

      <div class="section-label">Choose workspace</div>
      <div class="ws-options">${workspaceOptions}</div>

      <div class="actions">
        <button type="submit" class="btn-approve">Approve</button>
        <button type="button" class="btn-deny" onclick="deny()">Deny</button>
      </div>
    </form>
  </div>
  <script>
    function deny() {
      const f = document.createElement('form');
      f.method = 'POST';
      f.action = '/oauth/authorize/deny';
      const inp = document.createElement('input');
      inp.type = 'hidden'; inp.name = 'request_id'; inp.value = '${esc(requestId)}';
      f.appendChild(inp);
      document.body.appendChild(f);
      f.submit();
    }

    ${requestsWrite ? `
    // Phase 9.1: dynamically strip workspace:write from the submitted scope
    // when the selected workspace role is viewer.
    var FULL_SCOPE = ${JSON.stringify(scope)};
    var WRITE_ROLES = ['owner','admin','editor'];
    function updateScopeForRole() {
      var checked = document.querySelector('input[name="workspace_id"]:checked');
      if (!checked) return;
      var role = checked.getAttribute('data-role') || 'viewer';
      var isWriter = WRITE_ROLES.indexOf(role) !== -1;
      var parts = FULL_SCOPE.split(' ').filter(Boolean);
      if (!isWriter) parts = parts.filter(function(s){ return s !== 'workspace:write'; });
      document.getElementById('scope-input').value = parts.join(' ');
      var writeItem = document.getElementById('scope-write-item');
      var viewerNote = document.getElementById('viewer-note');
      if (writeItem) writeItem.style.display = isWriter ? '' : 'none';
      if (viewerNote) viewerNote.style.display = isWriter ? 'none' : '';
    }
    document.querySelectorAll('input[name="workspace_id"]').forEach(function(r){
      r.addEventListener('change', updateScopeForRole);
    });
    updateScopeForRole();
    ` : ''}
  </script>
</body>
</html>`;

  reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
}

interface LoginPageParams {
  requestId: string;
  loginUrl: string;
}

export function renderLoginPage(reply: FastifyReply, params: LoginPageParams): void {
  const { requestId, loginUrl } = params;
  const workosLoginUrl = loginUrl; // alias for template use

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — Mnema</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --surface: #0f0f0f;
      --surface-2: #1a1a1a;
      --border: #2a2a2a;
      --ink: #f0f0f0;
      --ink-muted: #888;
      --accent: #6366f1;
      --accent-hover: #818cf8;
    }
    body {
      background: var(--surface);
      color: var(--ink);
      font-family: 'Geist', system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 380px;
      text-align: center;
    }
    .logo {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--ink);
      letter-spacing: -0.02em;
      margin-bottom: 0.25rem;
    }
    .logo span { color: var(--ink-muted); font-weight: 400; }
    .tagline {
      font-size: 0.8rem;
      color: var(--ink-muted);
      margin-bottom: 2rem;
    }
    h1 {
      font-size: 1.05rem;
      font-weight: 600;
      margin-bottom: 0.4rem;
    }
    .sub {
      font-size: 0.825rem;
      color: var(--ink-muted);
      margin-bottom: 1.75rem;
      line-height: 1.5;
    }
    .btn-signin {
      display: block;
      width: 100%;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.7rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s;
      line-height: 1;
    }
    .btn-signin:hover { background: var(--accent-hover); }
    .divider { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
    .footer {
      font-size: 0.75rem;
      color: var(--ink-muted);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">mnema <span>/ connect</span></div>
    <p class="tagline">Your team's shared knowledge</p>

    <hr class="divider">

    <h1>Sign in to continue</h1>
    <p class="sub">You're connecting an external client to your Mnema workspace. Sign in to review and approve access.</p>

    <a class="btn-signin" href="${esc(workosLoginUrl)}">Continue with Mnema</a>

    <hr class="divider">
    <p class="footer">You'll be asked to choose a workspace after signing in.</p>
  </div>
</body>
</html>`;

  reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
}

export function renderErrorPage(reply: FastifyReply, opts: { error: string; description?: string }): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Error — Mnema OAuth</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #f0f0f0; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background: #1a1a1a; border:1px solid #2a2a2a; border-radius:12px; padding:2rem; max-width:380px; text-align:center; }
    h1 { font-size:1rem; margin-bottom:.5rem; color:#ef4444; }
    p { color:#888; font-size:.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorization error</h1>
    <p><strong>${esc(opts.error)}</strong>${opts.description ? ': ' + esc(opts.description) : ''}</p>
  </div>
</body>
</html>`;
  reply.header('Content-Type', 'text/html; charset=utf-8').status(400).send(html);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
