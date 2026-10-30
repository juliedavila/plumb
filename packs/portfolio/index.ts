// portfolio: checks across designs. A rooted 0.4 design lists this pack, and the portfolio
// runs it over every design composed, with RuleContext.portfolio set (src/core/portfolio.ts).
//   seam-crossing-declared  every crossing is declared (the portfolio, and a design's own build for its own crossings)
//   no-cross-effort-cycle   no wait loop runs through two designs' plans (the portfolio)
//   one-root                the designs of one portfolio share one root (the portfolio)
//   team-over-capacity      no team carries more units in doing than its allowance (the portfolio; src/core/capacity.ts)
//   unit-has-flow-item      every unit says what kind of work it is (every build of a design whose root has an org layer)
// A rule may set a finding's own severity (the runner keeps it): seam-crossing-declared, one-root and
// team-over-capacity report errors and warnings, and list the highest as theirs.

import type { ComposedDesign, Finding, Rule, RuleContext, RulePack, RootInput, Unit } from "../../src/types.ts";
import { crossingSentence, seamReport, type SeamDesign } from "../../src/core/seams.ts";
import { marksFor } from "../../src/core/marks.ts";
import { cycles, makeAdj } from "../../src/core/graph.ts";
import { providersOf } from "../../src/core/plan.ts";
import { parseRef } from "../../src/core/namespace.ts";
import { natCompare } from "../../src/core/util.ts";
import { isFlowItem, overCapacityText, unitFlowItem } from "../../src/core/capacity.ts";

type F = Omit<Finding, "pack" | "rule">;

/** A design's own build: the seam report for its own crossings (its own edges to shared parts, its module crossings). */
function ownReport(ctx: RuleContext) {
  if (!ctx.ns) return undefined;                   // a lone instance has no seams
  const root = ctx.rootInput;
  if (!root && !ctx.model.seams?.length) return undefined;
  const own = ctx.ns.own ?? ctx.config.name;
  const design: SeamDesign = { namespace: own, title: ctx.config.title, model: ctx.model, plan: ctx.plan };
  const composed: ComposedDesign = { ...design, dir: "", pins: [] };
  const r: RootInput = root ?? { dir: "", config: { kind: "root" }, problems: [] };
  const marks = marksFor(r, [composed]);
  return seamReport({ root, designs: [design], own, ...(marks ? { marks } : {}), marksAvailable: !!marks, ...(ctx.today ? { today: ctx.today } : {}) });
}

const seamCrossingDeclared: Rule = {
  id: "seam-crossing-declared",
  title: "Every crossing between designs, or across a module seam, is declared",
  severity: "error",
  why: "Designs meet only where they say they do. The shared layer holds every relationship between two designs, or between a design and a shared part, and a module seam names every relationship that crosses it, so nothing reaches across a seam without someone deciding it should. An undeclared crossing that is security-relevant is an error and any other is a warning. An organization may flag rather than block a seam's named contracts for a while, with a named risk acceptor and an end; that changes no mark and no other finding.",
  how: "Declared: a crossing in seams.yaml (or added to the shared layer by a root patch), or a module crossing its seam in model.yaml seams: names with every contract it carries. Security relevance is the crossing's mark from computeMarks. Exceptions: seams.yaml default_exceptions, replaced by org.yaml seam_exceptions for a seam the organization lists.",
  check(ctx) {
    const report = ctx.portfolio?.seams ?? ownReport(ctx);
    if (!report) return [];
    const words = { designs: ctx.portfolio?.designs ?? [{ namespace: ctx.ns?.own ?? ctx.config.name, title: ctx.config.title }] as SeamDesign[], root: ctx.portfolio?.root ?? ctx.rootInput };
    return report.undeclared.map((c): F => ({
      at: ctx.portfolio ? c.id : c.rel, atKind: "relationship", severity: c.severity ?? "error",
      message: crossingSentence(c, words), ...(c.excepted_by ? { excepted_by: c.excepted_by } : {}),
    })) as ReturnType<Rule["check"]>;
  },
};

const possessive = (t: string) => (/s$/i.test(t) ? `${t}'` : `${t}'s`);

const noCrossEffortCycle: Rule = {
  id: "no-cross-effort-cycle",
  title: "No wait loop runs through two designs",
  severity: "error",
  why: "When work in one design waits on another design's work, which waits back on the first, neither design can finish first, and neither design's own plan shows the loop. The portfolio joins every design's plan and reports a loop that holds units of two or more designs; a loop inside one design stays with that design's own check.",
  how: "Unit A waits on unit B when A requires a capability B provides; a capability the shared layer declares is matched to its providers in whichever design provides it. Every unit counts, done or not.",
  check(ctx) {
    const p = ctx.portfolio;
    if (!p) return [];
    const units = ctx.plan.units;
    const byId = new Map(units.map((u) => [u.id, u]));
    const prov = providersOf(ctx.plan);
    const edges: [string, string][] = [];
    for (const u of units) for (const c of u.requires ?? []) for (const q of prov.get(c) ?? []) if (q !== u.id) edges.push([u.id, q]);
    const adj = makeAdj(units.map((u) => u.id), edges);
    const title = (ns: string) => p.designs.find((d) => d.namespace === ns)?.title ?? ns;
    const say = (id: string) => `${possessive(title(parseRef(id).ns ?? ""))} “${byId.get(id)?.title ?? parseRef(id).id}”`;
    const out: F[] = [];
    for (const scc of cycles(adj)) {
      const designs = [...new Set(scc.map((id) => parseRef(id).ns ?? ""))];
      if (designs.length < 2) continue;
      const inScc = new Set(scc);
      const start = scc[0], other = scc.find((id) => parseRef(id).ns !== parseRef(start).ns)!;
      const walk = [...pathWithin(adj, inScc, start, other), ...pathWithin(adj, inScc, other, start).slice(1)];
      const text = walk.slice(1).reduce((acc, id, i) => `${acc}${i === 0 ? " waits on " : ", which waits on "}${say(id)}`, say(walk[0]));
      out.push({ at: start, atKind: "unit", message: `${text}. The loop holds ${scc.length} units of ${designs.length} designs (${scc.join(", ")}), so none of them can start first.` });
    }
    return out as ReturnType<Rule["check"]>;
  },
};

/** The shortest path from a to b along wait edges, inside one strongly connected group (it always exists there). */
function pathWithin(adj: Map<string, string[]>, inScc: Set<string>, a: string, b: string): string[] {
  const prev = new Map<string, string>([[a, a]]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === b && n !== a) break;
    for (const m of [...(adj.get(n) ?? [])].sort(natCompare)) {
      if (!inScc.has(m) || prev.has(m)) continue;
      prev.set(m, n);
      queue.push(m);
    }
  }
  if (!prev.has(b)) return [a, b];
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return path;
}

const oneRoot: Rule = {
  id: "one-root",
  title: "The designs of one portfolio share one root",
  severity: "error",
  why: "A portfolio adds up every team's load and checks every crossing against one shared layer and one organization. A design that names a different root is checked against records the others never see, so it is an error; a design that names no root at all counts in no team's load, so it is a warning.",
  how: "Each design's engine.yaml root:, resolved from its folder, against portfolio.yaml root:.",
  check(ctx) {
    const p = ctx.portfolio;
    if (!p) return [];
    const want = p.root?.dir;
    const out: F[] = [];
    for (const d of [...p.designs].sort((a, b) => natCompare(a.namespace, b.namespace))) {
      const r = p.roots?.[d.namespace];
      if (!r?.dir) out.push({ at: d.namespace, atKind: "instance", severity: "warning", message: `${d.title} names no shared root, so its work counts in no team's load and the shared layer's crossings never reach it` });
      else if (want && r.dir !== want) out.push({ at: d.namespace, atKind: "instance", severity: "error", message: `${d.title} names the root ${r.written ?? r.dir} in its engine.yaml, while portfolio.yaml names ${p.rootWritten ?? want}, another folder; the designs of one portfolio share one root` });
    }
    return out as ReturnType<Rule["check"]>;
  },
};

const teamOverCapacity: Rule = {
  id: "team-over-capacity",
  title: "No team carries more work in doing than its allowance",
  severity: "error",
  why: "A team's capacity is how many pieces of work it carries in doing at once. Keeping the lights on and its other value streams take a share of that, and what is left is its allowance for design work. A team with more units in doing than its allowance is spread too thin, and everything it carries finishes later. When it owns open work on the path to a design's next milestone, that milestone slips with it, so that is an error; otherwise it is a warning.",
  how: "Units in doing: status doing, in every design composed, whose owner teams include the team; a unit with several owner teams takes a slot on each. Allowance: org.yaml capacity × (1 − the shares of its activities in force today, after the reliefs that have landed and a slowdown in force). The path: each composed design's current milestone (the first not reached), its open work and the open work that work waits on, across designs. A team with no capacity stated is not judged.",
  check(ctx) {
    const load = ctx.portfolio?.load;
    if (!load) return [];
    const title = (ns: string) => ctx.portfolio?.designs.find((d) => d.namespace === ns)?.title ?? ns;
    return load.teams.filter((t) => t.over).sort((a, b) => natCompare(a.team, b.team))
      .map((t): F => ({ at: t.team, atKind: "team", severity: t.severity ?? "warning", message: overCapacityText(t, load, title) })) as ReturnType<Rule["check"]>;
  },
};

/** A unit's flow item problem, in words, or undefined when it is one of the four. */
function flowProblem(u: Unit): string | undefined {
  const f = unitFlowItem(u);
  if (!f?.item) return "has no flow item: say in plan.yaml whether it is feature, defect, risk or debt work, or set it in progress.yaml";
  if (!isFlowItem(f.item)) return `has the flow item "${f.item}", which is not feature, defect, risk or debt`;
  return undefined;
}

const unitHasFlowItem: Rule = {
  id: "unit-has-flow-item",
  title: "Every unit says what kind of work it is",
  severity: "warning",
  why: "Across designs, open work splits between features, defects, risk and debt, and that split is what a team trades when it takes on more of one. A unit with no flow item drops out of that view. Premerge's and Intake's units arrive with their editions' defaults, so this catches an organization's own designs.",
  how: "A unit's flow_item in plan.yaml, or the one progress.yaml sets over it: feature, defect, risk or debt. Checked on every design whose root has an org layer, in its own build and in the portfolio.",
  check(ctx) {
    const out: F[] = [];
    const p = ctx.portfolio;
    if (p) {
      // the portfolio: every design under the portfolio's own root, when that root has an org layer (one under another root reports in its own build)
      if (!p.root?.org) return [];
      const designs = new Set(p.designs.filter((d) => p.roots?.[d.namespace]?.dir === p.root!.dir).map((d) => d.namespace));
      for (const u of ctx.plan.units) {
        if (!designs.has(parseRef(u.id).ns ?? "")) continue;
        const why = flowProblem(u);
        if (why) out.push({ at: u.id, atKind: "unit", message: `Unit ${u.id} (“${u.title}”) ${why}` });
      }
      return out as ReturnType<Rule["check"]>;
    }
    if (!ctx.ns?.rooted || !ctx.rootInput?.org) return [];
    for (const u of ctx.plan.units) { const why = flowProblem(u); if (why) out.push({ at: u.id, atKind: "unit", message: `Unit ${u.id} (“${u.title}”) ${why}` }); }
    return out as ReturnType<Rule["check"]>;
  },
};

export const pack: RulePack = {
  name: "portfolio",
  title: "Across designs",
  description: "Checks that only a portfolio can make, or that a design makes at its own edge: every crossing between designs or across a module seam is declared, no wait loop runs through two designs, the designs share one root, no team carries more work than its allowance, and every unit says what kind of work it is.",
  rules: [seamCrossingDeclared, noCrossEffortCycle, oneRoot, teamOverCapacity, unitHasFlowItem],
};
export default pack;
