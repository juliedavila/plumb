// The shared layer's shape checks and the security marks on what crosses. This file holds the one derivation of
// marks; the seam rule and the shared pack both call it.
//
// Marks derive from the checks as a floor; a person may raise one, never lower one:
//   - The floor of a contract is what the shipped checks derived and the shipped seams.yaml records in security.floor.
//     Where the shipped file records a floor for a contract (an empty list included), it is authoritative and the
//     engine adds nothing to it. floor_source "shipped".
//   - A contract or crossing the shipped file never held (an organization's own, added by a root patch; a design's own
//     edge to a shared part; a module crossing) gets the engine's signals as a provisional floor, labelled
//     "engine signal: <which>" so the page can say why. The signals (crossingSignals, the single signal function):
//       agent-reach            the crossing ends at a part coding agents reach (agent_reachable: true)
//       untrusted-content      the crossing is marked content: untrusted
//       untrusted-fields       a contract it carries has untrusted_fields
//       evidence-partitioned   it carries an evidence contract into a store with partition keys
//       grants-authority       it ends at a part that grants authority
//       model-boundary         it ends at a part at a model boundary
//   - A shipped crossing's floor is its own shipped floor, if it records one, and the floors of the contracts it
//     carries; a crossing the shipped file never held adds its signals. A crossing carrying a relevant contract is
//     relevant.
//   - A raise (security.raised: { by, why }) adds; so does a mark written relevant: true. Nothing lowers: a mark
//     written relevant: false on what the floor marks relevant is refused (shared/mark-valid) and ignored.
//
// computeMarks(root, designs) -> { contracts, crossings }, the contract the seam checks import:
//   - Keys are canonical: contracts "shared:<name>" for the shared layer's, "<ns>:<name>" for a design's own;
//     crossings "shared:<id>" for the shared layer's (the root's patches applied), "<ns>:<id>" for a design's own.
//   - Coverage: every crossing of the shared layer, and every crossing found in the designs passed: a design's own
//     edge whose other end has another home (a shared part) and, where the design declares a module seam, every edge
//     between a module and the rest; with the design-own contracts those carry.
//   - `designs` may hold one design: a design's own build passes its own compiled model as a one-element list, whose
//     far ends carry the seam's exposure marks. Part marks come from the design that owns the part when it is passed,
//     else from a passed design's outside copy of it, else from the shared layer's exposure lists.
//
// Shape checks of the shared layer (the shared pack reports them):
//   shared/crossing-valid  a crossing the shared layer holds carries no contract and gives no written no_contract
//                          reason (on shipped and organization seams alike), carries a contract on its seam's
//                          never_cross list, or carries a contract the shared layer does not define
//   shared/file-intact     seams.yaml no longer has the sha256 the root's engine.yaml recorded (shared_from.sha256)
//   shared/mark-valid      a mark written not relevant below its floor; a raise with no by or why; a mark written
//                          relevant above an empty floor with no raise; a floor written by a patch (floors come from
//                          the checks)
// References inside the shared layer that resolve nowhere (a crossing's or a contract's shared part, a part's system,
// zone or premise, a never_cross contract) are core/xref-resolves (b).

import type { ComposedDesign, Contract, Element, Mark, Marks, Model, Relationship, RootInput, RootProblem, SharedLayer } from "../types.ts";
import { parseRef, SHARED } from "./namespace.ts";
import { natCompare } from "./util.ts";
import { onSeam } from "./org.ts";

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const nonEmptyList = (v: unknown): boolean => Array.isArray(v) && v.length > 0;

/** The engine's signals, in the order the page lists them. */
export const SIGNALS = ["agent-reach", "untrusted-content", "untrusted-fields", "evidence-partitioned", "grants-authority", "model-boundary"] as const;

/** A reference written in the shared layer, canonical in the root's terms: the layer's own records "shared:<id>", a design's "<ns>:<id>". */
export const canonShared = (ref: string): string => { const r = parseRef(ref); return r.ns === undefined || r.ns === SHARED ? `${SHARED}:${r.id}` : `${r.ns}:${r.id}`; };
/** A reference written in a design's compiled model, canonical in the root's terms: its own records "<ns>:<id>", the rest as written. */
export const canonDesign = (ns: string, ref: string): string => (parseRef(ref).ns ? ref : `${ns}:${ref}`);

const isStore = (e: Element | undefined) => !!e && (e.kind === "store" || e.kind === "registry");

/**
 * The engine's signals on one relationship: which of its checks would read it. Ends and contracts are looked up in
 * `model` by the strings the relationship itself uses, so pass a model in the same terms (a design's compiled model for
 * its own relationships, or the root's composed model). With `only`, the signals that belong to one contract it
 * carries (untrusted fields, evidence) are read for that contract alone; the crossing's own signals always count.
 */
export function crossingSignals(crossing: Relationship, model: Pick<Model, "elements" | "contracts">, only?: string): string[] {
  const el = (id: string) => model.elements.find((e) => e.id === id);
  const to = el(crossing.to);
  const out = new Set<string>();
  if (to?.attrs?.agent_reachable === true) out.add("agent-reach");
  if (crossing.attrs?.content === "untrusted") out.add("untrusted-content");
  if (to?.attrs?.grants_authority === true) out.add("grants-authority");
  if (to?.attrs?.model_boundary === true) out.add("model-boundary");
  for (const name of crossing.carries ?? []) {
    if (only !== undefined && name !== only) continue;
    const c = model.contracts.find((x) => x.name === name);
    if (!c) continue;
    if (nonEmptyList(c.attrs?.untrusted_fields)) out.add("untrusted-fields");
    const evidence = c.attrs?.evidence_content === true;
    if (evidence && isStore(to) && nonEmptyList(to!.attrs?.partitioned_by)) out.add("evidence-partitioned");
  }
  return SIGNALS.filter((s) => out.has(s));
}

const sourceOf = (signals: string[]) => `engine signal: ${signals.length ? signals.join(", ") : "none"}`;

/** A contract's or crossing's mark as written: { relevant?, floor?, raised? } under security, or nothing. */
function written(rec: { attrs?: Raw } | undefined): { relevant?: boolean; floor?: string[]; raised?: { by?: string; why?: string }; raisedRaw?: unknown } {
  const s = rec?.attrs?.security;
  if (!isMap(s)) return {};
  const out: ReturnType<typeof written> = {};
  if (typeof s.relevant === "boolean") out.relevant = s.relevant;
  if (Array.isArray(s.floor)) out.floor = s.floor.map(String);
  if (s.raised !== undefined && s.raised !== null) {
    out.raisedRaw = s.raised;
    if (isMap(s.raised)) {
      const by = typeof s.raised.by === "string" && s.raised.by.trim() ? s.raised.by.trim() : undefined;
      const why = typeof s.raised.why === "string" && s.raised.why.trim() ? s.raised.why.trim() : undefined;
      if (by || why) out.raised = { ...(by ? { by } : {}), ...(why ? { why } : {}) };
    }
  }
  return out;
}

/** A raise counts when it says who and why. */
const raiseCounts = (r: { by?: string; why?: string } | undefined) => !!r?.by && !!r?.why;

/** The root's records and the designs' as one model in the root's terms, and every crossing to mark. */
export function composedForMarks(root: Pick<RootInput, "shared" | "shipped">, designs: ComposedDesign[]): { model: Pick<Model, "elements" | "contracts">; crossings: { rel: Relationship; shipped: boolean; home: string }[] } {
  const sh = root.shared;
  const els = new Map<string, Element>();
  const owned = new Set(designs.map((d) => d.namespace));
  for (const p of sh?.parts ?? []) els.set(`${SHARED}:${p.id}`, { ...p, id: `${SHARED}:${p.id}`, ...(p.attrs ? { attrs: { ...p.attrs } } : {}) });
  // the parts each design owns, then the outside copies a design holds of parts whose design is not passed
  for (const d of designs) for (const e of d.model.elements) if (!e.home) els.set(`${d.namespace}:${e.id}`, { ...e, id: `${d.namespace}:${e.id}` });
  for (const d of designs) for (const e of d.model.elements) {
    if (!e.home) continue;
    const id = e.id; // outside records are canonical already
    const cur = els.get(id);
    if (!cur) els.set(id, { ...e });
    else if (e.home === SHARED || !owned.has(e.home)) cur.attrs = { ...(cur.attrs ?? {}), ...(e.attrs ?? {}) }; // exposure marks a design's build put on it
  }
  // the shared layer's exposure lists, for far parts whose design is not passed
  for (const sm of sh?.seams ?? []) for (const es of Object.values(sm.exposure ?? {})) for (const x of es) {
    const id = canonShared(x.part), ns = parseRef(id).ns!;
    if (ns !== SHARED && owned.has(ns)) continue;
    const cur = els.get(id);
    if (cur) cur.attrs = { ...(cur.attrs ?? {}), ...x.marks };
    else els.set(id, { id, name: sh?.names[id] ?? parseRef(id).id, kind: "part", home: ns, attrs: { ...x.marks } });
  }
  const contracts = new Map<string, Contract>();
  for (const c of sh?.contracts ?? []) contracts.set(`${SHARED}:${c.name}`, { ...c, name: `${SHARED}:${c.name}` });
  for (const d of designs) for (const c of d.model.contracts) if (!c.home) contracts.set(`${d.namespace}:${c.name}`, { ...c, name: `${d.namespace}:${c.name}` });

  const crossings: { rel: Relationship; shipped: boolean; home: string }[] = [];
  const shippedIds = new Set((root.shipped ?? sh)?.crossings.map((x) => x.id) ?? []);
  for (const x of sh?.crossings ?? [])
    crossings.push({ rel: { ...x, id: `${SHARED}:${x.id}`, from: canonShared(x.from), to: canonShared(x.to), ...(x.carries ? { carries: x.carries.map(canonShared) } : {}) }, shipped: shippedIds.has(x.id), home: SHARED });
  for (const d of designs) {
    const ns = d.namespace;
    const module = new Map(d.model.elements.filter((e) => !e.home).map((e) => [e.id, typeof e.attrs?.module === "string" ? e.attrs.module as string : undefined]));
    const seamModules = new Set((d.model.seams ?? []).flatMap((s) => s.between));
    for (const r of d.model.relationships) {
      if (r.home) continue; // the shared layer's crossings at this design's edge: marked above
      const from = canonDesign(ns, r.from), to = canonDesign(ns, r.to);
      const homes = [parseRef(from).ns, parseRef(to).ns];
      const a = module.get(r.from), b = module.get(r.to);
      const crossesModule = module.has(r.from) && module.has(r.to) && a !== b && ((!!a && seamModules.has(a)) || (!!b && seamModules.has(b)));
      if (homes[0] === homes[1] && !crossesModule) continue;
      crossings.push({ rel: { ...r, id: `${ns}:${r.id}`, from, to, ...(r.carries ? { carries: r.carries.map((c) => canonDesign(ns, c)) } : {}) }, shipped: false, home: ns });
    }
  }
  return { model: { elements: [...els.values()], contracts: [...contracts.values()] }, crossings };
}

/**
 * Every contract's and crossing's mark. See the header: the shipped floor is authoritative where the shipped file
 * records one; elsewhere the engine's signals give a provisional floor; raises and marks written relevant add; nothing
 * lowers. `designs` may be empty (the root's own build), one design (its own build) or a portfolio's.
 */
export function computeMarks(root: Pick<RootInput, "shared" | "shipped">, designs: ComposedDesign[]): Marks {
  const { model, crossings } = composedForMarks(root, designs);
  const shipped = root.shipped ?? root.shared;
  const shippedContract = new Map((shipped?.contracts ?? []).map((c) => [`${SHARED}:${c.name}`, c]));
  const shippedCrossing = new Map((shipped?.crossings ?? []).map((x) => [`${SHARED}:${x.id}`, x]));
  const carriersOf = new Map<string, { rel: Relationship; shipped: boolean }[]>();
  for (const x of crossings) for (const c of x.rel.carries ?? []) carriersOf.set(c, [...(carriersOf.get(c) ?? []), x]);

  // every shared contract, and the designs' own contracts that a crossing carries
  const contracts: Record<string, Mark> = {};
  for (const c of [...model.contracts].sort((a, b) => natCompare(a.name, b.name))) {
    if (parseRef(c.name).ns !== SHARED && !carriersOf.has(c.name)) continue;
    const w = written(c);
    const shippedFloor = written(shippedContract.get(c.name)).floor;
    let floor: string[], floor_source: string;
    if (shippedFloor) { floor = [...shippedFloor]; floor_source = "shipped"; }
    else {
      const sig = new Set<string>();
      for (const x of carriersOf.get(c.name) ?? []) for (const s of crossingSignals(x.rel, model, c.name)) sig.add(s);
      floor = SIGNALS.filter((s) => sig.has(s)); floor_source = sourceOf(floor);
    }
    const raised = raiseCounts(w.raised) ? w.raised : undefined;
    contracts[c.name] = { relevant: floor.length > 0 || !!raised || w.relevant === true, floor, floor_source, ...(raised ? { raised } : {}) };
  }

  const crossingMarks: Record<string, Mark> = {};
  for (const x of [...crossings].sort((a, b) => natCompare(a.rel.id, b.rel.id))) {
    const w = written(x.rel);
    const own = x.shipped ? written(shippedCrossing.get(x.rel.id)).floor ?? [] : crossingSignals(x.rel, model);
    const floor: string[] = [...own];
    let fromShipped = x.shipped;
    let contractRaise: Mark["raised"] | undefined;
    let carriedRelevant = false;
    for (const name of x.rel.carries ?? []) {
      const m = contracts[name];
      if (!m) continue;
      for (const f of m.floor) if (!floor.includes(f)) floor.push(f);
      if (m.floor.length && m.floor_source === "shipped") fromShipped = true;
      if (m.relevant) carriedRelevant = true;
      if (!contractRaise && m.raised) contractRaise = m.raised;
    }
    const raised = raiseCounts(w.raised) ? w.raised : contractRaise;
    const floor_source = fromShipped ? "shipped" : sourceOf(own);
    crossingMarks[x.rel.id] = { relevant: floor.length > 0 || !!raised || carriedRelevant || w.relevant === true, floor, floor_source, ...(raised ? { raised } : {}) };
  }
  return { contracts, crossings: crossingMarks };
}

/** shared/mark-valid: what a mark as written gets wrong, against the computed marks. */
export function markProblems(root: Pick<RootInput, "shared" | "shipped">, marks: Marks): RootProblem[] {
  const out: RootProblem[] = [];
  const sh = root.shared;
  if (!sh) return out;
  const shipped = root.shipped ?? sh;
  const check = (kind: "contract" | "relationship", id: string, rec: { attrs?: Raw }, shippedRec: { attrs?: Raw } | undefined, mark: Mark | undefined) => {
    const w = written(rec);
    if (!mark || (w.relevant === undefined && w.raisedRaw === undefined && w.floor === undefined)) return;
    const what = kind === "contract" ? `The contract ${id}` : `The crossing ${id}`;
    const at = `${SHARED}:${id}`;
    const shippedFloor = written(shippedRec).floor;
    const p = (message: string) => out.push({ rule: "shared/mark-valid", at, atKind: kind, message });
    if (w.relevant === false && mark.floor.length) p(`${what} is marked not security-relevant, below its floor (${mark.floor.join(", ")}, ${mark.floor_source}); a mark is never lowered, so this one is ignored and it stays relevant`);
    if (w.raisedRaw !== undefined) {
      const r = w.raisedRaw;
      const missing = !isMap(r) ? ["by", "why"] : (["by", "why"] as const).filter((k) => !(typeof r[k] === "string" && (r[k] as string).trim()));
      if (missing.length) p(`${what} is raised with no ${missing.join(" or ")}: a raise says who raised it and why (security.raised: { by, why })`);
    }
    if (w.relevant === true && !mark.floor.length && !raiseCounts(w.raised)) p(`${what} is marked security-relevant above an empty floor with no raise saying who and why; write the raise as security.raised: { by, why }`);
    if (w.floor !== undefined && JSON.stringify(w.floor) !== JSON.stringify(shippedFloor ?? []) && (w.floor.length || shippedFloor?.length))
      p(`${what} has a floor (${w.floor.join(", ") || "none"}) that the shipped file does not record (${(shippedFloor ?? []).join(", ") || "none"}); a floor comes from the checks and is never written by hand, so raise the mark with security.raised: { by, why } instead`);
  };
  for (const c of sh.contracts) check("contract", c.name, c, shipped.contracts.find((x) => x.name === c.name), marks.contracts[`${SHARED}:${c.name}`]);
  for (const x of sh.crossings) check("relationship", x.id, x, shipped.crossings.find((y) => y.id === x.id), marks.crossings[`${SHARED}:${x.id}`]);
  return out;
}

/** shared/crossing-valid: each crossing the shared layer holds, against its seams and the layer's contracts. */
export function crossingProblems(root: Pick<RootInput, "shared" | "shipped">): RootProblem[] {
  const out: RootProblem[] = [];
  const sh = root.shared;
  if (!sh) return out;
  const defined = new Set(sh.contracts.map((c) => `${SHARED}:${c.name}`));
  for (const x of sh.crossings) {
    const at = `${SHARED}:${x.id}`;
    const carries = (x.carries ?? []).map(canonShared);
    const seams = sh.seams.filter((s) => onSeam(s.between, x.from, x.to));
    const msgs: string[] = [];
    const reason = x.attrs?.no_contract;
    if (!carries.length && !(typeof reason === "string" && reason.trim())) msgs.push(`carries no contract${seams.length ? ` across the seam ${seams.map((s) => s.id).join(" and ")}` : ""} and gives no written reason why none is needed; add a contract or a non-empty no_contract reason`);
    for (const s of seams) {
      const never = new Set((s.never_cross ?? []).map(canonShared));
      const bad = carries.filter((c) => never.has(c));
      if (bad.length) msgs.push(`carries ${bad.join(" and ")} across the seam ${s.id}, whose never_cross list holds ${bad.length === 1 ? "it" : "them"}`);
    }
    const undefinedHere = carries.filter((c) => !defined.has(c));
    if (undefinedHere.length) msgs.push(`carries ${undefinedHere.join(" and ")}, which the shared layer does not define; every contract that crosses is defined once in the shared layer`);
    if (msgs.length) out.push({ rule: "shared/crossing-valid", at, atKind: "relationship", message: `The crossing ${x.id} (${x.from} to ${x.to}) ${msgs.join("; ")}` });
  }
  return out;
}

/** Does a recorded hash name this file's sha256 (in full, or as a prefix of 12 or more)? */
const hashMatches = (recorded: string, actual: string) => recorded.length >= 12 && actual.startsWith(recorded.toLowerCase());

/** shared/file-intact: the root's shipped seams.yaml against the sha256 recorded when it was imported. */
export function fileIntactProblem(root: Pick<RootInput, "config" | "shipped">): RootProblem | undefined {
  const recorded = root.config.shared_from?.sha256;
  if (!recorded || typeof recorded !== "string") return undefined;
  const actual = root.shipped?.sha256;
  if (actual && hashMatches(recorded, actual)) return undefined;
  const head = actual ? `seams.yaml has sha256 ${actual.slice(0, 12)}, and the root recorded ${recorded.slice(0, 12)} when the file was put here (engine.yaml shared_from.sha256)` : `seams.yaml is gone, and the root recorded its sha256 ${recorded.slice(0, 12)} when the file was put here`;
  return { rule: "shared/file-intact", at: "seams.yaml", atKind: "instance", message: `${head}: the shipped file was changed by hand. Put the shipped file back and write the change as a patch in patches/; an upgrade replaces the file and applies the patches again` };
}

/** core/xref-resolves (b) inside the shared layer: references to its own records that it does not hold. */
export function sharedRefProblems(root: Pick<RootInput, "shared">): RootProblem[] {
  const out: RootProblem[] = [];
  const sh = root.shared;
  if (!sh) return out;
  const parts = new Set(sh.parts.map((p) => p.id)), systems = new Set(sh.systems.map((s) => s.id)), zones = new Set(sh.zones.map((z) => z.id));
  const claims = new Set(sh.claims.map((c) => c.id)), contracts = new Set(sh.contracts.map((c) => c.name));
  const own = (ref: string) => { const r = parseRef(ref); return r.ns === undefined || r.ns === SHARED ? r.id : undefined; };
  const x = (at: string, atKind: RootProblem["atKind"], message: string) => out.push({ rule: "core/xref-resolves", at, atKind, message, severity: "error" });
  for (const c of sh.crossings) for (const [end, ref] of [["starts at", c.from], ["ends at", c.to]] as const) {
    const id = own(ref);
    if (id !== undefined && !parts.has(id)) x(`${SHARED}:${c.id}`, "relationship", `the shared layer's crossing ${c.id} ${end} ${ref}, which is not a shared part (a design's part is written <namespace>:<id>)`);
  }
  for (const c of sh.contracts) for (const [role, refs] of [["producer", c.produced_by], ["consumer", c.consumed_by]] as const) for (const ref of refs ?? []) {
    const id = own(ref);
    if (id !== undefined && !parts.has(id)) x(`${SHARED}:${c.name}`, "contract", `the shared layer's contract ${c.name} names ${role} ${ref}, which is not a shared part (a design's part is written <namespace>:<id>)`);
  }
  for (const p of sh.parts) {
    const at = `${SHARED}:${p.id}`;
    if (p.system && own(p.system) !== undefined && !systems.has(own(p.system)!)) x(at, "element", `the shared part ${p.id} names system ${p.system}, which the shared layer does not hold`);
    if (p.zone && own(p.zone) !== undefined && !zones.has(own(p.zone)!)) x(at, "element", `the shared part ${p.id} names zone ${p.zone}, which the shared layer does not hold`);
    for (const c of p.rests_on ?? []) if (own(c) !== undefined && !claims.has(own(c)!)) x(at, "element", `the shared part ${p.id} rests on ${c}, which the shared layer does not hold as a claim`);
  }
  for (const s of sh.seams) {
    for (const c of s.never_cross ?? []) if (own(c) !== undefined && !contracts.has(own(c)!)) x(`${SHARED}:${s.id}`, "instance", `the seam ${s.id} lists ${c} as never crossing, which the shared layer does not define (a design's contract is written <namespace>:<name>)`);
    for (const [side, es] of Object.entries(s.exposure ?? {})) for (const e of es) if (own(e.part) !== undefined && !parts.has(own(e.part)!)) x(`${SHARED}:${s.id}`, "instance", `the seam ${s.id}'s exposure for ${side} names ${e.part}, which is not a shared part (a design's part is written <namespace>:<id>)`);
  }
  return out;
}

/** The shared layer as a model in the root's terms, for the root's own page and checks: every record "shared:<id>". */
export function sharedModel(sh: SharedLayer | undefined): Pick<Model, "systems" | "zones" | "elements" | "relationships" | "contracts" | "claims"> {
  const s = (x: string) => canonShared(x);
  return {
    systems: (sh?.systems ?? []).map((x) => ({ ...x, id: s(x.id) })),
    zones: (sh?.zones ?? []).map((x) => ({ ...x, id: s(x.id) })),
    elements: (sh?.parts ?? []).map((p) => ({ ...p, id: s(p.id), ...(p.system ? { system: s(p.system) } : {}), ...(p.zone ? { zone: s(p.zone) } : {}), ...(p.rests_on ? { rests_on: p.rests_on.map(s) } : {}) })),
    relationships: (sh?.crossings ?? []).map((x) => ({ ...x, id: s(x.id), from: s(x.from), to: s(x.to), ...(x.carries ? { carries: x.carries.map(s) } : {}) })),
    contracts: (sh?.contracts ?? []).map((c) => ({ ...c, name: s(c.name), ...(c.produced_by ? { produced_by: c.produced_by.map(s) } : {}), ...(c.consumed_by ? { consumed_by: c.consumed_by.map(s) } : {}) })),
    claims: (sh?.claims ?? []).map((c) => ({ ...c, id: s(c.id), ...(c.rests_on ? { rests_on: c.rests_on.map(s) } : {}) })),
  };
}
