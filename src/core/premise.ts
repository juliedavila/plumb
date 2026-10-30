// "If this is false": what rests on a claim, computed the way a patch impact is.
//
// A record rests on a claim when its `rests_on` names it (parts, relationships, units, milestones, other claims). The
// dependents are every record resting on the claim directly, or on a claim that rests on it, however deep; each keeps
// the chain of claims that reaches it. The plan slice is every unit that rests on it directly, moves a part that rests
// on it, or sits in a milestone that rests on it, grouped by milestone in plan order.

import type { Claim, Model, Plan, PremiseExposure, PremiseImpact, RecordKind } from "../types.ts";
import { natCompare } from "./util.ts";

type Ref = { kind: RecordKind; id: string };

/** claim id -> the records whose rests_on names it, in a stable order (claims, phases, units, elements, relationships). */
export function restsOnIndex(model: Model, plan: Plan): Map<string, Ref[]> {
  const ix = new Map<string, Ref[]>();
  const add = (kind: RecordKind, id: string, on?: string[]) => {
    for (const c of new Set(on ?? [])) { if (!ix.has(c)) ix.set(c, []); ix.get(c)!.push({ kind, id }); }
  };
  for (const c of model.claims ?? []) add("claim", c.id, c.rests_on);
  for (const p of plan.phases) add("phase", p.id, p.rests_on);
  for (const u of plan.units) add("unit", u.id, u.rests_on);
  for (const e of model.elements) add("element", e.id, e.rests_on);
  for (const r of model.relationships) add("relationship", r.id, r.rests_on);
  return ix;
}

const ORDER: Record<string, number> = { claim: 0, phase: 1, unit: 2, element: 3, relationship: 4 };

export function premiseImpact(claimId: string, model: Model, plan: Plan, index = restsOnIndex(model, plan)): PremiseImpact {
  const direct = [...(index.get(claimId) ?? [])];
  const dependents: PremiseImpact["dependents"] = [];
  const seen = new Set<string>([`claim:${claimId}`]);
  // breadth first through claims, so each record keeps its shortest chain
  const queue: { id: string; via: string[] }[] = [{ id: claimId, via: [claimId] }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const r of index.get(cur.id) ?? []) {
      const k = `${r.kind}:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dependents.push({ ...r, via: cur.via });
      if (r.kind === "claim") queue.push({ id: r.id, via: [...cur.via, r.id] });
    }
  }
  dependents.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || natCompare(a.id, b.id));
  const counts = { elements: 0, relationships: 0, units: 0, phases: 0, claims: 0, total: dependents.length };
  for (const d of dependents) {
    if (d.kind === "element") counts.elements++;
    else if (d.kind === "relationship") counts.relationships++;
    else if (d.kind === "unit") counts.units++;
    else if (d.kind === "phase") counts.phases++;
    else if (d.kind === "claim") counts.claims++;
  }
  const els = new Set(dependents.filter((d) => d.kind === "element").map((d) => d.id));
  const phases = new Set(dependents.filter((d) => d.kind === "phase").map((d) => d.id));
  const units = new Set(dependents.filter((d) => d.kind === "unit").map((d) => d.id));
  for (const u of plan.units) {
    if (phases.has(u.phase) || u.elements?.some((m) => els.has(m.id))) units.add(u.id);
  }
  const phaseOrder = [...plan.phases].sort((a, b) => a.order - b.order || natCompare(a.id, b.id));
  const byPhase = new Map<string, string[]>();
  const unitOf = new Map(plan.units.map((u) => [u.id, u]));
  for (const id of units) {
    const ph = unitOf.get(id)?.phase ?? "";
    if (!byPhase.has(ph)) byPhase.set(ph, []);
    byPhase.get(ph)!.push(id);
  }
  const rank = (ph: string) => { const i = phaseOrder.findIndex((p) => p.id === ph); return i < 0 ? 1e9 : i; };
  const slice = [...byPhase].sort((a, b) => rank(a[0]) - rank(b[0]) || natCompare(a[0], b[0]))
    .map(([phase, us]) => ({ phase, units: us.sort(natCompare) }));
  const openUnits = [...units].filter((id) => (unitOf.get(id)?.status ?? "todo") !== "done").length;
  return { claim: claimId, direct, dependents, counts, units: slice, openUnits };
}

/** How much of the plan is built on a claim before its first test lands (types.ts PremiseExposure). */
export function exposure(im: PremiseImpact, claim: Claim, plan: Plan): PremiseExposure {
  const unitOf = new Map(plan.units.map((u) => [u.id, u]));
  const order = new Map([...plan.phases].sort((a, b) => a.order - b.order || natCompare(a.id, b.id)).map((p, i) => [p.id, i]));
  const raw = claim.attrs?.tested_by;
  const tests = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).map(String).filter((id) => unitOf.has(id));
  let first: number | undefined;
  for (const t of tests) { const i = order.get(unitOf.get(t)!.phase); if (i !== undefined && (first === undefined || i < first)) first = i; }
  const firstPhase = first === undefined ? undefined : [...order].find(([, i]) => i === first)![0];
  const beforeByPhase = im.units
    .filter((g) => first === undefined || (order.get(g.phase) ?? 1e9) < first)
    .map((g) => ({ phase: g.phase, open: g.units.filter((id) => (unitOf.get(id)?.status ?? "todo") !== "done").length }))
    .filter((g) => g.open > 0);
  return {
    tests,
    ...(firstPhase ? { firstTest: { phase: firstPhase, units: tests.filter((t) => unitOf.get(t)!.phase === firstPhase) } } : {}),
    before: beforeByPhase.reduce((n, g) => n + g.open, 0),
    beforeByPhase,
  };
}

const GRADE_RANK: Record<string, number> = { untested: 0, judgment: 1, inference: 2, evidence: 3 };

/**
 * Claims ranked by stakes, for "which bet do we test next": an untested or judgment claim that no work tests and open
 * work is built on first (by that work), then the least evidence (untested, then judgment,
 * inference, evidence), then the most work built on it before its first test, then the most milestones at stake,
 * then how much rests on it.
 */
export function rankByStakes(claims: Claim[], impacts: Record<string, PremiseImpact>): Claim[] {
  const w = (c: Claim) => (impacts[c.id] ? weight(impacts[c.id]) : 0);
  const ex = (c: Claim) => impacts[c.id]?.exposure?.before ?? 0;
  const st = (c: Claim) => impacts[c.id]?.atStake?.length ?? 0;
  // an untested or judgment claim that nothing tests and work is built on comes first, by that work: no test is coming
  const tier = (c: Claim) => ((c.grade === "untested" || c.grade === "judgment") && !(impacts[c.id]?.exposure?.tests.length) && ex(c) > 0 ? -1 : GRADE_RANK[c.grade] ?? 0);
  return [...claims].sort((a, b) => tier(a) - tier(b) || ex(b) - ex(a) || st(b) - st(a) || w(b) - w(a) || natCompare(a.id, b.id));
}

/** Every claim's impact, keyed by claim id. */
export function allPremiseImpacts(model: Model, plan: Plan): Record<string, PremiseImpact> {
  const index = restsOnIndex(model, plan);
  const out: Record<string, PremiseImpact> = {};
  for (const c of model.claims ?? []) { out[c.id] = premiseImpact(c.id, model, plan, index); out[c.id].exposure = exposure(out[c.id], c, plan); }
  return out;
}

/** How much rests on a claim, as one number for ranking: every dependent record plus every unit in the plan slice. */
export function weight(im: PremiseImpact): number {
  const sliceUnits = im.units.reduce((n, g) => n + g.units.length, 0);
  return im.counts.total - im.counts.units + sliceUnits;
}

/** Claims ranked by how much rests on them (most first), then by id. */
export function rankClaims(claims: Claim[], impacts: Record<string, PremiseImpact>): Claim[] {
  return [...claims].sort((a, b) => (impacts[b.id] ? weight(impacts[b.id]) : 0) - (impacts[a.id] ? weight(impacts[a.id]) : 0) || natCompare(a.id, b.id));
}

/** The threshold at which an untested premise counts as load-bearing: engine.yaml premises.load_bearing, default 5. */
export function loadBearingAt(config: Record<string, unknown>): number {
  const p = config.premises as { load_bearing?: unknown } | undefined;
  const n = Number(p?.load_bearing);
  return Number.isFinite(n) && n >= 1 ? n : 5;
}
