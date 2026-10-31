// Resolution and canonical form for a 0.4 design.
//
// A bare id names the design's own record; failing that, a record of the shared layer; failing that, in a team field,
// a team of the org layer. `<ns>:<id>` names a namespace directly. A design names its own records and its root's,
// never another design's, except in descriptive records (a view's parts, a claim's rests_on, a note's target), which
// create no dependency: those resolve where both designs are composed and show as outside parts elsewhere.
//
// The compiled state is rewritten to canonical form: own records bare, everything else `<ns>:<id>`. The records a
// design names outside itself are brought into its compiled model as outside records carrying `home`, so every rule
// and the page compare plain strings and find what they name:
//   - shared parts, systems, zones, contracts, claims and capabilities it names (ids "shared:<id>"),
//   - org teams it names (ids "org:<id>"),
//   - the shared layer's crossings at its edge (relationships "shared:<id>"), the contracts they carry, and their far
//     ends: a shared part, or another design's part named from the shared layer's `names` and marked from the seam's
//     `exposure` (far parts coding agents reach),
//   - another design's parts its views show.
// References from the root into this design (a crossing's ends, a seam's exposure list, an org relief's unit or
// milestone, an exception's end) resolve in this design's own build; those into other designs resolve where they are
// composed (the portfolio).
//
// Findings (core pack):
//   xref-resolves (a) a design names another design outside a descriptive record; (b) a reference into shared or org
//     names a record the root does not hold, or a bare id resolves nowhere in a field no other rule checks (engine.yaml
//     settings: a bare id elsewhere is left bare, and the rule that checks that field reports it, as in a lone build,
//     so one typo is one finding); (c) a reference from the root into this design names a record it does not hold.
//   one-home: an id defined both in the design and in its root's shared layer, for one kind; a capability the design
//     provides that the shared layer says another design provides; a design that declares teams while its root has an
//     org layer.

import type {
  Claim, ComposedDesign, Contract, Element, Finding, InstanceConfig, Model, NamespaceInfo, Note, Plan, RecordKind, Relationship,
  RootInput, Seam, SharedCapability, SharedLayer, System, Team, Zone,
} from "../types.ts";
import { isForeign, isNamespaced, ORG, parseRef, SHARED } from "./namespace.ts";
import { normClaim } from "./load.ts";
import { natCompare } from "./util.ts";

type K = "element" | "relationship" | "contract" | "team" | "system" | "zone" | "unit" | "phase" | "claim" | "capability" | "seam" | "view";
type F = Finding;
interface State { model: Model; plan: Plan }

const xref = (at: string, atKind: F["atKind"], message: string): F => ({ pack: "core", rule: "xref-resolves", severity: "error", at, atKind, message });
const oneHome = (at: string, atKind: F["atKind"], message: string): F => ({ pack: "core", rule: "one-home", severity: "error", at, atKind, message });

/** How the page names a home: the shared layer, the org layer, or a design (its title where known, its namespace otherwise). */
export function homeName(ns: string, root?: RootInput, compose?: ComposedDesign[]): string {
  if (ns === SHARED) return "the shared layer";
  if (ns === ORG) return "the org layer";
  return compose?.find((d) => d.namespace === ns)?.title ?? root?.shared?.names[ns] ?? ns;
}

/** The shared layer's records by kind and id. */
function sharedIndex(sh?: SharedLayer) {
  const m = <T>(xs: T[], key: (x: T) => string) => new Map(xs.map((x) => [key(x), x] as const));
  return {
    element: m(sh?.parts ?? [], (x) => x.id), relationship: m(sh?.crossings ?? [], (x) => x.id), contract: m(sh?.contracts ?? [], (x) => x.name),
    system: m(sh?.systems ?? [], (x) => x.id), zone: m(sh?.zones ?? [], (x) => x.id), claim: m(sh?.claims ?? [], (x) => x.id),
    capability: m(sh?.capabilities ?? [], (x) => x.id), seam: m(sh?.seams ?? [], (x) => x.id),
  };
}
type SharedIx = ReturnType<typeof sharedIndex>;
const SHARED_KINDS = ["element", "relationship", "contract", "system", "zone", "claim", "capability", "seam"] as const;
type SK = typeof SHARED_KINDS[number];

/** The design's own ids by kind (capabilities: the ones its units provide). */
function ownIndex(model: Model, plan: Plan): Record<K, Set<string>> {
  return {
    element: new Set(model.elements.map((x) => x.id)), relationship: new Set(model.relationships.map((x) => x.id)),
    contract: new Set(model.contracts.map((x) => x.name)), team: new Set(model.teams.map((x) => x.id)),
    system: new Set(model.systems.map((x) => x.id)), zone: new Set(model.zones.map((x) => x.id)),
    unit: new Set(plan.units.map((x) => x.id)), phase: new Set(plan.phases.map((x) => x.id)),
    claim: new Set((model.claims ?? []).map((x) => x.id)), view: new Set(model.views.map((x) => x.id)),
    seam: new Set((model.seams ?? []).map((x) => x.id)), capability: new Set(plan.units.flatMap((u) => u.provides ?? [])),
  };
}

export interface ResolveResult {
  findings: F[];
  homes: Record<string, string>;         // namespace -> how the page names it, for every home an outside record has
  sharedNamed: { kind: SK; id: string }[]; // the shared records this design names (for a stale shared file)
}

interface Where { kind: F["atKind"]; id: string; field: string }
interface Opt { team?: boolean; descriptive?: boolean; settles?: boolean; config?: boolean }

/** The resolver for one design: own, then shared, then org for teams; collects what it names outside itself. */
class Resolver {
  readonly f: F[] = [];
  readonly sh: SharedIx;
  readonly used = new Map<SK, Set<string>>(SHARED_KINDS.map((k) => [k, new Set<string>()]));
  readonly usedOrg = new Set<string>();
  readonly foreign = new Map<string, { kind: K; descriptive: boolean }>(); // "<ns>:<id>" -> what names it
  readonly orgTeams: Map<string, Team>;
  constructor(readonly own: string | undefined, readonly ix: Record<K, Set<string>>, readonly root: RootInput | undefined, readonly compose: ComposedDesign[] | undefined) {
    this.sh = sharedIndex(root?.shared);
    this.orgTeams = new Map((root?.org?.teams ?? []).map((t) => [t.id, t]));
  }
  useShared(kind: SK, id: string): void { this.used.get(kind)!.add(id); }

  /** Resolve one reference written in one of the design's own records. */
  ref(raw: string, kind: K, opt: Opt, at: Where): string {
    const r = parseRef(raw);
    const where = `${at.kind === "instance" ? "" : `${at.kind} ${at.id} `}names ${raw}${at.field ? ` in ${at.field}` : ""}`;
    if (r.ns === undefined || r.ns === this.own) {
      if (opt.settles && !this.ix[kind].has(r.id)) this.f.push(xref(at.id, at.kind, `${where}, which does not resolve to a unit in this design`));
      if (this.ix[kind].has(r.id) || r.ns === this.own) return r.id; // own (an own namespace written out is still own)
      const sk = kind as SK;
      if ((SHARED_KINDS as readonly string[]).includes(kind) && this.sh[sk].has(r.id)) {
        if (kind === "capability" && this.own && (this.sh.capability.get(r.id)!.provided_by.includes(this.own))) return r.id; // this design is to provide it: its own
        this.useShared(sk, r.id);
        return `${SHARED}:${r.id}`;
      }
      if (opt.team && this.orgTeams.has(r.id)) { this.usedOrg.add(r.id); return `${ORG}:${r.id}`; }
      if (opt.config && this.root) this.f.push(xref(at.id, at.kind, `${at.kind === "instance" ? "engine.yaml " : ""}${where}, which is not a record of this design, its shared layer${opt.team ? " or its org layer" : ""}`));
      return r.id; // unresolved: the rule that checks this field reports it, as in a lone build
    }
    if (r.ns === SHARED) {
      const sk = kind as SK;
      if ((SHARED_KINDS as readonly string[]).includes(kind) && this.sh[sk].has(r.id)) { this.useShared(sk, r.id); return `${SHARED}:${r.id}`; }
      this.f.push(xref(at.id, at.kind, `${where}, which ${!this.root ? "cannot resolve: this design names no root" : !this.root.shared ? "the root does not hold: it has no shared layer (seams.yaml)" : `the shared layer does not hold as a ${kind}`}`));
      return `${SHARED}:${r.id}`;
    }
    if (r.ns === ORG) {
      if (kind === "team" && this.orgTeams.has(r.id)) { this.usedOrg.add(r.id); return `${ORG}:${r.id}`; }
      this.f.push(xref(at.id, at.kind, `${where}, which ${!this.root ? "cannot resolve: this design names no root" : !this.root.org ? "the root does not hold: it has no org layer (org.yaml)" : kind !== "team" ? `is not a team, and the org layer holds teams for a design to name` : "the org layer does not hold"}`));
      return `${ORG}:${r.id}`;
    }
    // another design's namespace
    const canon = `${r.ns}:${r.id}`;
    if (!opt.descriptive) {
      this.f.push(xref(at.id, at.kind, `${where}: a design names its own records and its root's, never another design's (only a view's parts, a claim's rests_on and a note's target may)`));
      return canon;
    }
    const d = this.compose?.find((x) => x.namespace === r.ns);
    if (!d && opt.settles && this.compose) this.f.push({ ...xref(at.id, at.kind, `${where}: unknown namespace ${r.ns} in this workspace`), severity: "warning" });
    if (d && !composedHas(d, kind, r.id)) this.f.push(xref(at.id, at.kind, `${where}, which ${d.title} (${r.ns}) does not hold`));
    if (!this.foreign.has(canon)) this.foreign.set(canon, { kind, descriptive: true });
    return canon;
  }

  refs(xs: string[] | undefined, kind: K, opt: Opt, at: Where): string[] | undefined {
    return xs?.map((x) => this.ref(x, kind, opt, at));
  }

  /** A reference written inside the shared layer, seen from this design: shared's own bare, this design's bare, others namespaced. */
  shared(raw: string): string {
    const r = parseRef(raw);
    if (r.ns === undefined || r.ns === SHARED) return `${SHARED}:${r.id}`;
    if (r.ns === this.own) return r.id;
    return `${r.ns}:${r.id}`;
  }
}

function composedHas(d: ComposedDesign, kind: K, id: string): boolean {
  switch (kind) {
    case "element": return d.model.elements.some((x) => x.id === id);
    case "relationship": return d.model.relationships.some((x) => x.id === id);
    case "contract": return d.model.contracts.some((x) => x.name === id);
    case "claim": return (d.model.claims ?? []).some((x) => x.id === id);
    case "unit": return d.plan.units.some((x) => x.id === id);
    case "phase": return d.plan.phases.some((x) => x.id === id);
    case "team": return d.model.teams.some((x) => x.id === id);
    case "system": return d.model.systems.some((x) => x.id === id);
    case "zone": return d.model.zones.some((x) => x.id === id);
    default: return true;
  }
}

const TEAM_ATTRS = ["owner_teams", "decider", "not"] as const;

/** Rewrite the design's own records to canonical form (in place). */
function canonicalizeOwn(s: State, R: Resolver): void {
  const m = s.model, p = s.plan;
  for (const e of m.elements) {
    const at: Where = { kind: "element", id: e.id, field: "" };
    if (e.system) e.system = R.ref(e.system, "system", {}, { ...at, field: "system" });
    if (e.zone) e.zone = R.ref(e.zone, "zone", {}, { ...at, field: "zone" });
    if (e.owner) e.owner = R.ref(e.owner, "team", { team: true }, { ...at, field: "owner" });
    if (e.verifier) e.verifier = R.ref(e.verifier, "team", { team: true }, { ...at, field: "verifier" });
    if (e.parent) e.parent = R.ref(e.parent, "element", {}, { ...at, field: "parent" });
    if (e.rests_on) e.rests_on = R.refs(e.rests_on, "claim", { descriptive: true }, { ...at, field: "rests_on" });
    if (e.attrs) for (const k of TEAM_ATTRS) {
      const v = e.attrs[k];
      if (typeof v === "string") e.attrs[k] = R.ref(v, "team", { team: true }, { ...at, field: `attrs.${k}` });
      else if (Array.isArray(v)) e.attrs[k] = v.map((x) => (typeof x === "string" ? R.ref(x, "team", { team: true }, { ...at, field: `attrs.${k}` }) : x));
    }
  }
  for (const r of m.relationships) {
    const at: Where = { kind: "relationship", id: r.id, field: "" };
    r.from = R.ref(r.from, "element", {}, { ...at, field: "from" });
    r.to = R.ref(r.to, "element", {}, { ...at, field: "to" });
    if (r.carries) r.carries = R.refs(r.carries, "contract", {}, { ...at, field: "carries" });
    if (r.rests_on) r.rests_on = R.refs(r.rests_on, "claim", { descriptive: true }, { ...at, field: "rests_on" });
  }
  for (const c of m.contracts) {
    const at: Where = { kind: "contract", id: c.name, field: "" };
    if (c.produced_by) c.produced_by = R.refs(c.produced_by, "element", {}, { ...at, field: "produced_by" });
    if (c.consumed_by) c.consumed_by = R.refs(c.consumed_by, "element", {}, { ...at, field: "consumed_by" });
  }
  for (const v of m.views) {
    const at: Where = { kind: "view", id: v.id, field: "" };
    v.elements = R.refs(v.elements, "element", { descriptive: true }, { ...at, field: "elements" })!;
    if (v.relationships) v.relationships = R.refs(v.relationships, "relationship", { descriptive: true }, { ...at, field: "relationships" });
  }
  for (const c of m.claims ?? []) {
    const at: Where = { kind: "claim", id: c.id, field: "" };
    if (c.rests_on) c.rests_on = R.refs(c.rests_on, "claim", { descriptive: true }, { ...at, field: "rests_on" });
    const tb = c.attrs?.tested_by;
    if (tb !== undefined) c.attrs!.tested_by = (Array.isArray(tb) ? tb : [tb]).map((x) => (typeof x === "string" ? R.ref(x, "unit", { descriptive: true, settles: true }, { ...at, field: "attrs.tested_by" }) : x));
  }
  for (const ph of p.phases) if (ph.rests_on) ph.rests_on = R.refs(ph.rests_on, "claim", { descriptive: true }, { kind: "phase", id: ph.id, field: "rests_on" });
  for (const u of p.units) {
    const at: Where = { kind: "unit", id: u.id, field: "" };
    u.phase = R.ref(u.phase, "phase", {}, { ...at, field: "phase" });
    if (u.elements) for (const mv of u.elements) mv.id = R.ref(mv.id, "element", {}, { ...at, field: "elements" });
    if (u.requires) u.requires = R.refs(u.requires, "capability", {}, { ...at, field: "requires" });
    if (u.provides) u.provides = u.provides.map((c) => providedRef(c, R, at));
    if (u.owner) u.owner = R.ref(u.owner, "team", { team: true }, { ...at, field: "owner" });
    if (u.verifier) u.verifier = R.ref(u.verifier, "team", { team: true }, { ...at, field: "verifier" });
    if (u.rests_on) u.rests_on = R.refs(u.rests_on, "claim", { descriptive: true }, { ...at, field: "rests_on" });
  }
  for (const sm of m.seams ?? []) for (const x of sm.crossings ?? []) {
    const at: Where = { kind: "instance", id: sm.id, field: `seam ${sm.id} crossings` };
    x.id = R.ref(x.id, "relationship", {}, at);
    if (x.carries) x.carries = R.refs(x.carries, "contract", {}, at);
  }
}

/** A capability a unit provides: always its own; written as shared:<id>, it must be one the shared layer says this design provides. */
function providedRef(raw: string, R: Resolver, at: Where): string {
  const r = parseRef(raw);
  if (r.ns === undefined || r.ns === R.own) return r.id;
  if (r.ns === SHARED) {
    const cap = R.sh.capability.get(r.id);
    if (cap && R.own && cap.provided_by.includes(R.own)) return r.id;
    R.f.push(xref(at.id, at.kind, `${at.kind} ${at.id} provides ${raw}, which ${cap ? "the shared layer says another design provides" : "the shared layer does not hold"}`));
    return raw;
  }
  R.f.push(xref(at.id, at.kind, `${at.kind} ${at.id} provides ${raw}: a design provides its own capabilities, never another design's`));
  return raw;
}

/** One-home: an id both in the design and in its root's shared layer; a design's teams beside an org layer. */
function oneHomeFindings(s: State, R: Resolver): F[] {
  const out: F[] = [];
  if (!R.root?.shared) return teamsBesideOrg(s, R, out);
  const both = (kind: SK, atKind: F["atKind"], ids: string[], word: string) => {
    for (const id of ids) if (R.sh[kind].has(id))
      out.push(oneHome(id, atKind, `${word} ${id} is defined both in this design and in the shared layer; a record lives in one home, so rename this design's or remove it and name shared:${id}`));
  };
  both("element", "element", s.model.elements.filter((e) => !e.home).map((e) => e.id), "part");
  both("relationship", "relationship", s.model.relationships.filter((r) => !r.home).map((r) => r.id), "relationship");
  both("contract", "contract", s.model.contracts.filter((c) => !c.home).map((c) => c.name), "contract");
  both("system", "instance", s.model.systems.filter((x) => !x.home).map((x) => x.id), "system");
  both("zone", "instance", s.model.zones.filter((x) => !x.home).map((x) => x.id), "zone");
  both("claim", "claim", (s.model.claims ?? []).filter((c) => !c.home).map((c) => c.id), "claim");
  both("seam", "instance", (s.model.seams ?? []).map((x) => x.id), "seam");
  // a capability this design provides that the shared layer says only other designs provide
  const prov = new Map<string, string[]>();
  for (const u of s.plan.units) for (const c of u.provides ?? []) prov.set(c, [...(prov.get(c) ?? []), u.id]);
  for (const [c, us] of prov) {
    const cap = R.sh.capability.get(c);
    if (cap && R.own && cap.provided_by.length && !cap.provided_by.includes(R.own))
      for (const u of us) out.push(oneHome(u, "unit", `unit ${u} provides ${c}, which the shared layer says ${cap.provided_by.join(" and ")} provides; a capability has one home, so name it from the shared layer (shared:${c}) or declare this design among its providers`));
  }
  return teamsBesideOrg(s, R, out);
}

function teamsBesideOrg(s: State, R: Resolver, out: F[]): F[] {
  if (R.root?.org) for (const t of s.model.teams.filter((x) => !x.home))
    out.push(oneHome(t.id, "team", `this design declares team ${t.id} while its root has an org layer (org.yaml); teams live in the org layer, so remove the design's teams and name the org's`));
  return out;
}

/** References from the root into this design (crossing ends, exposure, org reliefs and exception ends): (c). */
function rootRefsIntoThis(s: State, R: Resolver): F[] {
  const out: F[] = [];
  if (!R.own || !R.root) return out;
  const has = (kinds: K[], id: string) => kinds.some((k) => R.ix[k].has(id));
  const check = (raw: unknown, kinds: K[], at: string, what: string) => {
    if (typeof raw !== "string") return;
    const r = parseRef(raw);
    if (r.ns !== R.own) return;
    const ks = r.kind ? [r.kind as K] : kinds;
    if (!has(ks, r.id)) out.push(xref(at, "instance", `${what} names ${raw}, which this design (${R.own}) does not hold`));
  };
  const sh = R.root.shared;
  for (const x of sh?.crossings ?? []) { check(x.from, ["element"], `shared:${x.id}`, `the shared layer's crossing ${x.id}`); check(x.to, ["element"], `shared:${x.id}`, `the shared layer's crossing ${x.id}`); }
  for (const sm of sh?.seams ?? []) {
    for (const [side, es] of Object.entries(sm.exposure ?? {})) for (const e of es) check(e.part, ["element"], `shared:${sm.id}`, `seam ${sm.id}'s exposure for ${side}`);
    for (const ex of sm.default_exceptions ?? []) if (ex && typeof ex === "object") check((ex as Record<string, unknown>).until, ["phase"], `shared:${sm.id}`, `seam ${sm.id}'s default exception`);
  }
  const org = R.root.org;
  for (const a of org?.activities ?? []) for (const rv of Array.isArray(a.relieved_by) ? a.relieved_by : []) if (rv && typeof rv === "object") check((rv as Record<string, unknown>).at, ["phase", "unit"], `org:${a.id}`, `org activity ${a.id}'s relief`);
  for (const sd of org?.slowdowns ?? []) check(sd.until, ["phase"], `org:${sd.id}`, `org slowdown ${sd.id}`);
  for (const [seam, xs] of Object.entries(org?.seam_exceptions ?? {})) {
    check(seam, ["seam"], `org:${seam}`, `an org exception's seam`);
    for (const ex of xs) if (ex && typeof ex === "object") check((ex as Record<string, unknown>).until, ["phase"], `org:${seam}`, `an org exception on ${seam}`);
  }
  return out;
}

const clone = <T>(x: T): T => structuredClone(x);

/**
 * Resolve a 0.4 design's compiled state in place: canonical references, outside records brought in, and the
 * findings. `s` must be the state after patches (compile calls this before sorting).
 */
export function resolveState(s: State, ns: Pick<NamespaceInfo, "namespace" | "root" | "compose">): ResolveResult {
  const own = ns.namespace, root = ns.root?.input, compose = ns.compose;
  const R = new Resolver(own, ownIndex(s.model, s.plan), root, compose);
  canonicalizeOwn(s, R);
  const findings: F[] = [...R.f];
  findings.push(...oneHomeFindings(s, R), ...rootRefsIntoThis(s, R));
  const sh = root?.shared;
  const outsideEls = new Map<string, Element>();
  const addForeignEl = (canon: string) => {
    if (outsideEls.has(canon) || R.ix.element.has(canon)) return;
    const r = parseRef(canon);
    const d = compose?.find((x) => x.namespace === r.ns);
    const src = d?.model.elements.find((e) => e.id === r.id);
    const el: Element = { id: canon, name: sh?.names[canon] ?? src?.name ?? r.id, kind: src?.kind ?? "part", home: r.ns! };
    if (src?.attrs && Object.keys(src.attrs).length) el.attrs = clone(src.attrs);
    if (src?.description) el.description = src.description;
    outsideEls.set(canon, el);
  };

  // the shared layer's crossings at this design's edge
  const crossings: Relationship[] = [];
  if (sh && own) for (const x of sh.crossings) {
    const ends = [parseRef(x.from), parseRef(x.to)];
    const homes = ends.map((e) => e.ns ?? SHARED);
    if (!homes.includes(own)) continue;
    if (ends.some((e, i) => homes[i] === own && !R.ix.element.has(e.id))) continue; // (c) reported above
    const rel: Relationship = { ...clone(x), id: `${SHARED}:${x.id}`, from: R.shared(x.from), to: R.shared(x.to), home: SHARED };
    if (x.carries) rel.carries = x.carries.map((c) => { const cc = R.shared(c); if (parseRef(cc).ns === SHARED && R.sh.contract.has(parseRef(cc).id)) R.useShared("contract", parseRef(cc).id); return cc; });
    if (x.rests_on) rel.rests_on = x.rests_on.map((c) => R.shared(c));
    crossings.push(rel);
    for (const [i, e] of ends.entries()) {
      if (homes[i] === own) continue;
      if (homes[i] === SHARED) { if (R.sh.element.has(e.id)) R.useShared("element", e.id); }
      else addForeignEl(`${e.ns}:${e.id}`);
    }
  }
  for (const [canon, v] of R.foreign) if (v.kind === "element") addForeignEl(canon);

  // the shared records named, with what they name in turn (a part's system, zone and claims; a claim's claims)
  const sharedEls: Element[] = [], sharedClaims: Claim[] = [];
  const done = new Set<string>();
  const work = () => {
    let grew = true;
    while (grew) {
      grew = false;
      for (const id of R.used.get("element")!) {
        if (done.has(`element:${id}`)) continue;
        done.add(`element:${id}`); grew = true;
        const p = clone(R.sh.element.get(id)!);
        const el: Element = { ...p, id: `${SHARED}:${id}`, home: SHARED };
        if (p.system) { el.system = R.shared(p.system); const r = parseRef(el.system); if (r.ns === SHARED && R.sh.system.has(r.id)) R.useShared("system", r.id); }
        if (p.zone) { el.zone = R.shared(p.zone); const r = parseRef(el.zone); if (r.ns === SHARED && R.sh.zone.has(r.id)) R.useShared("zone", r.id); }
        if (p.parent) el.parent = R.shared(p.parent);
        if (p.rests_on) el.rests_on = p.rests_on.map((c) => { const cc = R.shared(c); const r = parseRef(cc); if (r.ns === SHARED && R.sh.claim.has(r.id)) R.useShared("claim", r.id); return cc; });
        sharedEls.push(el);
      }
      for (const id of R.used.get("claim")!) {
        if (done.has(`claim:${id}`)) continue;
        done.add(`claim:${id}`); grew = true;
        const c = normClaim({ ...clone(R.sh.claim.get(id)!) } as unknown as Record<string, unknown>);
        c.id = `${SHARED}:${id}`; c.home = SHARED;
        if (c.rests_on) c.rests_on = c.rests_on.map((x) => { const cc = R.shared(x); const r = parseRef(cc); if (r.ns === SHARED && R.sh.claim.has(r.id)) R.useShared("claim", r.id); return cc; });
        sharedClaims.push(c);
      }
    }
  };
  work();

  // exposure: the far parts coding agents reach, as each seam declares them for this design's side
  if (sh && own) for (const sm of sh.seams) {
    if (!sm.between.includes(own)) continue;
    for (const e of sm.exposure?.[own] ?? []) {
      const canon = R.shared(e.part);
      const el = outsideEls.get(canon) ?? sharedEls.find((x) => x.id === canon);
      if (el) el.attrs = { ...(el.attrs ?? {}), ...clone(e.marks) };
    }
  }

  // bring the outside records in
  const m = s.model;
  m.elements.push(...sharedEls, ...[...outsideEls.values()]);
  m.relationships.push(...crossings);
  for (const id of R.used.get("contract")!) {
    const c = clone(R.sh.contract.get(id)!);
    const con: Contract = { ...c, name: `${SHARED}:${id}`, home: SHARED };
    if (c.produced_by) con.produced_by = c.produced_by.map((x) => R.shared(x));
    if (c.consumed_by) con.consumed_by = c.consumed_by.map((x) => R.shared(x));
    m.contracts.push(con);
  }
  for (const id of R.used.get("system")!) m.systems.push({ ...clone(R.sh.system.get(id)! as System), id: `${SHARED}:${id}`, home: SHARED });
  for (const id of R.used.get("zone")!) m.zones.push({ ...clone(R.sh.zone.get(id)! as Zone), id: `${SHARED}:${id}`, home: SHARED });
  if (sharedClaims.length) (m.claims ??= []).push(...sharedClaims);
  for (const id of R.usedOrg) m.teams.push({ ...clone(R.orgTeams.get(id)!), id: `${ORG}:${id}`, home: ORG });
  const caps = [...R.used.get("capability")!].sort(natCompare).map((id): SharedCapability => ({ ...clone(R.sh.capability.get(id)!), id: `${SHARED}:${id}`, home: SHARED }));
  if (caps.length) s.plan.capabilities = caps;

  const homes: Record<string, string> = {};
  const homeOf = (h?: string) => { if (h && !homes[h]) homes[h] = homeName(h, root, compose); };
  for (const x of [...m.elements, ...m.relationships, ...m.teams, ...m.systems, ...m.zones, ...(m.claims ?? [])]) homeOf(x.home);
  for (const c of m.contracts) homeOf(c.home);
  for (const c of caps) { homeOf(c.home); for (const n of c.provided_by) homeOf(n); } // the page names who provides it
  const sharedNamed = SHARED_KINDS.flatMap((kind) => [...R.used.get(kind)!].map((id) => ({ kind, id })));
  for (const x of crossings) sharedNamed.push({ kind: "relationship", id: parseRef(x.id).id });
  return { findings, homes, sharedNamed };
}

/**
 * engine.yaml's references, canonical for the checks: teams.role_teams values (teams), and the security pack's
 * outbound_systems, authorization_systems (systems) and execution_zones (zones). The config as written is kept for
 * the hashes. A bare id here that resolves nowhere is an xref-resolves error, since no other rule reads these.
 */
export function canonicalConfig(config: InstanceConfig, own: string | undefined, root: RootInput | undefined, model: Model, plan: Plan): { config: InstanceConfig; findings: F[] } {
  const R = new Resolver(own, ownIndex(model, plan), root, undefined);
  const out: InstanceConfig = clone(config);
  const at = (field: string): Where => ({ kind: "instance", id: "engine.yaml", field });
  const t = out.teams as Record<string, unknown> | undefined;
  if (t && typeof t === "object" && t.role_teams && typeof t.role_teams === "object" && !Array.isArray(t.role_teams)) {
    const rt = t.role_teams as Record<string, unknown>;
    for (const [k, v] of Object.entries(rt)) if (typeof v === "string") rt[k] = R.ref(v, "team", { team: true, config: true }, at(`teams.role_teams.${k}`));
  }
  const sec = out.security as Record<string, unknown> | undefined;
  if (sec && typeof sec === "object") {
    for (const [k, kind] of [["outbound_systems", "system"], ["authorization_systems", "system"], ["execution_zones", "zone"]] as const)
      if (Array.isArray(sec[k])) sec[k] = (sec[k] as unknown[]).map((v) => (typeof v === "string" ? R.ref(v, kind, { config: true }, at(`security.${k}`)) : v));
  }
  return { config: out, findings: R.f };
}

/** Notes' targets, canonical: a note may name another design's record (it is descriptive), which stays namespaced. */
export function canonicalNotes(notes: Note[], own: string | undefined, root: RootInput | undefined, model: Model, plan: Plan): Note[] {
  const R = new Resolver(own, ownIndex(model, plan), root, undefined);
  const kinds: Record<string, K> = { element: "element", relationship: "relationship", contract: "contract", unit: "unit", phase: "phase", claim: "claim" };
  return notes.map((n) => {
    const k = kinds[n.target.kind];
    if (!k) return n;
    const id = R.ref(n.target.id, k, { descriptive: true }, { kind: "note", id: n.id, field: "target" });
    return id === n.target.id ? n : { ...n, target: { ...n.target, id } };
  });
}

/**
 * In a design's own build, rules about records it does not own are skipped: a finding that
 * sits on an outside record is dropped, unless its home is the org layer (an org team's load in this design is about
 * this design) or it is the security pack's on a part or relationship at this design's edge. Core findings stay.
 */
export function dropOutsideFindings(findings: F[], model: Model): F[] {
  const home = new Map<string, string>();
  for (const e of model.elements) if (e.home) home.set(`element:${e.id}`, e.home);
  for (const r of model.relationships) if (r.home) home.set(`relationship:${r.id}`, r.home);
  for (const c of model.contracts) if (c.home) home.set(`contract:${c.name}`, c.home);
  for (const t of model.teams) if (t.home) home.set(`team:${t.id}`, t.home);
  for (const c of model.claims ?? []) if (c.home) home.set(`claim:${c.id}`, c.home);
  return findings.filter((f) => {
    if (f.pack === "core") return true;
    const h = home.get(`${f.atKind}:${f.at}`);
    if (!h || h === ORG) return true;
    return f.pack === "security" && (f.atKind === "element" || f.atKind === "relationship");
  });
}

/** Does a reference name another design (for rules that skip what this build cannot resolve)? */
export const foreignRef = (ref: string, own?: string): boolean => isForeign(ref, own);
export { isNamespaced };
