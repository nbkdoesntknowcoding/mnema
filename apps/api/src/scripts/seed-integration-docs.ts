/**
 * Seed integration documentation docs into Mnema workspaces.
 *
 * Creates an "Integrations" folder and 8 setup guides for all supported AI apps.
 * Idempotent: checks doc titles before creating (safe to run multiple times).
 *
 * Run:          npx tsx src/scripts/seed-integration-docs.ts
 * Specific workspace: npx tsx src/scripts/seed-integration-docs.ts <workspaceId>
 * All workspaces:    npx tsx src/scripts/seed-integration-docs.ts --all
 */

import { and, eq, isNull } from 'drizzle-orm';
import { withSystemPrivilege } from '../db/with-system-privilege.js';
import { workspaces, folders, docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { emptyYjsState } from '../lib/yjs.js';

// createdBy is nullable on both folders and docs — use null for scripted seeding
const SYSTEM_USER_ID = null as unknown as string;

// ── Integration guide content ─────────────────────────────────────────────────

const CLAUDE_DESKTOP_GUIDE = `# Connecting Claude Desktop to Mnema

## Step 1 — Get your MCP URL
Go to Workspace Settings → Developer → Copy the MCP URL.

## Step 2 — Edit claude.json
Open \`~/.claude/claude.json\` (create if it doesn't exist) and add:

\`\`\`json
{
  "mcpServers": {
    "mnema": {
      "type": "sse",
      "url": "https://mnema.example.com/mcp"
    }
  }
}
\`\`\`

## Step 3 — Install session tracking hooks
\`\`\`bash
MNEMA_HOOK_TOKEN=<your_token> MNEMA_WORKSPACE_ID=<your_workspace_id> \\
  bash <(curl -sf https://mnema.example.com/install/claude-hooks.sh)
\`\`\`

## Step 4 — Restart Claude Desktop
Close and reopen Claude Desktop. The Mnema tools will appear in your tool list.

## Available tools
- \`list_docs\` — Browse your knowledge base
- \`get_doc\` — Read any document
- \`search_docs\` — Hybrid search across all docs
- \`get_next_task\` — Get your next task
- \`claim_task\` — Claim a task to work on
- \`complete_task\` — Mark task done
- \`log_blocker\` — Report a blocker
`;

const CHATGPT_GUIDE = `# Connecting ChatGPT to Mnema

## Step 1 — Get your API key
1. Open Mnema → Workspace Settings → API Keys
2. Click "Create API key"
3. Name it "ChatGPT" and select scopes: Read (required), Write (optional)
4. Copy the key — it won't be shown again

## Step 2 — Create a Custom GPT
1. Go to https://chat.openai.com/gpts/editor
2. Click "Configure"
3. Set name: "Mnema Assistant"
4. Set description: "I have access to your team's Mnema knowledge base."

## Step 3 — Add Mnema as an Action
1. Scroll to "Actions" → "Create new action"
2. In "Authentication": select "API Key", type "Bearer", paste your Mnema API key
3. In "Schema": paste the URL below and click "Import"
   \`https://mnema.example.com/api/public/openapi.json\`
4. Click "Save"

## GPT Instructions
Paste this into the Instructions field:

> You have access to a Mnema knowledge base via the Mnema Knowledge API.
> When the user asks about anything that might be documented in the workspace,
> search the knowledge base first using searchDocs before answering from memory.
> When returning information from Mnema docs, cite the doc title.

## What works
- Search across all workspace docs
- Read any specific doc by ID or title
- Walk through structured flows step by step
- Create new docs (if Write scope enabled)
`;

const GEMINI_GUIDE = `# Connecting Gemini to Mnema

## Step 1 — Get your API key
Workspace Settings → API Keys → Create key → name "Gemini", scope: Read

## Step 2 — Load Mnema function definitions

\`\`\`python
import requests
import google.generativeai as genai

# Fetch Mnema function definitions
functions = requests.get(
    'https://mnema.example.com/api/public/gemini-functions.json'
).json()['function_declarations']

# Configure Gemini with functions
model = genai.GenerativeModel(
    model_name='gemini-2.0-flash',
    tools=[{'function_declarations': functions}]
)
\`\`\`

## Step 3 — Handle function calls

\`\`\`python
MNEMA_API_KEY = 'mnema_api_your_key_here'
MNEMA_BASE = 'https://mnema.example.com/api/public/v1'

def call_mnema(function_name: str, parameters: dict) -> dict:
    response = requests.post(
        f'{MNEMA_BASE}/call',
        headers={'Authorization': f'Bearer {MNEMA_API_KEY}'},
        json={'function': function_name, 'parameters': parameters}
    )
    return response.json()['data']
\`\`\`

## Step 4 — Chat with your knowledge base

\`\`\`python
chat = model.start_chat()
response = chat.send_message(
    "What does our onboarding flow say about setting up the dev environment?"
)
# Gemini will call search_knowledge_base and get_doc automatically
\`\`\`
`;

const CURSOR_GUIDE = `# Connecting Cursor to Mnema

## Step 1 — Add MCP config
Edit \`~/.cursor/mcp.json\` (create if it doesn't exist):

\`\`\`json
{
  "mcpServers": {
    "mnema": {
      "type": "sse",
      "url": "https://mnema.example.com/mcp"
    }
  }
}
\`\`\`

## Step 2 — Install session tracking hooks
\`\`\`bash
MNEMA_HOOK_TOKEN=<your_token> MNEMA_WORKSPACE_ID=<your_workspace_id> \\
  bash <(curl -sf https://mnema.example.com/install/cursor-hooks.sh)
\`\`\`

## Step 3 — Restart Cursor
Cursor will automatically detect the MCP server on next startup.

## Notes
- Cursor uses the same hook format as Claude Code (PostToolUse)
- Session tracking is tagged with \`agent: "cursor"\` in AgentLens
- All Mnema tools are available (same as Claude Desktop)
`;

const WINDSURF_GUIDE = `# Connecting Windsurf to Mnema

## Step 1 — Add MCP config
Edit \`~/.windsurf/mcp.json\` (create if it doesn't exist):

\`\`\`json
{
  "mcpServers": {
    "mnema": {
      "type": "sse",
      "url": "https://mnema.example.com/mcp"
    }
  }
}
\`\`\`

## Step 2 — Install hooks (optional, for session tracking)
\`\`\`bash
MNEMA_HOOK_TOKEN=<your_token> MNEMA_WORKSPACE_ID=<your_workspace_id> \\
  bash <(curl -sf https://mnema.example.com/install/cursor-hooks.sh)
\`\`\`
The Cursor hooks script is compatible with Windsurf's PostToolUse format.

## Step 3 — Restart Windsurf
Windsurf will load the MCP server automatically.
`;

const CLINE_GUIDE = `# Connecting Cline to Mnema

## Step 1 — Add MCP server in VS Code
1. Open VS Code Command Palette: \`Cmd+Shift+P\` (macOS) or \`Ctrl+Shift+P\` (Windows)
2. Type: "Cline: Open MCP Settings"
3. Add the following server:

\`\`\`json
{
  "name": "mnema",
  "url": "https://mnema.example.com/mcp",
  "type": "sse"
}
\`\`\`

## Step 2 — Verify connection
In the Cline chat, type: "List my Mnema docs"

## Notes
- Session tracking (AgentLens) is not yet available for Cline (coming in Phase 5)
- All read and write MCP tools are available
`;

const CONTINUE_GUIDE = `# Connecting Continue.dev to Mnema

## Step 1 — Add MCP server
Edit \`~/.continue/config.json\` and add:

\`\`\`json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "sse",
          "url": "https://mnema.example.com/mcp"
        }
      }
    ]
  }
}
\`\`\`

## Step 2 — Reload Continue
Open VS Code Command Palette → "Continue: Focus Continue Input"

## Notes
- Continue.dev does not have a hook system — session tracking is not available
- All MCP read tools work: list_docs, get_doc, search_docs, list_flows, get_flow_step
`;

const API_REFERENCE = `# Mnema API Reference

## Authentication
All API requests require:
\`\`\`
Authorization: Bearer mnema_api_<your_key>
\`\`\`

Get your API key from Workspace Settings → API Keys.

## Base URL
\`https://mnema.example.com/api/public/v1\`

---

## Documents

### List docs
\`GET /docs?limit=20&cursor=<id>&folder=<name>\`

### Search docs
\`GET /docs/search?q=<query>&limit=10\`

### Get doc
\`GET /docs/:id\`

### Create doc
\`POST /docs\`
\`\`\`json
{ "title": "string", "markdown": "string", "folderId": "uuid (optional)" }
\`\`\`

### Update doc
\`PATCH /docs/:id\`
\`\`\`json
{ "title": "string (optional)", "markdown": "string (optional)" }
\`\`\`

### Append to doc
\`POST /docs/:id/append\`
\`\`\`json
{ "markdown": "string" }
\`\`\`

---

## Folders

### List folders
\`GET /folders\`

---

## Flows

### List flows
\`GET /flows\`

### Get flow
\`GET /flows/:slug\`

### Get flow step
\`GET /flows/:slug/steps/:stepIndex\`

---

## Tasks (dev_project workspaces only)

### Get next task
\`GET /tasks/next\`

### Claim task
\`POST /tasks/:id/claim\`

### Complete task
\`POST /tasks/:id/complete\`

### Log blocker
\`POST /tasks/:id/block\`

---

## Gemini function calling
\`GET /api/public/gemini-functions.json\` — function declarations
\`POST /api/public/v1/call\` — unified function dispatcher
\`\`\`json
{ "function": "search_knowledge_base", "parameters": { "query": "..." } }
\`\`\`

---

## OpenAPI spec
\`GET /api/public/openapi.json\` — OpenAPI 3.1 (for ChatGPT GPT Actions)
\`GET /api/public/openapi.yaml\` — YAML version
`;

// ── Doc definitions ───────────────────────────────────────────────────────────

interface DocDef {
  title: string;
  path: string;
  markdown: string;
}

const INTEGRATION_DOCS: DocDef[] = [
  { title: 'Claude Desktop Setup',  path: 'Integrations/claude-desktop-setup',  markdown: CLAUDE_DESKTOP_GUIDE },
  { title: 'ChatGPT Setup',         path: 'Integrations/chatgpt-setup',         markdown: CHATGPT_GUIDE },
  { title: 'Gemini Setup',          path: 'Integrations/gemini-setup',           markdown: GEMINI_GUIDE },
  { title: 'Cursor Setup',          path: 'Integrations/cursor-setup',           markdown: CURSOR_GUIDE },
  { title: 'Windsurf Setup',        path: 'Integrations/windsurf-setup',         markdown: WINDSURF_GUIDE },
  { title: 'Cline Setup',           path: 'Integrations/cline-setup',            markdown: CLINE_GUIDE },
  { title: 'Continue.dev Setup',    path: 'Integrations/continue-setup',         markdown: CONTINUE_GUIDE },
  { title: 'API Reference',         path: 'Integrations/api-reference',          markdown: API_REFERENCE },
];

// ── Per-workspace seeding ─────────────────────────────────────────────────────

async function seedForWorkspace(workspaceId: string, workspaceName: string): Promise<void> {
  console.log(`\n📦 Seeding: ${workspaceId} (${workspaceName})`);

  // 1. Find or create Integrations folder
  let folderId: string;

  const existingFolder = await withTenant(workspaceId, (tx) =>
    tx
      .select({ id: folders.id })
      .from(folders)
      .where(and(
        eq(folders.workspaceId, workspaceId),
        eq(folders.name, 'Integrations'),
        isNull(folders.deletedAt),
      ))
      .limit(1),
  );

  if (existingFolder[0]) {
    folderId = existingFolder[0].id;
    console.log(`  ↪ Folder "Integrations" already exists`);
  } else {
    const [created] = await withTenant(workspaceId, (tx) =>
      tx
        .insert(folders)
        .values({ workspaceId, name: 'Integrations', createdBy: SYSTEM_USER_ID })
        .returning({ id: folders.id }),
    );
    folderId = created!.id;
    console.log(`  ✔ Created folder "Integrations"`);
  }

  // 2. Get existing doc titles in this folder
  const existingDocs = await withTenant(workspaceId, (tx) =>
    tx
      .select({ title: docs.title })
      .from(docs)
      .where(and(
        eq(docs.workspaceId, workspaceId),
        eq(docs.folderId, folderId),
        isNull(docs.deletedAt),
      )),
  );
  const existingTitles = new Set(existingDocs.map((d) => d.title));

  // 3. Create missing docs
  let created = 0;
  let skipped = 0;

  for (const doc of INTEGRATION_DOCS) {
    if (existingTitles.has(doc.title)) {
      console.log(`  ↪ "${doc.title}" already exists`);
      skipped++;
      continue;
    }

    await withTenant(workspaceId, (tx) =>
      tx.insert(docs).values({
        workspaceId,
        folderId,
        path: doc.path,
        title: doc.title,
        markdown: doc.markdown,
        yjsState: emptyYjsState(),
        createdBy: SYSTEM_USER_ID,
      }),
    );
    console.log(`  ✔ Created "${doc.title}"`);
    created++;
  }

  console.log(`  → ${created} created, ${skipped} already existed`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const targetWorkspaceId = args.find((a) => !a.startsWith('--'));
  const seedAll = args.includes('--all');

  if (!targetWorkspaceId && !seedAll) {
    console.error('Usage:');
    console.error('  npx tsx src/scripts/seed-integration-docs.ts <workspaceId>');
    console.error('  npx tsx src/scripts/seed-integration-docs.ts --all');
    process.exit(1);
  }

  console.log('\n🌱 seed-integration-docs');

  if (targetWorkspaceId) {
    const ws = await withSystemPrivilege((tx) =>
      tx
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, targetWorkspaceId))
        .limit(1)
        .then((r) => r[0]),
    );
    if (!ws) {
      console.error(`Workspace ${targetWorkspaceId} not found`);
      process.exit(1);
    }
    await seedForWorkspace(ws.id, ws.name);
  } else {
    // --all: seed every workspace
    const allWorkspaces = await withSystemPrivilege((tx) =>
      tx.select({ id: workspaces.id, name: workspaces.name }).from(workspaces),
    );
    for (const ws of allWorkspaces) {
      await seedForWorkspace(ws.id, ws.name);
    }
  }

  console.log('\n✅ Done\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
