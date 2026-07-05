/**
 * RSA keypair loading and JWKS export for the OAuth 2.1 AS.
 *
 * Keys live at OAUTH_PRIVATE_KEY_PATH / OAUTH_PUBLIC_KEY_PATH — never in git.
 * Loaded once at first call, cached for the process lifetime.
 * Rotation: add a second key with a new kid to JWKS, wait for old tokens
 * to expire (≤1h), then remove the old kid.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK, type JWK } from 'jose';
import { config } from '../config/env.js';

// Resolve a (possibly relative) key path against the REPO ROOT, not process.cwd().
// The api dev process runs with cwd=apps/api, so a bare `./keys/...` would wrongly
// resolve to apps/api/keys; keys live at the repo root ./keys (and /app/keys in Docker).
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}
function resolveKeyPath(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot(), p);
}

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  publicJwk: JWK;
  kid: string;
  alg: 'RS256';
}

let _cache: KeyPair | null = null;
let _cacheInit: Promise<KeyPair> | null = null;

async function buildKeyPair(): Promise<KeyPair> {
  const privatePemPath = resolveKeyPath(config.OAUTH_PRIVATE_KEY_PATH);
  const publicPemPath = resolveKeyPath(config.OAUTH_PUBLIC_KEY_PATH);
  const kid = config.OAUTH_KEY_ID;

  const privatePem = readFileSync(privatePemPath, 'utf-8');
  const publicPem = readFileSync(publicPemPath, 'utf-8');

  const privateKey = createPrivateKey(privatePem);
  const publicKey = createPublicKey(publicPem);

  // jose's exportJWK is async in v5+
  const baseJwk = await exportJWK(publicKey);

  const publicJwk: JWK = {
    ...baseJwk,
    alg: 'RS256',
    use: 'sig',
    kid,
  };

  return { privateKey, publicKey, publicJwk, kid, alg: 'RS256' };
}

export async function loadKeyPair(): Promise<KeyPair> {
  if (_cache) return _cache;
  if (!_cacheInit) {
    _cacheInit = buildKeyPair().then((kp) => {
      _cache = kp;
      return kp;
    });
  }
  return _cacheInit;
}

export async function getJwks(): Promise<{ keys: JWK[] }> {
  const { publicJwk } = await loadKeyPair();
  return { keys: [publicJwk] };
}
