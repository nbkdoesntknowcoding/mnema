/**
 * OpenAPI spec endpoints.
 * GET /api/public/openapi.json — JSON (no auth — public schema document)
 * GET /api/public/openapi.yaml — YAML
 */

import type { FastifyPluginAsync } from 'fastify';
import { OPENAPI_SPEC } from '../../lib/openapi-spec.js';

// Minimal YAML serialiser for the spec (avoids a heavy dep).
function toYaml(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'boolean') return obj.toString();
  if (typeof obj === 'number') return obj.toString();
  if (typeof obj === 'string') {
    if (obj.includes('\n')) return `|\n${obj.split('\n').map((l) => `${pad}  ${l}`).join('\n')}`;
    if (/[:{}\[\]#,&|>!%@`]/.test(obj) || obj.trim() !== obj) return JSON.stringify(obj);
    return obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => `\n${pad}- ${toYaml(item, indent + 1).trimStart()}`).join('');
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      const val = toYaml(v, indent + 1);
      const isBlock = typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v as object).length > 0;
      const isArr   = Array.isArray(v) && (v as unknown[]).length > 0;
      return `\n${pad}${k}:${isBlock || isArr ? val : ` ${val}`}`;
    }).join('');
  }
  return String(obj);
}

export const openApiRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/public/openapi.json — no auth required
  app.get('/api/public/openapi.json', { config: { mcpRoute: false } }, async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    return OPENAPI_SPEC;
  });

  // GET /api/public/openapi.yaml — no auth required
  app.get('/api/public/openapi.yaml', { config: { mcpRoute: false } }, async (_req, reply) => {
    reply.header('Content-Type', 'text/yaml; charset=utf-8');
    reply.header('Access-Control-Allow-Origin', '*');
    const yaml = `# Mnema Knowledge API — OpenAPI 3.1\n${toYaml(OPENAPI_SPEC).trimStart()}\n`;
    return reply.send(yaml);
  });
};
