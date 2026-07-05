// Minimal ambient types for d3-force-3d (ships no declarations).
// Only the surface used by the graph (forceRadial) is typed.
declare module 'd3-force-3d' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type RadialNode = any;

  interface RadialForce {
    (alpha: number): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strength(s: number): RadialForce;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    radius(r: number | ((node: RadialNode, i: number, nodes: RadialNode[]) => number)): RadialForce;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialize(nodes: RadialNode[]): void;
  }

  export function forceRadial(
    radius: number | ((node: RadialNode, i: number, nodes: RadialNode[]) => number),
    x?: number,
    y?: number,
    z?: number,
  ): RadialForce;
}
