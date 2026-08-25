# mnema-brain

**Self-hostable shared brain for you and your AI agents — docs, flows, meetings, decisions, rationale**

Mnema is a self-hostable workspace that people and AI agents share. Docs,
step-by-step flows, meetings, tasks and decisions live in one place; every
connected assistant — Claude, ChatGPT, Cursor, Windsurf, or your own app via
the API — reads the current version live and writes back through a human
approval gate. A knowledge graph builds itself from the work, so the reasoning
behind a decision stays queryable months later. Fair-code; self-host in about
four minutes.

## Install

```
/plugin marketplace add nbkdoesntknowcoding/mnema
/plugin install mnema-brain@mnema
```

Then run `/mcp` and authenticate with `mnema`. Auth is OAuth 2.1 with PKCE —
there is no API key to paste, and nothing to copy into a config file.

## What you get

| Capability | What it does |
| :--- | :--- |
| **MCP server** | The full Mnema tool surface — docs, search, flows, tasks, decisions, the knowledge graph |
| **Skills** | `first-run`, `capture-decision`, `catch-up`, `ask-the-brain` |
| **Capture hook** | Optional. Records sessions, cost and files touched against the task you are working on |

## Self-hosting

Set **Mnema API origin** in the plugin's settings to your own instance. Nothing
else changes — the plugin talks to whatever origin you point it at.

## The capture hook is optional, and off until configured

Without a capture token the hook is a deliberate no-op: every tool still works.
To turn capture on, set **Capture token** and **Workspace id** from
Settings → Developer in Mnema.

It sends metadata and file **paths** only — never file contents — and always
exits 0, so it can never block a session.

### If you already ran `mnema hooks install`

The `mnema` CLI installs the same capture by writing entries into your own
`~/.claude/settings.json`. This plugin registers them declaratively instead and
**never touches your settings file**. Running both double-fires every event.
Pick one:

```
mnema hooks uninstall
```

…then configure the token here. Or skip the plugin's token and keep the CLI.

## Licence

Fair-code, under the Sustainable Use License — source-available, free to use and
self-host, with limits on reselling it as a competing service. See
[LICENSE](../../LICENSE).

- Homepage: https://mnema.theboringpeople.in
- Repository: https://github.com/nbkdoesntknowcoding/mnema
- Also in the Official MCP Registry as `in.theboringpeople/mnema`
