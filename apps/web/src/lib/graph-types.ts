// Shared graph types used by the 3D graph component and the /app/graph page

export interface GraphNode {
  id: string;
  label: string;
  entityType: string;
  entityId?: string;
  summary?: string | null;
  degree?: number;
  betweennessCentrality?: number;
  isGodNode?: boolean;
  communityId?: number;
  communityLabel?: string;
  // 3D simulation positions (set by force-graph)
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
}

export interface GraphEdge {
  id?: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType?: string;
  provenance?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  weight?: number;
  confidenceScore?: number;
  rationale?: string;
  // react-force-graph uses source/target
  source?: string | GraphNode;
  target?: string | GraphNode;
}

export interface GraphCommunity {
  id: number;
  label: string;
  description?: string;
  suggestedQuestions?: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: GraphCommunity[];
  report: GraphReport | null;
}

export interface GraphReport {
  reportDocId?: string;
  totalNodes: number;
  totalEdges: number;
  totalCommunities: number;
  godNodeCount: number;
  lastBuiltAt?: string;
  suggestedQuestions?: string[];
}
