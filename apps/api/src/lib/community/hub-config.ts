/**
 * Community hub configuration helpers (Community Flows — Phase 0, P0-4).
 *
 * A thin typed surface over the COMMUNITY_HUB_* env so the rest of the code
 * never reads process.env directly. Shared by the hub client (P2-1), the proxy
 * routes (P2-2), and the publish route (P2-4).
 */
import { config } from '../../config/env.js';

/** Whether the community feature is enabled on this instance at all. */
export function isCommunityEnabled(): boolean {
  return config.COMMUNITY_HUB_ENABLED;
}

/** Base URL of the central hub (no trailing slash). */
export function getHubBaseUrl(): string {
  return config.COMMUNITY_HUB_URL.replace(/\/+$/, '');
}

/** This instance's community-license key, used to authenticate publishes.
 *  Undefined when unset — publish is disabled with a clear message. */
export function getHubKey(): string | undefined {
  return config.COMMUNITY_HUB_KEY;
}

/** True when this instance can publish (feature on + a key configured). */
export function canPublishToCommunity(): boolean {
  return isCommunityEnabled() && !!getHubKey();
}
