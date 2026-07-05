/**
 * Server-side Recall.ai REST client (Phase 2 — post-meeting transcripts).
 *
 * The meeting-bot service (meeting-bot/src/recall.ts) creates bots; here the API
 * worker reads the resulting recording and generates + fetches the async
 * transcript after a meeting ends. Auth is a bare token (no "Bearer"); the base
 * URL is region-specific (default ap-northeast-1).
 */
import { config } from '../config/env.js';

const BASE = `https://${config.RECALL_REGION}.recall.ai/api/v1`;

export interface TranscriptTurn {
  speaker: string | null;
  text: string;
  tsMs: number | null;
}

export interface BotRecording {
  recordingId: string;
  recordingDone: boolean;
  /** Existing transcript artifact on the recording, if one was already created. */
  transcriptId: string | null;
  transcriptStatus: string | null;
}

function authHeaders(): Record<string, string> {
  return { Authorization: config.RECALL_API_KEY ?? '', 'Content-Type': 'application/json' };
}

async function recallFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Recall ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** True if RECALL_API_KEY is configured (else transcript capture is skipped). */
export function recallEnabled(): boolean {
  return !!config.RECALL_API_KEY;
}

/**
 * Permanently delete all of a bot's recording media (video + audio) stored by
 * Recall. We call this once the transcript text is safely persisted, so no
 * video/audio is retained anywhere — Mnema keeps only the transcript. Best
 * effort: never throws (a 404/409 just means it's already gone).
 */
export async function deleteBotMedia(botId: string): Promise<void> {
  try {
    await recallFetch(`/bot/${botId}/delete_media/`, { method: 'POST' });
  } catch {
    /* already deleted / not ready — non-fatal */
  }
}

/** Find the most-complete recording for a bot, and any transcript already on it. */
export async function getBotRecording(botId: string): Promise<BotRecording | null> {
  const bot = (await recallFetch(`/bot/${botId}/`)) as { recordings?: Array<Record<string, unknown>> };
  const recordings = bot.recordings ?? [];
  if (recordings.length === 0) return null;
  // Prefer a 'done' recording; else take the latest.
  const rec = recordings.find((r) => (r.status as { code?: string } | undefined)?.code === 'done') ?? recordings[recordings.length - 1];
  if (!rec) return null;
  const shortcuts = (rec.media_shortcuts as Record<string, unknown> | undefined) ?? {};
  const transcript = shortcuts.transcript as { id?: string; status?: { code?: string } } | null | undefined;
  return {
    recordingId: String(rec.id),
    recordingDone: (rec.status as { code?: string } | undefined)?.code === 'done',
    transcriptId: transcript?.id ?? null,
    transcriptStatus: transcript?.status?.code ?? null,
  };
}

/** Kick off an async (post-meeting) transcript for a recording; returns its id. */
export async function createAsyncTranscript(recordingId: string): Promise<string> {
  const res = (await recallFetch(`/recording/${recordingId}/create_transcript/`, {
    method: 'POST',
    body: JSON.stringify({
      provider: { recallai_async: { language_code: 'auto' } },
      diarization: { use_separate_streams_when_available: true },
    }),
  })) as { id: string };
  return res.id;
}

export interface TranscriptArtifact {
  statusCode: string;            // 'processing' | 'done' | 'failed' | …
  downloadUrl: string | null;
}

export async function getTranscriptArtifact(transcriptId: string): Promise<TranscriptArtifact> {
  const res = (await recallFetch(`/transcript/${transcriptId}/`)) as {
    status?: { code?: string };
    data?: { download_url?: string | null };
  };
  return {
    statusCode: res.status?.code ?? 'unknown',
    downloadUrl: res.data?.download_url ?? null,
  };
}

/**
 * Download + normalise Recall's transcript JSON into ordered turns. Recall's
 * canonical async format is an array of segments, each with a `participant` and
 * a `words` array; we join the words per segment into one turn. Tolerant of
 * minor shape variations.
 */
export async function downloadTranscript(downloadUrl: string): Promise<TranscriptTurn[]> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`transcript download → ${res.status}`);
  const json: unknown = await res.json();
  const segments: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { transcript?: unknown[] })?.transcript)
      ? (json as { transcript: unknown[] }).transcript
      : [];

  const turns: TranscriptTurn[] = [];
  for (const seg of segments) {
    const s = seg as Record<string, unknown>;
    const participant = s.participant as { name?: string | null } | undefined;
    const words = s.words as Array<Record<string, unknown>> | undefined;

    let text: string;
    let tsMs: number | null = null;
    if (Array.isArray(words) && words.length > 0) {
      text = words.map((w) => String(w.text ?? '')).join(' ').replace(/\s+/g, ' ').trim();
      const first = words[0]?.start_timestamp as { relative?: number } | number | undefined;
      const rel = typeof first === 'number' ? first : first?.relative;
      if (typeof rel === 'number') tsMs = Math.round(rel * 1000);
    } else {
      text = String(s.text ?? '').trim();
    }
    if (!text) continue;
    turns.push({ speaker: participant?.name ?? (s.speaker as string | undefined) ?? null, text, tsMs });
  }
  return turns;
}
