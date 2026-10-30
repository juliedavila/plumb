// Synthetic large bundle for site scale tests: 150 elements, 500 relationships, 50 views,
// 300 units, plus findings and patches. Deterministic (seeded) so sizes are stable across runs.
import type { Bundle, Element, Relationship, View, ViewLayout, Unit, Finding } from "../../src/types";

export function makeBigBundle(): Bundle {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const teams = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }));
  const zones = Array.from({ length: 6 }, (_, i) => ({ id: `z${i}`, name: `Zone ${i}` }));
  const systems = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, name: `System ${i}` }));
  const kinds = ["service", "store", "queue", "person", "ui", "process", "external-system"];
  const elements: Element[] = Array.from({ length: 150 }, (_, i) => ({
    id: `e${i}`, name: `Element number ${i} ${pick(["gateway", "ledger", "worker", "portal", "broker"])}`,
    kind: pick(kinds), zone: pick(zones).id, system: pick(systems).id, owner: i % 17 === 0 ? undefined : pick(teams).id,
    description: `Synthetic element ${i} used to test how the site behaves at scale.`,
  }));
  const relKinds = ["data", "control", "feedback", "handoff"];
  const relationships: Relationship[] = Array.from({ length: 500 }, (_, i) => {
    const from = Math.floor(rnd() * 150);
    let to = Math.floor(rnd() * 150); if (to === from) to = (to + 1) % 150;
    return { id: `r${i}`, from: `e${from}`, to: `e${to}`, kind: pick(relKinds), label: rnd() < 0.5 ? `flow ${i}` : undefined, carries: rnd() < 0.2 ? [`c${i % 40}`] : undefined };
  });
  const contracts = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, description: `Contract ${i}`, produced_by: [`e${i}`], consumed_by: [`e${i + 50}`] }));
  const views: View[] = [];
  const layouts: ViewLayout[] = [];
  for (let v = 0; v < 50; v++) {
    const ids = new Set<string>();
    while (ids.size < 18) ids.add(`e${Math.floor(rnd() * 150)}`);
    const els = [...ids];
    views.push({ id: `v${v}`, title: `View ${v}`, elements: els });
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    els.forEach((id, i) => pos.set(id, { x: 30 + (i % 6) * 230, y: 30 + Math.floor(i / 6) * 120, w: 170, h: 56 }));
    const edges = relationships.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r) => {
      const a = pos.get(r.from)!, b = pos.get(r.to)!;
      return { id: r.id, from: r.from, to: r.to, points: [[a.x + a.w, a.y + a.h / 2], [(a.x + b.x) / 2 + 85, a.y + a.h / 2], [(a.x + b.x) / 2 + 85, b.y + b.h / 2], [b.x, b.y + b.h / 2]] as [number, number][] };
    });
    layouts.push({ view: `v${v}`, width: 30 + 6 * 230, height: 30 + 3 * 120 + 30, nodes: els.map((id) => ({ id, ...pos.get(id)! })), edges });
  }
  const phases = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Phase ${i}`, order: i, exit_test: `Phase ${i} is checkably finished.` }));
  const units: Unit[] = Array.from({ length: 300 }, (_, i) => ({
    id: `u${i}`, title: `Unit ${i}: ${pick(["wire", "agree", "measure", "build"])} the ${pick(["intake", "ledger", "export", "review"])}`,
    kind: pick(["code", "agreement", "measurement"]), phase: `p${Math.floor(i / 50)}`, owner: pick(teams).id,
    status: i < 60 ? "done" : i < 75 ? "doing" : "todo",
    requires: i > 0 ? [`cap${Math.floor(rnd() * i)}`, ...(rnd() < 0.3 ? [`cap${Math.floor(rnd() * i)}`] : [])] : [],
    provides: [`cap${i}`],
    elements: [{ id: pick(elements).id, from: "none", to: pick(["stand-in", "existing-tool", "built"]) }],
    check: `Unit ${i} passes its check when the named output exists and a reviewer can confirm it.`,
  }));
  const done = new Set(units.filter((u) => u.status === "done").map((u) => u.id));
  const deps: Record<string, string[]> = {}, unblocks: Record<string, string[]> = {};
  for (const u of units) { deps[u.id] = (u.requires ?? []).map((c) => "u" + c.slice(3)); unblocks[u.id] = []; }
  for (const u of units) for (const d of deps[u.id]) unblocks[d].push(u.id);
  const open = units.filter((u) => !done.has(u.id)).map((u) => u.id);
  const frontier = open.filter((id) => deps[id].every((d) => done.has(d)));
  const blocked: Bundle["analysis"]["blocked"] = {};
  for (const id of open) if (!frontier.includes(id)) blocked[id] = { missing: deps[id].filter((d) => !done.has(d)).map((d) => "cap" + d.slice(1)), waitingOn: deps[id].filter((d) => !done.has(d)) };
  const findings: Finding[] = [];
  for (let i = 0; i < 150; i += 17) findings.push({ pack: "generic", rule: "element-owner", severity: "error", at: `e${i}`, atKind: "element", message: `Element number ${i} has no owner team.` });
  for (let i = 0; i < 300; i += 7) findings.push({ pack: "plan", rule: "phase-order", severity: "warning", at: `u${i}`, atKind: "unit", message: `Unit u${i} waits on a later phase.` });
  const patches = Array.from({ length: 10 }, (_, i) => ({
    id: `patch-${String(i).padStart(3, "0")}`, title: `Synthetic change ${i}`, status: (i % 3 === 0 ? "accepted" : "proposed") as "accepted" | "proposed",
    why: "Exercise the changes page at scale.", ops: [{ op: "remove" as const, kind: "element" as const, id: `e${i}` }],
    impact: { patch: `patch-${i}`, status: "proposed" as const, added: [], removed: [{ kind: "element" as const, id: `e${i}` }], modified: [],
      cascade: relationships.filter((r) => r.from === `e${i}`).map((r) => ({ kind: "relationship" as const, id: r.id, because: `touches removed element e${i}` })),
      findingsIntroduced: [], findingsResolved: [], unitsAffected: units.filter((u) => u.elements?.[0].id === `e${i}`).map((u) => u.id), errors: [] },
  }));
  return {
    engine: { version: "0.1.0", built: "2026-10-21T00:00:00.000Z", hash: "big" },
    instance: { name: "big", title: "Synthetic scale test", packs: [
      { name: "generic", title: "Model integrity", description: "", rules: [{ id: "element-owner", title: "Every element has an owner team", why: "Ownership.", severity: "error" }] },
      { name: "plan", title: "Plan soundness", description: "", rules: [{ id: "phase-order", title: "Earlier phases do not wait on later ones", why: "Order.", severity: "warning" }] },
    ], ladder: ["none", "stand-in", "existing-tool", "built"] },
    model: { teams, zones, systems, elements, relationships, contracts, views },
    plan: { phases, units },
    findings,
    analysis: {
      deps, unblocks, layers: [open], frontier, blocked, critical_path: ["u0", "u1", "u2"],
      phases: phases.map((p) => { const us = units.filter((u) => u.phase === p.id); const d = us.filter((u) => u.status === "done").length; return { id: p.id, total: us.length, done: d, complete: d === us.length }; }),
      unprovided: [],
    },
    patches,
    layouts,
  };
}
