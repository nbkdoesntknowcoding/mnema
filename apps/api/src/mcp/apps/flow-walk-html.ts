/**
 * Flow Walk Simulator MCP App HTML bundle.
 *
 * Navigation: calls get_flow_step via app.callServerTool.
 * CSP: no external fetches.
 * Note: JS inside <script> uses var/function syntax and string concatenation —
 * no backtick template literals (the outer TS file uses one for the HTML string).
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

let _html: string | null = null;

export function getFlowWalkHtml(): string {
  if (_html) return _html;

  _html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Flow Walk</title>
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
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body {
  background:var(--canvas); color:var(--ink);
  font-family:var(--sans); font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
button { font-family:inherit; color:inherit; }

/* Card */
.m-card {
  background:var(--canvas); color:var(--ink);
  border-radius:14px; border:1px solid rgba(0,0,0,0.4);
  overflow:hidden; font-size:13px; line-height:1.5;
}
.m-head {
  display:flex; align-items:center; justify-content:space-between;
  padding:12px 18px; border-bottom:1px solid var(--line);
  background:var(--surface); min-height:48px;
}
.m-head .left { display:flex; align-items:center; gap:12px; min-width:0; }
.m-head .glyph {
  width:22px; height:22px; border-radius:6px;
  background:var(--ink); color:var(--canvas);
  display:inline-flex; align-items:center; justify-content:center;
  font:500 14px/1 var(--sans); padding-bottom:1px;
  position:relative; flex-shrink:0;
}
.m-head .glyph::after { content:""; position:absolute; inset:0; border-radius:inherit; background:linear-gradient(135deg,rgba(255,255,255,0.18),transparent 50%); }
.m-head .sep { width:1px; height:14px; background:var(--line-strong); }
.m-head .tool { font:500 11px/1 var(--mono); color:var(--ink-soft); letter-spacing:0.04em; }
.m-head .tool .args { color:var(--ink-muted); }
.m-head .meta { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); display:inline-flex; align-items:center; gap:6px; }
.m-head .meta .dot { width:5px; height:5px; border-radius:50%; background:var(--status-sync); box-shadow:0 0 6px var(--status-sync); }

.m-foot {
  display:flex; align-items:center; justify-content:space-between;
  padding:12px 18px; border-top:1px solid var(--line); background:var(--surface);
}
.m-foot .left, .m-foot .right { display:flex; align-items:center; gap:8px; }

/* Buttons */
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

/* Kbd hint */
.kbd-hint { font:500 10px/1 var(--mono); letter-spacing:0.04em; color:var(--ink-faint); display:inline-flex; align-items:center; gap:6px; }
.kbd-hint kbd { padding:2px 5px; border-radius:3px; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-muted); font:500 9.5px/1 var(--mono); }

/* Pills */
.pill { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:999px; font:500 10px/1 var(--mono); letter-spacing:0.04em; background:var(--surface-2); border:1px solid var(--line); color:var(--ink-soft); }
.pill .dot { width:5px; height:5px; border-radius:50%; background:currentColor; }
.pill.live { background:rgba(107,227,155,0.10); color:var(--status-sync); border-color:rgba(107,227,155,0.28); }
.pill.draft { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-line); }
.pill.change { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-line); }

/* Walk-specific */
.walk-progress { display:flex; gap:4px; padding:16px 22px 0; background:var(--canvas); }
.walk-progress .seg { flex:1; height:3px; border-radius:999px; background:var(--surface-3); position:relative; }
.walk-progress .seg.done { background:var(--accent); }
.walk-progress .seg.current { background:linear-gradient(90deg,var(--accent) 60%,var(--surface-3) 60%); }
.walk-progress .seg.current::after { content:""; position:absolute; right:39%; top:-2px; width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px rgba(255,179,112,0.20); }

.walk-stepmeta { display:flex; align-items:center; justify-content:space-between; padding:18px 22px 14px; border-bottom:1px solid var(--line); }
.walk-stepmeta .num { font:500 11px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-muted); }
.walk-stepmeta .num strong { color:var(--accent); font-weight:600; }
.walk-stepmeta .kind { font:500 10px/1 var(--mono); letter-spacing:0.06em; text-transform:uppercase; padding:4px 8px; border-radius:4px; background:var(--accent-soft); color:var(--accent); border:1px solid var(--accent-line); }
.walk-stepmeta .kind.doc { background:rgba(124,156,255,0.10); color:var(--status-info); border-color:rgba(124,156,255,0.28); }
.walk-stepmeta .kind.instr { background:var(--accent-soft); color:var(--accent); border-color:var(--accent-line); }

.walk-step { padding:22px; display:flex; flex-direction:column; gap:18px; }
.walk-title { font:500 24px/1.2 var(--sans); letter-spacing:-0.02em; color:var(--ink); margin:0; }
.walk-doc-ref { display:flex; align-items:center; gap:9px; padding:10px 12px; background:var(--surface); border:1px solid var(--line); border-radius:7px; font:500 12.5px/1 var(--sans); color:var(--ink); }
.walk-doc-ref .path { margin-left:auto; color:var(--ink-muted); font:400 11px var(--mono); }
.walk-instr { font:400 14px/1.6 var(--sans); color:var(--ink-soft); background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:14px 16px; }
.walk-doc-body { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:14px 16px; max-height:320px; overflow-y:auto; }
.walk-doc-body pre { font:400 12.5px/1.7 var(--mono); color:var(--ink-soft); margin:0; white-space:pre-wrap; word-break:break-word; }

.walk-decision { display:flex; flex-direction:column; gap:10px; background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:16px; }
.walk-decision-q { font:500 14px/1.4 var(--sans); color:var(--ink); margin:0 0 4px; }
.walk-decision-help { font:400 12.5px/1.5 var(--sans); color:var(--ink-muted); margin:0 0 8px; }
.branches { display:flex; flex-direction:column; gap:6px; }
.branch-row { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-radius:6px; background:var(--surface-2); border:1px solid var(--line); cursor:pointer; transition:background-color 140ms ease,border-color 140ms ease; }
.branch-row:hover { background:var(--surface-3); border-color:var(--line-strong); }
.branch-row .lbl { display:flex; align-items:center; gap:10px; }
.branch-row .kbd { font:500 10px/1 var(--mono); padding:2px 5px; border-radius:3px; background:var(--surface); border:1px solid var(--line); color:var(--ink-muted); }
.branch-row .branch-text { font:500 13px/1 var(--sans); color:var(--ink); }
.branch-row .target { display:inline-flex; align-items:center; gap:6px; font:500 11px/1 var(--mono); color:var(--ink-muted); }

/* States */
.state-loading { padding:40px 22px; display:flex; flex-direction:column; gap:10px; }
.skel { border-radius:4px; background:linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; }
@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.state-end { padding:40px 22px; text-align:center; }
.state-end .icon { font-size:24px; margin-bottom:12px; }
.state-end .ttl { font:500 22px/1.2 var(--sans); letter-spacing:-0.02em; color:var(--ink); margin-bottom:6px; }
.state-end .sub { font:400 13px/1.5 var(--sans); color:var(--ink-muted); }
.state-error { padding:22px; color:var(--status-error); font-size:13px; line-height:1.6; }
</style>
</head>
<body>
<div id="root">
  <div class="m-card">
    <div class="m-head">
      <div class="left">
        <span class="glyph">&#x3BC;</span>
        <span class="sep"></span>
        <span class="tool">get_flow_step<span class="args">(&#x22;&#x22;)</span></span>
      </div>
      <span class="meta"><span class="dot"></span>LIVE</span>
    </div>
    <div class="state-loading">
      <div class="skel" style="height:14px;width:100%"></div>
      <div class="skel" style="height:14px;width:70%"></div>
      <div class="skel" style="height:14px;width:40%"></div>
    </div>
  </div>
</div>
<script>window.__sdk = ${JSON.stringify(APP_WITH_DEPS_JS)};</script>
<script>
(function() {
  var app = null;
  var flowId = null;
  var isNav = false;
  var autoAdvanceTimer = null;

  var ICON_FILE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  var ICON_CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 6 6 6-6 6"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function cancelAutoAdvance() {
    if (autoAdvanceTimer !== null) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  }

  function buildProgress(current, total) {
    var html = '<div class="walk-progress">';
    for (var i = 1; i <= total; i++) {
      if (i < current) {
        html += '<div class="seg done"></div>';
      } else if (i === current) {
        html += '<div class="seg current"></div>';
      } else {
        html += '<div class="seg"></div>';
      }
    }
    html += '</div>';
    return html;
  }

  function buildHead(flowId, current, total) {
    var argsHtml = '("' + esc(flowId || '') + '")';
    return '<div class="m-head">'
      + '<div class="left">'
      + '<span class="glyph">&#x3BC;</span>'
      + '<span class="sep"></span>'
      + '<span class="tool">get_flow_step<span class="args">' + argsHtml + '</span></span>'
      + '</div>'
      + '<span class="meta"><span class="dot"></span>LIVE &middot; STEP ' + current + ' / ' + total + '</span>'
      + '</div>';
  }

  function buildKindPill(kind) {
    if (kind === 'decision') {
      return '<span class="kind">Decision</span>';
    }
    if (kind === 'doc' || kind === 'docs') {
      return '<span class="kind doc">Doc</span>';
    }
    return '<span class="kind instr">Instruction</span>';
  }

  function buildStepMeta(current, total, flowName, kind) {
    return '<div class="walk-stepmeta">'
      + '<span class="num">STEP <strong>' + pad2(current) + '</strong> / ' + pad2(total) + ' &mdash; ' + esc((flowName || '').toUpperCase()) + '</span>'
      + buildKindPill(kind)
      + '</div>';
  }

  function buildKbdHints(kind, hasPrev) {
    var hints = '';
    if (hasPrev) {
      hints += '<span class="kbd-hint"><kbd>&larr;</kbd> back</span>';
    }
    if (kind === 'decision') {
      hints += '<span class="kbd-hint"><kbd>1</kbd>&ndash;<kbd>N</kbd> pick branch</span>';
    }
    hints += '<span class="kbd-hint"><kbd>esc</kbd> exit</span>';
    return hints;
  }

  function renderStep(sc) {
    cancelAutoAdvance();

    var flow = sc.flow;
    var step = sc.step;
    var decision = sc.decision;
    var progress = sc.progress;
    var hasMore = sc.has_more;

    flowId = flow.slug;

    var current = progress.current;
    var total = progress.total;
    var kind = step.kind;
    var hasPrev = current > 1;
    var nextIndex = step.index + 1;
    var prevIndex = step.index - 1 < 1 ? 1 : step.index - 1;

    // End of flow
    if (!hasMore) {
      var endHtml = '<div class="m-card">'
        + buildHead(flowId, current, total)
        + buildProgress(current, total)
        + buildStepMeta(current, total, flow.name, kind)
        + '<div class="state-end">'
        + '<div class="icon">&#x2713;</div>'
        + '<div class="ttl">Flow complete</div>'
        + '<div class="sub">' + esc(flow.name) + '</div>'
        + '</div>'
        + '<div class="m-foot">'
        + '<div class="left">' + buildKbdHints(kind, hasPrev) + '</div>'
        + '<div class="right">'
        + '<button class="btn btn-secondary" data-action="restart">Restart</button>'
        + '</div>'
        + '</div>'
        + '</div>';
      document.getElementById('root').innerHTML = endHtml;
      return;
    }

    var pause = step.pause_for_user_input;

    // ── Decision ──
    if (kind === 'decision' && decision) {
      var branches = decision.branches || [];
      var branchesHtml = '';
      for (var bi = 0; bi < branches.length; bi++) {
        var branch = branches[bi];
        var kbdNum = '' + (bi + 1);
        branchesHtml += '<div class="branch-row" data-action="branch" data-step="' + branch.target_step_index + '">'
          + '<span class="lbl">'
          + '<span class="kbd">' + kbdNum + '</span>'
          + '<span class="branch-text">' + esc(branch.label) + '</span>'
          + '</span>'
          + '<span class="target">' + ICON_CHEVRON + ' step ' + branch.target_step_index + '</span>'
          + '</div>';
      }

      var decisionHtml = '<div class="m-card">'
        + buildHead(flowId, current, total)
        + buildProgress(current, total)
        + buildStepMeta(current, total, flow.name, kind)
        + '<div class="walk-step">'
        + '<h2 class="walk-title">' + esc(decision.question || '') + '</h2>'
        + '<div class="walk-instr">Before picking a path, review the options carefully.</div>'
        + '<div class="walk-decision">'
        + '<p class="walk-decision-q">Pick the path Claude should follow:</p>'
        + '<p class="walk-decision-help">Walk Simulator follows the branch you pick and resumes the flow at the chosen target step.</p>'
        + '<div class="branches">' + branchesHtml + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="m-foot">'
        + '<div class="left">' + buildKbdHints(kind, hasPrev) + '</div>'
        + '<div class="right">'
        + (hasPrev ? '<button class="btn btn-ghost" data-action="back" data-step="' + prevIndex + '">Back</button>' : '')
        + '<button class="btn btn-secondary" data-action="advance" data-step="' + nextIndex + '">Skip step</button>'
        + '<button class="btn btn-primary" data-action="advance" data-step="' + nextIndex + '">Continue ' + ICON_CHEVRON + '</button>'
        + '</div>'
        + '</div>'
        + '</div>';
      document.getElementById('root').innerHTML = decisionHtml;
      return;
    }

    // ── Doc / Docs ──
    if (kind === 'doc' || kind === 'docs') {
      var sourcePath = '';
      if (step.source && step.source.doc_title) {
        sourcePath = step.source.doc_title;
      } else if (step.source && step.source.path) {
        sourcePath = step.source.path;
      } else if (step.source && typeof step.source === 'string') {
        sourcePath = step.source;
      }

      var docRefHtml = '<div class="walk-doc-ref">'
        + ICON_FILE
        + '<span>' + esc(step.title || '') + '</span>'
        + (sourcePath ? '<span class="path">' + esc(sourcePath) + '</span>' : '')
        + '</div>';

      var instrBlockHtml = step.instruction
        ? '<div class="walk-instr">' + esc(step.instruction) + '</div>'
        : '';

      // Show the actual doc content (markdown text from the referenced doc)
      var contentBlockHtml = (step.content && step.content.trim())
        ? '<div class="walk-doc-body"><pre>' + esc(step.content) + '</pre></div>'
        : '';

      var docHtml = '<div class="m-card">'
        + buildHead(flowId, current, total)
        + buildProgress(current, total)
        + buildStepMeta(current, total, flow.name, kind)
        + '<div class="walk-step">'
        + '<h2 class="walk-title">' + esc(step.title || '') + '</h2>'
        + docRefHtml
        + instrBlockHtml
        + contentBlockHtml
        + '</div>'
        + '<div class="m-foot">'
        + '<div class="left">' + buildKbdHints(kind, hasPrev) + '</div>'
        + '<div class="right">'
        + (hasPrev ? '<button class="btn btn-ghost" data-action="back" data-step="' + prevIndex + '">Back</button>' : '')
        + '<button class="btn btn-primary" data-action="advance" data-step="' + nextIndex + '">Continue ' + ICON_CHEVRON + '</button>'
        + '</div>'
        + '</div>'
        + '</div>';
      document.getElementById('root').innerHTML = docHtml;
      // Doc steps show content for the human to read — do NOT auto-advance.
      // (pause_for_user_input is false for doc steps as a hint to Claude,
      //  but the walk simulator always waits for the user to click Continue.)
      return;
    }

    // ── Instruction (default) ──
    var instrTitle = step.instruction || step.title || '';

    var instrHtml = '<div class="m-card">'
      + buildHead(flowId, current, total)
      + buildProgress(current, total)
      + buildStepMeta(current, total, flow.name, kind)
      + '<div class="walk-step">'
      + '<h2 class="walk-title">' + esc(instrTitle) + '</h2>'
      + '</div>'
      + '<div class="m-foot">'
      + '<div class="left">' + buildKbdHints(kind, hasPrev) + '</div>'
      + '<div class="right">'
      + (hasPrev ? '<button class="btn btn-ghost" data-action="back" data-step="' + prevIndex + '">Back</button>' : '')
      + '<button class="btn btn-primary" data-action="advance" data-step="' + nextIndex + '">Continue ' + ICON_CHEVRON + '</button>'
      + '</div>'
      + '</div>'
      + '</div>';
    document.getElementById('root').innerHTML = instrHtml;

    if (pause === false) {
      var instrNext = nextIndex;
      autoAdvanceTimer = setTimeout(function() {
        autoAdvanceTimer = null;
        navigate(instrNext);
      }, 600);
    }
  }

  function showError(msg, showRestart) {
    var html = '<div class="m-card">'
      + '<div class="m-head">'
      + '<div class="left">'
      + '<span class="glyph">&#x3BC;</span>'
      + '<span class="sep"></span>'
      + '<span class="tool">get_flow_step<span class="args">(&#x22;&#x22;)</span></span>'
      + '</div>'
      + '<span class="meta"><span class="dot"></span>LIVE</span>'
      + '</div>'
      + '<div class="state-error">' + esc(msg) + '</div>';
    if (showRestart) {
      html += '<div class="m-foot">'
        + '<div class="left"></div>'
        + '<div class="right"><button class="btn btn-secondary" data-action="restart">Restart</button></div>'
        + '</div>';
    }
    html += '</div>';
    document.getElementById('root').innerHTML = html;
  }

  function showLoading() {
    document.getElementById('root').innerHTML = '<div class="m-card">'
      + '<div class="m-head">'
      + '<div class="left">'
      + '<span class="glyph">&#x3BC;</span>'
      + '<span class="sep"></span>'
      + '<span class="tool">get_flow_step<span class="args">(&#x22;&#x22;)</span></span>'
      + '</div>'
      + '<span class="meta"><span class="dot"></span>LIVE</span>'
      + '</div>'
      + '<div class="state-loading">'
      + '<div class="skel" style="height:14px;width:100%"></div>'
      + '<div class="skel" style="height:14px;width:70%"></div>'
      + '<div class="skel" style="height:14px;width:40%"></div>'
      + '</div>'
      + '</div>';
  }

  function navigate(stepIndex) {
    if (isNav || !flowId) return;
    cancelAutoAdvance();
    isNav = true;
    showLoading();
    app.callServerTool({
      name: 'get_flow_step',
      arguments: { flow_id: flowId, step_index: stepIndex }
    }).then(function(result) {
      isNav = false;
      if (result.isError) {
        var errText = (result.content && result.content[0] && result.content[0].text)
          ? result.content[0].text
          : 'Navigation error';
        showError(errText, true);
        return;
      }
      var sc = result.structuredContent;
      if (!sc) {
        showError('No step data received.', true);
        return;
      }
      if (sc.error === 'flow_not_found') {
        showError('Flow not found. Check the slug and try again.', false);
        return;
      }
      if (sc.error === 'step_out_of_range') {
        showError('No more steps.', true);
        return;
      }
      renderStep(sc);
    }).catch(function(err) {
      isNav = false;
      showError(String(err), true);
    });
  }

  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    if (isNav) return;
    var action = el.getAttribute('data-action');
    if (action === 'advance' || action === 'branch' || action === 'back') {
      navigate(parseInt(el.getAttribute('data-step'), 10));
    } else if (action === 'restart') {
      cancelAutoAdvance();
      navigate(1);
    }
  });

  document.addEventListener('keydown', function(e) {
    if (isNav) return;
    var key = e.key;
    if (key === 'ArrowLeft') {
      var backBtn = document.querySelector('[data-action="back"]');
      if (backBtn) navigate(parseInt(backBtn.getAttribute('data-step'), 10));
    } else if (key === 'ArrowRight' || key === 'Enter') {
      var continueBtn = document.querySelector('[data-action="advance"]');
      if (continueBtn) navigate(parseInt(continueBtn.getAttribute('data-step'), 10));
    } else if (key >= '1' && key <= '9') {
      var idx = parseInt(key, 10) - 1;
      var branchRows = document.querySelectorAll('.branch-row[data-action="branch"]');
      if (branchRows[idx]) navigate(parseInt(branchRows[idx].getAttribute('data-step'), 10));
    }
  });

  function main() {
    var blob = new Blob([window.__sdk], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    import(url).then(function(mod) {
      URL.revokeObjectURL(url);
      var App = mod.App;
      var PostMessageTransport = mod.PostMessageTransport;

      app = new App({ name: 'flow-walk', version: '1.0.0' }, {}, { autoResize: true });

      app.ontoolresult = function(payload) {
        var sc = payload.structuredContent;
        var isError = payload.isError;
        if (isError || !sc) {
          showError('Tool error — no step data available.', true);
          return;
        }
        if (sc.flow && sc.flow.slug) {
          flowId = sc.flow.slug;
        }
        if (sc.error === 'flow_not_found') {
          showError('Flow not found. Check the slug and try again.', false);
          return;
        }
        if (sc.error === 'step_out_of_range') {
          showError('No more steps.', true);
          return;
        }
        renderStep(sc);
      };

      return app.connect(new PostMessageTransport(window.parent, window.parent));
    }).catch(function(err) {
      document.getElementById('root').innerHTML = '<div class="m-card"><div class="state-error">Failed to connect: ' + esc(String(err)) + '</div></div>';
    });
  }

  main();
})();
</script>
</body>
</html>`;

  return _html;
}
