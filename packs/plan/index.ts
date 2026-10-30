// plan: checks that the plan can actually be followed from start to finish.

import { DEFAULT_LADDER } from "../../src/core/load.ts";
import { cycles, makeAdj } from "../../src/core/graph.ts";
import { analyzePlan, providersOf, uniqueUnits } from "../../src/core/plan.ts";
import type { Finding, Rule, RulePack } from "../../src/types.ts";
import { isNamespaced } from "../../src/core/namespace.ts";
import { contradicting, unitAsserts } from "../../src/core/flow.ts";
import { RETIRABLE, RETIRED, retireFindings } from "../../src/core/current.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;

const requiresProvided: Rule = {
  id: "requires-provided",
  title: "Every required capability is provided",
  severity: "error",
  why: "Units hand each other capabilities; a unit that needs something no other unit will ever provide can never start, so the plan has a hole. A unit that provides what it requires is the same hole: it would have to finish before it could start.",
  check(ctx) {
    const prov = providersOf(ctx.plan);
    // a 0.4 design's shared capabilities are provided across the seam, by another design (src/core/plan.ts)
    const across = new Set((ctx.plan.capabilities ?? []).map((c) => c.id));
    const out: F[] = [];
    for (const u of uniqueUnits(ctx.plan)) for (const c of u.requires ?? []) {
      const ps = prov.get(c) ?? [];
      if (!ps.length && (across.has(c) || (ctx.ns && isNamespaced(c)))) continue; // across the seam, or core/xref-resolves says why not
      if (!ps.length) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} requires "${c}", which no unit provides` });
      else if (ps.every((p) => p === u.id)) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} requires "${c}", which only it provides, so it can never start` });
    }
    return out;
  },
};

const noCycles: Rule = {
  id: "no-dependency-cycles",
  title: "No dependency cycles",
  severity: "error",
  why: "If units wait on each other in a loop, none of them can go first; the plan must be orderable so someone can always start.",
  check(ctx) {
    const a = analyzePlan(ctx.plan);
    const edges: [string, string][] = [];
    for (const [u, ds] of Object.entries(a.deps)) for (const d of ds) edges.push([u, d]);
    return cycles(makeAdj(ctx.plan.units.map((u) => u.id), edges)).map((c) => ({
      at: c[0], atKind: "unit" as const, message: `units ${c.join(", ")} depend on each other in a cycle`,
    }));
  },
};

const exitTest: Rule = {
  id: "phase-has-exit-test",
  title: "Every milestone has an exit test",
  severity: "error",
  why: "A milestone is reached when a person can check a plain sentence and say yes; without one, nobody can tell when it is reached.",
  check(ctx) {
    return ctx.plan.phases.filter((p) => !p.exit_test?.trim()).map((p) => ({ at: p.id, atKind: "phase" as const, message: `milestone ${p.id} (${p.name}) has no exit test` }));
  },
};

const ladderUp: Rule = {
  id: "fidelity-moves-up",
  title: "Fidelity moves never go down the ladder",
  severity: "error",
  why: "The ladder ranks how real a part is, from nothing to a stand-in to the real thing; a unit may raise a part or extend it at the same level, but never lower it, and only to levels the instance defines.",
  check(ctx) {
    const ladder = ctx.config.ladder ?? DEFAULT_LADDER;
    const out: F[] = [];
    for (const u of ctx.plan.units) for (const m of u.elements ?? []) {
      // a 0.4 design: retired is a terminal level outside the ladder, for a part whose disposition is replace or retire
      if (ctx.ns && m.to === RETIRED && !ladder.includes(RETIRED)) {
        if (ladder.indexOf(m.from) < 0) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves ${m.id} from "${m.from}", which is not on the ladder (${ladder.join(" < ")})` });
        const st = ctx.current?.records.get(m.id);
        if (!st?.disposition || !RETIRABLE.has(st.disposition))
          out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves ${m.id} to retired, which is allowed only for a part whose disposition in current state is replace or retire; ${!st ? "it has no current-state record" : st.disposition ? `its disposition is ${st.disposition}` : "its record gives no disposition that can be read"}` });
        continue;
      }
      const f = ladder.indexOf(m.from), t = ladder.indexOf(m.to);
      if (f < 0) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves ${m.id} from "${m.from}", which is not on the ladder (${ladder.join(" < ")})` });
      if (t < 0) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves ${m.id} to "${m.to}", which is not on the ladder (${ladder.join(" < ")})` });
      if (f >= 0 && t >= 0 && t < f) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves ${m.id} down the ladder, from ${m.from} to ${m.to}` });
    }
    return out;
  },
};

const ownerExists: Rule = {
  id: "unit-owner-exists",
  title: "A unit's owner team exists",
  severity: "error",
  why: "The owner is who does the work; an owner that is not a known team means the work has nobody real behind it.",
  check(ctx) {
    return ctx.plan.units.filter((u) => u.owner && !ctx.team.has(u.owner) && !(ctx.ns && isNamespaced(u.owner)))
      .map((u) => ({ at: u.id, atKind: "unit" as const, message: `unit ${u.id} names owner team "${u.owner}", which does not exist` }));
  },
};

const noEarlyOnLate: Rule = {
  id: "no-earlier-depends-on-later",
  title: "No unit depends on work only provided in a later milestone",
  severity: "error",
  why: "Milestones come in order; a unit that needs a capability only a later milestone provides cannot finish in its own, so its milestone can never pass its exit test.",
  check(ctx) {
    const prov = providersOf(ctx.plan);
    const out: F[] = [];
    for (const u of ctx.plan.units) {
      const mine = ctx.phase.get(u.phase);
      if (!mine) continue;
      for (const c of u.requires ?? []) {
        const ps = (prov.get(c) ?? []).filter((p) => p !== u.id).map((p) => ctx.unit.get(p)!);
        if (!ps.length) continue;
        const later = ps.every((p) => { const ph = ctx.phase.get(p.phase); return ph !== undefined && ph.order > mine.order; });
        if (later) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} (milestone ${u.phase}) requires "${c}", which only later milestones provide (${ps.map((p) => `${p.id} in ${p.phase}`).join(", ")})` });
      }
    }
    return out;
  },
};

const doneHasDoneDeps: Rule = {
  id: "done-unit-dependencies-done",
  title: "A done unit's dependencies are done",
  severity: "error",
  why: "A unit can only have finished if what it needed was already there; a done unit whose required capability no done unit provides means a status is wrong, and everything downstream is planned on a false floor.",
  check(ctx) {
    const units = uniqueUnits(ctx.plan);
    const byId = new Map(units.map((u) => [u.id, u]));
    const prov = providersOf(ctx.plan);
    const out: F[] = [];
    for (const u of units) {
      if ((u.status ?? "todo") !== "done") continue;
      for (const c of u.requires ?? []) {
        const ps = (prov.get(c) ?? []).filter((p) => p !== u.id);
        if (!ps.length) continue; // requires-provided reports it
        if (ps.some((p) => byId.get(p)?.status === "done")) continue;
        out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} is done but requires "${c}", and no unit that provides it is done (${ps.map((p) => `${p} is ${byId.get(p)?.status ?? "todo"}`).join(", ")})` });
      }
    }
    return out;
  },
};

const doneUnitHolds: Rule = {
  id: "done-unit-holds",
  title: "A done unit is not contradicted by the model",
  severity: "warning",
  why: "A unit marked done claims something about the design. Where the unit says what that is, the model can check it; a done unit the model contradicts is reported progress that is not true.",
  how: "A unit's attrs.asserts lists what it claims, each as every part of a kind carrying an attribute (every: queue, has: wip_limit).",
  check(ctx) {
    const out: F[] = [];
    for (const u of ctx.plan.units) {
      if ((u.status ?? "todo") !== "done") continue;
      for (const a of unitAsserts(u.attrs)) {
        const bad = contradicting(ctx.model, a);
        if (!bad.length) continue;
        out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} is done, but the model contradicts it: ${bad.map((e) => `${a.every} ${e.id}`).join(", ")} ${bad.length === 1 ? "has" : "have"} no ${a.has}` });
      }
    }
    return out;
  },
};

// ---------- 0.4: current state ----------
// These rules are the pack's for a 0.4 design only (src/core/rules.ts `packsFor`), so a lone instance's plan pack
// keeps its rule set: fidelity-moves-up's check already reads `retired` only in a 0.4 design, and here says so.

const ladderUp04: Rule = {
  ...ladderUp,
  why: "The ladder ranks how real a part is, from nothing to a stand-in to the real thing; a unit may raise a part or extend it at the same level, but never lower it, and only to levels the instance defines. Retiring a part is the one move off the ladder, and only for a part that current state says is replaced or retired.",
  how: "retired is a terminal level outside the ladder: a unit may move a part to it only when the part's disposition in current.yaml is replace or retire.",
};

const retireBeforeReplace: Rule = {
  id: "retire-before-replace",
  title: "A part that goes away is retired in step with what replaces it",
  severity: "error",
  why: "Expand and contract: when the plan replaces or retires a part that exists today, a unit must switch the old part off, in the milestone where its replacement reaches its target and after the work that brings it there. A plan that never switches it off pays to run both, one that switches it off later runs both side by side, and one that can switch it off first leaves a gap. A finding that rests on a record nobody has confirmed is a warning until a person confirms it.",
  how: "current.yaml gives each part's disposition and replaced_by; a unit retires a part with the move to: retired. Order is plan order inside one design and target dates across designs, with no finding when a date is missing. Not waiting for the replacement is always a warning.",
  check(ctx) {
    // a finding's own severity: an error on a confirmed record, a warning on a discovered one (src/core/current.ts)
    return ctx.current ? (retireFindings(ctx.plan, ctx.current) as F[]) : [];
  },
};

export const pack: RulePack = {
  name: "plan",
  title: "Plan soundness",
  description: "Checks that the plan can be followed: every need is met, nothing waits in a loop, milestones can be reached, and work moves parts up the fidelity ladder.",
  rules: [requiresProvided, noCycles, exitTest, ladderUp, ownerExists, noEarlyOnLate, doneHasDoneDeps, doneUnitHolds],
  rules04: [ladderUp04, retireBeforeReplace],
};
