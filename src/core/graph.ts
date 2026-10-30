// Deterministic graph helpers shared by plan analysis, layout and packs.
// Nodes and adjacency are visited in natural id order everywhere.

import { natCompare, natSort } from "./util.ts";

export type Adj = Map<string, string[]>;

export function makeAdj(nodes: string[], edges: [string, string][]): Adj {
  const adj: Adj = new Map(natSort(nodes).map((n) => [n, []]));
  for (const [a, b] of edges) if (adj.has(a) && adj.has(b) && !adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  for (const v of adj.values()) v.sort(natCompare);
  return adj;
}

/** Edges that close a cycle in a DFS from each node in natural order (to a node still on the stack). */
export function backEdges(adj: Adj): Set<string> {
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  for (const root of adj.keys()) {
    if (state.get(root)) continue;
    // iterative DFS
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [n, i] = top;
      const next = adj.get(n)!;
      if (i < next.length) {
        top[1]++;
        const m = next[i];
        const st = state.get(m) ?? 0;
        if (st === 1) back.add(`${n}\u0000${m}`);
        else if (st === 0) { state.set(m, 1); stack.push([m, 0]); }
      } else {
        state.set(n, 2);
        stack.pop();
      }
    }
  }
  return back;
}

export const edgeKey = (a: string, b: string) => `${a}\u0000${b}`;

/** Adjacency with the DFS back edges dropped: always acyclic. */
export function acyclic(adj: Adj): Adj {
  const back = backEdges(adj);
  const out: Adj = new Map();
  for (const [n, vs] of adj) out.set(n, vs.filter((m) => !back.has(edgeKey(n, m))));
  return out;
}

/** Topological order of an acyclic adjacency (Kahn, natural order among ready nodes). */
export function topo(adj: Adj): string[] {
  const indeg = new Map<string, number>([...adj.keys()].map((n) => [n, 0]));
  for (const vs of adj.values()) for (const m of vs) indeg.set(m, (indeg.get(m) ?? 0) + 1);
  let ready = natSort([...indeg].filter(([, d]) => d === 0).map(([n]) => n));
  const order: string[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) { ready.push(m); ready.sort(natCompare); }
    }
  }
  return order;
}

/** Strongly connected components with more than one node, or a self loop. Each sorted; list sorted by first id. */
export function cycles(adj: Adj): string[][] {
  let index = 0;
  const idx = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { strong(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1 || (adj.get(v) ?? []).includes(v)) out.push(natSort(comp));
    }
  };
  for (const v of adj.keys()) if (!idx.has(v)) strong(v);
  return out.sort((a, b) => natCompare(a[0], b[0]));
}
