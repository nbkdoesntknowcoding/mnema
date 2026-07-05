/**
 * Minimal Google Calendar client for Phase C (no SDK — raw REST via fetch).
 *   - exchangeCode:   auth code → tokens (returns the offline refresh_token)
 *   - refreshAccess:  refresh_token → short-lived access_token
 *   - listUpcoming:   pull the next ~14 days of events that have a video link
 *
 * The OAuth client credentials come from env (optional); callers must check
 * `calendarConfigured()` first and 503 when unset.
 */
import { config } from '../config/env.js';

const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export function calendarConfigured(): boolean {
  return Boolean(
    config.GOOGLE_CALENDAR_CLIENT_ID &&
    config.GOOGLE_CALENDAR_CLIENT_SECRET &&
    config.GOOGLE_CALENDAR_REDIRECT_URI,
  );
}

/**
 * The Google consent URL to start the calendar-link flow.
 *
 * prompt='select_account consent' forces Google's account CHOOSER (over accounts
 * the browser already has sessions for) and then the consent screen. We avoid
 * `login_hint` on purpose: per Google's docs it "suppresses the account chooser"
 * and pre-fills the *sign-in form* — and that sign-in/identifier page throws a
 * bare 400 when there's no resolvable session. The chooser path doesn't.
 */
export function consentUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: config.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: config.GOOGLE_CALENDAR_REDIRECT_URI!,
    response_type: 'code',
    scope: CAL_SCOPE,
    access_type: 'offline',            // required to receive a refresh_token
    prompt: 'select_account consent',  // chooser → consent (avoids sign-in form 400)
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: config.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirect_uri: config.GOOGLE_CALENDAR_REDIRECT_URI!,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccess(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: config.GOOGLE_CALENDAR_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as TokenResponse).access_token;
}

export interface CalendarEvent {
  id: string;
  title: string;
  meetingUrl: string | null;
  start: string | null;   // ISO
  end: string | null;     // ISO
  attendeeCount: number;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: unknown[];
}

/** Pull upcoming events (now → +days) that carry a joinable video link. */
export async function listUpcoming(accessToken: string, days = 14): Promise<CalendarEvent[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const p = new URLSearchParams({
    timeMin, timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`google events list failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { items?: GEvent[] };

  const out: CalendarEvent[] = [];
  for (const e of body.items ?? []) {
    if (e.status === 'cancelled') continue;
    const video = e.hangoutLink
      ?? e.conferenceData?.entryPoints?.find((x) => x.entryPointType === 'video')?.uri
      ?? null;
    if (!video) continue; // only meetings the bot could join
    out.push({
      id: e.id,
      title: e.summary ?? 'Untitled meeting',
      meetingUrl: video,
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      attendeeCount: Array.isArray(e.attendees) ? e.attendees.length : 0,
    });
  }
  return out;
}
