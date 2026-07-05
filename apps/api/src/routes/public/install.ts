/**
 * One-click MCP installer endpoints (Chunk B.1).
 *
 * GET /install/cursor?workspaceToken=<key>
 *   → cursor:// deep link that installs the Mnema MCP server in Cursor
 *
 * GET /install/cursor/config?workspaceToken=<key>
 *   → Raw mcp.json snippet for manual Cursor setup
 *
 * GET /install/windsurf?workspaceToken=<key>
 *   → windsurf:// deep link (same pattern as Cursor)
 *
 * GET /install/windsurf/config?workspaceToken=<key>
 *   → Raw config snippet for Windsurf
 *
 * All endpoints are public (no auth required) — the workspaceToken is
 * the user's API key, encoded into the deep link for their own client.
 */

import type { FastifyPluginAsync } from 'fastify';
import { config } from '../../config/env.js';

export const installRoutes: FastifyPluginAsync = async (app) => {
  const mcpBase = config.WEB_BASE_URL.replace(/\/$/, '');
  // MCP endpoint URL — use the production API URL so the deep link works
  // for users even when the API is tunnelled.
  const mcpUrl = `${process.env.PUBLIC_MCP_URL ?? mcpBase}/mcp`;

  // ── Cursor deep link ────────────────────────────────────────────────────────

  app.get('/install/cursor', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = q.workspaceToken ?? '';
    const serverUrl = token ? `${mcpUrl}?token=${encodeURIComponent(token)}` : mcpUrl;

    const configObj = { type: 'sse', url: serverUrl };
    const encoded = Buffer.from(JSON.stringify(configObj)).toString('base64url');

    // Cursor deep link format: cursor://anysphere.cursor-deeplink/mcp/install
    return reply.redirect(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=Mnema&config=${encoded}`,
      302,
    );
  });

  app.get('/install/cursor/config', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = q.workspaceToken ?? '';
    const serverUrl = token ? `${mcpUrl}?token=${encodeURIComponent(token)}` : mcpUrl;

    return reply.send({
      mcpServers: {
        mnema: { type: 'sse', url: serverUrl },
      },
    });
  });

  // ── Codex / OpenAI plugin manifest (B.2) ────────────────────────────────────

  const pluginManifest = {
    schema_version: 'v1',
    name_for_human: 'Mnema',
    name_for_model: 'mnema',
    description_for_human: "Connect your AI coding agent to your team's knowledge base.",
    description_for_model:
      'Mnema is a knowledge management system. Search and read workspace docs, ' +
      'walk structured flows step by step, and manage dev tasks. ' +
      'Always search Mnema before answering questions about codebases, architecture, or team processes.',
    auth: { type: 'user_http', authorization_type: 'bearer' },
    api: {
      type: 'openapi',
      url: `${process.env.PUBLIC_MCP_URL ?? mcpBase}/api/public/openapi.json`,
    },
    logo_url: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/logo.svg`,
    contact_email: 'hello@example.com',
    legal_info_url: `${process.env.WEB_BASE_URL ?? 'https://mnema.example.com'}/terms`,
  };

  app.get('/.well-known/ai-plugin.json', async (_req, reply) =>
    reply.header('Content-Type', 'application/json').send(pluginManifest),
  );
  app.get('/mcp/.well-known/ai-plugin.json', async (_req, reply) =>
    reply.header('Content-Type', 'application/json').send(pluginManifest),
  );

  // ── Windsurf deep link ──────────────────────────────────────────────────────

  app.get('/install/windsurf', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = q.workspaceToken ?? '';
    const serverUrl = token ? `${mcpUrl}?token=${encodeURIComponent(token)}` : mcpUrl;

    const configObj = { type: 'sse', url: serverUrl };
    const encoded = Buffer.from(JSON.stringify(configObj)).toString('base64url');

    // Windsurf deep link scheme (Codeium/Windsurf uses same pattern)
    return reply.redirect(
      `windsurf://codeium.windsurf-deeplink/mcp/install?name=Mnema&config=${encoded}`,
      302,
    );
  });

  app.get('/install/windsurf/config', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const token = q.workspaceToken ?? '';
    const serverUrl = token ? `${mcpUrl}?token=${encodeURIComponent(token)}` : mcpUrl;

    return reply.send({
      mcpServers: {
        mnema: { type: 'sse', url: serverUrl },
      },
    });
  });
};
