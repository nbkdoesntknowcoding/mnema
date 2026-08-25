#!/usr/bin/env node
/**
 * Mnema capture hook — plugin-native bootstrap.
 *
 * WHY A BOOTSTRAP AND NOT A VENDORED COPY. The canonical hook is authored in the
 * API (`routes/hook-assets.ts`) and served at `<origin>/install/mnema-hook.mjs`.
 * That file is not carved into this public repo, so a vendored copy here would be
 * a second source of truth that silently drifts from the server that receives its
 * events. This fetches the canonical asset once, caches it in CLAUDE_PLUGIN_DATA,
 * and refreshes weekly.
 *
 * WHY THIS DOES NOT TOUCH ~/.claude/settings.json. The `mnema` CLI installs the
 * same capture by writing hook entries into the user's own settings. This plugin
 * registers them declaratively in hooks/hooks.json instead. Running BOTH would
 * double-fire every event, so the plugin never writes to settings.json — see the
 * README for how to migrate off the CLI installer.
 *
 * ALWAYS exits 0. Telemetry must never block a coding session, and a plugin that
 * breaks the host is worse than one that captures nothing.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function env(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks);
}

async function main() {
  const stdin = await readStdin();

  const origin = env('CLAUDE_PLUGIN_OPTION_MNEMA_ORIGIN', 'https://api.theboringpeople.in').replace(/\/+$/, '');
  const token = env('CLAUDE_PLUGIN_OPTION_CAPTURE_TOKEN');
  const workspaceId = env('CLAUDE_PLUGIN_OPTION_WORKSPACE_ID');
  const dataDir = env('CLAUDE_PLUGIN_DATA', join(env('HOME', '.'), '.claude', 'plugins', 'data', 'mnema-brain'));

  // No token means capture is simply off. Every MCP tool still works; this is a
  // deliberate no-op rather than an error, so the plugin is useful before setup.
  if (!token) return;

  mkdirSync(dataDir, { recursive: true });
  const cached = join(dataDir, 'mnema-hook.mjs');
  const configPath = join(dataDir, 'mnema.config.json');

  const stale = !existsSync(cached) || (Date.now() - statSync(cached).mtimeMs) > REFRESH_AFTER_MS;
  if (stale) {
    const res = await fetch(`${origin}/install/mnema-hook.mjs`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`fetch hook asset: HTTP ${res.status}`);
    const body = await res.text();
    if (!body.includes('Mnema capture hook')) throw new Error('fetched asset does not look like the hook');
    writeFileSync(cached, body);
  }

  // The canonical hook reads its config from this file, same shape the CLI writes.
  writeFileSync(
    configPath,
    JSON.stringify({ origin, token, workspaceId, developerId: env('USER', 'unknown') }, null, 2),
    { mode: 0o600 },
  );

  await new Promise((resolve) => {
    const child = spawn(process.execPath, [cached], {
      env: { ...process.env, MNEMA_HOOK_CONFIG: configPath },
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.end(stdin);
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

main().catch((err) => {
  // Fail soft, but never silently: a capture that stops working must be findable.
  if (process.env.CLAUDE_DEBUG) console.error(`[mnema-brain] capture skipped: ${err?.message ?? err}`);
}).finally(() => process.exit(0));
