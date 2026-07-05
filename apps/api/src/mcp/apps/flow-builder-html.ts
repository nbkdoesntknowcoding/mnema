/**
 * Flow Builder Canvas MCP App HTML bundle.
 *
 * Rendered in a sandboxed iframe when `get_flow` returns structuredContent.
 * Shows the full draft graph: nodes as absolute-positioned divs, edges as SVG
 * bezier paths, decision branches as labeled forks. Read-only — no writes.
 *
 * Layout:
 *   - Uses stored positions if any node has a non-zero position.
 *   - BFS fallback for all-zero (new) flows.
 *
 * Node kinds:
 *   instruction — amber accent
 *   doc         — info-blue accent
 *   docs        — info-blue accent
 *   decision    — amber dashed border
 *
 * Edges: SVG bezier paths, branch label divs at midpoint.
 * Unconnected decision branches: dashed amber arrow with "?" endpoint.
 *
 * Inspector drawer: right-pinned 280px panel (flex sibling), slides in on node click.
 * Header: μ glyph | get_flow("slug") | status pill
 * Footer: kbd hints | Walk this flow button
 *
 * NOTE: <foreignObject> HTML inside SVG does NOT render in Claude Desktop's
 * sandboxed MCP App iframe. This file uses absolute-positioned divs for nodes.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

function loadAppWithDeps(): string {
  try {
    const pkgPath = _require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
    return readFileSync(pkgPath, 'utf8');
  } catch (e) {
    return "console.error('ext-apps load failed: " + String(e) + "');";
  }
}

const APP_WITH_DEPS_JS = loadAppWithDeps();

let _html: string | null = null;

export function getFlowBuilderHtml(): string {
  if (_html) return _html;

  _html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mnema Flow Builder</title>
<style>
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
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
body { background:var(--canvas); color:var(--ink); font-family:var(--sans); font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; height:100%; overflow:hidden; display:flex; flex-direction:column; }
html { height:100%; }
button { font-family:inherit; color:inherit; cursor:pointer; }

.m-card { background:var(--canvas); color:var(--ink); overflow:hidden; display:flex; flex-direction:column; height:100%; }
.m-head { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-bottom:1px solid var(--line); background:var(--surface); min-height:48px; flex-shrink:0; }
.m-head .left { display:flex; align-items:center; gap:12px; min-width:0; }
.m-head .glyph { width:22px; height:22px; border-radius:6px; background:var(--ink); color:var(--canvas); display:inline-flex; align-items:center; justify-content:center; font:500 14px/1 var(--sans); padding-bottom:1px; position:relative; flex-shrink:0; }
.m-head .glyph::after { content:""; position:absolute; inset:0; border-radius:inherit; background:linear-gradient(135deg,rgba(255,255,255,0.18),transparent 50%); }
.m-head .sep { width:1px; height:14px; background:var(--line-strong); }
.m-head .tool { font:500 11px/1 var(--mono); color:var(--ink-soft); letter-spacing:0.04em; }
.m-head .tool .args { color:var(--ink-muted); }
.m-head .meta { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); display:inline-flex; align-items:center; gap:8px; }

.pill { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:999px; font:500 10px/1 var(--mono); letter-spacing:0.04em; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-soft); }
.pill .dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
.pill.live { background:rgba(107,227,155,0.10); color:var(--status-sync); border-color:rgba(107,227,155,0.28); }
.pill.draft { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-line); }

.fg-canvas { position:relative; flex:1; background: radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px) 0 0 / 22px 22px, var(--canvas); overflow:hidden; display:flex; }
.fg-stage { flex:1; position:relative; overflow:hidden; }
.fg-stage::before, .fg-stage::after { content:""; position:absolute; pointer-events:none; z-index:3; top:0; bottom:0; width:40px; }
.fg-stage::before { left:0; background:linear-gradient(90deg,var(--canvas),transparent); }
.fg-stage::after { right:0; background:linear-gradient(270deg,var(--canvas),transparent); }
.fg-edge-svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; z-index:1; }

.fg-node { position:absolute; width:156px; background:var(--surface); border:1px solid var(--line-strong); border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; gap:6px; cursor:pointer; transition:transform 140ms ease,border-color 140ms ease,background 140ms ease; z-index:2; }
.fg-node:hover { border-color:var(--line-bright); transform:translateY(-1px); }
.fg-node.selected { border-color:var(--accent); background:rgba(255,179,112,0.05); box-shadow:0 0 0 3px var(--accent-soft); }
.fg-node .kind-row { display:flex; align-items:center; justify-content:space-between; }
.fg-node .kind { font:500 9.5px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); display:inline-flex; align-items:center; gap:5px; }
.fg-node .kind .kdot { width:5px; height:5px; border-radius:50%; }
.fg-node.doc .kind .kdot { background:var(--status-info); }
.fg-node.docs .kind .kdot { background:var(--status-info); }
.fg-node.decision .kind .kdot { background:var(--accent); }
.fg-node.instruction .kind .kdot { background:var(--status-edit); }
.fg-node .num { font:500 9.5px/1 var(--mono); color:var(--ink-faint); }
.fg-node .ttl { font:500 12.5px/1.3 var(--sans); letter-spacing:-0.005em; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fg-node.decision { border-style:dashed; }
.fg-node.start { background:var(--accent-soft); border-color:var(--accent-line); }

.fg-edge-label { position:absolute; font:500 9.5px/1 var(--mono); letter-spacing:0.04em; text-transform:uppercase; background:var(--canvas); color:var(--ink-soft); padding:3px 6px; border-radius:3px; border:1px solid var(--line); z-index:2; white-space:nowrap; pointer-events:none; }

.fg-inspector { width:280px; background:var(--surface); border-left:1px solid var(--line); display:flex; flex-direction:column; flex-shrink:0; position:relative; z-index:5; overflow:hidden; transition:width 200ms ease; }
.fg-inspector.closed { width:0; }
.insp-head { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid var(--line); flex-shrink:0; }
.insp-head .kind { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); display:inline-flex; align-items:center; gap:7px; }
.insp-head .kind .kdot { width:6px; height:6px; border-radius:50%; background:var(--accent); }
.insp-close { width:24px; height:24px; border-radius:5px; border:0; background:transparent; color:var(--ink-muted); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.insp-close:hover { background:var(--surface-2); color:var(--ink); }
.insp-body { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:16px; }
.insp-sec { display:flex; flex-direction:column; gap:6px; }
.insp-sec h6 { margin:0; font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); }
.insp-title { font:500 16px/1.3 var(--sans); color:var(--ink); letter-spacing:-0.01em; }
.insp-doc { display:flex; align-items:center; gap:9px; padding:9px 12px; background:var(--surface-2); border:1px solid var(--line); border-radius:6px; font:500 12.5px/1.3 var(--sans); color:var(--ink); }
.insp-doc svg { color:var(--ink-muted); flex-shrink:0; }
.insp-doc .path { margin-left:auto; color:var(--ink-muted); font:400 10.5px var(--mono); }
.insp-branches { display:flex; flex-direction:column; gap:6px; }
.insp-branch { display:flex; align-items:center; justify-content:space-between; padding:8px 11px; background:var(--surface-2); border:1px solid var(--line); border-radius:6px; }
.insp-branch .lbl { font:500 12.5px/1.3 var(--sans); color:var(--ink); display:flex; align-items:center; gap:7px; }
.insp-branch .target { font:500 10.5px var(--mono); color:var(--ink-muted); }
.insp-branch.active { border-color:var(--accent-line); background:var(--accent-soft); }
.insp-branch.active .lbl { color:var(--accent); }
.insp-branch.active .target { color:var(--accent); }
.insp-foot { padding:10px 16px; border-top:1px solid var(--line); font:500 10.5px/1 var(--mono); color:var(--ink-muted); display:flex; justify-content:space-between; flex-shrink:0; }

.fg-mini-toolbar { position:absolute; bottom:14px; left:14px; display:inline-flex; align-items:center; gap:4px; background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:3px; z-index:4; }
.fg-mini-toolbar button { width:26px; height:26px; border:0; background:transparent; border-radius:4px; color:var(--ink-muted); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font:500 11px/1 var(--mono); }
.fg-mini-toolbar button:hover { background:var(--surface-2); color:var(--ink); }
.fg-mini-toolbar .zoom-level { padding:0 8px; font:500 11px/1 var(--mono); color:var(--ink-muted); }
.fg-mini-toolbar .sep { width:1px; height:14px; background:var(--line); }

.m-foot { display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-top:1px solid var(--line); background:var(--surface); flex-shrink:0; }
.m-foot .left, .m-foot .right { display:flex; align-items:center; gap:8px; }
.btn { font:500 12.5px/1 var(--sans); padding:8px 13px; border-radius:6px; cursor:pointer; border:1px solid transparent; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; transition:background-color 140ms ease,border-color 140ms ease; }
.btn-ghost { background:transparent; color:var(--ink-soft); }
.btn-ghost:hover { color:var(--ink); background:var(--surface-2); }
.btn-secondary { background:var(--surface-2); color:var(--ink); border-color:var(--line-strong); }
.btn-secondary:hover { background:var(--surface-3); border-color:var(--line-bright); }
.kbd-hint { font:500 10px/1 var(--mono); letter-spacing:0.04em; color:var(--ink-faint); display:inline-flex; align-items:center; gap:6px; }
.kbd-hint kbd { padding:2px 5px; border-radius:3px; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-muted); font:500 9.5px/1 var(--mono); }

.state-loading { padding:40px 22px; display:flex; flex-direction:column; gap:10px; }
.skel { border-radius:4px; background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; }
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.state-error { padding:22px; color:var(--status-error); font-size:13px; line-height:1.6; }
.state-empty { padding:40px 22px; text-align:center; color:var(--ink-muted); font-size:13px; }
</style>
</head>
<body>
<div id="root" class="m-card">
  <div class="m-head">
    <div class="left">
      <span class="glyph">μ</span>
      <span class="sep"></span>
      <span class="tool" id="head-tool">get_flow</span>
    </div>
    <div class="meta" id="head-meta">
      <span id="status-pill" class="pill draft"><span class="dot"></span>DRAFT</span>
      <span id="head-version" style="margin-left:10px;"></span>
    </div>
  </div>

  <div class="fg-canvas" id="fg-canvas">
    <div class="fg-stage" id="fg-stage">
      <svg class="fg-edge-svg" id="fg-edges" viewBox="0 0 800 500" preserveAspectRatio="none">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.22)"/>
          </marker>
          <marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#FFB370"/>
          </marker>
        </defs>
      </svg>
      <div id="fg-nodes"></div>
      <div id="fg-edge-labels"></div>
      <div class="fg-mini-toolbar">
        <button id="btn-fit" title="Fit">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"/></svg>
        </button>
        <span class="sep"></span>
        <button id="btn-refresh" title="Refresh">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
        </button>
      </div>
    </div>
    <aside class="fg-inspector closed" id="fg-inspector">
      <div class="insp-head">
        <span class="kind" id="insp-kind"><span class="kdot"></span><span id="insp-kind-text">NODE</span></span>
        <button class="insp-close" id="insp-close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="insp-body" id="insp-body"></div>
      <div class="insp-foot" id="insp-foot"></div>
    </aside>
  </div>

  <div class="m-foot">
    <div class="left">
      <span class="kbd-hint"><kbd>space</kbd>pan</span>
      <span class="kbd-hint"><kbd>esc</kbd>close</span>
    </div>
    <div class="right">
      <button class="btn btn-secondary" id="btn-walk">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Walk this flow
      </button>
    </div>
  </div>
</div>

<script>window.__sdk=${JSON.stringify(APP_WITH_DEPS_JS)};</script>
<script>
(function () {
// ── Constants ──────────────────────────────────────────────────────────────
var NODE_W = 156, NODE_H = 76, H_GAP = 60, V_GAP = 80, PAD = 40;

// ── State ──────────────────────────────────────────────────────────────────
var app, flowUuid = null, state = null, selectedNodeId = null, isRefreshing = false;

// ── HTML escape ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── BFS layout ──────────────────────────────────────────────────────────────
function bfsLayout(nodes, edges) {
  var i, e, kids, j;
  var hasPositions = false;
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].position.x !== 0 || nodes[i].position.y !== 0) { hasPositions = true; break; }
  }
  if (hasPositions) {
    var pos = {};
    for (i = 0; i < nodes.length; i++) {
      pos[nodes[i].client_node_id] = { x: nodes[i].position.x, y: nodes[i].position.y };
    }
    return pos;
  }
  // Build adjacency + in-degree
  var children = {}, inDeg = {};
  for (i = 0; i < nodes.length; i++) {
    children[nodes[i].client_node_id] = [];
    inDeg[nodes[i].client_node_id] = 0;
  }
  for (i = 0; i < edges.length; i++) {
    e = edges[i];
    if (children[e.from]) children[e.from].push(e.to);
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
  }
  // BFS layers
  var queue = [];
  for (i = 0; i < nodes.length; i++) {
    if ((inDeg[nodes[i].client_node_id] || 0) === 0) queue.push(nodes[i].client_node_id);
  }
  var layers = [], visited = {};
  for (i = 0; i < queue.length; i++) visited[queue[i]] = true;
  while (queue.length) {
    layers.push(queue.slice());
    var next = [];
    for (i = 0; i < queue.length; i++) {
      kids = children[queue[i]] || [];
      for (j = 0; j < kids.length; j++) {
        if (!visited[kids[j]]) { visited[kids[j]] = true; next.push(kids[j]); }
      }
    }
    queue = next;
  }
  // Disconnected nodes
  var unseen = [];
  for (i = 0; i < nodes.length; i++) {
    if (!visited[nodes[i].client_node_id]) unseen.push(nodes[i].client_node_id);
  }
  if (unseen.length) layers.push(unseen);
  // Assign positions — center each layer
  var positions = {};
  for (var li = 0; li < layers.length; li++) {
    var layer = layers[li];
    var totalW = layer.length * NODE_W + (layer.length - 1) * H_GAP;
    var startX = -totalW / 2 + NODE_W / 2;
    for (var ni = 0; ni < layer.length; ni++) {
      positions[layer[ni]] = { x: startX + ni * (NODE_W + H_GAP), y: li * (NODE_H + V_GAP) };
    }
  }
  return positions;
}

// ── BFS order index (1-based, zero-padded) ─────────────────────────────────
function buildBfsOrder(nodes, edges) {
  var i, e;
  var children = {}, inDeg = {};
  for (i = 0; i < nodes.length; i++) {
    children[nodes[i].client_node_id] = [];
    inDeg[nodes[i].client_node_id] = 0;
  }
  for (i = 0; i < edges.length; i++) {
    e = edges[i];
    if (children[e.from]) children[e.from].push(e.to);
    inDeg[e.to] = (inDeg[e.to] || 0) + 1;
  }
  var queue = [];
  for (i = 0; i < nodes.length; i++) {
    if ((inDeg[nodes[i].client_node_id] || 0) === 0) queue.push(nodes[i].client_node_id);
  }
  var order = {}, idx = 1, visited = {};
  for (i = 0; i < queue.length; i++) visited[queue[i]] = true;
  while (queue.length) {
    var next = [];
    for (i = 0; i < queue.length; i++) {
      order[queue[i]] = idx++;
      var kids = children[queue[i]] || [];
      for (var j = 0; j < kids.length; j++) {
        if (!visited[kids[j]]) { visited[kids[j]] = true; next.push(kids[j]); }
      }
    }
    queue = next;
  }
  for (i = 0; i < nodes.length; i++) {
    if (!order[nodes[i].client_node_id]) order[nodes[i].client_node_id] = idx++;
  }
  return order;
}

function zeroPad(n) {
  return n < 10 ? '0' + String(n) : String(n);
}

// ── Render canvas ───────────────────────────────────────────────────────────
function renderCanvas(sc) {
  state = sc;
  flowUuid = sc.flow.uuid;

  // Header tool label
  var toolEl = document.getElementById('head-tool');
  toolEl.innerHTML = 'get_flow<span class="args">(' + esc('"' + (sc.flow.slug || sc.flow.uuid) + '"') + ')</span>';

  // Status pill
  var pill = document.getElementById('status-pill');
  var isPublished = sc.flow.published_at && !sc.flow.is_dirty;
  if (isPublished) {
    pill.className = 'pill live';
    pill.innerHTML = '<span class="dot"></span>PUBLISHED';
  } else {
    pill.className = 'pill draft';
    pill.innerHTML = '<span class="dot"></span>DRAFT';
  }

  var nodes = sc.nodes || [];
  var edges = sc.edges || [];

  // Clear containers
  var nodesContainer = document.getElementById('fg-nodes');
  var labelsContainer = document.getElementById('fg-edge-labels');
  var svgEl = document.getElementById('fg-edges');
  nodesContainer.innerHTML = '';
  labelsContainer.innerHTML = '';
  // Remove all paths/lines from svg (keep defs)
  var svgChildren = svgEl.childNodes;
  var toRemove = [];
  for (var ci = 0; ci < svgChildren.length; ci++) {
    if (svgChildren[ci].nodeName !== 'defs') toRemove.push(svgChildren[ci]);
  }
  for (var ri = 0; ri < toRemove.length; ri++) svgEl.removeChild(toRemove[ri]);

  if (!nodes.length) {
    nodesContainer.innerHTML = '<div class="state-empty">No nodes yet — use Claude to add the first step.</div>';
    return;
  }

  var positions = bfsLayout(nodes, edges);
  var bfsOrder = buildBfsOrder(nodes, edges);

  // Canvas bounds
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  var posKeys = Object.keys(positions);
  for (var pi = 0; pi < posKeys.length; pi++) {
    var p = positions[posKeys[pi]];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + NODE_W > maxX) maxX = p.x + NODE_W;
    if (p.y + NODE_H > maxY) maxY = p.y + NODE_H;
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 400; maxY = 200; }
  var offX = -minX + PAD;
  var offY = -minY + PAD;
  var canvasW = maxX - minX + PAD * 2;
  var canvasH = maxY - minY + PAD * 2;

  // Size the SVG viewport to match
  svgEl.setAttribute('viewBox', '0 0 ' + canvasW + ' ' + canvasH);
  svgEl.setAttribute('width', canvasW);
  svgEl.setAttribute('height', canvasH);

  // Build incoming-edge set to find entry nodes
  var hasIncoming = {};
  for (var ei = 0; ei < edges.length; ei++) {
    hasIncoming[edges[ei].to] = true;
  }

  // Build node map
  var nodeById = {};
  for (var ni = 0; ni < nodes.length; ni++) nodeById[nodes[ni].client_node_id] = nodes[ni];

  // ── Draw nodes ───────────────────────────────────────────────────────────
  for (var ni2 = 0; ni2 < nodes.length; ni2++) {
    var n = nodes[ni2];
    var pos = positions[n.client_node_id];
    if (!pos) continue;
    var nx = pos.x + offX;
    var ny = pos.y + offY;
    var isEntry = !hasIncoming[n.client_node_id];
    var idx = bfsOrder[n.client_node_id] || (ni2 + 1);

    var kindClass = (n.kind === 'doc' || n.kind === 'docs' || n.kind === 'decision' || n.kind === 'instruction') ? n.kind : 'doc';
    var kindLabel = n.kind === 'doc' ? 'Doc' : n.kind === 'docs' ? 'Docs' : n.kind === 'decision' ? 'Decision' : 'Instruction';

    var div = document.createElement('div');
    div.className = 'fg-node ' + kindClass + (isEntry ? ' start' : '');
    div.style.left = nx + 'px';
    div.style.top = ny + 'px';
    div.setAttribute('data-node-id', n.client_node_id);

    div.innerHTML =
      '<div class="kind-row">' +
        '<span class="kind"><span class="kdot"></span>' + esc(kindLabel) + '</span>' +
        '<span class="num">' + zeroPad(idx) + '</span>' +
      '</div>' +
      '<div class="ttl">' + esc(n.title || '') + '</div>';

    nodesContainer.appendChild(div);
  }

  // ── Draw edges (SVG) ──────────────────────────────────────────────────────
  function makeSvgPath(attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var keys = Object.keys(attrs);
    for (var k = 0; k < keys.length; k++) el.setAttribute(keys[k], String(attrs[keys[k]]));
    return el;
  }

  for (var ei2 = 0; ei2 < edges.length; ei2++) {
    var edge = edges[ei2];
    var sp = positions[edge.from];
    var tp = positions[edge.to];
    if (!sp || !tp) continue;

    var sx = sp.x + offX + NODE_W / 2;
    var sy = sp.y + offY + NODE_H;
    var tx = tp.x + offX + NODE_W / 2;
    var ty = tp.y + offY;
    var cy = (sy + ty) / 2;

    var pathD = 'M' + sx + ',' + sy + ' C' + sx + ',' + cy + ' ' + tx + ',' + cy + ' ' + tx + ',' + ty;

    var pathEl = makeSvgPath({
      d: pathD,
      stroke: 'rgba(255,255,255,0.22)',
      'stroke-width': '1.4',
      fill: 'none',
      'marker-end': 'url(#arrow)'
    });
    svgEl.appendChild(pathEl);

    // Edge label div
    if (edge.branch) {
      var lx = (sx + tx) / 2;
      var ly = (sy + ty) / 2;
      var lbl = document.createElement('span');
      lbl.className = 'fg-edge-label';
      lbl.style.left = (lx - 20) + 'px';
      lbl.style.top = (ly - 10) + 'px';
      lbl.textContent = String(edge.branch);
      labelsContainer.appendChild(lbl);
    }
  }

  // ── Unconnected decision branch stubs ─────────────────────────────────────
  for (var ni3 = 0; ni3 < nodes.length; ni3++) {
    var nd = nodes[ni3];
    if (nd.kind !== 'decision') continue;
    var data = nd.data || {};
    var branchKeys = Object.keys(data.branches || {});
    for (var bi = 0; bi < branchKeys.length; bi++) {
      var bkey = branchKeys[bi];
      var hasEdge = false;
      for (var ei3 = 0; ei3 < edges.length; ei3++) {
        if (edges[ei3].from === nd.client_node_id && edges[ei3].branch === bkey) { hasEdge = true; break; }
      }
      if (!hasEdge) {
        var sp2 = positions[nd.client_node_id];
        if (!sp2) continue;
        var sx2 = sp2.x + offX + NODE_W / 2;
        var sy2 = sp2.y + offY + NODE_H;
        var ty2 = sy2 + 60;
        var stubPath = makeSvgPath({
          d: 'M' + sx2 + ',' + sy2 + ' L' + sx2 + ',' + ty2,
          stroke: '#FFB370',
          'stroke-width': '1.4',
          fill: 'none',
          'stroke-dasharray': '4 3',
          'marker-end': 'url(#arrow-accent)'
        });
        svgEl.appendChild(stubPath);
        // "?" label
        var qLbl = document.createElement('span');
        qLbl.className = 'fg-edge-label';
        qLbl.style.left = (sx2 + 6) + 'px';
        qLbl.style.top = (sy2 + 24) + 'px';
        qLbl.textContent = String(bkey) + '  ?';
        labelsContainer.appendChild(qLbl);
      }
    }
  }
}

// ── Inspector ───────────────────────────────────────────────────────────────
function openInspector(nodeId) {
  if (!state) return;
  selectedNodeId = nodeId;
  var n = null;
  for (var i = 0; i < state.nodes.length; i++) {
    if (state.nodes[i].client_node_id === nodeId) { n = state.nodes[i]; break; }
  }
  if (!n) return;

  // Highlight selected node
  var allNodes = document.querySelectorAll('.fg-node');
  for (var ai = 0; ai < allNodes.length; ai++) allNodes[ai].classList.remove('selected');
  var selNodes = document.querySelectorAll('.fg-node[data-node-id="' + nodeId + '"]');
  for (var si = 0; si < selNodes.length; si++) selNodes[si].classList.add('selected');

  // Inspector header kind
  var kindTextEl = document.getElementById('insp-kind-text');
  if (kindTextEl) {
    var kindLabel = n.kind === 'doc' ? 'DOC' : n.kind === 'docs' ? 'DOCS' : n.kind === 'decision' ? 'DECISION' : 'INSTRUCTION';
    kindTextEl.textContent = kindLabel;
  }

  var data = n.data || {};
  var bodyEl = document.getElementById('insp-body');
  var footEl = document.getElementById('insp-foot');
  var html = '';

  // Title section
  html += '<div class="insp-sec"><h6>Title</h6><div class="insp-title">' + esc(n.title || '') + '</div></div>';

  if (n.kind === 'doc') {
    var docId = data.doc_id || '';
    if (docId) {
      html += '<div class="insp-sec"><h6>Read from</h6>' +
        '<div class="insp-doc">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          esc(docId) +
        '</div>' +
      '</div>';
    }
    var instr = data.instruction || '';
    if (instr) {
      html += '<div class="insp-sec"><h6>Framing</h6>' +
        '<p style="font:400 12px/1.4 var(--sans); color:var(--ink-soft);">' + esc(instr) + '</p>' +
      '</div>';
    }
  } else if (n.kind === 'docs') {
    var docIds = data.doc_ids || [];
    if (docIds.length) {
      var docRows = '';
      for (var di = 0; di < docIds.length; di++) {
        docRows += '<div class="insp-doc">' +
          '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
          esc(docIds[di]) +
        '</div>';
      }
      html += '<div class="insp-sec"><h6>Documents (' + docIds.length + ')</h6>' + docRows + '</div>';
    }
    var instr2 = data.instruction || '';
    if (instr2) {
      html += '<div class="insp-sec"><h6>Framing</h6>' +
        '<p style="font:400 12px/1.4 var(--sans); color:var(--ink-soft);">' + esc(instr2) + '</p>' +
      '</div>';
    }
  } else if (n.kind === 'decision') {
    var question = data.question || n.title || '';
    if (question) {
      html += '<div class="insp-sec"><h6>Question</h6><div class="insp-title">' + esc(question) + '</div></div>';
    }
    var branchKeys = Object.keys(data.branches || {});
    if (branchKeys.length) {
      var branchRows = '';
      for (var bki = 0; bki < branchKeys.length; bki++) {
        var bk = branchKeys[bki];
        var edgeMatch = null;
        for (var ei4 = 0; ei4 < state.edges.length; ei4++) {
          if (state.edges[ei4].from === n.client_node_id && state.edges[ei4].branch === bk) {
            edgeMatch = state.edges[ei4]; break;
          }
        }
        var targetTitle = '';
        if (edgeMatch) {
          for (var tni = 0; tni < state.nodes.length; tni++) {
            if (state.nodes[tni].client_node_id === edgeMatch.to) {
              targetTitle = state.nodes[tni].title || edgeMatch.to;
              break;
            }
          }
        }
        var isActive = !!edgeMatch;
        var arrowSvg = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
        branchRows += '<div class="insp-branch' + (isActive ? ' active' : '') + '">' +
          '<span class="lbl">' + arrowSvg + esc(bk) + '</span>' +
          '<span class="target">' + (targetTitle ? esc(targetTitle) : '—') + '</span>' +
        '</div>';
      }
      html += '<div class="insp-sec"><h6>Branches</h6><div class="insp-branches">' + branchRows + '</div></div>';
    }
  } else {
    // instruction
    var text = data.text || '';
    if (text) {
      html += '<div class="insp-sec"><h6>Directive</h6>' +
        '<p style="font:400 12px/1.4 var(--sans); color:var(--ink-soft);">' + esc(text) + '</p>' +
      '</div>';
    }
  }

  bodyEl.innerHTML = html;
  footEl.textContent = 'NODE  ' + nodeId;

  document.getElementById('fg-inspector').classList.remove('closed');
}

function closeInspector() {
  selectedNodeId = null;
  document.getElementById('fg-inspector').classList.add('closed');
  var allNodes = document.querySelectorAll('.fg-node');
  for (var i = 0; i < allNodes.length; i++) allNodes[i].classList.remove('selected');
}

// ── Refresh ──────────────────────────────────────────────────────────────────
function refreshFlow() {
  if (isRefreshing || !flowUuid) return;
  isRefreshing = true;
  var btn = document.getElementById('btn-refresh');
  if (btn) btn.style.opacity = '0.4';
  app.callServerTool({ name: 'get_flow', arguments: { flow_id: flowUuid } })
    .then(function (result) {
      if (result.isError) {
        showError(result.content && result.content[0] && result.content[0].text ? result.content[0].text : 'Refresh failed');
      } else if (result.structuredContent) {
        closeInspector();
        renderCanvas(result.structuredContent);
      }
    })
    .catch(function (err) { showError(String(err)); })
    .finally(function () {
      isRefreshing = false;
      var b = document.getElementById('btn-refresh');
      if (b) b.style.opacity = '';
    });
}

function showError(msg) {
  var nodesContainer = document.getElementById('fg-nodes');
  nodesContainer.innerHTML = '<div class="state-error">' + esc(msg) + '</div>';
}

// ── Event handlers ───────────────────────────────────────────────────────────
document.getElementById('fg-nodes').addEventListener('click', function (e) {
  var target = e.target;
  while (target && target !== this) {
    if (target.getAttribute && target.getAttribute('data-node-id')) {
      var nodeId = target.getAttribute('data-node-id');
      if (selectedNodeId === nodeId) { closeInspector(); } else { openInspector(nodeId); }
      return;
    }
    target = target.parentNode;
  }
});

document.getElementById('insp-close').addEventListener('click', function () {
  closeInspector();
});

document.getElementById('btn-refresh').addEventListener('click', function () {
  refreshFlow();
});

document.getElementById('btn-fit').addEventListener('click', function () {
  // no-op: fit is the default render, re-render to re-center
  if (state) renderCanvas(state);
});

document.getElementById('btn-walk').addEventListener('click', function () {
  // read-only panel — no-op per design
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeInspector();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
function main() {
  var blob = new Blob([window.__sdk], { type: 'text/javascript' });
  var url = URL.createObjectURL(blob);
  Promise.resolve().then(function () { return import(url); }).then(function (mod) {
    URL.revokeObjectURL(url);
    var App = mod.App, PostMessageTransport = mod.PostMessageTransport;

    app = new App({ name: 'mnema-flow-builder', version: '1.0.0' }, {}, { autoResize: true });

    app.ontoolresult = function (result) {
      var structuredContent = result.structuredContent, isError = result.isError;
      if (isError || !structuredContent) {
        showError('Tool error — no graph data available.');
        return;
      }
      if (structuredContent.flow && structuredContent.flow.uuid) flowUuid = structuredContent.flow.uuid;
      renderCanvas(structuredContent);
    };

    return app.connect(new PostMessageTransport(window.parent, window.parent));
  }).catch(function (err) {
    showError('Failed to connect: ' + String(err));
  });
}

main();
})();
</script>
</body>
</html>`;

  return _html;
}
