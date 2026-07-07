/**
 * In-process workspace event pub/sub.
 *
 * Used to broadcast real-time events (task_updated, notification) to SSE
 * clients within the same process. For multi-process deployments, swap the
 * EventEmitter for a Redis pub/sub channel.
 *
 * Design:
 *   - One emitter per workspace (lazy-created, GC'd on last unsubscribe)
 *   - Listeners receive typed WorkspaceEvent objects
 *   - Emitter is deliberately unbuffered — if no listeners are connected,
 *     events are dropped (SSE clients will re-fetch on reconnect)
 */

import { EventEmitter } from 'node:events';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TaskUpdatedPayload {
  task: {
    id: string;
    workspaceId: string;
    title: string;
    status: string;
    priority: string;
    boardOrder: number;
    updatedAt: Date;
    [key: string]: unknown;
  };
  previousStatus: string;
  changedBy: 'agent' | 'user';
  developerId?: string;
}

export interface NotificationPayload {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: Date | null;
  createdAt: Date;
}

// ── Phase 2: AgentLens session event payloads ─────────────────────────────────

export interface SessionCostUpdatedPayload {
  sessionId:       string;
  developerId:     string;
  totalCostUsd:    number;
  totalToolCalls:  number;
  latestToolName:  string;
}

export interface SessionStartedPayload {
  sessionId:   string;
  developerId: string;
  agent:       string;
  taskId?:     string;
}

export interface SessionEndedPayload {
  sessionId:    string;
  totalCostUsd: number;
  status:       string;
}

export interface TaskDeletedPayload {
  taskId:      string;
  workspaceId: string;
}

export interface TaskCommentedPayload {
  taskId: string;
  comment: {
    id:         string;
    body:       string;
    authorId:   string;
    authorName: string | null;
    createdAt:  Date;
  };
}

export type WorkspaceEvent =
  | { type: 'notification'; data: NotificationPayload }
  | { type: 'task_updated'; data: TaskUpdatedPayload }
  | { type: 'task_commented'; data: TaskCommentedPayload }
  | { type: 'task_deleted'; data: TaskDeletedPayload }
  | { type: 'session_cost_updated'; data: SessionCostUpdatedPayload }
  | { type: 'session_started';      data: SessionStartedPayload }
  | { type: 'session_ended';        data: SessionEndedPayload }
  | { type: 'optimization_findings_updated'; data: { newCount: number } }
  | { type: 'attachment_ready'; data: { attachmentId: string; docId: string | null; format: string } }
  | { type: 'graph_updated'; data: { totalNodes: number; totalEdges: number; communityCount: number } }
  | {
      type: 'graph_node_added';
      data: {
        nodeId: string;
        label: string;
        entityType: string;
        connectedNodeIds: string[];
        communityId?: number;
      };
    };

type WorkspaceEventListener = (event: WorkspaceEvent) => void;

// ── Emitter registry ─────────────────────────────────────────────────────────

// Keyed by workspace_id. Entries removed when listener count drops to 0.
const emitters = new Map<string, EventEmitter>();

function getOrCreate(workspaceId: string): EventEmitter {
  let emitter = emitters.get(workspaceId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(200); // large teams, many open tabs
    emitters.set(workspaceId, emitter);
  }
  return emitter;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe a listener to all events in the workspace.
 * Returns an unsubscribe function — call it when the SSE connection closes.
 */
export function subscribeWorkspace(
  workspaceId: string,
  listener: WorkspaceEventListener,
): () => void {
  const emitter = getOrCreate(workspaceId);
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
    if (emitter.listenerCount('event') === 0) {
      emitters.delete(workspaceId);
    }
  };
}

/**
 * Emit an event to all subscribers of the workspace.
 * Fire-and-forget — does not throw if there are no listeners.
 */
export function emitWorkspaceEvent(workspaceId: string, event: WorkspaceEvent): void {
  const emitter = emitters.get(workspaceId);
  if (emitter) {
    emitter.emit('event', event);
  }
}
