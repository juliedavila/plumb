// notes: notes and questions pinned to records (<instance>/notes.yaml). The engine adds this pack whenever the
// instance has a notes file. Notes on findings are checked after every other rule has run (src/core/bundle.ts),
// because a finding exists only once the checks have run.

import type { Finding, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { isForeign } from "../../src/core/namespace.ts";

type F = Omit<Finding, "pack" | "rule" | "severity">;

/** Does a note's target exist in this compiled model? Undefined for findings (checked after the rules run). */
export function targetExists(ctx: Pick<RuleContext, "model" | "plan" | "patchIds">, kind: string, id: string): boolean | undefined {
  switch (kind) {
    case "design": return true; // the enclosing design owns this note
    case "team": return ctx.model.teams.some((t) => t.id === id);
    case "element": return ctx.model.elements.some((e) => e.id === id);
    case "relationship": return ctx.model.relationships.some((r) => r.id === id);
    case "contract": return ctx.model.contracts.some((c) => c.name === id);
    case "unit": return ctx.plan.units.some((u) => u.id === id);
    case "phase": return ctx.plan.phases.some((p) => p.id === id);
    case "claim": return (ctx.model.claims ?? []).some((c) => c.id === id);
    case "patch": return ctx.patchIds ? ctx.patchIds.includes(id) : true;
    case "finding": return undefined;
    default: return false;
  }
}

export const TARGET_EXISTS: Rule = {
  id: "target-exists",
  title: "Every note is pinned to a record that exists",
  severity: "warning",
  why: "A note whose record was removed or renamed is orphaned: nobody sees it in place any more, and an open question on it is silently dropped.",
  check(ctx: RuleContext): F[] {
    const out: F[] = [];
    for (const n of ctx.notes ?? []) {
      if (ctx.ns && isForeign(n.target.id, ctx.ns.own)) continue; // another design's record: it resolves where that design is composed
      if (targetExists(ctx, n.target.kind, n.target.id) === false)
        out.push({ at: n.id, atKind: "note", message: `${n.kind === "question" ? "Question" : "Note"} ${n.id} is pinned to ${n.target.kind} ${n.target.id}, which no longer exists` });
    }
    return out;
  },
};

export const pack: RulePack = {
  name: "notes",
  title: "Notes",
  description: "Notes and questions stay pinned to records that exist.",
  rules: [TARGET_EXISTS],
};
