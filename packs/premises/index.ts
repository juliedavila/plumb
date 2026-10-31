// premises: the claims a design rests on. The engine adds this pack whenever the model declares claims.

import { CLAIM_GRADES, CLAIM_KINDS } from "../../src/core/load.ts";
import { loadBearingAt, premiseImpact, restsOnIndex, weight } from "../../src/core/premise.ts";
import type { Finding, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { natCompare } from "../../src/core/util.ts";
import { isNamespaced } from "../../src/core/namespace.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;

const restsOnResolves: Rule = {
  id: "rests-on-resolves",
  title: "Everything that rests on a claim names one that exists",
  severity: "error",
  why: "A part, unit or milestone that says it rests on a claim nobody declared hides a premise: no one can grade it, and its \"if this is false\" view is empty.",
  check(ctx: RuleContext): F[] {
    const ids = new Set((ctx.model.claims ?? []).map((c) => c.id));
    const out: F[] = [];
    const look = (atKind: F["atKind"], at: string, on?: string[]) => {
      // in a 0.4 design a namespaced claim is another design's (a claim's rests_on may point across) or core/xref-resolves's
      for (const c of on ?? []) if (!ids.has(c) && !(ctx.ns && isNamespaced(c))) out.push({ at, atKind, message: `${at} rests on claim ${c}, which the model does not declare` });
    };
    for (const c of ctx.model.claims ?? []) look("claim", c.id, c.rests_on);
    for (const e of ctx.model.elements) look("element", e.id, e.rests_on);
    for (const r of ctx.model.relationships) look("relationship", r.id, r.rests_on);
    for (const u of ctx.plan.units) look("unit", u.id, u.rests_on);
    for (const p of ctx.plan.phases) look("phase", p.id, p.rests_on);
    return out;
  },
};

const claimWellFormed: Rule = {
  id: "claim-well-formed",
  title: "Every claim has a statement, a kind and a grade",
  severity: "error",
  why: "A claim is only useful if a reader can say what it asserts and how well it is backed; an unknown grade cannot be ranked or warned about.",
  check(ctx: RuleContext): F[] {
    const out: F[] = [];
    const seen = new Set<string>();
    for (const c of ctx.model.claims ?? []) {
      if (seen.has(c.id)) out.push({ at: c.id, atKind: "claim", message: `two claims share the id ${c.id}` });
      seen.add(c.id);
      if (!c.statement.trim()) out.push({ at: c.id, atKind: "claim", message: `${c.id} has no statement` });
      if (!(CLAIM_KINDS as readonly string[]).includes(c.kind)) out.push({ at: c.id, atKind: "claim", message: `${c.id}: kind "${c.kind}" is not one of ${CLAIM_KINDS.join(", ")}` });
      if (!(CLAIM_GRADES as readonly string[]).includes(c.grade)) out.push({ at: c.id, atKind: "claim", message: `${c.id}: grade "${c.grade}" is not one of ${CLAIM_GRADES.join(", ")}` });
    }
    return out;
  },
};

const claimsAcyclic: Rule = {
  id: "claims-acyclic",
  title: "No claim rests on itself, directly or through others",
  severity: "error",
  why: "A circle of claims that support one another has no footing: none of them can be tested first, so none of them is backed.",
  check(ctx: RuleContext): F[] {
    const by = new Map((ctx.model.claims ?? []).map((c) => [c.id, c]));
    const out: F[] = [];
    const state = new Map<string, number>(); // 1 on the stack, 2 done
    const stack: string[] = [];
    const visit = (id: string) => {
      state.set(id, 1); stack.push(id);
      for (const n of by.get(id)?.rests_on ?? []) {
        if (!by.has(n)) continue;
        if (state.get(n) === 1) {
          const cyc = stack.slice(stack.indexOf(n));
          const at = [...cyc].sort(natCompare)[0];
          if (!out.some((f) => f.at === at)) out.push({ at, atKind: "claim", message: `${[...cyc, n].join(" rests on ")}` });
        } else if (!state.get(n)) visit(n);
      }
      stack.pop(); state.set(id, 2);
    };
    for (const id of [...by.keys()].sort(natCompare)) if (!state.get(id)) visit(id);
    return out;
  },
};

const loadBearingUntested: Rule = {
  id: "load-bearing-untested",
  title: "No load-bearing premise is untested",
  severity: "warning",
  why: "When many parts and units rest on a premise that nothing tests yet, the design can be wrong in one place and fail in many. Test it early in the plan, or give it a fallback that does not rest on it.",
  check(ctx: RuleContext): F[] {
    const at = loadBearingAt(ctx.config);
    const index = restsOnIndex(ctx.model, ctx.plan);
    const out: F[] = [];
    for (const c of ctx.model.claims ?? []) {
      if (c.grade !== "untested" || c.kind === "claim") continue;
      const im = premiseImpact(c.id, ctx.model, ctx.plan, index, ctx.premiseLinks);
      const w = weight(im);
      if (w < at) continue;
      const bits = [im.counts.elements && `${im.counts.elements} part${im.counts.elements === 1 ? "" : "s"}`, im.counts.relationships && `${im.counts.relationships} relationship${im.counts.relationships === 1 ? "" : "s"}`, im.counts.claims && `${im.counts.claims} claim${im.counts.claims === 1 ? "" : "s"}`, im.counts.phases && `${im.counts.phases} milestone${im.counts.phases === 1 ? "" : "s"}`].filter(Boolean);
      const units = im.units.reduce((n, g) => n + g.units.length, 0);
      out.push({ at: c.id, atKind: "claim", message: `${c.id} is untested and ${w} records rest on it (${[...bits, units ? `${units} unit${units === 1 ? "" : "s"} in the plan slice` : ""].filter(Boolean).join(", ")})${c.fallback ? "; it has a fallback" : "; it has no fallback"}` });
    }
    return out;
  },
};

export const pack: RulePack = {
  name: "premises",
  title: "Premises",
  description: "The claims the design rests on: each is declared, graded and acyclic, and no premise that much rests on is untested.",
  rules: [restsOnResolves, claimWellFormed, claimsAcyclic, loadBearingUntested],
  // Input findings are supplied by the reconciliation reader, like core's input checks.
  rules04: [{
    id: "links-valid", title: "Premise reconciliation preserves the evidence and needs review", severity: "error",
    why: "Premise links keep agent discoveries apart from a person's confirmation. Missing premises, changed text and review flags remain visible.",
    check: () => [],
  }],
};
