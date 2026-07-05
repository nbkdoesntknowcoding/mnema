/**
 * Hello-world MCP App HTML bundle — Phase 10, Step 1.2.
 *
 * Temporary. Proves the protocol end-to-end through the Cloudflare tunnel
 * and OAuth before any write logic is added. Removed after verification.
 *
 * Self-contained: inlines app-with-deps.js via a runtime blob URL import.
 * CSP: no external origins declared (enforced by registerAppResource config).
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

export const PROBE_HTML: string = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mnema Probe</title>
<style>
:root {
  --canvas:#0A0B0D; --surface:#121317; --surface-2:#181A1F; --surface-3:#22252B;
  --line:rgba(255,255,255,0.06); --line-strong:rgba(255,255,255,0.12);
  --ink:#F4F5F7; --ink-soft:#B0B4BC; --ink-muted:#707479; --ink-faint:#3D4046;
  --accent-rgb:255,179,112; --accent:rgb(var(--accent-rgb));
  --accent-soft:rgba(var(--accent-rgb),0.14);
  --status-sync:#6BE39B; --status-error:#FF7A8A;
  --sans:"Geist",-apple-system,system-ui,sans-serif;
  --mono:"Geist Mono",ui-monospace,Menlo,Consolas,monospace;
}
*, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
body {
  background:var(--canvas); color:var(--ink);
  font-family:var(--sans); font-size:13px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
  padding:16px;
}
#s { font:500 12px/1.4 var(--sans); color:var(--ink-muted); margin-bottom:12px; }
#s.ok { color:var(--status-sync); }
#s.err { color:var(--status-error); }
#d {
  background:var(--surface-2);
  border:1px solid var(--line);
  border-radius:8px;
  padding:14px 16px;
  font:500 12px/1.6 var(--mono);
  white-space:pre-wrap;
  word-break:break-all;
  color:var(--ink-soft);
  max-height:400px;
  overflow-y:auto;
}
</style>
</head>
<body>
<div id="s">Connecting…</div>
<div id="d"></div>
<script>window.__sdk=${JSON.stringify(APP_WITH_DEPS_JS)};</script>
<script type="module">
(async()=>{
  var s=document.getElementById('s'),d=document.getElementById('d');
  function syntaxHighlight(json) {
    var escaped = json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(match) {
      var cls = 'color:var(--ink-soft)';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'color:#FFB370'; // accent -- keys
        } else {
          cls = 'color:var(--status-sync)'; // string values
        }
      } else if (/true|false/.test(match)) {
        cls = 'color:var(--status-sync)';
      } else if (/null/.test(match)) {
        cls = 'color:var(--ink-muted)';
      } else {
        cls = 'color:#7C9CFF'; // numbers = info blue
      }
      return '<span style="' + cls + '">' + match + '</span>';
    });
  }
  try {
    const blob=new Blob([window.__sdk],{type:'text/javascript'});
    const url=URL.createObjectURL(blob);
    const {App,PostMessageTransport}=await import(url);
    URL.revokeObjectURL(url);
    const app=new App({name:'mnema-probe',version:'1.0.0'},{},{autoResize:true});
    app.ontoolresult = function(payload) {
      var structuredContent = payload.structuredContent;
      var isError = payload.isError;
      s.textContent = isError ? 'Tool error' : 'Connected — result received';
      s.className = isError ? 'err' : 'ok';
      if (structuredContent) {
        d.innerHTML = syntaxHighlight(JSON.stringify(structuredContent, null, 2));
      } else {
        d.textContent = '(no structured content)';
      }
    };
    await app.connect(new PostMessageTransport(window.parent,window.parent));
    s.textContent='Connected — awaiting result…';
    s.className='ok';
  } catch(err) {
    s.textContent=String(err);
    s.className='err';
  }
})();
</script>
</body>
</html>`;
