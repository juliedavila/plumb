// Plan analysis: the capability graph between units, pull layers, frontier, blocked, critical path, phase progress.
//
// Semantics:
// - unit A depends on unit B when A requires a capability B provides (B != A).
// - a capability is AVAILABLE when at least one done unit provides it.
// - frontier: units not done whose every required capability is available.
// - blocked: every other unit not done, with its unavailable capabilities and the not-done units that provide them.
// - layers and critical_path cover units not done; dependency cycles are broken by dropping DFS back edges.
// - when two units share an id, the first in file order is the unit; later ones are ignored here
//   (generic/unique-ids reports them), so a unit is never both on the frontier and blocked.
// - a 0.4 design's plan may list shared capabilities (plan.capabilities, outside records "shared:<id>"): one its units
//   require and another design provides is provided across the seam, so it is never unprovided; it is never available
//   in the design's own build either, so the unit waits on it, outside this design (analysis.outside names who provides it).

import type { Plan, PlanAnalysis, Unit } from "../types.ts";
import { acyclic, makeAdj, topo } from "./graph.ts";
import { natCompare, natSort } from "./util.ts";

const isDone = (u: Unit) => (u.status ?? "todo") === "done";

/** The plan's units with duplicate ids dropped: the first by file order wins. */
export function uniqueUnits(plan: Plan): Unit[] {
  const seen = new Set<string>();
  return plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

export function providersOf(plan: Plan): Map<string, string[]> {
  const prov = new Map<string, string[]>();
  for (const u of uniqueUnits(plan)) for (const c of u.provides ?? []) {
    if (!prov.has(c)) prov.set(c, []);
    if (!prov.get(c)!.includes(u.id)) prov.get(c)!.push(u.id);
  }
  for (const v of prov.values()) v.sort(natCompare);
  return prov;
}

export function analyzePlan(plan: Plan): PlanAnalysis {
  const units = uniqueUnits(plan).sort((a, b) => natCompare(a.id, b.id));
  const byId = new Map(units.map((u) => [u.id, u]));
  const prov = providersOf(plan);

  const deps: Record<string, string[]> = {};
  const unblocks: Record<string, string[]> = {};
  for (const u of units) { deps[u.id] = []; unblocks[u.id] = []; }
  for (const u of units) {
    const ds = new Set<string>();
    for (const c of u.requires ?? []) for (const p of prov.get(c) ?? []) if (p !== u.id) ds.add(p);
    deps[u.id] = natSort(ds);
    for (const d of ds) unblocks[d].push(u.id);
  }
  for (const k of Object.keys(unblocks)) unblocks[k] = natSort(new Set(unblocks[k]));

  const available = new Set<string>();
  for (const u of units) if (isDone(u)) for (const c of u.provides ?? []) available.add(c);

  const open = units.filter((u) => !isDone(u));
  const frontier: string[] = [];
  const blocked: PlanAnalysis["blocked"] = {};
  for (const u of open) {
    const missing = natSort(new Set((u.requires ?? []).filter((c) => !available.has(c))));
    if (!missing.length) { frontier.push(u.id); continue; }
    const waiting = new Set<string>();
    for (const c of missing) for (const p of prov.get(c) ?? []) if (p !== u.id && !isDone(byId.get(p)!)) waiting.add(p);
    blocked[u.id] = { missing, waitingOn: natSort(waiting) };
  }

  // Graph over open units, edges dependency -> dependent, cycles broken.
  const openIds = open.map((u) => u.id);
  const openSet = new Set(openIds);
  const edges: [string, string][] = [];
  for (const u of open) for (const d of deps[u.id]) if (openSet.has(d)) edges.push([d, u.id]);
  const dag = acyclic(makeAdj(openIds, edges));
  const order = topo(dag);
  const preds = new Map<string, string[]>(openIds.map((n) => [n, []]));
  for (const [n, vs] of dag) for (const m of vs) preds.get(m)!.push(n);

  // Pull layers: level = longest distance from an open unit with no open dependency.
  const level = new Map<string, number>();
  for (const n of order) level.set(n, Math.max(-1, ...preds.get(n)!.map((p) => level.get(p)!)) + 1);
  const layers: string[][] = [];
  for (const n of order) (layers[level.get(n)!] ??= []).push(n);
  for (const l of layers) l.sort(natCompare);

  // Critical path: longest chain by unit count; ties go to the smaller id at every step.
  const len = new Map<string, number>(), back = new Map<string, string | undefined>();
  for (const n of order) {
    let best: string | undefined, bl = 0;
    for (const p of natSort(preds.get(n)!)) if (len.get(p)! > bl) { bl = len.get(p)!; best = p; }
    len.set(n, bl + 1); back.set(n, best);
  }
  let end: string | undefined, el = 0;
  for (const n of natSort(order)) if (len.get(n)! > el) { el = len.get(n)!; end = n; }
  const critical_path: string[] = [];
  for (let n = end; n !== undefined; n = back.get(n)) critical_path.unshift(n);

  const phases = [...plan.phases]
    .sort((a, b) => a.order - b.order || natCompare(a.id, b.id))
    .map((ph) => {
      const us = units.filter((u) => u.phase === ph.id);
      const done = us.filter(isDone).length;
      return { id: ph.id, total: us.length, done, complete: done === us.length };
    });

  // capabilities provided across a seam, by other designs (a 0.4 design's shared capabilities)
  const across = new Map((plan.capabilities ?? []).map((c) => [c.id, c.provided_by]));
  const unprovided = natSort(new Set(units.flatMap((u) => u.requires ?? []).filter((c) => !prov.has(c) && !across.has(c))));
  const outside: Record<string, string[]> = {};
  for (const c of natSort(new Set(units.flatMap((u) => u.requires ?? [])))) if (!prov.has(c) && across.has(c)) outside[c] = [...across.get(c)!];

  // Transitive unblocks: for each open unit, how many other open units depend on it directly or through others.
  // Ranks "can start now" by leverage without inventing dates. Cycles are harmless here (a visited set).
  const unblocksTransitive: Record<string, number> = {};
  for (const u of open) {
    const seen = new Set<string>([u.id]), stack = [u.id];
    while (stack.length) for (const n of unblocks[stack.pop()!] ?? []) if (openSet.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    unblocksTransitive[u.id] = seen.size - 1;
  }

  return { deps, unblocks, layers, frontier, blocked, critical_path, phases, unprovided, unblocksTransitive, ...(Object.keys(outside).length ? { outside } : {}) };
}
