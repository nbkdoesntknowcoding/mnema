// apps/web/src/components/graph/highlight.ts
// No Three.js. Just a state object that drawNode reads.

export interface HighlightState {
  selectedId: string | null;
  connectedIds: Set<string>;
}

export const highlightState: HighlightState = {
  selectedId:   null,
  connectedIds: new Set(),
};

export function setHighlight(id: string, connected: string[]): void {
  highlightState.selectedId   = id;
  highlightState.connectedIds = new Set(connected);
}

export function clearHighlight(): void {
  highlightState.selectedId   = null;
  highlightState.connectedIds = new Set();
}
