/**
 * Community hub client (Community Flows — Phase 2, P2-1).
 *
 * The CORE-side HTTP client every instance uses to talk to the central hub
 * (COMMUNITY_HUB_URL). This is what makes a self-hosted install participate in
 * the same catalog as the cloud. Reads retry on transient errors; writes never
 * retry (publish must not double-post). When the feature is disabled, every
 * call throws CommunityDisabledError so routes can translate to 404.
 */
import { getHubBaseUrl, getHubKey, isCommunityEnabled } from './hub-config.js';
import { config } from '../../config/env.js';

export class CommunityDisabledError extends Error {
  constructor() {
    super('The community hub is disabled on this instance.');
    this.name = 'CommunityDisabledError';
  }
}

export class HubError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'HubError';
  }
}

const TIMEOUT_MS = 10_000;

interface FetchOpts {
  method?: string;
  body?: unknown;
  key?: string;
  retries?: number;
}

async function hubFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  if (!isCommunityEnabled()) throw new CommunityDisabledError();
  const url = `${getHubBaseUrl()}${path}`;
  const method = opts.method ?? 'GET';
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
          'x-mnema-instance': config.WEB_BASE_URL,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ac.signal,
      });
      clearTimeout(timer);

      const text = await res.text();
      const parsed = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        // Retry 5xx on reads only; surface 4xx immediately.
        if (res.status >= 500 && attempt < retries) {
          lastErr = new HubError(res.status, 'hub_5xx', `Hub returned ${res.status}`, parsed);
          continue;
        }
        const code = (parsed as { error?: string })?.error ?? `http_${res.status}`;
        throw new HubError(res.status, code, `Hub error ${res.status}`, parsed);
      }
      return parsed as T;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HubError) throw err;
      // Network/abort — retry on reads.
      lastErr = err;
      if (attempt >= retries) throw new HubError(502, 'hub_unreachable', 'Community hub is unreachable.', String(err));
    }
  }
  throw lastErr instanceof Error ? lastErr : new HubError(502, 'hub_unreachable', 'Community hub is unreachable.');
}

export interface HubListItem {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  nodeCount: number;
  importCount: number;
  publisherHandle: string | null;
  createdAt: string;
}

export interface HubListResult {
  flows: HubListItem[];
  next_cursor: number | null;
}

export interface HubFlowDetail {
  slug: string;
  name: string;
  description: string | null;
  tags: string[];
  schema_version: number;
  template_json: unknown;
  node_count: number;
  edge_count: number;
  import_count: number;
  publisher_handle: string | null;
  created_at: string;
}

export function hubList(params: {
  q?: string;
  tag?: string;
  sort?: string;
  cursor?: number;
  limit?: number;
}): Promise<HubListResult> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.tag) qs.set('tag', params.tag);
  if (params.sort) qs.set('sort', params.sort);
  if (params.cursor) qs.set('cursor', String(params.cursor));
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  return hubFetch<HubListResult>(`/api/hub/flows${suffix ? `?${suffix}` : ''}`);
}

export function hubGet(slug: string): Promise<HubFlowDetail> {
  return hubFetch<HubFlowDetail>(`/api/hub/flows/${encodeURIComponent(slug)}`);
}

export function hubPublish(
  body: { template_json: unknown; name: string; description: string | null; tags: string[]; source_version?: string },
): Promise<{ slug: string; url: string }> {
  const key = getHubKey();
  if (!key) throw new HubError(400, 'no_key', 'No community key configured on this instance.');
  return hubFetch(`/api/hub/flows`, { method: 'POST', body, key });
}

export function hubUnpublish(slug: string): Promise<{ removed: boolean }> {
  const key = getHubKey();
  if (!key) throw new HubError(400, 'no_key', 'No community key configured on this instance.');
  return hubFetch(`/api/hub/flows/${encodeURIComponent(slug)}`, { method: 'DELETE', key });
}

export function hubReport(slug: string, body: { reason: string; detail?: string }): Promise<{ received: boolean }> {
  return hubFetch(`/api/hub/flows/${encodeURIComponent(slug)}/report`, { method: 'POST', body });
}

export function hubBumpImport(slug: string): Promise<{ ok: boolean }> {
  return hubFetch(`/api/hub/flows/${encodeURIComponent(slug)}/imported`, { method: 'POST', retries: 0 });
}
