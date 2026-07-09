import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Walk up from this file to find the nearest .env (repo root or app root).
const here = dirname(fileURLToPath(import.meta.url));
let dir = here;
for (let i = 0; i < 6; i++) {
  const candidate = resolve(dir, '.env');
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate });
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(8080),
  COLLAB_PORT: z.coerce.number().int().positive().default(1234),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // WorkOS — only used when AUTH_PROVIDER='workos' (cloud). Self-host (password/
  // oidc) can omit these entirely; the sentinel defaults keep the type `string`
  // (so plugins/workos.ts + oauth/workos-bridge.ts still compile) and construct
  // an inert client that is never called. A superRefine below fails fast if the
  // cloud provider is selected without real values.
  WORKOS_API_KEY: z.string().default('unused_on_self_host'),
  WORKOS_CLIENT_ID: z.string().default('unused_on_self_host'),
  WORKOS_REDIRECT_URI: z.string().url().default('http://localhost/unused-on-self-host'),
  // Phase 0 (Open-Core): WORKOS_COOKIE_PASSWORD now does exactly ONE job —
  // sealing WorkOS session cookies. The three other jobs it used to cover each
  // get a dedicated 32+ char secret below. Split per plan doc 2512a512 + A2.
  WORKOS_COOKIE_PASSWORD: z.string().min(32),

  // Collab server <-> api writeback internal RPC shared secret (was folded into
  // WORKOS_COOKIE_PASSWORD). Signer: collab/writeback.ts; verifier: collab/server.ts.
  COLLAB_INTERNAL_SECRET: z.string().min(32),
  // scrypt KDF seed for lib/secret-box.ts AES-256-GCM (calendar refresh-token
  // encryption + OAuth state HMAC). Was WORKOS_COOKIE_PASSWORD.
  SECRETBOX_MASTER_KEY: z.string().min(32),
  // web <-> api /_internal/* internal_secret shared secret (set-session, waitlist,
  // join-workspace, request-join, accept-invite-pending). Was WORKOS_COOKIE_PASSWORD.
  API_INTERNAL_SECRET: z.string().min(32),

  // Phase 4 (Open-Core) — pluggable auth. 'workos' (cloud default) | 'password'
  // (built-in email+password, self-host) | 'oidc' (generic OpenID Connect, company).
  AUTH_PROVIDER: z.enum(['workos', 'password', 'oidc']).default('workos'),
  // Generic OIDC settings (used when AUTH_PROVIDER='oidc'); discovery via the issuer.
  OIDC_ISSUER_URL:    z.string().url().optional(),
  OIDC_CLIENT_ID:     z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_REDIRECT_URI:  z.string().url().optional(),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().url(),
  // MCP audience accepted on Bearer tokens. Local dev accepts both the REST
  // audience (so the existing /api/_internal/set-session JWT works directly
  // in the Inspector) and the MCP audience. Phase D narrows this to MCP-only
  // once WorkOS-issued tokens replace the local-secret path.
  JWT_AUDIENCE_MCP: z.string().url().default('http://localhost:8080/mcp'),

  // Phase 4.1 — canonical web origin used in invitation accept URLs and
  // other server-rendered links back into the app. Production swaps this
  // for the live web hostname; local dev points at the Astro server.
  WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  // MCP (Phase 2.1)
  // The wire-protocol version we advertise on initialize.
  MCP_PROTOCOL_VERSION: z.string().min(1).default('2025-11-25'),
  // The canonical externally-visible URL of the api process. The MCP resource
  // identifier is `${MCP_BASE_URL}/mcp`; the protected-resource metadata
  // refers to it; tokens from the AS are expected to carry this as audience.
  MCP_BASE_URL: z.string().url().default('http://localhost:8080'),
  // The Authorization Server URL advertised in protected-resource metadata.
  // Phase 2.1 ships a placeholder so the route is testable; Phase 2.2 swaps
  // in the actual WorkOS AS URL once we wire DCR.
  MCP_AUTHORIZATION_SERVER: z.string().url().default('http://localhost:8080'),
  // Origins permitted on all /api/* routes (browser CORS). Comma-separated.
  // Include every host that serves the web app (localhost dev ports + Vercel).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5175,http://localhost:6274'),

  // Origins permitted to POST to /mcp and /mcp/http.
  // Comma-separated. Includes remote clients: ChatGPT, OpenAI API, Codex.
  // Non-browser clients that omit Origin entirely are always allowed through.
  MCP_ORIGIN_ALLOWLIST: z
    .string()
    .default(
      'http://localhost:5173,http://localhost:5175,http://localhost:6274,' +
      'https://chatgpt.com,https://chat.openai.com,https://api.openai.com,' +
      'https://platform.openai.com,https://claude.ai,https://claude.com',
    ),

  // Voyage AI (Phase 3.1)
  // The user obtained this from voyageai.com — the worker crashes loudly
  // if it's missing rather than silently no-op'ing the embedding pipeline.
  VOYAGE_API_KEY: z.string().min(1),
  EMBEDDING_MODEL: z.string().default('voyage-3-large'),
  // 1024 matches the schema's `vector(1024)` column. Don't change without
  // a migration — pgvector enforces dimension at insert time.
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  // Heading-aware chunker tuning. 500 target / 50 overlap is the recipe
  // from the brief; bump only with retrieval-quality data to back it.
  EMBEDDING_CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(500),
  EMBEDDING_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(50),
  // Voyage caps batch input at 128. Stay at-or-below.
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(128).default(128),
  // Per-process worker concurrency. Combined with the BullMQ rate limiter
  // (3 jobs/sec) keeps us well under Voyage's free-tier limits.
  EMBEDDING_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Autocomplete (Phase 3.3 stub, Phase 3.4 production)
  // 350ms is what Cursor uses — shorter and we fire too often, longer and
  // the UX feels laggy. The cap is declared here so 3.4 can tune from
  // data without touching application code.
  AUTOCOMPLETE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(350),
  // Prefix/suffix character caps — matter most in 3.4 where they bound the
  // LLM token budget. Declared in 3.3 so the request contract is stable.
  AUTOCOMPLETE_MAX_PREFIX_CHARS: z.coerce.number().int().positive().default(2000),
  AUTOCOMPLETE_MAX_SUFFIX_CHARS: z.coerce.number().int().nonnegative().default(500),

  // Gemini (Phase 3.4) — user obtains from aistudio.google.com.
  // Crashes loudly if missing — we never silently no-op the production path.
  GEMINI_API_KEY: z.string().min(1),
  // Pinned model. Don't swap mid-build — model swaps are tuning decisions,
  // not build decisions, per the 3.4 spec.
  AUTOCOMPLETE_MODEL: z.string().default('gemini-2.5-flash-lite'),
  // 60 tokens is the autocomplete sweet spot — longer feels laggy and
  // rarely improves quality. Don't raise without latency data.
  AUTOCOMPLETE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(60),
  // Stop sequences — paragraph break terminates the completion so it
  // doesn't run on past the current sentence/list item. CSV in env;
  // `\\n` is converted to a real newline at parse time.
  AUTOCOMPLETE_STOP_SEQUENCES: z
    .string()
    .default('\\n\\n')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.replace(/\\n/g, '\n'))
        .filter((x) => x.length > 0),
    ),

  // Rate limits (Phase 3.4) — per-user sliding window + per-tenant daily cost cap.
  // 60/min and 1000/day catch sustained-overuse, not bursts. The per-tenant
  // budget unit ≈ $0.0001; default 50,000 units = $5/day cost ceiling.
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_USER_PER_DAY: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_TENANT_DAILY_UNITS: z.coerce.number().int().positive().default(50000),

  // Billing — Razorpay. The open-core (self-host) edition ships with NO
  // payment/billing layer, so these are optional and unused. They remain
  // declared only so a hosted deployment that layers billing on top of core
  // can supply them; on self-host leave them unset.
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  RAZORPAY_ENVIRONMENT: z.enum(['test', 'live']).default('test'),

  // Recall.ai workspace verification secret (whsec_…) — signs the participant-events
  // webhook. Optional: when set, the meeting bot's act-as identity is validated
  // against Recall's tamper-proof roster (Phase 4 anti-impersonation); when unset,
  // act-as behaves as before (no roster validation).
  RECALL_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),

  // Recall.ai REST credentials — used server-side by the meeting-end worker to
  // create + fetch the post-meeting transcript (Phase 2). Same key the
  // meeting-bot uses. Optional: when unset, transcript capture is skipped.
  RECALL_API_KEY: z.string().min(1).optional(),
  RECALL_REGION:  z.string().min(1).default('ap-northeast-1'),

  // Cloudflare R2 (DOCX/PDF attachment storage — optional; upload/export routes
  // return 503 if not configured rather than crashing the whole server)
  R2_ACCOUNT_ID:        z.string().min(1).optional(),
  R2_ACCESS_KEY_ID:     z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME:       z.string().min(1).optional(),
  R2_PUBLIC_URL:        z.string().url().optional(),

  // DOCX/PDF feature
  MISTRAL_API_KEY:       z.string().min(1).optional(),
  PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MAX_UPLOAD_SIZE_MB:    z.coerce.number().int().positive().default(50),

  // OpenAI (used for knowledge graph semantic extraction)
  OPENAI_API_KEY: z.string().min(1).optional(),

  // OnlyOffice Document Server
  ONLYOFFICE_API_URL:      z.string().url().optional(), // public URL browser loads SDK from
  ONLYOFFICE_INTERNAL_URL: z.string().url().optional(), // internal Docker URL for callback base
  ONLYOFFICE_JWT_SECRET:   z.string().min(1).optional(), // shared secret for request signing

  // OAuth 2.1 Authorization Server (Phase A)
  // Externally-visible issuer URL — equals MCP_BASE_URL in practice.
  // The `iss` claim in every OAuth-issued JWT and the base for all AS URLs.
  OAUTH_ISSUER: z.string().url(),
  // Paths to the RSA keypair (relative to CWD or absolute). Never committed.
  OAUTH_PRIVATE_KEY_PATH: z.string().min(1),
  OAUTH_PUBLIC_KEY_PATH: z.string().min(1),
  OAUTH_KEY_ID: z.string().min(1).default('mnema-oauth-key-1'),
  // WorkOS redirect URI for the OAuth authorize flow (api-server callback).
  // Must be registered in WorkOS dashboard as an allowed redirect URI.
  // Self-host defaults it (see WORKOS_API_KEY note) — the MCP flow routes to
  // /auth/local there, so this WorkOS callback is never used.
  WORKOS_REDIRECT_URI_OAUTH: z.string().url().default('http://localhost/unused-on-self-host'),

  // Phase C — Google Calendar linking (optional; calendar routes return 503 when
  // unset). Create an OAuth client in Google Cloud Console with scope
  // calendar.readonly and add these. Redirect URI must equal the /api/calendar/
  // callback URL and be registered as an authorised redirect URI in Google.
  GOOGLE_CALENDAR_CLIENT_ID:     z.string().min(1).optional(),
  GOOGLE_CALENDAR_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_CALENDAR_REDIRECT_URI:  z.string().url().optional(),

  // Phase C — internal meeting-bot controller (the express service that asks
  // Recall to send the bot). Defaults to the Docker-network address; the API
  // POSTs /join here when an admitted meeting is starting soon.
  MEETING_BOT_INTERNAL_URL:   z.string().url().default('http://meeting-bot:3001'),
  MNEMA_MEETING_BOT_API_KEY:  z.string().min(1).optional(),

  // Internal admin center — staff-only. Access is gated to this email domain, plus an
  // optional comma-separated allowlist for exceptions. The internal log-streamer sidecar
  // (Docker-socket access) is reached at LOG_STREAMER_URL.
  ADMIN_EMAIL_DOMAIN: z.string().min(1).default('example.com'),
  ADMIN_EMAILS:       z.string().optional(),
  LOG_STREAMER_URL:   z.string().url().default('http://log-streamer:9000'),

  // Phase 2 (Open-Core) — entitlement enforcement. REPORT-ONLY by default: gates
  // log what they would block but allow through until this is 'true'. Flip only
  // after licenses are granted so the live workspace keeps its features.
  ENFORCE_ENTITLEMENTS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Ed25519 private signing key (PEM) — ISSUING SIDE ONLY (cloud). Absent on
  // self-host, which only verifies against the baked-in public key.
  LICENSE_SIGNING_KEY: z.string().optional(),

  // Community Flows hub (open-core). Every instance — cloud AND self-hosted —
  // talks to a CENTRAL hub to browse/import/publish flow templates. Defaults to
  // the SaaS host; self-hosters may point elsewhere or disable entirely.
  //   URL      — base URL of the hub API (serves /api/hub/*).
  //   ENABLED  — false fully disables the feature (air-gapped self-host).
  //   KEY      — the instance's community-license key, used only to authenticate
  //              PUBLISH calls. Browse/import need no key. Absent = publish off.
  COMMUNITY_HUB_URL:     z.string().url().default('https://api.theboringpeople.in'),
  COMMUNITY_HUB_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  COMMUNITY_HUB_KEY:     z.string().min(1).optional(),
});

const parsed = envSchema
  .superRefine((env, ctx) => {
    // Cloud (WorkOS) must be fully configured — the sentinel defaults are only
    // valid for self-host (password/oidc), where WorkOS is never called.
    if (env.AUTH_PROVIDER === 'workos') {
      for (const key of ['WORKOS_API_KEY', 'WORKOS_CLIENT_ID'] as const) {
        if (!env[key] || env[key] === 'unused_on_self_host') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when AUTH_PROVIDER='workos'`,
          });
        }
      }
    }
  })
  .safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
