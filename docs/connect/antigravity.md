# Connect Antigravity to Mnema

Your endpoint is `https://<your-mnema-host>/mcp` (self-host default `http://localhost:8080/mcp`).

## Steps

1. Open Antigravity's MCP configuration (`~/.gemini/config/mcp_config.json`).
2. Add Mnema as an HTTP MCP server:

```json
{
  "mcpServers": {
    "mnema": { "url": "https://<your-mnema-host>/mcp" }
  }
}
```

3. Reload the IDE. The browser OAuth flow opens → sign in to Mnema → pick workspace → **Approve**.
4. Mnema's tools appear in the agent's tool list.

## Verify

Ask the agent: *"Use Mnema to list my documents."*

## Skill: mnema-direct-upload (bypass the doc-creation popup)

Antigravity surfaces a mandatory UI approval popup every time an agent creates a
document through the IDE. For bulk or large uploads that gets in the way. This
optional skill teaches the agent to call Mnema's REST/MCP surface directly —
one `upload_doc_file` tool call per file, no popups. Mnema's MCP transport is
stateless JSON, so a single JSON-RPC `tools/call` POST per file is all it takes.

Install it at `~/.gemini/config/skills/mnema-direct-upload/`:

```
mnema-direct-upload/
├── SKILL.md
└── scripts/
    └── upload.py
```

### SKILL.md

```markdown
---
name: mnema-direct-upload
description: Directly upload documents to Mnema via its REST API, bypassing IDE UI popups.
---
# Mnema Direct Upload

## Purpose
This skill bypasses the IDE's mandatory UI popups for document creation by
calling the Mnema REST API directly using JSON-RPC over HTTP POST.

Use this whenever you need to upload large documents, batch upload multiple
files, or if the user specifically requests to bypass the IDE's documentation
approval popup for Mnema.

## Prerequisites
- The script automatically reads the Bearer token from the user's
  `~/.gemini/config/mcp_config.json`.
- The Mnema `upload_doc_file` tool only accepts real `.docx` and `.pdf` files
  (it converts them to Markdown). The script uploads those directly and **skips**
  any other file type with a warning — it does not rename or convert them, since
  a renamed file (e.g. `notes.md` → `notes.docx`) is not valid OpenXML and fails
  at ingest.

## Usage
Run the bundled python script to upload one or more `.docx`/`.pdf` files:

    python3 ~/.gemini/config/skills/mnema-direct-upload/scripts/upload.py report.docx spec.pdf
```

### scripts/upload.py

```python
#!/usr/bin/env python3
"""Upload files to Mnema as docs via the MCP endpoint (JSON-RPC over HTTP).

Bypasses IDE document-creation popups by calling the upload_doc_file tool
directly. Reads the server URL and Bearer token from the Antigravity MCP
config (~/.gemini/config/mcp_config.json) — connect Mnema in the IDE once
first so the token exists.

Usage: python upload.py <file> [<file> ...]
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

CONFIG_PATH = Path.home() / ".gemini" / "config" / "mcp_config.json"


def find_mnema_server(cfg):
    servers = cfg.get("mcpServers") or cfg.get("servers") or {}
    entries = list(servers.items())
    # Prefer an entry named/pointing at mnema; fall back to the first /mcp URL.
    for prefer_mnema in (True, False):
        for name, server in entries:
            url = server.get("url") or server.get("serverUrl") or ""
            if "/mcp" not in url:
                continue
            if prefer_mnema and "mnema" not in (name + url).lower():
                continue
            return url, server
    raise SystemExit(f"No Mnema MCP server found in {CONFIG_PATH}")


def bearer_token(server):
    headers = server.get("headers") or {}
    auth = headers.get("Authorization") or headers.get("authorization") or ""
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):]
    token = server.get("bearerToken") or server.get("token")
    if token:
        return token
    raise SystemExit(
        "No Bearer token on the Mnema server entry - connect once via the IDE first."
    )


def upload(url, token, path, req_id):
    filename = path.name
    payload = {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "tools/call",
        "params": {
            "name": "upload_doc_file",
            "arguments": {
                "filename": filename,
                "content_base64": base64.b64encode(path.read_bytes()).decode(),
            },
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req) as res:
        result = json.loads(res.read().decode())
    if result.get("error"):
        raise SystemExit(f"{path}: {result['error'].get('message', result['error'])}")
    print(f"uploaded {path} as {filename}")


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: python upload.py <file> [<file> ...]")
    cfg = json.loads(CONFIG_PATH.read_text())
    url, server = find_mnema_server(cfg)
    token = bearer_token(server)
    req_id = 0
    for arg in sys.argv[1:]:
        path = Path(arg)
        if path.suffix.lower() not in (".docx", ".pdf"):
            print(f"skipped {path}: only .docx and .pdf are supported")
            continue
        req_id += 1
        upload(url, token, path, req_id)


if __name__ == "__main__":
    main()
```

Notes:

- Max upload size is 20 MB per file; Mnema converts the file to Markdown and
  stores it as a doc (the tool returns the new doc id).
- The MCP OAuth token in `mcp_config.json` is short-lived on some setups — if
  uploads start returning `401`, reconnect Mnema in the IDE to refresh it.

## Troubleshooting

- **Server shows as failed:** confirm the URL ends in `/mcp` and the host is
  reachable from your machine; `POST /mcp` should return `401` until
  authenticated.
- **No auth prompt:** remove and re-add the server entry to re-trigger the
  OAuth flow.
