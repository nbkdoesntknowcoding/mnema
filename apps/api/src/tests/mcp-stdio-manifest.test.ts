/**
 * ⚠️ The shipped tool manifest must match the server that ships it.
 *
 * packages/mcp-stdio serves tools/list from a JSON file captured at build time,
 * because it has to answer with no database and no environment. That buys
 * offline introspection at the cost of a second copy of the truth — and a
 * second copy rots. This regenerates the manifest with the real generator and
 * fails if the committed file has drifted.
 *
 * When it fails, the fix is to regenerate, not to hand-edit the JSON:
 *   pnpm --filter @boppl/api mcp:manifest
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const COMMITTED = join(REPO_ROOT, 'packages/mcp-stdio/src/tools.generated.json');
const GENERATOR = join(REPO_ROOT, 'apps/api/src/scripts/generate-mcp-manifest.ts');

describe('mcp-stdio tool manifest', () => {
  it('is byte-identical to a fresh capture from the live server definition', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-manifest-'));
    const fresh = join(dir, 'tools.generated.json');
    try {
      execFileSync(join(REPO_ROOT, 'apps/api/node_modules/.bin/tsx'), [GENERATOR, fresh], {
        cwd: REPO_ROOT,
        // The generator supplies its own placeholder env. An inherited one with
        // real values would not change the schemas, but it could change which
        // optional integrations register — keep the capture deterministic.
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120_000,
      });
      expect(readFileSync(fresh, 'utf8')).toBe(readFileSync(COMMITTED, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('⚠️ ships no dev or probe tools — this file becomes a public directory listing', () => {
    const manifest = JSON.parse(readFileSync(COMMITTED, 'utf8')) as { tools: { name: string }[] };
    const names = manifest.tools.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('__ui_probe');
    expect(names.filter((n) => n.startsWith('__'))).toEqual([]);
  });

  it('every tool carries a description and an object input schema', () => {
    const manifest = JSON.parse(readFileSync(COMMITTED, 'utf8')) as {
      tools: { name: string; description: string; inputSchema: { type?: string } }[];
    };
    for (const t of manifest.tools) {
      expect(t.description, `${t.name} has no description`).toBeTruthy();
      expect(t.inputSchema?.type, `${t.name} input schema is not an object`).toBe('object');
    }
  });
});
