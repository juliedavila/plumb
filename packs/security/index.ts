// Security pack: checks declared security attributes and configured contract classifications.
// Every rule reads marks from `attrs`; an instance that
// carries none of those marks gets no findings. Settings (all optional) live under `security:` in engine.yaml:
//   outbound_systems:      systems whose elements count as "outward" for the trifecta (default: systems holding a model-boundary element)
//   execution_zones:       zones where effects happen (default: [execution])
//   authorization_systems: systems allowed to receive proposals (default: systems holding an element with grants_authority)
import type { Contract, Element, Relationship, Rule, RuleContext, RulePack } from "../../src/types.ts";
import { parseRef } from "../../src/core/namespace.ts";

/** Classifications belong to the design: arbitrary contract names or explicit record attributes. */
function classified(ctx: RuleContext, name: string, field: string): boolean {
  const configured = (ctx.config.security as Record<string, unknown> | undefined)?.[field];
  return Array.isArray(configured) && configured.includes(name);
}
const PROPAGATING = new Set(["data", "inference", "feedback", "observation"]);

type Cfg = { outbound_systems?: string[]; execution_zones?: string[]; authorization_systems?: string[] };
const cfg = (ctx: RuleContext): Cfg => (ctx.config.security as Cfg | undefined) ?? {};
const a = (x: { attrs?: Record<string, unknown> } | undefined, k: string): unknown => x?.attrs?.[k];
const nonEmptyList = (v: unknown) => Array.isArray(v) && v.length > 0;
const nonEmptyString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isStore = (e: Element | undefined) => !!e && (e.kind === "store" || e.kind === "registry");
const isPartitioned = (e: Element | undefined) => isStore(e) && nonEmptyList(a(e, "partitioned_by"));
const carries = (r: Relationship) => r.carries ?? [];
/** A contract's or zone's own name: a 0.4 design, or the portfolio's composed graph, names them "<ns>:<name>". A lone instance's names have no namespace, so they read as before. */
const local = (name: string) => parseRef(name).id;

export function evidenceContracts(ctx: RuleContext): Set<string> {
  const s = new Set<string>();
  for (const c of ctx.model.contracts) if (classified(ctx,c.name,"evidence_contracts") || a(c, "evidence_content") === true) s.add(c.name);
  return s;
}

/** Elements exposed to untrusted content: seeded by relationships marked content: untrusted, spread along
 *  data/inference/feedback/observation relationships whose content is not marked structured. */
export function exposedElements(ctx: RuleContext): Map<string, string> {
  const why = new Map<string, string>(); // element -> relationship id that exposed it
  for (const r of ctx.model.relationships) if (a(r, "content") === "untrusted" && !why.has(r.to)) why.set(r.to, r.id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of ctx.model.relationships) {
      if (why.has(r.to) || !why.has(r.from) || !PROPAGATING.has(r.kind) || a(r, "content") === "structured") continue;
      why.set(r.to, r.id); grew = true;
    }
  }
  return why;
}

/** An element holds non-public data when it or an ancestor receives a ContextSnapshot, or says so with holds_nonpublic. */
export function holdsNonpublic(ctx: RuleContext, id: string): boolean {
  const seen = new Set<string>();
  for (let cur: string | undefined = id; cur && !seen.has(cur); cur = ctx.el.get(cur)?.parent) {
    seen.add(cur);
    if (a(ctx.el.get(cur), "holds_nonpublic") === true) return true;
    if ((ctx.inn.get(cur) ?? []).some((r) => carries(r).some((x) => classified(ctx,x,"context_contracts") || a(ctx.con.get(x),"nonpublic_context") === true))) return true;
  }
  return false;
}

const systemsWith = (ctx: RuleContext, pred: (e: Element) => boolean) =>
  new Set(ctx.model.elements.filter(pred).map((e) => e.system).filter((s): s is string => !!s));

const trifecta: Rule = {
  id: "trifecta",
  title: "No agent combines untrusted text, private data and an unguarded way out",
  why: "An agent that reads outsiders' text, holds private data and can send or act without a guard can be talked into leaking or doing harm, so every such route must pass a load-bearing gate and never reach execution directly.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const c = cfg(ctx);
    const exposed = exposedElements(ctx);
    const gates = ctx.model.elements.filter((e) => a(e, "model_boundary") === true && a(e, "load_bearing") === true);
    const gateIds = new Set(gates.map((g) => g.id));
    const gateParents = new Set(gates.map((g) => g.parent).filter((p): p is string => !!p));
    const outboundSystems = new Set(c.outbound_systems ?? [...systemsWith(ctx, (e) => a(e, "model_boundary") === true)]);
    const execZones = new Set(c.execution_zones ?? []);
    const isExec = (z: string) => (c.execution_zones ? execZones.has(z) : local(z) === "execution"); // the default names a zone called execution, wherever it lives
    const authSystems = new Set(c.authorization_systems ?? [...systemsWith(ctx, (e) => a(e, "grants_authority") === true)]);
    for (const p of ctx.model.elements) {
      if (a(p, "role_class") !== "producer" || !exposed.has(p.id) || !holdsNonpublic(ctx, p.id)) continue;
      const rels = ctx.out.get(p.id) ?? [];
      const outbound = rels.filter((r) => {
        const t = ctx.el.get(r.to);
        return r.kind === "inference" || t?.kind === "external-system" || (t?.system && outboundSystems.has(t.system));
      });
      if (!outbound.length) continue;
      for (const r of outbound) {
        const gated = r.optional !== true && (gateIds.has(r.to) || gateParents.has(r.to));
        if (!gated) out.push({ at: p.id, atKind: "element", message: `${p.name} reads untrusted text and holds non-public data, and ${r.id} to ${r.to} does not pass a load-bearing gate on a required edge.` });
      }
      for (const r of rels) {
        const t = ctx.el.get(r.to);
        if (t && ((t.zone && isExec(t.zone)) || t.kind === "runner"))
          out.push({ at: p.id, atKind: "element", message: `${p.name} holds all three legs and reaches the execution part ${r.to} directly (${r.id}); effects must go through authorization.` });
        if (r.kind === "proposal" && authSystems.size && !(t?.system && authSystems.has(t.system)))
          out.push({ at: p.id, atKind: "element", message: `${p.name} holds all three legs and sends a proposal (${r.id}) to ${r.to}, outside authorization.` });
      }
    }
    return out;
  },
};

const evidencePartitioned: Rule = {
  id: "evidence-partitioned",
  title: "Evidence lands in a partitioned store",
  why: "Evidence that never lands in a store split by its partition keys can be read or mixed across boundaries it must not cross, so each kind of evidence the design produces needs at least one partitioned home.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const ev = evidenceContracts(ctx);
    for (const name of [...ev].sort()) {
      const con = ctx.con.get(name) as Contract;
      const carriers = ctx.model.relationships.filter((r) => carries(r).includes(name));
      if (!con.produced_by?.length && !carriers.length) continue; // nothing produces it: nothing to land
      if (carriers.some((r) => isPartitioned(ctx.el.get(r.to)))) continue;
      out.push({ at: name, atKind: "contract", message: `Evidence contract ${name} is produced but no relationship carries it into a store with partition keys (partitioned_by).` });
    }
    return out;
  },
};

const storeReason: Rule = {
  id: "store-reason-by-reference",
  title: "An unpartitioned store receives evidence only by reference",
  why: "A store that says it holds no evidence has no partition keys to protect it, so anything evidential sent there must be an id or reference, never the record itself.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const ev = evidenceContracts(ctx);
    for (const s of ctx.model.elements) {
      if (!isStore(s) || !nonEmptyString(a(s, "unpartitioned")) || nonEmptyList(a(s, "partitioned_by"))) continue;
      for (const r of ctx.inn.get(s.id) ?? []) {
        const byRef = new Set((a(r, "by_reference") as string[] | undefined) ?? []);
        const bad = carries(r).filter((c) => ev.has(c) && !byRef.has(c));
        if (bad.length) out.push({ at: r.id, atKind: "relationship", message: `${r.id} delivers ${bad.join(", ")} into ${s.id}, which states it holds no evidence; mark the contracts by_reference or give the store partition keys.` });
      }
    }
    return out;
  },
};

const controllerFeedback: Rule = {
  id: "controller-feedback",
  title: "Every person who controls hears the measured outcome",
  why: "A person who approves, decides or sets a limit can only notice their own drift if something tells them, with a measure, how their decisions turned out.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const measured = (name: string) => nonEmptyString(a(ctx.con.get(name), "measures"));
    for (const p of ctx.model.elements) {
      if (a(p, "role_class") !== "human") continue;
      if (!(ctx.out.get(p.id) ?? []).some((r) => r.kind === "control" || r.kind === "authorization")) continue;
      const heard = (ctx.inn.get(p.id) ?? []).some((r) => r.kind === "feedback" && r.optional !== true && r.from !== p.id && ctx.el.has(r.from) && carries(r).some(measured));
      if (!heard) out.push({ at: p.id, atKind: "element", message: `${p.name} issues control or authorization but receives no required feedback relationship carrying a contract with a measures field.` });
    }
    return out;
  },
};

const storePartitioning: Rule = {
  id: "store-partitioning",
  title: "Every store states its partitioning",
  why: "Each store must say either how it is split (partition keys) or why it holds no evidence, so nobody has to guess whether a store needs protecting.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const stores = ctx.model.elements.filter(isStore);
    // Only judged in instances that use the marks at all; a model without them is not making this claim.
    if (!stores.some((s) => a(s, "partitioned_by") !== undefined || a(s, "unpartitioned") !== undefined)) return out;
    for (const s of stores) {
      const keys = nonEmptyList(a(s, "partitioned_by")), reason = nonEmptyString(a(s, "unpartitioned"));
      if (keys && reason) out.push({ at: s.id, atKind: "element", message: `${s.name} states both partition keys and a reason it holds no evidence; it must state one.` });
      else if (!keys && !reason) out.push({ at: s.id, atKind: "element", message: `${s.name} states neither partition keys (partitioned_by) nor a reason it holds no evidence (unpartitioned).` });
    }
    return out;
  },
};

const agentReach: Rule = {
  id: "agent-reach",
  title: "Coding agents never see the answers or outsiders' text",
  why: "A coding agent that can read the proof conditions or kept tests can write code that passes them without fixing anything, and one that reads outsiders' text can be steered, so neither may reach it.",
  severity: "error",
  check(ctx) {
    const out: ReturnType<Rule["check"]> = [];
    const exposed = exposedElements(ctx);
    for (const e of ctx.model.elements) {
      if (a(e, "agent_reachable") !== true) continue;
      if (exposed.has(e.id)) out.push({ at: e.id, atKind: "element", message: `${e.name} is agent-reachable and exposed to untrusted content (via ${exposed.get(e.id)}).` });
      for (const r of ctx.inn.get(e.id) ?? []) {
        const bad = carries(r).filter((c) => classified(ctx,c,"proof_contracts") || a(ctx.con.get(c),"proof_condition") === true);
        if (bad.length) out.push({ at: e.id, atKind: "element", message: `${e.name} is agent-reachable and receives ${bad.join(", ")} on ${r.id}.` });
      }
    }
    return out;
  },
};

const evidenceEdgeNamed: Rule = {
  id: "evidence-edge-named",
  title: "Evidence written to a partitioned store names what it carries",
  why: "The evidence rules can only see contracts a relationship names, so an evidence relationship into a protected store that names nothing is invisible to them, and removing that store would pass unnoticed.",
  severity: "warning",
  check(ctx) {
    return ctx.model.relationships
      .filter((r) => r.kind === "evidence" && isPartitioned(ctx.el.get(r.to)) && !carries(r).length && !nonEmptyString(a(r, "no_contract")))
      .map((r) => ({ at: r.id, atKind: "relationship" as const, message: `${r.id} writes evidence from ${r.from} into the partitioned store ${r.to} but names no contract, so the evidence rules cannot see it.` }));
  },
};

export const pack: RulePack = {
  name: "security",
  title: "Security",
  description: "Checks inference boundaries, evidence placement, unpartitioned stores, control feedback, partitioning and agent reach. Rules read security marks from attrs and contract classifications declared by the design.",
  rules: [trifecta, evidencePartitioned, storeReason, controllerFeedback, storePartitioning, agentReach, evidenceEdgeNamed],
};
export default pack;
