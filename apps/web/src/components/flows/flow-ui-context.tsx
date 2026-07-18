import { createContext, useContext } from 'react';

/**
 * UI actions the node components trigger but that live in FlowCanvas state:
 * the 3-level doc preview (peek → expand → full panel) and comment threads.
 * Provided by FlowCanvas; nodes consume it via useFlowUI().
 */
export interface FlowUI {
  /** hover peek tooltip — pass a node id to show, null to hide. */
  setPeek: (nodeId: string | null) => void;
  /** "Preview doc/capture" → expand-in-place. */
  onPreview: (nodeId: string) => void;
  /** open the node's comment thread popover. */
  onComment: (nodeId: string) => void;
  /** comment counts keyed by client node id. */
  commentsByNode: Record<string, number>;
}

const noop = () => {};
export const FlowUIContext = createContext<FlowUI>({
  setPeek: noop,
  onPreview: noop,
  onComment: noop,
  commentsByNode: {},
});

export function useFlowUI(): FlowUI {
  return useContext(FlowUIContext);
}
