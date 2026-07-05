/**
 * Write-preview MCP App HTML bundle.
 *
 * ONE bundle for ALL write-preview operations. Rendered in a sandboxed iframe
 * when any propose_* tool returns. Shows the proposed change, the target name,
 * the operation, and Approve/Cancel buttons.
 *
 * On Approve: calls the tool named in structuredContent.commit_tool via
 *   app.callServerTool() — commit_doc_write, commit_trash_folder,
 *   commit_flow_publish.
 * On Cancel: posts a "Write cancelled by user." message and dismisses.
 *
 * Render switches on structuredContent.preview.kind:
 *   append, replace_section, replace_body, create, trash_doc → DOC WRITE
 *   flow_publish → FLOW PUBLISH
 *   trash_folder → FOLDER TRASH
 *
 * Design: Mnema dark theme with design tokens inlined (no external fetch).
 * CSP: no external origins, no CDN, no google fonts.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

function loadAppWithDeps(): string {
  try {
    const pkgPath = _require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
    return readFileSync(pkgPath, 'utf8');
  } catch (e) {
    return `console.error('ext-apps load failed: ${String(e)}');`;
  }
}

const APP_WITH_DEPS_JS = loadAppWithDeps();

// Cache so it is only built once.
let _html: string | null = null;

export function getWritePreviewHtml(): string {
  if (_html) return _html;

  _html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mnema Write Preview</title>
<style>
:root {
  --canvas:#0A0B0D; --surface:#121317; --surface-2:#181A1F; --surface-3:#22252B; --sunken:#050608;
  --line:rgba(255,255,255,0.06); --line-strong:rgba(255,255,255,0.12); --line-bright:rgba(255,255,255,0.22);
  --ink:#F4F5F7; --ink-soft:#B0B4BC; --ink-muted:#707479; --ink-faint:#3D4046;
  --accent-rgb:255,179,112; --accent:rgb(var(--accent-rgb));
  --accent-soft:rgba(var(--accent-rgb),0.14); --accent-line:rgba(var(--accent-rgb),0.32);
  --status-sync:#6BE39B; --status-edit:#FFB370; --status-info:#7C9CFF; --status-error:#FF7A8A;
  --on-accent:#1A0E04;
  --sans:"Geist",-apple-system,system-ui,sans-serif;
  --mono:"Geist Mono",ui-monospace,Menlo,Consolas,monospace;
}
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
body { background:var(--canvas); color:var(--ink); font-family:var(--sans); font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
button { font-family:inherit; color:inherit; cursor:pointer; }

.m-card { background:var(--canvas); color:var(--ink); overflow:hidden; }
.m-head { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-bottom:1px solid var(--line); background:var(--surface); min-height:48px; }
.m-head .left { display:flex; align-items:center; gap:12px; min-width:0; }
.m-head .glyph { width:22px; height:22px; border-radius:6px; background:var(--ink); color:var(--canvas); display:inline-flex; align-items:center; justify-content:center; font:500 14px/1 var(--sans); padding-bottom:1px; position:relative; flex-shrink:0; }
.m-head .glyph::after { content:""; position:absolute; inset:0; border-radius:inherit; background:linear-gradient(135deg,rgba(255,255,255,0.18),transparent 50%); }
.m-head .sep { width:1px; height:14px; background:var(--line-strong); }
.m-head .tool { font:500 11px/1 var(--mono); color:var(--ink-soft); letter-spacing:0.04em; }
.m-head .tool .args { color:var(--ink-muted); }
.m-head .meta { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); display:inline-flex; align-items:center; gap:8px; }
.pill { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:999px; font:500 10px/1 var(--mono); letter-spacing:0.04em; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-soft); }
.pill .dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
.pill.change { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-line); }
.pill.add { background:rgba(107,227,155,0.10); color:var(--status-sync); border-color:rgba(107,227,155,0.28); }
.pill.rm { background:rgba(255,122,138,0.10); color:var(--status-error); border-color:rgba(255,122,138,0.28); }
.pill.danger { background:rgba(255,122,138,0.10); color:var(--status-error); border-color:rgba(255,122,138,0.28); }
.m-body { padding:22px; background:var(--canvas); }
.m-foot { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-top:1px solid var(--line); background:var(--surface); }
.m-foot .left, .m-foot .right { display:flex; align-items:center; gap:8px; }
.btn { font:500 12.5px/1 var(--sans); padding:8px 13px; border-radius:6px; cursor:pointer; border:1px solid transparent; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; transition:background-color 140ms ease,border-color 140ms ease; }
.btn-primary { background:var(--accent); color:var(--on-accent); font-weight:600; border-color:var(--accent); }
.btn-primary:hover { filter:brightness(1.08); }
.btn-secondary { background:var(--surface-2); color:var(--ink); border-color:var(--line-strong); }
.btn-secondary:hover { background:var(--surface-3); border-color:var(--line-bright); }
.btn-ghost { background:transparent; color:var(--ink-soft); }
.btn-ghost:hover { color:var(--ink); background:var(--surface-2); }
.btn-danger { background:rgba(255,122,138,0.12); color:var(--status-error); border-color:rgba(255,122,138,0.30); font-weight:600; }
.btn-danger:hover { background:rgba(255,122,138,0.20); border-color:rgba(255,122,138,0.50); }
.btn[disabled] { opacity:0.4; cursor:not-allowed; }
.kbd-hint { font:500 10px/1 var(--mono); letter-spacing:0.04em; color:var(--ink-faint); display:inline-flex; align-items:center; gap:6px; }
.kbd-hint kbd { padding:2px 5px; border-radius:3px; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-muted); font:500 9.5px/1 var(--mono); }

/* DOC WRITE STYLES */
.dw-summary { display:flex; align-items:center; gap:14px; padding:16px 22px; border-bottom:1px solid var(--line); background:var(--surface); }
.dw-doc-icon { width:32px; height:38px; border-radius:5px; background:var(--surface-2); border:1px solid var(--line-strong); display:inline-flex; align-items:center; justify-content:center; color:var(--ink-muted); flex-shrink:0; position:relative; }
.dw-doc-icon::after { content:"MD"; position:absolute; right:-6px; bottom:-3px; font:700 7.5px/1 var(--mono); padding:2px 4px; border-radius:3px; background:var(--accent); color:var(--on-accent); letter-spacing:0.04em; }
.dw-summary .body { flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; }
.dw-summary .ttl { font:500 16px/1.2 var(--sans); color:var(--ink); letter-spacing:-0.01em; }
.dw-summary .path { font:400 11.5px/1.3 var(--mono); color:var(--ink-muted); }
.dw-summary .stats { display:inline-flex; gap:14px; font:500 11px/1 var(--mono); letter-spacing:0.04em; }
.dw-summary .stats .add { color:var(--status-sync); }
.dw-summary .stats .rm { color:var(--status-error); }
.dw-summary .stats .keep { color:var(--ink-muted); }
.dw-tabs { display:flex; gap:4px; padding:12px 22px 0; }
.dw-tab { font:500 11px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; padding:8px 11px; border-radius:5px 5px 0 0; color:var(--ink-muted); cursor:pointer; border:1px solid transparent; background:transparent; }
.dw-tab.active { color:var(--ink); background:var(--surface); border-color:var(--line); border-bottom-color:var(--surface); margin-bottom:-1px; }
.dw-tab:hover:not(.active) { color:var(--ink-soft); }
.dw-diff { border-radius:8px; overflow:hidden; background:var(--surface); border:1px solid var(--line); font:500 12.5px/1.6 var(--mono); }
.dw-diff-head { display:flex; justify-content:space-between; align-items:center; padding:9px 14px; background:var(--surface-2); border-bottom:1px solid var(--line); font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); }
.dw-diff-head .where { font:500 11px/1 var(--mono); color:var(--ink); letter-spacing:0.02em; text-transform:none; }
.dw-line { display:grid; grid-template-columns:36px 14px 1fr; align-items:stretch; }
.dw-line .ln { font:500 10.5px/1.7 var(--mono); color:var(--ink-faint); padding:2px 8px 2px 14px; text-align:right; user-select:none; }
.dw-line .sigil { font:600 13px/1.7 var(--mono); text-align:center; user-select:none; }
.dw-line .code { padding:2px 14px 2px 4px; white-space:pre-wrap; word-break:break-word; font:500 12.5px/1.7 var(--mono); color:var(--ink-soft); }
.dw-line.context { background:transparent; }
.dw-line.context .sigil { color:var(--ink-faint); }
.dw-line.add { background:rgba(107,227,155,0.05); }
.dw-line.add .ln { color:rgba(107,227,155,0.55); }
.dw-line.add .sigil { color:var(--status-sync); }
.dw-line.add .code { color:var(--ink); }
.dw-line.rm { background:rgba(255,122,138,0.05); }
.dw-line.rm .ln { color:rgba(255,122,138,0.55); }
.dw-line.rm .sigil { color:var(--status-error); }
.dw-line.rm .code { color:var(--ink-soft); text-decoration:line-through; text-decoration-color:rgba(255,122,138,0.5); }
.dw-line.hunk { background:var(--surface-3); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.dw-line.hunk .ln, .dw-line.hunk .code { color:var(--ink-muted); font-style:italic; }
.dw-line.hunk .code { padding-top:4px; padding-bottom:4px; }

/* FLOW PUBLISH STYLES */
.fp-versions { display:flex; align-items:center; gap:14px; padding:16px 22px; border-bottom:1px solid var(--line); background:var(--surface); }
.fp-versions .v-card { flex:1; display:flex; flex-direction:column; gap:6px; padding:12px 14px; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; }
.fp-versions .v-card.new { border-color:var(--accent-line); }
.fp-versions .v-card .top { display:flex; align-items:center; justify-content:space-between; }
.fp-versions .v-card .ver { font:500 11px/1 var(--mono); letter-spacing:0.04em; color:var(--ink); }
.fp-versions .v-card .ver.accent { color:var(--accent); }
.fp-versions .v-card .meta { font:500 10px/1 var(--mono); color:var(--ink-muted); letter-spacing:0.04em; text-transform:uppercase; }
.fp-versions .v-card .meta.accent { color:var(--accent); }
.fp-versions .v-card .who { font:400 12px/1.4 var(--sans); color:var(--ink-soft); }
.fp-versions .arrow-between { color:var(--ink-muted); }
.fp-stats { display:flex; gap:18px; padding:14px 22px; border-bottom:1px solid var(--line); background:var(--canvas); font:500 11px/1 var(--mono); letter-spacing:0.04em; text-transform:uppercase; }
.fp-stats .stat { display:inline-flex; align-items:center; gap:7px; color:var(--ink-muted); }
.fp-stats .stat .swatch { width:8px; height:8px; border-radius:2px; }
.fp-stats .stat .v { color:var(--ink); font-weight:600; }
.fp-stats .add .swatch { background:var(--status-sync); }
.fp-stats .rm .swatch { background:var(--status-error); }
.fp-stats .ch .swatch { background:var(--accent); }
.fp-stats .keep .swatch { background:var(--ink-faint); }
.fp-list { background:var(--canvas); }
.fp-list-head { display:flex; align-items:center; justify-content:space-between; padding:14px 22px 8px; }
.fp-list-head h6 { margin:0; font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); }
.fp-row { display:grid; grid-template-columns:60px 1fr; align-items:center; gap:14px; padding:11px 22px; border-top:1px solid var(--line); }
.fp-row:first-of-type { border-top:0; }
.fp-row:hover { background:var(--surface); }
.fp-row .sig { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; padding:3px 7px; border-radius:3px; display:inline-flex; align-items:center; gap:5px; width:max-content; }
.fp-row .sig.add { background:rgba(107,227,155,0.10); color:var(--status-sync); border:1px solid rgba(107,227,155,0.28); }
.fp-row .sig.rm { background:rgba(255,122,138,0.10); color:var(--status-error); border:1px solid rgba(255,122,138,0.28); }
.fp-row .sig.ch { background:var(--accent-soft); color:var(--accent); border:1px solid var(--accent-line); }
.fp-row .ttl-wrap { display:flex; flex-direction:column; gap:3px; min-width:0; }
.fp-row .ttl { font:500 13px/1.3 var(--sans); color:var(--ink); letter-spacing:-0.005em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fp-row.rm .ttl { color:var(--ink-soft); }
.fp-row .sub { font:400 11.5px/1.3 var(--mono); color:var(--ink-muted); }

/* FOLDER TRASH STYLES */
.ft-summary { display:flex; align-items:flex-start; gap:18px; padding:22px; }
.ft-folder { width:84px; height:64px; position:relative; flex-shrink:0; filter:drop-shadow(0 6px 14px rgba(0,0,0,0.45)); }
.ft-folder svg { display:block; }
.ft-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }
.ft-title { font:500 22px/1.2 var(--sans); letter-spacing:-0.02em; color:var(--ink); margin:0; }
.ft-path { font:500 12px/1 var(--mono); color:var(--ink-muted); }
.ft-lede { font:400 14px/1.5 var(--sans); color:var(--ink-soft); margin:0; }
.ft-impact { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:0 22px 22px; }
.ft-stat { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:4px; }
.ft-stat .num { font:600 28px/1 var(--sans); letter-spacing:-0.02em; color:var(--ink); }
.ft-stat .lbl { font:500 10.5px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); }
.ft-stat.warn { border-color:rgba(255,122,138,0.32); background:rgba(255,122,138,0.04); }
.ft-stat.warn .num { color:var(--status-error); }
.ft-callout { display:flex; align-items:center; gap:12px; padding:10px 14px; margin:0 22px 22px; background:rgba(255,122,138,0.06); border:1px solid rgba(255,122,138,0.20); border-radius:7px; }
.ft-callout svg { color:var(--status-error); flex-shrink:0; }
.ft-callout p { margin:0; font:500 12.5px/1.5 var(--sans); color:var(--ink); }
.ft-restore { display:flex; align-items:center; gap:10px; margin:0 22px 22px; font:400 12px/1.5 var(--sans); color:var(--ink-muted); }
.ft-restore svg { color:var(--ink-muted); flex-shrink:0; }

/* States */
.state-loading { padding:40px 22px; display:flex; flex-direction:column; gap:10px; }
.skel { border-radius:4px; background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; }
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.state-error { padding:22px; color:var(--status-error); font-size:13px; line-height:1.6; }
.state-success { padding:40px 22px; text-align:center; }
.state-success .ttl { font:500 20px/1.2 var(--sans); letter-spacing:-0.01em; color:var(--ink); margin-bottom:6px; }
.state-success .sub { font:400 13px var(--sans); color:var(--ink-muted); }
</style>
</head>
<body>
<div id="diag" style="font:500 11px/1.4 var(--sans,system-ui);color:#707479;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">Initializing…</div>
<div id="root">
  <div class="m-card">
    <div class="m-head">
      <div class="left">
        <span class="glyph">M</span>
        <span class="sep"></span>
        <span class="tool">loading<span class="args"></span></span>
      </div>
    </div>
    <div class="state-loading">
      <div class="skel" style="height:14px;width:60%;"></div>
      <div class="skel" style="height:14px;width:40%;"></div>
      <div class="skel" style="height:80px;width:100%;margin-top:8px;"></div>
    </div>
  </div>
</div>
<script>window.__sdk=${JSON.stringify(APP_WITH_DEPS_JS)};</script>
<script>
// All JS uses var + function syntax and string concatenation.
// NO backtick template literals — this runs inside an outer TS template literal.
// NOTE: classic <script> (not type="module") — MCP iframe sandbox blocks ES module scripts.

var ICO_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>';
var ICO_ARROW = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var ICO_TRASH = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
var ICO_FILE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
var ICO_FOLDER = '<svg width="84" height="64" viewBox="0 0 168 130">'
  + '<defs>'
  + '<linearGradient id="ftPaper" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#F5F5F5"/>'
  + '<stop offset="1" stop-color="#D6D6D6"/>'
  + '</linearGradient>'
  + '<linearGradient id="ftFront" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#5C5E64"/>'
  + '<stop offset="0.45" stop-color="#3E4046"/>'
  + '<stop offset="1" stop-color="#2C2E33"/>'
  + '</linearGradient>'
  + '</defs>'
  + '<g>'
  + '<path d="M48 16 L106 16 L116 26 L116 84 Q116 88 112 88 L48 88 Q44 88 44 84 L44 20 Q44 16 48 16 Z" fill="url(#ftPaper)"/>'
  + '<path d="M106 16 L116 26 L106 26 Z" fill="#B8B8B8"/>'
  + '</g>'
  + '<path d="M20 42 Q20 38 24 38 L62 38 Q66 38 67.5 35 L70 30 Q71.5 27 75 27 L148 27 Q152 27 152 31 L152 116 Q152 120 148 120 L24 120 Q20 120 20 116 Z" fill="url(#ftFront)"/>'
  + '</svg>';
var ICO_WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
var ICO_RESTORE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Diff line builder ─────────────────────────────────────────────────────────

function diffLine(type, lineNum, sigil, text) {
  return '<div class="dw-line ' + type + '">'
    + '<span class="ln">' + (lineNum ? esc(String(lineNum)) : '') + '</span>'
    + '<span class="sigil">' + esc(sigil) + '</span>'
    + '<span class="code">' + esc(text) + '</span>'
    + '</div>';
}

function buildDiff(rmLines, addLines, hunkLabel) {
  var html = '';
  html += diffLine('hunk', '', '@', '@@ ' + esc(hunkLabel) + ' @@');
  var i;
  for (i = 0; i < rmLines.length; i++) {
    html += diffLine('rm', i + 1, '−', rmLines[i]);
  }
  for (i = 0; i < addLines.length; i++) {
    html += diffLine('add', i + 1, '+', addLines[i]);
  }
  return html;
}

function buildAddDiff(addLines, hunkLabel) {
  var html = '';
  html += diffLine('hunk', '', '@', '@@ ' + esc(hunkLabel) + ' @@');
  for (var i = 0; i < addLines.length; i++) {
    html += diffLine('add', i + 1, '+', addLines[i]);
  }
  return html;
}

function splitLines(md) {
  if (!md) return [];
  return String(md).split('\\n');
}

// ── Doc Write renderer ────────────────────────────────────────────────────────

function renderDocWrite(preview, docId) {
  var kind = preview.kind;
  var docTitle = preview.doc_title || preview.title || 'Untitled';
  var docPath = preview.doc_path || '';
  var pathLine = docPath ? esc(docPath) + ' · ' + esc(docId) : esc(docId);

  // Determine mode arg for header
  var modeArg = 'edit';
  if (kind === 'create') modeArg = 'create';
  if (kind === 'trash_doc') modeArg = 'trash';

  // Build stats
  var addedCount = 0;
  var rmCount = 0;
  var keepCount = 0;
  var diffInner = '';
  var diffHeadWhere = '';

  if (kind === 'append') {
    var aLines = splitLines(preview.new_blocks_markdown);
    addedCount = aLines.length;
    diffHeadWhere = 'End of document';
    diffInner = buildAddDiff(aLines, 'New content');
  } else if (kind === 'replace_section') {
    var bLines = splitLines(preview.before_markdown);
    var afLines = splitLines(preview.after_markdown);
    rmCount = bLines.length;
    addedCount = afLines.length;
    keepCount = 0;
    diffHeadWhere = preview.section_heading || 'Section';
    diffInner = buildDiff(bLines, afLines, String(preview.section_heading || 'section'));
  } else if (kind === 'replace_body') {
    var bbLines = splitLines(preview.before_markdown);
    var abLines = splitLines(preview.after_markdown);
    rmCount = bbLines.length;
    addedCount = abLines.length;
    diffHeadWhere = 'Entire document';
    diffInner = buildDiff(bbLines, abLines, 'Entire document');
  } else if (kind === 'create') {
    var cLines = splitLines(preview.body_markdown);
    addedCount = cLines.length;
    diffHeadWhere = 'New document';
    diffInner = buildAddDiff(cLines, 'New document');
  }

  var statsHtml = '';
  if (kind !== 'trash_doc') {
    statsHtml = '<div class="stats">'
      + (addedCount > 0 ? '<span class="add">+' + addedCount + ' added</span>' : '')
      + (rmCount > 0 ? '<span class="rm">−' + rmCount + ' removed</span>' : '')
      + '<span class="keep">' + keepCount + ' unchanged</span>'
      + '</div>';
  }

  var summaryHtml = '<div class="dw-summary">'
    + '<div class="dw-doc-icon">' + ICO_FILE + '</div>'
    + '<div class="body">'
    + '<div class="ttl">' + esc(docTitle) + '</div>'
    + '<div class="path">' + pathLine + '</div>'
    + '</div>'
    + statsHtml
    + '</div>';

  var bodyHtml = '';
  if (kind === 'trash_doc') {
    bodyHtml = '<div class="m-body">'
      + '<div style="background:rgba(255,122,138,0.06);border:1px solid rgba(255,122,138,0.20);border-radius:7px;padding:14px 16px;margin-top:8px;">'
      + '<p style="margin:0;font:500 12.5px/1.5 var(--sans);color:var(--ink);">This document will be moved to trash. Restorable for 30 days.</p>'
      + '</div>'
      + '</div>';
  } else {
    var driftWarn = '';
    if (kind === 'replace_body' && preview.anchor_drift) {
      driftWarn = '<div style="background:rgba(255,179,112,0.08);border:1px solid var(--accent-line);border-radius:6px;padding:10px 12px;margin-bottom:14px;font:500 12px/1.5 var(--sans);color:var(--accent);">This replaces the entire document.</div>';
    }

    var tabsHtml = '<div class="dw-tabs">'
      + '<button class="dw-tab active">Diff</button>'
      + '<button class="dw-tab">Proposed</button>'
      + '<button class="dw-tab">Current</button>'
      + '</div>';

    var diffBlock = '<div class="dw-diff">'
      + '<div class="dw-diff-head">'
      + '<span class="where">' + esc(diffHeadWhere) + '</span>'
      + '<span>' + esc(kind.replace('_', ' ')) + '</span>'
      + '</div>'
      + diffInner
      + '</div>';

    bodyHtml = tabsHtml
      + '<div class="m-body">'
      + driftWarn
      + diffBlock
      + '</div>';
  }

  var footerLeft = '<div class="left">'
    + '<button id="btn-reject" class="btn btn-secondary">Reject</button>'
    + '</div>';
  var footerRight;
  if (kind === 'trash_doc') {
    footerRight = '<div class="right"><button id="btn-approve" class="btn btn-danger">' + ICO_TRASH + ' Move to trash</button></div>';
  } else {
    footerRight = '<div class="right"><button id="btn-approve" class="btn btn-primary">' + ICO_CHECK + ' Approve &amp; write</button></div>';
  }

  var headPill = '<span class="pill change"><span class="dot"></span>PENDING APPROVAL</span>';
  var headTool = '<span class="tool">write_doc<span class="args">(&quot;' + esc(docId) + '&quot;, mode: &quot;' + modeArg + '&quot;)</span></span>';

  return '<div class="m-card">'
    + '<div class="m-head">'
    + '<div class="left"><span class="glyph">M</span><span class="sep"></span>' + headTool + '</div>'
    + headPill
    + '</div>'
    + summaryHtml
    + bodyHtml
    + '<div class="m-foot">'
    + footerLeft
    + footerRight
    + '</div>'
    + '</div>';
}

// ── Flow Publish renderer ─────────────────────────────────────────────────────

function renderFlowPublish(preview, flowId) {
  var d = preview.node_diff || {};
  var added = d.added || [];
  var removed = d.removed || [];
  var changed = d.changed || [];
  var total = preview.total_nodes || (added.length + removed.length + changed.length);
  var unchanged = total - added.length - removed.length - changed.length;
  if (unchanged < 0) unchanged = 0;

  var pubV = preview.published_version != null ? preview.published_version : 0;
  var draftV = preview.draft_version != null ? preview.draft_version : pubV + 1;
  var pubNodes = preview.published_node_count != null ? preview.published_node_count : total;
  var draftNodes = preview.draft_node_count != null ? preview.draft_node_count : total;
  var pubTime = preview.published_at ? esc(preview.published_at) : 'never';

  var versionsHtml = '<div class="fp-versions">'
    + '<div class="v-card">'
    + '<div class="top"><span class="ver">v' + esc(String(pubV)) + '</span><span class="meta">PUBLISHED · ' + pubTime + '</span></div>'
    + '<div class="who">' + esc(String(pubNodes)) + ' nodes</div>'
    + '</div>'
    + '<div class="arrow-between">' + ICO_ARROW + '</div>'
    + '<div class="v-card new">'
    + '<div class="top"><span class="ver accent">v' + esc(String(draftV)) + ' · DRAFT</span><span class="meta accent">DRAFT</span></div>'
    + '<div class="who">' + esc(String(draftNodes)) + ' nodes · edited</div>'
    + '</div>'
    + '</div>';

  var statsHtml = '<div class="fp-stats">'
    + '<div class="stat add"><span class="swatch"></span><span class="v">' + added.length + '</span> Added</div>'
    + '<div class="stat rm"><span class="swatch"></span><span class="v">' + removed.length + '</span> Removed</div>'
    + '<div class="stat ch"><span class="swatch"></span><span class="v">' + changed.length + '</span> Changed</div>'
    + '<div class="stat keep"><span class="swatch"></span><span class="v">' + unchanged + '</span> Unchanged</div>'
    + '</div>';

  var hasDiff = added.length > 0 || removed.length > 0 || changed.length > 0;
  var listBody = '';
  if (!hasDiff) {
    listBody = '<div style="padding:16px 22px;font:400 13px/1.5 var(--sans);color:var(--ink-muted);">Publishing for the first time.</div>';
  } else {
    var rows = '';
    var i;
    for (i = 0; i < added.length; i++) {
      rows += '<div class="fp-row">'
        + '<span class="sig add">+ ADD</span>'
        + '<div class="ttl-wrap"><div class="ttl">' + esc(added[i].title || added[i]) + '</div>'
        + (added[i].sub ? '<div class="sub">' + esc(added[i].sub) + '</div>' : '')
        + '</div></div>';
    }
    for (i = 0; i < removed.length; i++) {
      rows += '<div class="fp-row rm">'
        + '<span class="sig rm">− REMOVE</span>'
        + '<div class="ttl-wrap"><div class="ttl">' + esc(removed[i].title || removed[i]) + '</div></div>'
        + '</div>';
    }
    for (i = 0; i < changed.length; i++) {
      rows += '<div class="fp-row">'
        + '<span class="sig ch">∼ CHANGE</span>'
        + '<div class="ttl-wrap"><div class="ttl">' + esc(changed[i].title || changed[i]) + '</div>'
        + (changed[i].sub ? '<div class="sub">' + esc(changed[i].sub) + '</div>' : '')
        + '</div></div>';
    }
    listBody = '<div class="fp-list">'
      + '<div class="fp-list-head"><h6>Changes</h6></div>'
      + rows
      + '</div>';
  }

  var headPill = '<span class="pill change"><span class="dot"></span>DRAFT → PUBLISH</span>';
  var headTool = '<span class="tool">publish_flow<span class="args">(&quot;' + esc(flowId) + '&quot;)</span></span>';

  return '<div class="m-card">'
    + '<div class="m-head">'
    + '<div class="left"><span class="glyph">M</span><span class="sep"></span>' + headTool + '</div>'
    + headPill
    + '</div>'
    + versionsHtml
    + statsHtml
    + listBody
    + '<div class="m-foot">'
    + '<div class="left"><button id="btn-cancel" class="btn btn-ghost">Cancel</button><button id="btn-reject" class="btn btn-secondary">Save draft</button></div>'
    + '<div class="right"><button id="btn-approve" class="btn btn-primary">' + ICO_ARROW + ' Publish v' + esc(String(draftV)) + '</button></div>'
    + '</div>'
    + '</div>';
}

// ── Folder Trash renderer ─────────────────────────────────────────────────────

function renderFolderTrash(preview, folderId) {
  var folderName = preview.folder_name || folderId;
  var folderPath = preview.folder_path || '';
  var docCount = preview.doc_count != null ? preview.doc_count : 0;
  var subCount = preview.subfolder_count != null ? preview.subfolder_count : 0;
  var flowRefs = preview.referenced_flow_count != null ? preview.referenced_flow_count : 0;

  var summaryHtml = '<div class="ft-summary">'
    + '<div class="ft-folder">' + ICO_FOLDER + '</div>'
    + '<div class="ft-body">'
    + '<h2 class="ft-title">Move ‘' + esc(folderName) + '’ to trash?</h2>'
    + (folderPath ? '<div class="ft-path">' + esc(folderPath) + '</div>' : '')
    + '<p class="ft-lede">All documents and subfolders inside will be trashed.</p>'
    + '</div>'
    + '</div>';

  var impactHtml = '<div class="ft-impact">'
    + '<div class="ft-stat warn"><div class="num">' + docCount + '</div><div class="lbl">Docs trashed</div></div>'
    + '<div class="ft-stat warn"><div class="num">' + subCount + '</div><div class="lbl">Subfolders trashed</div></div>'
    + '<div class="ft-stat"><div class="num">' + flowRefs + '</div><div class="lbl">Flows reference these</div></div>'
    + '</div>';

  var calloutHtml = '';
  if (flowRefs > 0) {
    calloutHtml = '<div class="ft-callout">'
      + ICO_WARN
      + '<p>' + flowRefs + ' flow' + (flowRefs === 1 ? '' : 's') + ' reference documents inside this folder. Those steps will break.</p>'
      + '</div>';
  }

  var restoreHtml = '<div class="ft-restore">'
    + ICO_RESTORE
    + '<span>You can restore this folder and its contents within 30 days.</span>'
    + '</div>';

  var headPill = '<span class="pill danger"><span class="dot"></span>DESTRUCTIVE</span>';
  var headTool = '<span class="tool">trash_folder<span class="args">(&quot;' + esc(folderId) + '&quot;)</span></span>';

  return '<div class="m-card">'
    + '<div class="m-head">'
    + '<div class="left"><span class="glyph">M</span><span class="sep"></span>' + headTool + '</div>'
    + headPill
    + '</div>'
    + summaryHtml
    + impactHtml
    + calloutHtml
    + restoreHtml
    + '<div class="m-foot">'
    + '<div class="left"><button id="btn-cancel" class="btn btn-ghost">Cancel</button></div>'
    + '<div class="right"><button id="btn-approve" class="btn btn-danger">' + ICO_TRASH + ' Move to trash</button></div>'
    + '</div>'
    + '</div>';
}

// ── State helpers ─────────────────────────────────────────────────────────────

function showSuccess(root, kind, targetName) {
  var desc = '';
  if (kind === 'trash_doc' || kind === 'trash_folder') {
    desc = esc(targetName) + ' moved to trash.';
  } else if (kind === 'flow_publish') {
    desc = esc(targetName) + ' published.';
  } else if (kind === 'create') {
    desc = esc(targetName) + ' created.';
  } else {
    desc = 'Changes to ' + esc(targetName) + ' saved.';
  }
  root.innerHTML = '<div class="m-card"><div class="state-success">'
    + '<div class="ttl">Done</div>'
    + '<div class="sub">' + desc + '</div>'
    + '</div></div>';
}

function showError(root, msg) {
  var displayMsg = msg ? esc(String(msg)) : 'An unknown error occurred.';
  if (msg && String(msg).indexOf('expired') !== -1) {
    displayMsg = 'This preview has expired. Ask Claude to propose the change again.';
  }
  root.innerHTML = '<div class="m-card"><div class="state-error">' + displayMsg + '</div></div>';
}

function showCancelled(root) {
  root.innerHTML = '<div class="m-card"><div style="padding:22px;font:400 13px var(--sans);color:var(--ink-muted);">Cancelled.</div></div>';
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Uses import().then() Promise chains — same pattern as flow-walk-html.ts (confirmed working).
// NO async/await at any level — classic <script> + await has issues in Electron iframes.

function diag(msg, color) {
  var el = document.getElementById('diag');
  if (el) { el.textContent = msg; el.style.color = color || '#707479'; }
}

function main() {
  var root = document.getElementById('root');
  var sdk  = window.__sdk;
  if (!sdk) { diag('SDK missing', '#FF7A8A'); showError(root, 'SDK not found.'); return; }
  diag('Loading SDK…');

  // Try data: URL first (works in Cursor/VSCode webview whose CSP blocks blob:).
  // Fall back to blob: (works in Claude Desktop Electron).
  var dataUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(sdk);

  import(dataUrl).then(function(mod) {
    diag('SDK loaded (data:). Connecting…');
    startApp(mod.App, mod.PostMessageTransport, root);
  }).catch(function() {
    // data: blocked too — try blob: (Claude Desktop path)
    var blob = new Blob([sdk], { type: 'text/javascript' });
    var blobUrl = URL.createObjectURL(blob);
    import(blobUrl).then(function(mod) {
      URL.revokeObjectURL(blobUrl);
      diag('SDK loaded (blob:). Connecting…');
      startApp(mod.App, mod.PostMessageTransport, root);
    }).catch(function(err) {
      diag('Connect failed: ' + String(err), '#FF7A8A');
      showError(root, 'Failed to connect: ' + String(err));
    });
  });
}

function startApp(App, PostMessageTransport, root) {
  diag('Connecting…');

    var app = new App({ name: 'mnema-write-preview', version: '1.0.0' }, {}, { autoResize: true });

    app.ontoolresult = function(result) {
      diag('ontoolresult fired — kind: ' + ((result.structuredContent && result.structuredContent.preview && result.structuredContent.preview.kind) || (result.isError ? 'ERROR' : '?')), result.isError ? '#FF7A8A' : '#6BE39B');
      try {
        var sc = result.structuredContent;
        var isError = result.isError;

        if (isError || !sc) {
          var errMsg = (sc && sc.message) ? String(sc.message) : 'Tool error — no preview available.';
          showError(root, errMsg);
          return;
        }

        var preview = sc.preview || {};
        var kind = preview.kind || '';
        var commitTool = sc.commit_tool || '';
        var proposalToken = sc.proposal_token || '';

        // Derive IDs and target name
        var docId = sc.doc_id || preview.doc_id || '';
        var flowId = sc.flow_id || preview.flow_id || '';
        var folderId = sc.folder_id || preview.folder_id || '';
        var targetName = '';
        var html = '';

        var docKinds = { append: 1, replace_section: 1, replace_body: 1, create: 1, trash_doc: 1 };
        if (docKinds[kind]) {
          targetName = preview.doc_title || preview.title || docId;
          html = renderDocWrite(preview, docId);
        } else if (kind === 'flow_publish') {
          targetName = preview.flow_name || flowId;
          html = renderFlowPublish(preview, flowId);
        } else if (kind === 'trash_folder') {
          targetName = preview.folder_name || folderId;
          html = renderFolderTrash(preview, folderId);
        } else {
          showError(root, 'Unknown preview kind: ' + esc(kind));
          return;
        }

        root.innerHTML = html;

        if (!commitTool) {
          showError(root, 'Missing commit_tool — cannot commit.');
          return;
        }

        var approveBtn = document.getElementById('btn-approve');
        var rejectBtn  = document.getElementById('btn-reject');
        var cancelBtn  = document.getElementById('btn-cancel');

        if (approveBtn) {
          approveBtn.onclick = function() {
            var origLabel = approveBtn.textContent;
            approveBtn.setAttribute('disabled', 'true');
            if (rejectBtn) rejectBtn.setAttribute('disabled', 'true');
            if (cancelBtn) cancelBtn.setAttribute('disabled', 'true');
            approveBtn.textContent = '…';
            app.callServerTool({
              name: commitTool,
              arguments: { proposal_token: proposalToken },
            }).then(function() {
              showSuccess(root, kind, targetName);
            }).catch(function(err) {
              var msg = String((err && err.message) || err);
              showError(root, msg);
              approveBtn.removeAttribute('disabled');
              if (rejectBtn) rejectBtn.removeAttribute('disabled');
              if (cancelBtn) cancelBtn.removeAttribute('disabled');
              approveBtn.textContent = origLabel;
            });
          };
        }

        function doCancelOrReject() {
          if (approveBtn) approveBtn.setAttribute('disabled', 'true');
          if (rejectBtn) rejectBtn.setAttribute('disabled', 'true');
          if (cancelBtn) cancelBtn.setAttribute('disabled', 'true');
          app.sendMessage({
            role: 'user',
            content: [{ type: 'text', text: 'Write cancelled by user.' }],
          }).catch(function() {});
          showCancelled(root);
        }

        if (rejectBtn) { rejectBtn.onclick = doCancelOrReject; }
        if (cancelBtn) { cancelBtn.onclick = doCancelOrReject; }
      } catch (renderErr) {
        showError(root, 'Render error: ' + String(renderErr && renderErr.message || renderErr));
      }
    };

  app.connect(new PostMessageTransport(window.parent, window.parent))
    .then(function() {
      diag('Connected — awaiting tool result…', '#6BE39B');
    }).catch(function(err) {
      diag('Connect failed: ' + String(err), '#FF7A8A');
      showError(root, 'Failed to connect: ' + String(err));
    });
}

main();
</script>
</body>
</html>`;

  return _html;
}
