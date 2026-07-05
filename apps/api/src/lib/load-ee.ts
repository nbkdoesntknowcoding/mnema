/**
 * Phase 3 (Open-Core) — conditional loader for the enterprise (ee) modules.
 *
 * Dynamic-imports the ee entrypoints so the core compiles AND boots when the ee
 * code is physically absent (the public `mnema` build). Present → registers the
 * gated modules and prod behaviour is unchanged. Absent → core-only, logged once.
 * A real error (not module-not-found) still propagates so we never silently swallow
 * a broken ee module.
 */
import type { FastifyInstance } from 'fastify';

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/** Register the ee API routes if the ee module is present. Returns true if loaded. */
// Non-literal specifiers: tsc must NOT statically resolve these, so the public
// `mnema` build compiles with apps/api/src/ee/ physically removed.
const EE_API_ENTRY = '../ee/' + 'index.js';
const EE_COLLAB_ENTRY = '../ee/' + 'collab.js';
const EE_WORKERS_ENTRY = '../ee/' + 'workers.js';
const EE_MCP_ENTRY = '../ee/' + 'mcp-tools.js';

interface EeApiModule {
  registerEeApi: (app: FastifyInstance) => Promise<void>;
}
interface EeCollabModule {
  registerEeCollab: () => void;
}
interface EeWorkersModule {
  startEeWorkers: () => { close: () => Promise<void> };
}
interface EeMcpModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerEeMcpTools: (register: (...args: any[]) => void) => void;
}

// Preloaded once at boot so the synchronous, per-request createMcpServer can
// register the ee graph/meeting MCP tools without awaiting a dynamic import.
let eeMcp: EeMcpModule | null = null;

/** Register the ee API routes if present (api process). Returns true if loaded. */
export async function loadEeApi(app: FastifyInstance): Promise<boolean> {
  try {
    const ee = (await import(EE_API_ENTRY)) as EeApiModule;
    await ee.registerEeApi(app);
    return true;
  } catch (err) {
    if (isModuleNotFound(err)) {
      app.log.warn('[ee] enterprise API modules absent — running core-only');
      return false;
    }
    throw err;
  }
}

/** Register the ee collab-side hooks if present (collab process). Returns true if loaded. */
export async function loadEeCollab(): Promise<boolean> {
  try {
    const ee = (await import(EE_COLLAB_ENTRY)) as EeCollabModule;
    ee.registerEeCollab();
    return true;
  } catch (err) {
    if (isModuleNotFound(err)) {
      // eslint-disable-next-line no-console
      console.warn('[ee] enterprise collab modules absent — running core-only');
      return false;
    }
    throw err;
  }
}

/** Start the ee workers if present (worker process). Returns a close handle, or null. */
export async function loadEeWorkers(): Promise<{ close: () => Promise<void> } | null> {
  try {
    const ee = (await import(EE_WORKERS_ENTRY)) as EeWorkersModule;
    return ee.startEeWorkers();
  } catch (err) {
    if (isModuleNotFound(err)) {
      // eslint-disable-next-line no-console
      console.warn('[ee] enterprise workers absent — running core-only');
      return null;
    }
    throw err;
  }
}

/** Preload the ee MCP tools module at boot (api process). No-op if absent. */
export async function preloadEeMcp(): Promise<void> {
  try {
    eeMcp = (await import(EE_MCP_ENTRY)) as EeMcpModule;
  } catch (err) {
    if (isModuleNotFound(err)) {
      eeMcp = null;
      return;
    }
    throw err;
  }
}

/** The preloaded ee MCP tools module, or null when absent. Sync, for createMcpServer. */
export function getEeMcpTools(): EeMcpModule | null {
  return eeMcp;
}
