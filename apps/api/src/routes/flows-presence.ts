import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { and, eq, isNull } from 'drizzle-orm';
import { flows } from '../db/schema.js';
import { withTenant } from '../db/with-tenant.js';
import { verifyJwt } from '../lib/jwt.js';
import { JWT_COOKIE_NAME } from '../plugins/auth.js';

/**
 * Presence-only WebSocket for the Flows editor: live cursors, presence avatars,
 * and remote selection. This is AWARENESS ONLY — the flow graph itself is still
 * saved over REST (no CRDT), so there is no document to persist. State lives in
 * memory and evaporates when the last peer leaves.
 *
 * We do NOT reuse the Hocuspocus collab server: its auth requires the room to be
 * a UUID that exists in the `docs` table, which a flow id is not.
 *
 * Transport: JSON messages.
 *   client → server: { t: 'cursor', x, y } | { t: 'select', nodeId }
 *   server → client: { t: 'sync', peers } | { t: 'join', peer }
 *                    | { t: 'move', id, x, y } | { t: 'select', id, nodeId }
 *                    | { t: 'leave', id }
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PALETTE = ['#7c9cff', '#6be39b', '#ffb370', '#ff7a8a', '#c9a0ff', '#5fd0e0', '#f6c453', '#ff9db0'];
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

interface Peer {
  connId: string;
  userId: string;
  name: string;
  color: string;
  socket: WebSocket;
  x: number | null;
  y: number | null;
  nodeId: string | null;
}

// flowId → connId → Peer
const rooms = new Map<string, Map<string, Peer>>();
let connSeq = 0;

function publicPeer(p: Peer) {
  return { id: p.connId, userId: p.userId, name: p.name, color: p.color, x: p.x, y: p.y, nodeId: p.nodeId };
}

function broadcast(room: Map<string, Peer>, exceptConnId: string, msg: unknown) {
  const data = JSON.stringify(msg);
  for (const peer of room.values()) {
    if (peer.connId === exceptConnId) continue;
    if (peer.socket.readyState === peer.socket.OPEN) {
      try { peer.socket.send(data); } catch { /* peer went away */ }
    }
  }
}

export async function flowPresenceRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>(
    '/ws/flows/:id/presence',
    {
      websocket: true,
      // Rate-limit the upgrade handshake so a flood of connection attempts can't
      // hammer verifyJwt + the flow-exists DB lookup (js/missing-rate-limiting).
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (socket, req) => {
      const flowId = req.params.id;

      // ── Auth: cookie JWT (browser sends it on the upgrade), Bearer fallback ──
      const bearer = /^Bearer\s+(.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const token = (req.cookies?.[JWT_COOKIE_NAME] as string | undefined) ?? bearer;
      if (!token) { socket.close(1008, 'unauthorized'); return; }

      let userId: string, tenantId: string, email: string;
      try {
        const claims = await verifyJwt(token);
        userId = claims.sub; tenantId = claims.tenant_id; email = claims.email ?? 'someone';
      } catch { socket.close(1008, 'unauthorized'); return; }

      if (!UUID_RE.test(flowId)) { socket.close(1008, 'bad flow id'); return; }

      // The flow must exist in this tenant (RLS enforces isolation).
      const ok = await withTenant(tenantId, async (tx) => {
        const rows = await tx
          .select({ id: flows.id })
          .from(flows)
          .where(and(eq(flows.id, flowId), isNull(flows.deletedAt)))
          .limit(1);
        return rows.length > 0;
      }).catch(() => false);
      if (!ok) { socket.close(1008, 'flow not found'); return; }

      // ── Join the room ────────────────────────────────────────────────────
      const connId = `c${++connSeq}`;
      let room = rooms.get(flowId);
      if (!room) { room = new Map(); rooms.set(flowId, room); }

      const self: Peer = {
        connId, userId, name: email, color: colorForUser(userId),
        socket, x: null, y: null, nodeId: null,
      };

      // Tell the newcomer who's already here, then announce them to the room.
      socket.send(JSON.stringify({ t: 'sync', self: { id: connId }, peers: [...room.values()].map(publicPeer) }));
      room.set(connId, self);
      broadcast(room, connId, { t: 'join', peer: publicPeer(self) });

      socket.on('message', (raw: Buffer) => {
        if (raw.length > 1024) return; // ignore oversized frames
        let msg: { t?: string; x?: number; y?: number; nodeId?: string | null };
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.t === 'cursor' && typeof msg.x === 'number' && typeof msg.y === 'number') {
          self.x = msg.x; self.y = msg.y;
          broadcast(room!, connId, { t: 'move', id: connId, x: msg.x, y: msg.y });
        } else if (msg.t === 'select') {
          self.nodeId = typeof msg.nodeId === 'string' ? msg.nodeId : null;
          broadcast(room!, connId, { t: 'select', id: connId, nodeId: self.nodeId });
        }
      });

      const leave = () => {
        room!.delete(connId);
        broadcast(room!, connId, { t: 'leave', id: connId });
        if (room!.size === 0) rooms.delete(flowId);
      };
      socket.on('close', leave);
      socket.on('error', leave);
    },
  );
}
