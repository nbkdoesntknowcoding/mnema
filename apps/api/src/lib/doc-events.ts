/**
 * Phase 3 (Open-Core) — generic in-process document event bus.
 *
 * Core emits `doc.updated` when a doc's content changes; gated modules (the ee
 * knowledge graph) subscribe. This replaces collab/persistence.ts's hard import
 * of queue/graph, so the core boots and compiles with the graph module absent.
 * Emit and subscribe must run in the SAME process — persistence runs collab-side,
 * so the graph subscriber is registered there (see lib/graph/doc-subscriber.ts).
 */
import { EventEmitter } from 'node:events';

export interface DocUpdatedEvent {
  tenantId: string;
  docId: string;
}

const bus = new EventEmitter();

/** Fire-and-forget: notify subscribers that a doc's content changed. */
export function emitDocUpdated(event: DocUpdatedEvent): void {
  bus.emit('doc.updated', event);
}

/** Subscribe to doc content changes (idempotent registration is the caller's job). */
export function onDocUpdated(handler: (event: DocUpdatedEvent) => void): void {
  bus.on('doc.updated', handler);
}
