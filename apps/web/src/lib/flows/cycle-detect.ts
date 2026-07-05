export function detectCycle(edges: Array<{ source: string; target: string }>): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();
  function dfs(node: string): boolean {
    if (inStack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    inStack.add(node);
    for (const neighbor of adj.get(node) ?? []) {
      if (dfs(neighbor)) return true;
    }
    inStack.delete(node);
    return false;
  }
  const allNodes = new Set([...edges.map((e) => e.source), ...edges.map((e) => e.target)]);
  for (const node of allNodes) {
    if (!visited.has(node) && dfs(node)) return true;
  }
  return false;
}
