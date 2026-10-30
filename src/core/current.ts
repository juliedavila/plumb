// Current state: where each part of a design stands today, part by part, in <design>/current.yaml.
//
// current.yaml is live state, like progress.yaml: read from the instance folder (never from a released edition), never
// written by an importer and never frozen. It holds one record per part, keyed by the part's id:
//
//   parts:
//     s1.tool-signal-intake:               a part of the design
//       baseline: existing-tool             the ladder level it stands at today (default: the ladder's first level)
//       disposition: transition             new, retain, transition, replace or retire
//       found: { by: "agent:current-state-scout", from: the service catalog export, as_of: "2026-11-03", confidence: medium }
//     legacy-scanner-gateway:              a part that exists only today
//       add: { name: Legacy scanner gateway, kind: service, system: s1, owner: appsec-platform }
//       baseline: built
//       disposition: replace
//       replaced_by: s1.tool-signal-intake
//       found: { ... }
//       confirmed: { by: the AppSec platform lead, at: "2026-11-05" }
//
// The investigation pod writes a record with `found` and no `confirmed`: it is discovered, and it enters the picture
// at once, marked wherever it shows. A person confirms it; a confirmation written by an agent does not count. A part
// declared with `add:` is brought into the compiled model (todayOnly), so a unit can retire it with the move
// { id, from, to: retired }: `retired` is a terminal level outside the ladder, allowed only for a part whose
// disposition is replace or retire.
//
// Findings:
//   core/current-valid (error): a record that does not read, names no part of this design, has an unknown baseline
//     or disposition, is to be replaced by nothing, or names a replacement that does not resolve; a part that exists
//     only today and names no system this design places parts in (its own or a shared one); a confirmation that is
//     not a person's (an agent's, or one with no name or date), which leaves the record discovered.
//   A missing disposition is undecided: core/current-valid warns while discovered and errors once confirmed.
//   Unknown dispositions and malformed records remain errors.
//   plan/retire-before-replace (packs/plan): see `retireFindings`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BundleCurrent, ComposedDesign, CurrentCompiled, CurrentFacts, CurrentInput, CurrentRecord, CurrentState, Disposition, Element, Finding, Model, Plan,
  Retirement, RootInput, TransitionWork, Unit,
} from "../types.ts";
import { ORG, parseRef, SHARED } from "./namespace.ts";
import { providersOf, uniqueUnits } from "./plan.ts";
import { natCompare, natSort } from "./util.ts";

export const CURRENT_FILE = "current.yaml";
/** The terminal level a unit moves a part to when it retires it: outside the ladder. */
export const RETIRED = "retired";
export const DISPOSITIONS: Disposition[] = ["new", "retain", "transition", "replace", "retire"];
/** Dispositions that make a unit that moves the part transition work. */
const TRANSITIONAL = new Set<string>(["transition", "replace", "retire"]);
/** Dispositions under which a part may be moved to retired. */
export const RETIRABLE = new Set<string>(["replace", "retire"]);

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
/** A value as text: a YAML date becomes YYYY-MM-DD, everything else its string, trimmed. */
const text = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
const what = (v: unknown) => (Array.isArray(v) ? "a list" : v === null || v === undefined ? "nothing" : typeof v === "object" ? "a mapping" : `the ${typeof v} ${JSON.stringify(v)}`);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Nov" from an ISO date, read as a calendar date. */
export const dayMonth = (iso?: string): string => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso ?? ""); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso ?? ""; };

/** Does a `by` name an agent rather than a person? "agent:<name>" (the pod's form), "agent", or Claude. */
export function isAgent(by: string | undefined): boolean {
  const s = (by ?? "").trim().toLowerCase();
  return /^agent(:|$)/.test(s) || s === "claude" || s === "claude code";
}
/** The agent's name in "agent:<name>", else undefined. */
const agentName = (by: string): string | undefined => (/^agent:/i.test(by.trim()) ? by.trim().slice(6).trim() || undefined : undefined);

// ---------- reading ----------

function textMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Raw)) { const t = text(x); if (t !== undefined && typeof x !== "object") out[k] = t; else if (x instanceof Date) out[k] = t!; }
  return out;
}

function readRecord(part: string, v: unknown): CurrentRecord {
  if (!isMap(v)) return { part, unread: true, problems: [`must be a mapping (baseline, disposition, found and the rest), not ${what(v)}; it is not read`] };
  const r: CurrentRecord = { part };
  const problems: string[] = [];
  for (const k of ["baseline", "disposition", "replaced_by"] as const) { const t = text(v[k]); if (t !== undefined && t !== "") r[k] = t; }
  if (v.add != null) {
    if (isMap(v.add)) { const add: Raw = {}; for (const [k, x] of Object.entries(v.add)) add[k] = x instanceof Date ? text(x) : x; r.add = add; }
    else { r.addUnread = true; problems.push(`has add: ${what(v.add)}, where a part that exists only today is a mapping (name, kind, system, owner); it is not read`); }
  }
  for (const k of ["found", "confirmed"] as const) {
    if (v[k] == null) continue;
    if (isMap(v[k])) r[k] = textMap(v[k]);
    else problems.push(`has ${k}: ${what(v[k])}, where ${k === "found" ? "found is a mapping (by, from, as_of, confidence)" : "confirmed is a mapping (by, at)"}; it is not read`);
  }
  if (problems.length) r.problems = problems;
  return r;
}

/**
 * <dir>/current.yaml, when there is one: `parts:`, a mapping from part ids to records. A file that does not parse, or
 * whose parts are not a mapping, reads as no records with a problem the build reports (core/current-valid).
 */
export function loadCurrent(dir: string): CurrentInput | undefined {
  const path = join(dir, CURRENT_FILE);
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try { raw = Bun.YAML.parse(readFileSync(path, "utf8")); } catch (e) { return { file: CURRENT_FILE, records: [], problem: `YAML parse error: ${(e as Error).message}` }; }
  if (raw === null || raw === undefined) return { file: CURRENT_FILE, records: [] };
  if (!isMap(raw)) return { file: CURRENT_FILE, records: [], problem: `expected a mapping with parts: (part ids to records), not ${what(raw)}` };
  const parts = raw.parts;
  if (parts === null || parts === undefined) return { file: CURRENT_FILE, records: [] };
  if (!isMap(parts)) return { file: CURRENT_FILE, records: [], problem: `parts must be a mapping from part ids to records, not ${what(parts)}` };
  return { file: CURRENT_FILE, records: Object.entries(parts).map(([id, v]) => readRecord(id, v)) };
}

// ---------- parts that exist only today ----------

const PART_KEYS = ["id", "name", "kind", "system", "zone", "owner", "verifier", "parent", "description", "rests_on"];

/** The record's key as one of this design's own ids, or undefined when it names another namespace. */
function ownKey(key: string, own?: string): string | undefined {
  const r = parseRef(key);
  return r.ns === undefined || r.ns === own ? r.id : undefined;
}

/** A part current.yaml declares with add:, as a part of the compiled model (normalized as model.yaml's parts are). */
export function todayOnlyElement(id: string, add: Raw): Element {
  const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
  const attrs: Raw = isMap(add.attrs) ? { ...add.attrs } : {};
  for (const [k, v] of Object.entries(add)) if (!PART_KEYS.includes(k) && k !== "attrs") attrs[k] = v;
  const e: Element = { id, name: str(add.name) ?? id, kind: str(add.kind) ?? "element", todayOnly: true };
  for (const k of ["system", "zone", "owner", "verifier", "parent", "description"] as const) { const s = str(add[k]); if (s !== undefined) (e as unknown as Raw)[k] = s; }
  if (add.rests_on != null) e.rests_on = (Array.isArray(add.rests_on) ? add.rests_on : [add.rests_on]).filter((x) => x != null).map(String);
  if (Object.keys(attrs).length) e.attrs = attrs;
  return e;
}

/**
 * Bring the parts that exist only today into a state about to be compiled (before patches and resolution, so a unit
 * can move them and their references resolve like any part's). A record whose id is already a part keeps the part:
 * `compileCurrent` reports the clash.
 */
export function addTodayOnly(model: Model, input: CurrentInput | undefined, own?: string): void {
  if (!input) return;
  const have = new Set(model.elements.map((e) => e.id));
  for (const r of input.records) {
    const id = ownKey(r.part, own);
    if (!r.add || id === undefined || have.has(id)) continue;
    model.elements.push(todayOnlyElement(id, r.add));
    have.add(id);
  }
}

// ---------- resolving and checking the records ----------

const valid = (at: string, atKind: Finding["atKind"], message: string): Finding => ({ pack: "core", rule: "current-valid", severity: "error", at, atKind, message });

export interface CurrentContext { own?: string; root?: RootInput; compose?: ComposedDesign[]; ladder: string[] }

/** The one-sentence provenance of a record: "Discovered by current-state-scout from the scheduler's job list, 27 Oct; not confirmed." */
export function provenanceText(st: Pick<CurrentState, "found" | "confirmed" | "state" | "refused">): string {
  const f = st.found;
  const found = f ? `${f.agent ?? f.by}${f.from ? ` from ${f.from}` : ""}${f.as_of ? `, ${dayMonth(f.as_of)}` : ""}` : "";
  if (st.state === "confirmed" && st.confirmed) return `Confirmed by ${st.confirmed.by} on ${dayMonth(st.confirmed.at)}${found ? `; discovered by ${found}` : ""}.`;
  const head = found ? `Discovered by ${found}; not confirmed` : "Recorded with no source; not confirmed";
  return `${head}${st.refused ? `: ${st.refused}` : ""}.`;
}

/** "Ownership macros' disposition", "Cloud tag sync job's disposition". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * Resolve and check the records against the compiled state (after patches and resolution): each record's part and
 * replacement in canonical form, confirmed or discovered, with core/current-valid's findings, and transition work.
 * A today-only part's system that resolves nowhere is dropped from the part, so one problem is one finding.
 */
export function compileCurrent(model: Model, plan: Plan, input: CurrentInput, ctx: CurrentContext): CurrentCompiled {
  const findings: Finding[] = [];
  if (input.problem) findings.push(valid(input.file, "instance", `${input.file}: ${input.problem}; no current state is read`));
  const own = ctx.own, ladder = ctx.ladder;
  const els = new Map(model.elements.map((e) => [e.id, e] as const));
  const ownEl = (id: string) => { const e = els.get(id); return e && !e.home ? e : undefined; };
  const sharedParts = new Map((ctx.root?.shared?.parts ?? []).map((p) => [p.id, p] as const));
  const records: CurrentState[] = [];
  const seen = new Set<string>();
  const where = (id: string) => `${input.file}: the record for ${id}`;

  for (const rec of input.records) {
    const key = rec.part, r = parseRef(key);
    // the part: one of this design's own (a part of the model, or one that exists only today)
    if (r.ns !== undefined && r.ns !== own) {
      const whose = r.ns === SHARED ? "the shared layer's part" : r.ns === ORG ? "the org layer, which holds no parts" : `a part of ${r.ns}, another design`;
      findings.push(valid(key, "instance", `${where(key)} names ${whose}; a design records current state for its own parts only, and its parts that exist only today are declared with add:`));
      continue;
    }
    const id = r.id;
    if (seen.has(id)) { findings.push(valid(id, "element", `${where(id)} is written twice (once as ${id}, once with its namespace); the first is read`)); continue; }
    seen.add(id);
    const e = ownEl(id);
    for (const p of rec.problems ?? []) findings.push(valid(id, e ? "element" : "instance", `${where(id)} ${p}`));
    if (rec.unread) continue;
    if (!e) {
      if (rec.addUnread) continue; // its add: did not read, which is the finding already
      findings.push(valid(id, "instance", sharedParts.has(id)
        ? `${where(id)} names the shared layer's part ${id}; a design records current state for its own parts only`
        : `${where(id)} names no part of this design; a part that exists only today is declared with add: { name, kind, system, owner }`));
      continue;
    }
    if (rec.add && !e.todayOnly) findings.push(valid(id, "element", `${where(id)} declares it with add:, but it is a part of this design's model; add: declares only a part that exists only today, so the record is read as the part's`));

    // baseline and disposition
    let baseline = rec.baseline, baselineDefault = false;
    if (baseline === undefined) { baseline = ladder[0] ?? "none"; baselineDefault = true; }
    else if (!ladder.includes(baseline)) findings.push(valid(id, "element", `${where(id)} has baseline "${baseline}", which is not on the ladder (${ladder.join(" < ")})${baseline === RETIRED ? "; a part stands at a ladder level today, and retired is where a unit moves it" : ""}`));
    let disposition: Disposition | undefined;
    const d = rec.disposition?.toLowerCase();
    if (d !== undefined && !(DISPOSITIONS as string[]).includes(d)) findings.push(valid(id, "element", `${where(id)} has disposition "${rec.disposition}", which is not new, retain, transition, replace or retire`));
    else if (d !== undefined) disposition = d as Disposition;

    // the replacement
    let replaced_by: string | undefined;
    if (disposition === "replace") {
      if (!rec.replaced_by) findings.push(valid(id, "element", `${where(id)} is to be replaced, but names no part to replace it (replaced_by)`));
      else {
        const q = resolvePart(rec.replaced_by, own, ownEl, sharedParts, ctx.compose);
        if (q.problem) findings.push(valid(id, "element", `${where(id)} is replaced by ${rec.replaced_by}, ${q.problem}`));
        else if (q.ref === id) findings.push(valid(id, "element", `${where(id)} is replaced by itself; replaced_by names the part that takes over`));
        else replaced_by = q.ref;
      }
    }

    // who found it, and who confirmed it
    const st: CurrentState = { part: id, name: e.name, baseline, state: "discovered", text: "" };
    if (baselineDefault) st.baselineDefault = true;
    if (disposition) st.disposition = disposition;
    if (replaced_by) st.replaced_by = replaced_by;
    if (e.todayOnly) st.todayOnly = true;
    if (rec.found) {
      const by = rec.found.by?.trim() || "an unnamed source";
      const f: NonNullable<CurrentState["found"]> = { by };
      const ag = agentName(by); if (ag) f.agent = ag;
      for (const k of ["from", "as_of", "confidence"] as const) { const v = rec.found[k]; if (typeof v === "string" && v) f[k] = v; }
      st.found = f;
    }
    if (rec.confirmed) {
      const by = rec.confirmed.by?.trim(), at = rec.confirmed.at?.trim();
      if (!by) { st.refused = "the confirmation names no one"; findings.push(valid(id, "element", `${where(id)} is confirmed without saying by whom (confirmed.by); it stays discovered`)); }
      else if (isAgent(by)) { st.refused = "an agent wrote the confirmation, and only a person confirms a record"; findings.push(valid(id, "element", `${where(id)} is confirmed by an agent (${by}); only a person confirms a record, so it stays discovered`)); }
      else if (!at || !ISO_DAY.test(at)) { st.refused = "the confirmation has no date"; findings.push(valid(id, "element", `${where(id)} is confirmed by ${by} ${at ? `on "${at}", which is not a date (YYYY-MM-DD)` : "with no date (confirmed.at)"}; it stays discovered`)); }
      else { st.confirmed = { by, at: at.slice(0, 10) }; st.state = "confirmed"; }
    }
    if (d === undefined) findings.push({
      ...valid(id, "element", `${where(id)} gives no disposition (new, retain, transition, replace or retire); its disposition is undecided${st.state === "confirmed" ? "; a confirmed record needs a disposition" : "; a person settles it when confirming the record"}`),
      severity: st.state === "confirmed" ? "error" : "warning",
    });
    st.text = provenanceText(st);
    records.push(st);
  }

  // a part that exists only today names a system this design places parts in, its own or a shared one
  const scope = new Set<string>(model.systems.filter((s) => !s.home).map((s) => s.id));
  for (const x of model.elements) if (!x.home && !x.todayOnly && x.system) scope.add(x.system);
  const systems = new Set(model.systems.map((s) => s.id));
  for (const x of model.elements) {
    if (!x.todayOnly || x.home) continue;
    const at = `${input.file}: the part ${x.id}, which exists only today,`;
    if (!x.system) findings.push(valid(x.id, "element", `${at} names no system; it must name a system this design places parts in, its own or a shared one`));
    else if (!systems.has(x.system)) { findings.push(valid(x.id, "element", `${at} names system ${x.system}, which is neither this design's nor its shared layer's`)); delete x.system; }
    else if (!scope.has(x.system)) findings.push(valid(x.id, "element", `${at} names system ${x.system}, where this design places none of its parts: it is outside the design's scope`));
  }

  records.sort((a, b) => natCompare(a.part, b.part));
  return { records, findings, transition: transitionWork(plan, new Map(records.map((s) => [s.part, s]))) };
}

/** A reference to a part, from current.yaml (replaced_by): this design's own part bare, a shared part shared:<id>, another design's <ns>:<id>. */
function resolvePart(raw: string, own: string | undefined, ownEl: (id: string) => Element | undefined, shared: Map<string, unknown>, compose?: ComposedDesign[]): { ref?: string; problem?: string } {
  const r = parseRef(raw);
  if (r.ns === undefined || r.ns === own) {
    if (ownEl(r.id)) return { ref: r.id };
    if (r.ns === undefined && shared.has(r.id)) return { ref: `${SHARED}:${r.id}` };
    return { problem: "which is not a part of this design or its shared layer" };
  }
  if (r.ns === SHARED) return shared.has(r.id) ? { ref: `${SHARED}:${r.id}` } : { problem: "which the shared layer does not hold" };
  if (r.ns === ORG) return { problem: "which names the org layer, which holds no parts" };
  const d = compose?.find((x) => x.namespace === r.ns);
  if (d && !d.model.elements.some((x) => x.id === r.id && !x.home)) return { problem: `which ${d.title} (${r.ns}) does not hold` };
  return { ref: `${r.ns}:${r.id}` }; // another design's part: it resolves where that design is composed
}

// ---------- transition work ----------

/** The units that are transition work, those in doing, and those whose only reason is a discovered disposition. */
export function transitionWork(plan: Plan, records: Map<string, CurrentState>): TransitionWork {
  const units: string[] = [], doing: string[] = [], discovered: string[] = [];
  for (const u of uniqueUnits(plan)) {
    const why = transitionReasons(u, records);
    if (!why.length) continue;
    units.push(u.id);
    if (u.status === "doing") doing.push(u.id);
    if (why.every((x) => x === "discovered")) discovered.push(u.id);
  }
  return { units: natSort(units), doing: natSort(doing), discovered: natSort(discovered) };
}

/** Why a unit is transition work: "plan" for a move to retired, a record's state for a part it moves whose disposition is transition, replace or retire. */
export function transitionReasons(u: Unit, records: Map<string, CurrentState>): ("plan" | "discovered" | "confirmed")[] {
  const out: ("plan" | "discovered" | "confirmed")[] = [];
  for (const m of u.elements ?? []) {
    if (m.to === RETIRED) out.push("plan");
    const r = records.get(m.id);
    if (r?.disposition && TRANSITIONAL.has(r.disposition)) out.push(r.state);
  }
  return out;
}

// ---------- the facts the plan pack reads ----------

/** What resolving and checking current state reads from an instance: its namespace, root, composed designs and ladder. */
export function currentContext(inst: { ns?: { namespace?: string; root?: { input?: RootInput }; compose?: ComposedDesign[] } }, ladder: string[]): CurrentContext {
  const ns = inst.ns;
  return { ladder, ...(ns?.namespace ? { own: ns.namespace } : {}), ...(ns?.root?.input ? { root: ns.root.input } : {}), ...(ns?.compose?.length ? { compose: ns.compose } : {}) };
}

export function currentFacts(c: CurrentCompiled, ctx: CurrentContext): CurrentFacts {
  return { records: new Map(c.records.map((s) => [s.part, s])), ladder: ctx.ladder, ...(ctx.own ? { own: ctx.own } : {}), ...(ctx.compose?.length ? { compose: ctx.compose } : {}) };
}

// ---------- retire-before-replace ----------

/** A unit that moves a part: in this design (design undefined) or in another design composed with it. */
interface Mover { design?: string; unit: Unit; phase?: { id: string; order: number; target?: string }; from: string; to: string }

/** Units, in this design and in the designs composed with it, that move part `ref` (canonical, as this design names it). */
function moversOf(ref: string, plan: Plan, facts: CurrentFacts): Mover[] {
  const out: Mover[] = [];
  const phaseOf = (p: Plan, id: string) => p.phases.find((x) => x.id === id);
  for (const u of uniqueUnits(plan)) for (const m of u.elements ?? []) if (m.id === ref) out.push({ unit: u, phase: phaseOf(plan, u.phase), from: m.from, to: m.to });
  const r = parseRef(ref);
  for (const d of facts.compose ?? []) {
    // another design's part is bare in its own plan; a shared part is shared:<id> in every design's
    const there = r.ns === SHARED ? ref : r.ns === d.namespace ? r.id : undefined;
    if (!there || d.namespace === facts.own) continue;
    for (const u of uniqueUnits(d.plan)) for (const m of u.elements ?? []) if (m.id === there) out.push({ design: d.namespace, unit: u, phase: phaseOf(d.plan, u.phase), from: m.from, to: m.to });
  }
  return out;
}

const unitRef = (m: Mover) => (m.design ? `${m.design}:${m.unit.id}` : m.unit.id);
const phaseRef = (m: Mover) => (m.phase ? (m.design ? `${m.design}:${m.phase.id}` : m.phase.id) : undefined);

/**
 * Units each unit depends on, across the designs composed: within a design, a unit depends on the units that provide
 * a capability it requires; a shared capability (shared:<id>) is provided by the units of the other designs that
 * provide it (a design names the capabilities it provides bare). Node ids: this design's units bare, another
 * design's "<ns>:<unit>".
 */
function dependencyGraph(plan: Plan, facts: CurrentFacts): Map<string, string[]> {
  const g = new Map<string, string[]>();
  const designs: { ns?: string; plan: Plan }[] = [{ plan }, ...(facts.compose ?? []).filter((d) => d.namespace !== facts.own).map((d) => ({ ns: d.namespace, plan: d.plan }))];
  const node = (ns: string | undefined, id: string) => (ns ? `${ns}:${id}` : id);
  const byCap = new Map<string, { ns?: string; node: string }[]>(); // a capability provided bare, in any design -> its providers
  for (const d of designs) for (const [cap, us] of providersOf(d.plan)) if (parseRef(cap).ns === undefined)
    for (const u of us) byCap.set(cap, [...(byCap.get(cap) ?? []), { ns: d.ns, node: node(d.ns, u) }]);
  for (const d of designs) {
    const prov = providersOf(d.plan);
    for (const u of uniqueUnits(d.plan)) {
      const deps = new Set<string>();
      for (const c of u.requires ?? []) {
        const r = parseRef(c);
        if (r.ns === SHARED) { for (const p of byCap.get(r.id) ?? []) if (p.ns !== d.ns) deps.add(p.node); }
        else for (const p of prov.get(c) ?? []) if (p !== u.id) deps.add(node(d.ns, p));
      }
      g.set(node(d.ns, u.id), [...deps]);
    }
  }
  return g;
}

/** Does `from` depend, directly or through others, on any of `targets`? */
function reaches(g: Map<string, string[]>, from: string, targets: Set<string>): boolean {
  const seen = new Set([from]), stack = [from];
  while (stack.length) for (const n of g.get(stack.pop()!) ?? []) { if (targets.has(n)) return true; if (!seen.has(n)) { seen.add(n); stack.push(n); } }
  return false;
}

/** How each replaced or retired part's retirement stands against its replacement. */
export function retirements(plan: Plan, facts: CurrentFacts): Retirement[] {
  const out: Retirement[] = [];
  const rank = (lv: string) => facts.ladder.indexOf(lv);
  let graph: Map<string, string[]> | undefined;
  for (const st of [...facts.records.values()].sort((a, b) => natCompare(a.part, b.part))) {
    if (!st.disposition || !RETIRABLE.has(st.disposition)) continue;
    const retiring = moversOf(st.part, plan, facts).filter((m) => !m.design && m.to === RETIRED)
      .sort((a, b) => (a.phase?.order ?? 1e9) - (b.phase?.order ?? 1e9) || natCompare(a.unit.id, b.unit.id));
    const rt: Retirement = { part: st.part, by: retiring.map((m) => m.unit.id) };
    const first = retiring[0];
    if (first?.phase) rt.milestone = first.phase.id;
    if (st.disposition === "replace" && st.replaced_by) {
      const moves = moversOf(st.replaced_by, plan, facts).filter((m) => m.to !== RETIRED);
      const top = Math.max(-1, ...moves.map((m) => rank(m.to)));
      const atTop = top < 0 ? [] : moves.filter((m) => rank(m.to) === top);
      // the units that bring it there: those that raise it to that level, else those that extend it there
      const raising = atTop.filter((m) => rank(m.from) < top);
      const bringers0 = raising.length ? raising : atTop;
      // this design's own work orders by plan order; another design's by target dates
      const local = bringers0.filter((m) => !m.design);
      const bringers = (local.length ? local : bringers0).sort((a, b) => (a.design ? (a.phase?.target ?? "9999").localeCompare(b.phase?.target ?? "9999") : (a.phase?.order ?? 1e9) - (b.phase?.order ?? 1e9)) || natCompare(unitRef(a), unitRef(b)));
      const arrive = bringers[0];
      rt.replacement = { part: st.replaced_by, units: bringers.map(unitRef) };
      if (top >= 0) rt.replacement.level = facts.ladder[top];
      if (arrive) {
        const ph = phaseRef(arrive); if (ph) rt.replacement.milestone = ph;
        if (arrive.design) { rt.replacement.design = arrive.design; if (arrive.phase?.target) rt.replacement.target = arrive.phase.target; }
        if (first) {
          if (!arrive.design) rt.order = !first.phase || !arrive.phase ? "unknown" : first.phase.order === arrive.phase.order ? "same" : first.phase.order > arrive.phase.order ? "after" : "before";
          else {
            const a = first.phase?.target, b = arrive.phase?.target;
            rt.order = !a || !b || !ISO_DAY.test(a) || !ISO_DAY.test(b) ? "unknown" : a.slice(0, 10) === b.slice(0, 10) ? "same" : a.slice(0, 10) > b.slice(0, 10) ? "after" : "before";
          }
          // the dependency clause: does each retiring unit wait for a unit that brings the replacement there?
          graph ??= dependencyGraph(plan, facts);
          const targets = new Set(bringers.map(unitRef));
          rt.waitsFor = []; rt.doesNotWait = [];
          for (const m of retiring) (reaches(graph, m.unit.id, targets) ? rt.waitsFor : rt.doesNotWait).push(m.unit.id);
        }
      }
    }
    out.push(rt);
  }
  return out;
}

/** The bundle's current state: every record with its provenance, how each retirement stands, transition work and counts. */
export function bundleCurrent(plan: Plan, c: CurrentCompiled, inst: Parameters<typeof currentContext>[0], ladder: string[]): BundleCurrent {
  const facts = currentFacts(c, currentContext(inst, ladder));
  const count = (f: (s: CurrentState) => boolean) => c.records.filter(f).length;
  return {
    file: CURRENT_FILE, records: c.records, retirements: retirements(plan, facts), transition: c.transition,
    counts: { records: c.records.length, discovered: count((s) => s.state === "discovered"), confirmed: count((s) => s.state === "confirmed"), todayOnly: count((s) => !!s.todayOnly) },
  };
}

/** What a finding that rests on a discovered record adds to its message, naming the record and who found it. */
function restsOn(st: CurrentState): string {
  if (st.state === "confirmed") return "";
  const f = st.found;
  const by = f ? ` discovered by ${f.agent ?? f.by}${f.from ? ` from ${f.from}` : ""}${f.as_of ? ` on ${dayMonth(f.as_of)}` : ""}` : " which records no source";
  return `; this rests on a discovered record not yet confirmed: ${possessive(st.name)} disposition,${by}`;
}

type RuleFinding = Omit<Finding, "pack" | "rule">;

/**
 * plan/retire-before-replace: a part P whose disposition is replace (replaced_by Q) or retire, where no unit moves P to
 * retired; or, for replace, where the first unit that retires P sits in a milestone after the one where Q reaches its
 * target level (the highest level any unit moves Q to): plan order inside one design, target dates across designs, and
 * no finding when a date is missing. An error when P's record is confirmed, a warning when it is discovered, and the
 * message then names the record. A second clause, always a warning: a unit that retires P does not wait, directly or
 * through others, for a unit that brings Q to its target level, so P could go before Q arrives.
 */
export function retireFindings(plan: Plan, facts: CurrentFacts): RuleFinding[] {
  const out: RuleFinding[] = [];
  const phaseOf = (id: string) => plan.phases.find((p) => p.id === id);
  for (const rt of retirements(plan, facts)) {
    const st = facts.records.get(rt.part)!;
    const sev: Finding["severity"] = st.state === "confirmed" ? "error" : "warning";
    const tail = restsOn(st);
    const q = rt.replacement;
    if (!rt.by.length) {
      out.push({ severity: sev, at: rt.part, atKind: "element", message: st.disposition === "replace"
        ? `part ${rt.part} is to be replaced${st.replaced_by ? ` by part ${st.replaced_by}` : ""}, but no unit moves it to retired: the plan adds the new part and never removes the old one${tail}`
        : `part ${rt.part} is to be retired, but no unit moves it to retired${tail}` });
      continue;
    }
    if (!q || !q.units.length) continue; // nothing brings the replacement anywhere: nothing to order against
    const lv = q.level ? ` to ${q.level}` : "";
    const arrive = q.units[0];
    if (rt.order === "after") {
      const there = q.design
        ? `${q.milestone ? `milestone ${parseRef(q.milestone).id}` : "a milestone"} of ${q.design}${q.target ? ` (target ${q.target})` : ""}, where unit ${arrive} brings its replacement, part ${q.part},${lv}`
        : `milestone ${q.milestone}, where unit ${arrive} brings its replacement, part ${q.part},${lv}`;
      const mine = rt.milestone ? `milestone ${rt.milestone}${q.design && phaseOf(rt.milestone)?.target ? ` (target ${phaseOf(rt.milestone)!.target})` : ""}` : "a later milestone";
      out.push({ severity: sev, at: rt.part, atKind: "element", message: `unit ${rt.by[0]} retires part ${rt.part} in ${mine}, after ${there}, so the old part runs beside the new one until then${tail}` });
    }
    for (const u of rt.doesNotWait ?? [])
      out.push({ severity: "warning", at: rt.part, atKind: "element", message: `unit ${u} retires part ${rt.part} but does not wait, directly or through other units, for unit ${arrive}, which brings its replacement, part ${q.part},${lv}: the old part could go before the new one is there${tail}` });
  }
  return out;
}
