export interface Edge { from: string; to: string }

export interface GraphValidation { valid: boolean; cycles: string[][]; danglingEdges: Edge[] }

/** Validates a prerequisite graph: every edge must reference known nodes and the graph must be acyclic. */
export function validateGraph(nodes: string[], edges: Edge[]): GraphValidation {
  const set = new Set(nodes);
  const danglingEdges = edges.filter((e) => !set.has(e.from) || !set.has(e.to));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) if (set.has(e.from) && set.has(e.to)) adj.get(e.from)!.push(e.to);

  const cycles: string[][] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const s = state.get(m) ?? 0;
      if (s === 0) visit(m);
      else if (s === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) visit(n);
  return { valid: cycles.length === 0 && danglingEdges.length === 0, cycles, danglingEdges };
}

/**
 * Kahn's algorithm with a priority tie-breaker: among nodes whose prerequisites are satisfied,
 * the highest-priority one is emitted first. Throws on cycles.
 */
export function prioritizedTopoSort(nodes: string[], edges: Edge[], priority: (n: string) => number): string[] {
  const set = new Set(nodes);
  const indeg = new Map<string, number>(nodes.map((n) => [n, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    if (!set.has(e.from) || !set.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, indeg.get(e.to)! + 1);
  }
  const ready = nodes.filter((n) => indeg.get(n) === 0);
  const out: string[] = [];
  const order = new Map(nodes.map((n, i) => [n, i]));
  while (ready.length) {
    ready.sort((a, b) => priority(b) - priority(a) || order.get(a)! - order.get(b)!);
    const n = ready.shift()!;
    out.push(n);
    for (const m of adj.get(n)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  if (out.length !== nodes.length) throw new Error('Prerequisite graph contains a cycle');
  return out;
}

/** All transitive prerequisites of `targets` (inclusive). */
export function ancestorsOf(targets: string[], edges: Edge[]): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const seen = new Set<string>();
  const stack = [...targets];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(parents.get(n) ?? []));
  }
  return seen;
}

/** Longest prerequisite chain length ending at each node. */
export function depthMap(nodes: string[], edges: Edge[]): Map<string, number> {
  const order = prioritizedTopoSort(nodes, edges, () => 0);
  const set = new Set(nodes);
  const depth = new Map<string, number>(nodes.map((n) => [n, 0]));
  const children = new Map<string, string[]>();
  for (const e of edges) if (set.has(e.from) && set.has(e.to)) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  for (const n of order) for (const m of children.get(n) ?? []) depth.set(m, Math.max(depth.get(m)!, depth.get(n)! + 1));
  return depth;
}

/** Layered left-to-right layout used to store roadmap node coordinates. */
export function layeredLayout(nodes: string[], edges: Edge[], opts = { xGap: 290, yGap: 96 }): Map<string, { x: number; y: number }> {
  const depth = depthMap(nodes, edges);
  const layers = new Map<number, string[]>();
  for (const n of nodes) layers.set(depth.get(n)!, [...(layers.get(depth.get(n)!) ?? []), n]);
  const maxLayer = Math.max(...[...layers.values()].map((l) => l.length));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [d, ns] of layers) {
    const offset = ((maxLayer - ns.length) * opts.yGap) / 2;
    ns.forEach((n, i) => pos.set(n, { x: d * opts.xGap, y: offset + i * opts.yGap }));
  }
  return pos;
}
