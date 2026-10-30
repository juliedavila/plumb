// generic: the checks every model needs, whatever it describes.

import type { Finding, RecordKind, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { isNamespaced } from "../../src/core/namespace.ts";

/** In a 0.4 design, a namespaced reference is core/xref-resolves's to judge (it resolved into an outside record, or core says why not). */
const coreJudges = (ctx: RuleContext, ref: string): boolean => !!ctx.ns && isNamespaced(ref);

type F = Omit<Finding, "pack" | "rule" | "severity">;

const uniqueIds: Rule = {
  id: "unique-ids",
  title: "Ids are unique within their kind",
  severity: "error",
  why: "Every other check, view and patch finds a record by its id; two records sharing one id means one of them is silently ignored.",
  check(ctx) {
    const out: F[] = [];
    const lists: [RecordKind, { id?: string; name?: string }[], "id" | "name"][] = [
      ["team", ctx.model.teams, "id"], ["system", ctx.model.systems, "id"], ["zone", ctx.model.zones, "id"],
      ["element", ctx.model.elements, "id"], ["relationship", ctx.model.relationships, "id"],
      ["contract", ctx.model.contracts, "name"], ["view", ctx.model.views, "id"],
      ["unit", ctx.plan.units, "id"], ["phase", ctx.plan.phases, "id"],
    ];
    for (const [kind, xs, key] of lists) {
      const count = new Map<string, number>();
      for (const x of xs) count.set(String(x[key]), (count.get(String(x[key])) ?? 0) + 1);
      for (const [id, n] of count) if (n > 1) out.push({ at: id, atKind: kind, message: `${n} ${kind} records share the ${key} "${id}"` });
    }
    return out;
  },
};

const referencesResolve: Rule = {
  id: "references-resolve",
  title: "Every id reference resolves",
  severity: "error",
  why: "A model is only trustworthy if every name it points at exists; a reference to a missing element, team or contract is usually a typo or a leftover from a removal.",
  check(ctx) {
    const out: F[] = [];
    const sys = new Set(ctx.model.systems.map((s) => s.id)), zon = new Set(ctx.model.zones.map((z) => z.id));
    const skip = (ref: string) => coreJudges(ctx, ref);
    for (const e of ctx.model.elements) {
      if (e.system && !sys.has(e.system) && !skip(e.system)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names system "${e.system}", which does not exist` });
      if (e.zone && !zon.has(e.zone) && !skip(e.zone)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names zone "${e.zone}", which does not exist` });
      if (e.owner && !ctx.team.has(e.owner) && !skip(e.owner)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names owner team "${e.owner}", which does not exist` });
      if (e.parent && !ctx.el.has(e.parent) && !skip(e.parent)) out.push({ at: e.id, atKind: "element", message: `element ${e.id} names parent "${e.parent}", which does not exist` });
      if (e.parent === e.id) out.push({ at: e.id, atKind: "element", message: `element ${e.id} is its own parent` });
    }
    for (const r of ctx.model.relationships) {
      if (!ctx.el.has(r.from) && !skip(r.from)) out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} starts at "${r.from}", which is not an element` });
      if (!ctx.el.has(r.to) && !skip(r.to)) out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} ends at "${r.to}", which is not an element` });
      for (const c of r.carries ?? []) if (!ctx.con.has(c) && !skip(c)) out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} carries contract "${c}", which does not exist` });
    }
    for (const c of ctx.model.contracts) {
      for (const p of c.produced_by ?? []) if (!ctx.el.has(p) && !skip(p)) out.push({ at: c.name, atKind: "contract", message: `contract ${c.name} names producer "${p}", which is not an element` });
      for (const p of c.consumed_by ?? []) if (!ctx.el.has(p) && !skip(p)) out.push({ at: c.name, atKind: "contract", message: `contract ${c.name} names consumer "${p}", which is not an element` });
    }
    for (const u of ctx.plan.units) {
      if (!ctx.phase.has(u.phase) && !skip(u.phase)) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} is in phase "${u.phase}", which does not exist` });
      for (const m of u.elements ?? []) if (!ctx.el.has(m.id) && !skip(m.id)) out.push({ at: u.id, atKind: "unit", message: `unit ${u.id} moves element "${m.id}", which does not exist` });
    }
    return out;
  },
};

const elementHasOwner: Rule = {
  id: "element-has-owner",
  title: "Every element has an owner team",
  severity: "warning",
  why: "A part of the system nobody owns is a part nobody fixes; naming an owning team for each element is how the model says who answers for it.",
  check(ctx) {
    return ctx.model.elements.filter((e) => !e.owner).map((e) => ({ at: e.id, atKind: "element" as const, message: `element ${e.id} (${e.name}) has no owner team` }));
  },
};

const contractEnds: Rule = {
  id: "contract-has-producer-and-consumer",
  title: "Contracts have a producer and a consumer",
  severity: "warning",
  why: "A contract is an agreement between the side that produces something and the side that relies on it; with either side missing, nobody can tell whether it is kept.",
  check(ctx) {
    const out: F[] = [];
    for (const c of ctx.model.contracts) {
      if (!c.produced_by?.length) out.push({ at: c.name, atKind: "contract", message: `contract ${c.name} has no producer` });
      if (!c.consumed_by?.length) out.push({ at: c.name, atKind: "contract", message: `contract ${c.name} has no consumer` });
    }
    return out;
  },
};

const carriedDirection: Rule = {
  id: "carried-contract-direction",
  title: "A relationship carrying a contract runs from a producer or a relaying reader to a consumer",
  severity: "error",
  why: "If a connection says it carries a contract, it should run from someone who produces that contract, or from a listed reader passing it on, to someone who consumes it; otherwise the drawing and the agreement disagree about who depends on whom. Producers keep meaning origin, and readers stay exact, so a relay must already be a listed reader.",
  check(ctx) {
    const out: F[] = [];
    for (const r of ctx.model.relationships) for (const name of r.carries ?? []) {
      const c = ctx.con.get(name);
      if (!c) continue; // references-resolve reports it
      // A listed reader may relay the contract onward: producers mean origin, readers stay exact.
      if (c.produced_by?.length && !c.produced_by.includes(r.from) && !c.consumed_by?.includes(r.from))
        out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} carries ${name} from ${r.from}, which neither produces it nor is a listed reader relaying it` });
      if (c.consumed_by?.length && !c.consumed_by.includes(r.to))
        out.push({ at: r.id, atKind: "relationship", message: `relationship ${r.id} carries ${name} to ${r.to}, which is not a consumer of it` });
    }
    return out;
  },
};

const viewIds: Rule = {
  id: "view-ids-exist",
  title: "Views name existing ids",
  severity: "error",
  why: "A view is a chosen window onto the model; an id in it that no longer exists means the picture quietly drops something its author meant to show.",
  check(ctx: RuleContext) {
    const out: F[] = [];
    for (const v of ctx.model.views) {
      for (const e of v.elements) if (!ctx.el.has(e) && !coreJudges(ctx, e)) out.push({ at: v.id, atKind: "view", message: `view ${v.id} shows element "${e}", which does not exist` });
      for (const r of v.relationships ?? []) {
        const rel = ctx.rel.get(r);
        if (!rel && coreJudges(ctx, r)) continue; // another design's relationship: it resolves where that design is composed
        if (!rel) out.push({ at: v.id, atKind: "view", message: `view ${v.id} lists relationship "${r}", which does not exist` });
        else if (!v.elements.includes(rel.from) || !v.elements.includes(rel.to))
          out.push({ at: v.id, atKind: "view", message: `view ${v.id} lists relationship ${r}, but not both of its ends` });
      }
    }
    return out;
  },
};

/** An email address, or an @handle at the start of a word. */
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
export const HANDLE = /(?:^|[\s(\[,;:"'“])@[A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_]/;
export function contactKind(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (EMAIL.test(text)) return "an email address";
  if (HANDLE.test(text)) return "an @handle";
  return undefined;
}

const noContactDetails: Rule = {
  id: "no-contact-details",
  title: "Free text names no email address or @handle",
  severity: "warning",
  why: "Owners and verifiers come from the team registry; people are named only where the work happens. Notes, claim statements and patch reasons are free text that people and agents both write, so an address or a handle can slip in and travel with the model. The finding says where, never what.",
  check(ctx: RuleContext) {
    const out: Omit<Finding, "pack" | "rule" | "severity">[] = [];
    for (const n of ctx.notes ?? []) for (const [field, text] of [["text", n.text], ["answer", n.answer]] as const) {
      const k = contactKind(text); if (k) out.push({ at: n.id, atKind: "note", message: `note ${n.id} has ${k} in its ${field}` });
    }
    for (const c of ctx.model.claims ?? []) for (const [field, text] of [["statement", c.statement], ["source", c.source], ["fallback", c.fallback]] as const) {
      const k = contactKind(text); if (k) out.push({ at: c.id, atKind: "claim", message: `claim ${c.id} has ${k} in its ${field}` });
    }
    for (const p of ctx.patches ?? []) { const k = contactKind(p.why); if (k) out.push({ at: p.id, atKind: "instance", message: `patch ${p.id} has ${k} in its why` }); }
    return out;
  },
};

export const pack: RulePack = {
  name: "generic",
  title: "Model integrity",
  description: "Checks every model needs: ids resolve, parts have owners, contracts have two sides and run the right way, views show real things.",
  rules: [uniqueIds, referencesResolve, elementHasOwner, contractEnds, carriedDirection, viewIds, noContactDetails],
};
