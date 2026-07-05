import { count, isNull } from 'drizzle-orm';
import { docs } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import type { McpAuthContext } from './auth.js';

/**
 * Test-only MCP tool. Registered ONLY when `NODE_ENV === 'test'`.
 *
 * The mcp-wrong-tenant regression test calls this through the SDK's
 * in-memory transport to assert that RLS + JWT-bound tenant_id together
 * scope every DB read to the caller's tenant. The probe is removed from
 * the surface in Phase 2.3 once real read tools exist.
 *
 * Filename starts with `_` so it sorts and reads as "internal/private."
 */

const PROBE_NAME = '__test_probe_doc_count';

export interface ProbeToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, never>;
    additionalProperties: false;
  };
}

export function registerTestProbe(): ProbeToolDefinition[] {
  return [
    {
      name: PROBE_NAME,
      description:
        'Test-only: returns the number of docs visible to the caller. Never registered outside NODE_ENV=test.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

export function isTestProbeName(name: string): boolean {
  return name === PROBE_NAME;
}

export async function callTestProbe(
  ctx: McpAuthContext,
  name: string,
  _args: Record<string, unknown>,
): Promise<{ count: number }> {
  if (name !== PROBE_NAME) {
    throw new Error(`Unknown probe: ${name}`);
  }

  const result = await withTenant(ctx.tenant_id, async (tx) => {
    const rows = await tx
      .select({ c: count() })
      .from(docs)
      .where(isNull(docs.deletedAt));
    return rows[0]?.c ?? 0;
  });

  return { count: Number(result) };
}
