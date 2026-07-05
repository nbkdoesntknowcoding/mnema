import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { registerAppTool, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpAuthContext } from './auth.js';
import { mcpConfig } from './config.js';
import { McpForbiddenError } from './scope.js';
import { PRODUCTION_TOOLS } from './tools/index.js';
import { DEV_TOOLS } from './tools/dev/index.js';
import { callTestProbe, isTestProbeName, registerTestProbe } from './_test-probe.js';
import { PROBE_HTML } from './apps/probe-html.js';
import { getWritePreviewHtml } from './apps/write-preview-html.js';
import { getFlowWalkHtml } from './apps/flow-walk-html.js';
import { getFlowBuilderHtml } from './apps/flow-builder-html.js';
import { getGraphExplorerHtml } from './apps/graph-explorer-html.js';
import { GET_FLOW_STEP_TOOL, getFlowStepStructured } from './tools/get-flow-step.js';
import { GET_FLOW_TOOL, getFlowStructured } from './tools/get-flow.js';
import {
  PROPOSE_DOC_WRITE_TOOL_NAME,
  PROPOSE_DOC_WRITE_TOOL_SPEC,
  proposeDocWrite,
} from './tools/propose-doc-write.js';
import { ADD_DIAGRAM_TOOL_NAME, ADD_DIAGRAM_TOOL_SPEC, addDiagram } from './tools/add-diagram.js';
import { ADD_CHART_TOOL_NAME, ADD_CHART_TOOL_SPEC, addChart } from './tools/add-chart.js';
import {
  INGEST_DATASET_TOOL_NAME, INGEST_DATASET_TOOL_SPEC, ingestDatasetTool,
  DESCRIBE_DATASET_TOOL_NAME, DESCRIBE_DATASET_TOOL_SPEC, describeDatasetTool,
} from './tools/datasets.js';
import {
  COMMIT_DOC_WRITE_TOOL_NAME,
  COMMIT_DOC_WRITE_TOOL_SPEC,
  commitProposedWrite,
} from './tools/commit-proposed-write.js';
import {
  CONFIRM_DOC_WRITE_TOOL_NAME,
  CONFIRM_DOC_WRITE_TOOL_SPEC,
  confirmDocWrite,
} from './tools/confirm-doc-write.js';
import {
  PROPOSE_TRASH_FOLDER_TOOL_NAME,
  PROPOSE_TRASH_FOLDER_TOOL_SPEC,
  proposeTrashFolder,
} from './tools/propose-trash-folder.js';
import {
  COMMIT_TRASH_FOLDER_TOOL_NAME,
  COMMIT_TRASH_FOLDER_TOOL_SPEC,
  commitTrashFolder,
} from './tools/commit-trash-folder.js';
import {
  PROPOSE_FLOW_PUBLISH_TOOL_NAME,
  PROPOSE_FLOW_PUBLISH_TOOL_SPEC,
  proposeFlowPublish,
} from './tools/propose-flow-publish.js';
import {
  COMMIT_FLOW_PUBLISH_TOOL_NAME,
  COMMIT_FLOW_PUBLISH_TOOL_SPEC,
  commitFlowPublish,
} from './tools/commit-flow-publish.js';
import { getEeMcpTools } from '../lib/load-ee.js';

/**
 * Build a fresh McpServer instance per request, capturing the verified
 * caller context in handler closures.
 *
 * Phase 10: migrated from low-level `Server` + setRequestHandler to `McpServer`
 * from @modelcontextprotocol/sdk/server/mcp.js. This enables use of
 * registerAppTool / registerAppResource from @modelcontextprotocol/ext-apps/server
 * to serve interactive HTML UIs in the conversation (MCP Apps).
 *
 * Why per-request: the MCP SDK's handler callbacks don't take a context bag —
 * request-scoped state (user/tenant) has to live in a closure. Module-level
 * context would be a catastrophic cross-tenant leak under concurrent requests.
 */

const WRITE_PREVIEW_RESOURCE_URI = 'ui://mnema/write-preview.html';
const PROBE_RESOURCE_URI = 'ui://mnema/probe.html';
const FLOW_WALK_RESOURCE_URI = 'ui://mnema/flow-walk.html';
const FLOW_BUILDER_RESOURCE_URI = 'ui://mnema/flow-builder.html';
const API_ORIGIN = process.env.MCP_BASE_URL ?? 'https://api.example.com';

// ── JSON Schema → Zod raw shape converter ──────────────────────────────────
// SDK 1.29.0 requires registerTool to receive a Zod schema or raw Zod shape.
// Our tool specs carry plain JSON Schema objects for client documentation.
// This converter bridges the two so the SDK stays happy while tools/list
// still returns a proper (though simplified) schema for Claude to read.
// Real arg validation happens inside each handler via its own argsSchema.
//
// IMPORTANT: 'object' and 'array' types must map to permissive Zod types so
// the SDK publishes them correctly in tools/list. Without this, the SDK falls
// through to z.string() and Claude passes objects as JSON strings — the handler
// then rejects with "expected object, received string".
//
// ALL FIELDS ARE MADE OPTIONAL at the SDK level — this prevents the SDK's
// validateToolInput() step from throwing McpError before our handler runs.
// If validateToolInput throws, the SDK returns createToolError() with NO
// structuredContent, which means the MCP Apps panel never opens.
// By making everything optional here, validateToolInput always succeeds and
// the handler runs — handlers catch validation errors themselves and always
// return structuredContent so the panel can open even on error.
type JsonSchemaProp = { type?: string; description?: string; enum?: string[]; minimum?: number; maximum?: number };
type JsonSchemaObj = { type?: string; properties?: Record<string, JsonSchemaProp>; required?: string[] };

// Returns undefined for no-property schemas so the SDK treats the tool as
// accepting any input (SDK rejects an empty {} object at runtime).
export function jsonSchemaToZodShape(schema: object): Record<string, z.ZodTypeAny> | undefined {
  const s = schema as JsonSchemaObj;
  const entries = Object.entries(s.properties ?? {});
  if (entries.length === 0) return undefined;
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of entries) {
    let field: z.ZodTypeAny;
    // String enums → z.enum so the valid values are PUBLISHED in tools/list (the model
    // sees them and can't guess wrong) AND enforced. Without this the enum was silently
    // dropped here and the param was published as a bare string. (Tier 4 schema tightening.)
    if (Array.isArray(prop.enum) && prop.enum.length > 0 && (prop.type === undefined || prop.type === 'string')) {
      field = z.enum(prop.enum as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case 'number':
        case 'integer': {
          // Coerce for integer too: clients that serialise integers as strings still pass.
          let num = prop.type === 'integer' ? z.coerce.number().int() : z.coerce.number();
          // Honor JSON-schema bounds so they're published + enforced (Tier 4).
          if (typeof prop.minimum === 'number') num = num.min(prop.minimum);
          if (typeof prop.maximum === 'number') num = num.max(prop.maximum);
          field = num;
          break;
        }
        case 'boolean': field = z.boolean(); break;
        // Object fields (e.g. `data`, `position`): use a permissive record so the
        // SDK publishes type:object in tools/list and Claude sends a real object.
        // The handler's own argsSchema does the precise structural validation.
        case 'object':  field = z.record(z.unknown()); break;
        // Array fields: use a permissive array for the same reason.
        case 'array':   field = z.array(z.unknown()); break;
        default:        field = z.string(); break;
      }
    }
    if (prop.description) field = field.describe(prop.description);
    // Always optional — see comment above. Handler validates required fields.
    shape[key] = field.optional();
  }
  return shape;
}

export function createMcpServer(ctx: McpAuthContext): McpServer {
  const mcpServer = new McpServer(
    {
      name: mcpConfig.serverName,
      title: mcpConfig.serverTitle,
      version: mcpConfig.serverVersion,
    },
    { instructions: mcpConfig.serverDescription },
  );

  // ── Register all existing production tools ──────────────────────────────────
  for (const { spec, handler } of PRODUCTION_TOOLS) {
    // Test-only probes are registered separately below — skip if in test mode
    // to avoid duplicate registration; they'll be added via the probe path.
    mcpServer.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: jsonSchemaToZodShape(spec.inputSchema),
        annotations: spec.annotations,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        if (process.env.NODE_ENV === 'test' && isTestProbeName(spec.name)) {
          const result = await callTestProbe(ctx, spec.name, args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
        try {
          const result = await handler(ctx, args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (err) {
          if (err instanceof McpForbiddenError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      },
    );
  }

  // ── Phase 1 AgentLens: dev MCP tools (dev_project workspaces only) ──────────
  // Dev tools are INVISIBLE in tools/list for knowledge-mode workspaces.
  // They are only registered when workspace.mode === 'dev_project'.
  if (ctx.workspaceMode === 'dev_project') {
    for (const { spec, handler } of DEV_TOOLS) {
      mcpServer.registerTool(
        spec.name,
        {
          description: spec.description,
          inputSchema: jsonSchemaToZodShape(spec.inputSchema),
          annotations: spec.annotations as { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string } | undefined,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (args: any) => {
          try {
            const result = await handler(ctx, args as Record<string, unknown>);
            return {
              content: [{ type: 'text' as const, text: result.content }],
              ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { isError: true, content: [{ type: 'text' as const, text: message }] };
          }
        },
      );
    }
  }

  // ── Test-only probe tool ────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'test') {
    for (const probeDef of registerTestProbe()) {
      mcpServer.registerTool(
        probeDef.name,
        {
          description: probeDef.description,
          inputSchema: jsonSchemaToZodShape(probeDef.inputSchema as object),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (args: any) => {
          try {
            const result = await callTestProbe(ctx, probeDef.name, args as Record<string, unknown>);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
          } catch (err) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: `Test probe error: ${err instanceof Error ? err.message : String(err)}` }],
            };
          }
        },
      );
    }
  }

  // ── Phase 10: propose_doc_write (model-visible, ["model"]) ──────────────────
  registerAppTool(
    mcpServer,
    PROPOSE_DOC_WRITE_TOOL_NAME,
    {
      description: PROPOSE_DOC_WRITE_TOOL_SPEC.description,
      inputSchema: jsonSchemaToZodShape(PROPOSE_DOC_WRITE_TOOL_SPEC.inputSchema),
      annotations: PROPOSE_DOC_WRITE_TOOL_SPEC.annotations,
      _meta: {
        ui: {
          resourceUri: WRITE_PREVIEW_RESOURCE_URI,
          visibility: ['model'],
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      try {
        const result = await proposeDocWrite(ctx, args as Record<string, unknown>);
        if (result.error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: result.message ?? result.error }],
            // Always include structuredContent — Claude Desktop only opens the panel when present.
            structuredContent: { error: result.error, message: result.message ?? result.error },
          };
        }
        return {
          content: [{ type: 'text' as const, text: result.content }],
          structuredContent: result.structuredContent,
        };
      } catch (err) {
        // Never re-throw for propose tools — a thrown error produces a bare MCP error
        // with no structuredContent, which means the panel never opens. Instead return
        // isError:true with structuredContent so the panel opens and shows the error.
        const isForbidden = err instanceof McpForbiddenError;
        const message = isForbidden
          ? `This MCP token lacks workspace:write scope.`
          : (err instanceof Error ? err.message : String(err));
        return {
          isError: true,
          content: [{ type: 'text' as const, text: message }],
          structuredContent: { error: isForbidden ? 'forbidden' : 'handler_error', message },
        };
      }
    },
  );

  // ── Phase 10: model-visible propose_* tools (["model"]) ────────────────────
  // Shared registration helper for propose_* tools (open the write-preview UI).
  // The preview panel works in both Claude Desktop and Cursor/Windsurf —
  // Cursor loads the panel HTML via the ext-apps resourceUri, which now uses
  // a data: URL fallback so VSCode webview CSP doesn't block it.
  const registerProposeTool = (
    name: string,
    spec: { description: string; inputSchema: object; annotations?: Record<string, unknown> },
    handler: (
      c: McpAuthContext,
      a: Record<string, unknown>,
    ) => Promise<{ content: string; structuredContent: Record<string, unknown>; error?: string; message?: string }>,
  ) => {
    // registerAppTool unconditionally reads _meta.ui — must always be present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolConfig: any = {
      description: spec.description,
      inputSchema: jsonSchemaToZodShape(spec.inputSchema),
      annotations: spec.annotations,
      _meta: {
        ui: { resourceUri: WRITE_PREVIEW_RESOURCE_URI, visibility: ['model'] },
      },
    };

    registerAppTool(
      mcpServer,
      name,
      toolConfig,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        try {
          const result = await handler(ctx, args as Record<string, unknown>);
          if (result.error) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: result.message ?? result.error }],
              structuredContent: { error: result.error, message: result.message ?? result.error },
            };
          }
          return {
            content: [{ type: 'text' as const, text: result.content }],
            structuredContent: result.structuredContent,
          };
        } catch (err) {
          // Never re-throw for propose tools (see propose_doc_write handler above).
          const isForbidden = err instanceof McpForbiddenError;
          const message = isForbidden
            ? `This MCP token lacks workspace:write scope.`
            : (err instanceof Error ? err.message : String(err));
          return {
            isError: true,
            content: [{ type: 'text' as const, text: message }],
            structuredContent: { error: isForbidden ? 'forbidden' : 'handler_error', message },
          };
        }
      },
    );
  };

  // Shared registration helper for commit_* tools (app-only, UI-triggered).
  const registerCommitTool = (
    name: string,
    spec: { description: string; inputSchema: object; annotations?: Record<string, unknown> },
    handler: (
      c: McpAuthContext,
      a: Record<string, unknown>,
    ) => Promise<{ error?: string; message?: string }>,
  ) => {
    registerAppTool(
      mcpServer,
      name,
      {
        description: spec.description,
        inputSchema: jsonSchemaToZodShape(spec.inputSchema),
        annotations: spec.annotations,
        _meta: {
          ui: {
            // No resourceUri: commit tools are only called from the write-preview
            // iframe, not associated with a new resource.
            visibility: ['app'], // HIDDEN from model — only the iframe Approve button can call this
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        try {
          const result = await handler(ctx, args as Record<string, unknown>);
          if (result.error) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: result.message ?? String(result.error) }],
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (err) {
          if (err instanceof McpForbiddenError) throw err;
          const message = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      },
    );
  };

  // ── Phase 10: commit_doc_write (app-only, ["app"]) ─────────────────────────
  registerCommitTool(COMMIT_DOC_WRITE_TOOL_NAME, COMMIT_DOC_WRITE_TOOL_SPEC, commitProposedWrite);

  // ── Phase 10: confirm_doc_write (model-callable, ["model"]) — Claude Code ──
  // CLI/Claude Code doesn't render the MCP Apps panel, so the model calls this
  // after showing the user the proposed diff and receiving chat confirmation.
  registerAppTool(
    mcpServer,
    CONFIRM_DOC_WRITE_TOOL_NAME,
    {
      description: CONFIRM_DOC_WRITE_TOOL_SPEC.description,
      inputSchema: jsonSchemaToZodShape(CONFIRM_DOC_WRITE_TOOL_SPEC.inputSchema),
      annotations: CONFIRM_DOC_WRITE_TOOL_SPEC.annotations,
      _meta: {
        ui: {
          // No resourceUri — this tool has no panel; it fires a direct commit.
          visibility: ['model'], // AI-callable; NOT the app/iframe
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      try {
        const result = await confirmDocWrite(ctx, args as Record<string, unknown>);
        if (result.error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: result.message ?? result.error }],
          };
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        if (err instanceof McpForbiddenError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    },
  );

  // ── Phase 10 Chunk 2: propose/commit trash_folder ──────────────────────────
  registerProposeTool(PROPOSE_TRASH_FOLDER_TOOL_NAME, PROPOSE_TRASH_FOLDER_TOOL_SPEC, proposeTrashFolder);
  registerCommitTool(COMMIT_TRASH_FOLDER_TOOL_NAME, COMMIT_TRASH_FOLDER_TOOL_SPEC, commitTrashFolder);

  // ── Phase 10 Chunk 2: propose/commit flow_publish ──────────────────────────
  registerProposeTool(PROPOSE_FLOW_PUBLISH_TOOL_NAME, PROPOSE_FLOW_PUBLISH_TOOL_SPEC, proposeFlowPublish);
  registerCommitTool(COMMIT_FLOW_PUBLISH_TOOL_NAME, COMMIT_FLOW_PUBLISH_TOOL_SPEC, commitFlowPublish);

  // ── Diagram Phase 1: add_diagram (propose-style; commits via confirm_doc_write) ───────────
  registerProposeTool(ADD_DIAGRAM_TOOL_NAME, ADD_DIAGRAM_TOOL_SPEC, addDiagram);

  // ── Charting Phase 1: add_chart (propose-style; library-rendered data chart) ──────────────
  registerProposeTool(ADD_CHART_TOOL_NAME, ADD_CHART_TOOL_SPEC, addChart);

  // ── Charting Phase 2: dataset store (ingest_dataset / describe_dataset) ───────────────────
  const registerDatasetTool = (
    name: string,
    spec: { description: string; inputSchema: object; annotations?: Record<string, unknown> },
    handler: (c: McpAuthContext, a: Record<string, unknown>) => Promise<{ content: string; structuredContent: Record<string, unknown>; error?: string }>,
  ): void => {
    registerAppTool(
      mcpServer,
      name,
      {
        description: spec.description,
        inputSchema: jsonSchemaToZodShape(spec.inputSchema),
        annotations: spec.annotations,
        _meta: { ui: { visibility: ['model'] } },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any) => {
        const r = await handler(ctx, args as Record<string, unknown>);
        return {
          ...(r.error ? { isError: true as const } : {}),
          content: [{ type: 'text' as const, text: r.content }],
          structuredContent: r.structuredContent,
        };
      },
    );
  };
  registerDatasetTool(INGEST_DATASET_TOOL_NAME, INGEST_DATASET_TOOL_SPEC, ingestDatasetTool);
  registerDatasetTool(DESCRIBE_DATASET_TOOL_NAME, DESCRIBE_DATASET_TOOL_SPEC, describeDatasetTool);

  // ── Phase 10: __ui_probe (dev/test only — temporary) ───────────────────────
  if (process.env.NODE_ENV !== 'production') {
    registerAppTool(
      mcpServer,
      '__ui_probe',
      {
        description: 'TEMPORARY — proves the MCP Apps protocol end-to-end. Remove after verification.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: undefined,
        _meta: {
          ui: {
            resourceUri: PROBE_RESOURCE_URI,
            visibility: ['model'],
          },
        },
      },
      async () => {
        return {
          content: [{ type: 'text' as const, text: 'MCP Apps probe triggered. Check the panel.' }],
          structuredContent: {
            workspace_name: ctx.tenant_id,
            user_id: ctx.user_id,
            probe: 'connected',
            timestamp: new Date().toISOString(),
          },
        };
      },
    );
  }

  // ── Phase 10: UI resources ──────────────────────────────────────────────────

  // Write-preview HTML resource (production + all envs)
  registerAppResource(
    mcpServer,
    'Write Preview',
    WRITE_PREVIEW_RESOURCE_URI,
    {
      description: 'Mnema write-preview panel — shows proposed content with Approve/Reject.',
    },
    async () => ({
      contents: [{
        uri: WRITE_PREVIEW_RESOURCE_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: getWritePreviewHtml(),
        _meta: {
          ui: {
            csp: {
              connectDomains: [API_ORIGIN],
            },
          },
        },
      }],
    }),
  );

  // Probe HTML resource (dev/test only)
  if (process.env.NODE_ENV !== 'production') {
    registerAppResource(
      mcpServer,
      'Mnema Probe',
      PROBE_RESOURCE_URI,
      {
        description: 'Temporary hello-world MCP App probe.',
      },
      async () => ({
        contents: [{
          uri: PROBE_RESOURCE_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: PROBE_HTML,
        }],
      }),
    );
  }

  // ── Phase 11 Chunk A: get_flow_step as App tool (Walk Simulator UI) ─────────
  registerAppTool(
    mcpServer,
    GET_FLOW_STEP_TOOL.name,
    {
      description: GET_FLOW_STEP_TOOL.description,
      inputSchema: jsonSchemaToZodShape(GET_FLOW_STEP_TOOL.inputSchema),
      annotations: GET_FLOW_STEP_TOOL.annotations,
      _meta: {
        ui: {
          resourceUri: FLOW_WALK_RESOURCE_URI,
          visibility: ['model'],
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      try {
        const result = await getFlowStepStructured(ctx, args as Record<string, unknown>);
        if (result.isError) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: result.content }],
            structuredContent: result.structuredContent,
          };
        }
        return {
          content: [{ type: 'text' as const, text: result.content }],
          structuredContent: result.structuredContent,
        };
      } catch (err) {
        if (err instanceof McpForbiddenError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    },
  );

  // ── Phase 11 Chunk A: Walk Simulator HTML resource ──────────────────────────
  registerAppResource(
    mcpServer,
    'Flow Walk',
    FLOW_WALK_RESOURCE_URI,
    {
      description: 'Mnema flow walk panel — interactive step-by-step flow walker with branch navigation.',
    },
    async () => ({
      contents: [{
        uri: FLOW_WALK_RESOURCE_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: getFlowWalkHtml(),
        _meta: {
          ui: {
            csp: {
              connectDomains: [API_ORIGIN],
            },
          },
        },
      }],
    }),
  );

  // ── Phase 12 Chunk A: get_flow as App tool (Flow Builder Canvas) ────────────
  registerAppTool(
    mcpServer,
    GET_FLOW_TOOL.name,
    {
      description: GET_FLOW_TOOL.description,
      inputSchema: jsonSchemaToZodShape(GET_FLOW_TOOL.inputSchema),
      annotations: GET_FLOW_TOOL.annotations,
      _meta: {
        ui: {
          resourceUri: FLOW_BUILDER_RESOURCE_URI,
          visibility: ['model'],
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => {
      try {
        const result = await getFlowStructured(ctx, args as Record<string, unknown>);
        if (result.isError) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: result.content }],
            structuredContent: result.structuredContent,
          };
        }
        return {
          content: [{ type: 'text' as const, text: result.content }],
          structuredContent: result.structuredContent,
        };
      } catch (err) {
        if (err instanceof McpForbiddenError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: 'text' as const, text: message }] };
      }
    },
  );

  // ── Phase 12 Chunk A: Flow Builder HTML resource ────────────────────────────
  registerAppResource(
    mcpServer,
    'Flow Builder',
    FLOW_BUILDER_RESOURCE_URI,
    {
      description: 'Mnema flow builder canvas — visual graph of a flow draft with node detail drawer.',
    },
    async () => ({
      contents: [{
        uri: FLOW_BUILDER_RESOURCE_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: getFlowBuilderHtml(),
        _meta: {
          ui: {
            csp: {
              connectDomains: [API_ORIGIN],
            },
          },
        },
      }],
    }),
  );

  // ── Knowledge Graph panel resource ────────────────────────────────────────
  const GRAPH_EXPLORER_URI = 'ui://mnema/graph-explorer.html';
  registerAppResource(
    mcpServer,
    'Knowledge Graph Explorer',
    GRAPH_EXPLORER_URI,
    { description: 'D3 force-directed knowledge graph — nodes, edges, god-nodes, communities, traversal paths.' },
    async () => ({
      contents: [{
        uri: GRAPH_EXPLORER_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: getGraphExplorerHtml(),
        _meta: { ui: { csp: { connectDomains: [API_ORIGIN] } } },
      }],
    }),
  );

  // ── Knowledge Graph tools (both workspace modes) ───────────────────────────

  const registerGraphTool = (
    spec: { name: string; description: string; inputSchema: object; annotations?: Record<string, unknown> },
    handler: (c: McpAuthContext, a: Record<string, unknown>) => Promise<{ content: string; structuredContent: Record<string, unknown> }>,
    withPanel = false,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolConfig: any = {
      description: spec.description,
      inputSchema: jsonSchemaToZodShape(spec.inputSchema),
      annotations: spec.annotations,
    };
    if (withPanel) {
      toolConfig._meta = { ui: { resourceUri: GRAPH_EXPLORER_URI, visibility: ['model'] } };
    }
    const register = withPanel ? registerAppTool : mcpServer.registerTool.bind(mcpServer);
    if (withPanel) {
      registerAppTool(mcpServer, spec.name, toolConfig, async (args: any) => {
        try {
          const result = await handler(ctx, args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: result.content }], structuredContent: result.structuredContent };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: 'text' as const, text: message }], structuredContent: { error: message } };
        }
      });
    } else {
      mcpServer.registerTool(spec.name, toolConfig, async (args: any) => {
        try {
          const result = await handler(ctx, args as Record<string, unknown>);
          return { content: [{ type: 'text' as const, text: result.content }], structuredContent: result.structuredContent };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      });
    }
  };

  // Phase 3 — the gated graph + meeting MCP tools register via the ee module
  // (preloaded at boot, lib/load-ee.ts). Absent in the public build → they
  // simply don't appear. registerGraphTool is the registrar the ee module uses.
  getEeMcpTools()?.registerEeMcpTools(registerGraphTool);

  return mcpServer;
}
