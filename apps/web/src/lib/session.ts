import type { SessionData } from '@boppl/shared';
import type { AstroCookies } from 'astro';
import { sealData, unsealData } from 'iron-session';

// ── Pending join session (same-domain workspace choice) ─────────────────────
// Stored in a separate short-lived cookie so the user can complete OAuth before
// picking a workspace. Cleared as soon as they finalise their choice.

export interface PendingJoinData {
  user_id: string;
  email: string;
  display_name: string | null;
  workos_user_id: string;
  access_token: string;
  domain_workspaces: Array<{ id: string; name: string; slug: string; member_count: number }>;
}

const PENDING_JOIN_COOKIE = 'boppl_pending_join';

const SESSION_COOKIE = 'boppl_session';
const JWT_COOKIE = 'boppl_jwt';

function getPassword(): string {
  const value = (process.env.WORKOS_COOKIE_PASSWORD ?? import.meta.env.WORKOS_COOKIE_PASSWORD) as string | undefined;
  if (!value || value.length < 32) {
    throw new Error('WORKOS_COOKIE_PASSWORD must be set (>=32 chars)');
  }
  return value;
}

export async function setSession(
  cookies: AstroCookies,
  data: SessionData,
): Promise<void> {
  const sealed = await sealData(data, { password: getPassword() });
  cookies.set(SESSION_COOKIE, sealed, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  cookies.set(JWT_COOKIE, data.jwt, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
}

export async function getSession(
  cookies: AstroCookies,
): Promise<SessionData | null> {
  const value = cookies.get(SESSION_COOKIE)?.value;
  if (!value) return null;
  try {
    const data = await unsealData<SessionData>(value, { password: getPassword() });
    // If the embedded JWT is expired, treat as no session → forces re-login.
    if (data?.jwt) {
      const parts = data.jwt.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(atob(parts[1]!)) as { exp?: number };
          if (payload.exp && payload.exp * 1000 < Date.now()) {
            return null;
          }
        } catch {
          // malformed JWT payload — fall through, let API reject it
        }
      }
    }
    return data;
  } catch {
    return null;
  }
}

export function clearSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  cookies.delete(JWT_COOKIE, { path: '/' });
}

export async function setPendingJoinSession(
  cookies: AstroCookies,
  data: PendingJoinData,
): Promise<void> {
  const sealed = await sealData(data, { password: getPassword() });
  cookies.set(PENDING_JOIN_COOKIE, sealed, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    // 30-minute window to complete the workspace choice
    maxAge: 60 * 30,
  });
}

export async function getPendingJoinSession(
  cookies: AstroCookies,
): Promise<PendingJoinData | null> {
  const value = cookies.get(PENDING_JOIN_COOKIE)?.value;
  if (!value) return null;
  try {
    return await unsealData<PendingJoinData>(value, { password: getPassword() });
  } catch {
    return null;
  }
}

export function clearPendingJoinSession(cookies: AstroCookies): void {
  cookies.delete(PENDING_JOIN_COOKIE, { path: '/' });
}

// ── Impersonation origin (admin center) ─────────────────────────────────────
// While a staff member impersonates a user, their REAL session is stashed here so
// "Return to admin" can restore it without a re-login. Sealed; same lifetime as a
// session. Never sent to the API — purely a web-side restore buffer.
const ADMIN_ORIGIN_COOKIE = 'boppl_admin_origin';

export async function setAdminOrigin(cookies: AstroCookies, data: SessionData): Promise<void> {
  const sealed = await sealData(data, { password: getPassword() });
  cookies.set(ADMIN_ORIGIN_COOKIE, sealed, {
    httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 60 * 60,
  });
}

export async function getAdminOrigin(cookies: AstroCookies): Promise<SessionData | null> {
  const value = cookies.get(ADMIN_ORIGIN_COOKIE)?.value;
  if (!value) return null;
  try { return await unsealData<SessionData>(value, { password: getPassword() }); }
  catch { return null; }
}

export function clearAdminOrigin(cookies: AstroCookies): void {
  cookies.delete(ADMIN_ORIGIN_COOKIE, { path: '/' });
}
