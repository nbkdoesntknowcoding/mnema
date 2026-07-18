import { useEffect, useRef, useState, useCallback } from 'react';

export interface PresencePeer {
  id: string;          // connection id
  userId: string;
  name: string;
  color: string;
  x: number | null;    // cursor, world coords
  y: number | null;
  nodeId: string | null;
}

interface Api {
  peers: PresencePeer[];
  /** send local cursor position in WORLD coords (throttled by caller/RAF). */
  sendCursor: (x: number, y: number) => void;
  /** send local node selection. */
  sendSelection: (nodeId: string | null) => void;
  connected: boolean;
}

function wsUrl(flowId: string): string | null {
  const api = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? '';
  // WS must hit the API origin directly (relative /ws would go to the web host).
  const base = api || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!base) return null;
  return base.replace(/^http/, 'ws') + `/ws/flows/${flowId}/presence`;
}

/**
 * Presence transport for the Flows editor. Opens a WebSocket to the api's
 * awareness endpoint (cookie-authenticated), tracks remote peers, and exposes
 * senders for the local cursor + selection. Auto-reconnects with backoff.
 */
export function useFlowPresence(flowId: string, enabled = true): Api {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, PresencePeer>>(new Map());
  const lastSentRef = useRef(0);

  const sync = useCallback(() => setPeers([...peersRef.current.values()]), []);

  useEffect(() => {
    if (!enabled) return;
    const url = wsUrl(flowId);
    if (!url) return;

    let closed = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { return; }
      wsRef.current = ws;

      ws.onopen = () => { retry = 0; setConnected(true); };
      ws.onclose = () => {
        setConnected(false);
        peersRef.current.clear(); sync();
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        reconnectTimer = setTimeout(connect, 500 * 2 ** retry); // 1s..32s backoff
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
      ws.onmessage = (ev: MessageEvent) => {
        let m: Record<string, unknown>;
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        const map = peersRef.current;
        switch (m.t) {
          case 'sync':
            map.clear();
            for (const p of (m.peers as PresencePeer[]) ?? []) map.set(p.id, p);
            sync(); break;
          case 'join':
            { const p = m.peer as PresencePeer; map.set(p.id, p); sync(); } break;
          case 'move': {
            const p = map.get(m.id as string);
            if (p) { p.x = m.x as number; p.y = m.y as number; sync(); }
            break;
          }
          case 'select': {
            const p = map.get(m.id as string);
            if (p) { p.nodeId = (m.nodeId as string | null) ?? null; sync(); }
            break;
          }
          case 'leave':
            map.delete(m.id as string); sync(); break;
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { wsRef.current?.close(); } catch { /* noop */ }
      peersRef.current.clear();
    };
  }, [flowId, enabled, sync]);

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* noop */ }
    }
  }, []);

  const sendCursor = useCallback((x: number, y: number) => {
    // throttle to ~30/s
    const now = Date.now();
    if (now - lastSentRef.current < 33) return;
    lastSentRef.current = now;
    send({ t: 'cursor', x: Math.round(x), y: Math.round(y) });
  }, [send]);

  const sendSelection = useCallback((nodeId: string | null) => {
    send({ t: 'select', nodeId });
  }, [send]);

  return { peers, sendCursor, sendSelection, connected };
}
