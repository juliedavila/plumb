// Seams and crossings.
//
// A crossing is a relationship whose ends have different homes (two designs, or a design and a shared part), or one
// that crosses a module seam inside one design (one end in the module, the other in the rest of the design). This
// file finds every crossing a build can see, says which are declared and which are not, applies the seam exceptions in
// force, and gives each undeclared crossing the seam rule's severity:
//   - declared: the shared layer holds it whole (it is one of seams.yaml's crossings, or the organization added it by a
//     root patch), or, for a module crossing, its module seam names it with every contract it carries;
//   - undeclared: anything else, such as a design's own edge to a shared part, a module crossing its seam does not
//     name, or a patch that writes a crossing outside the shared layer;
//   - severity: error when the crossing's mark is security-relevant, else warning. An exception in force on a seam the
//     crossing crosses, naming every contract it carries, makes the error a warning. An exception changes no mark and
//     no other finding: composed security findings keep their severity.
// Marks come from computeMarks (src/core/shared.ts, the one derivation) through src/core/marks.ts. A build with no
// derivation available counts an undeclared crossing as security-relevant: it fails closed, and says so.
//
// Exceptions are read once, by src/core/org.ts: a seam's shipped `default_exceptions`,
// or the organization's own list in org.yaml `seam_exceptions`, keyed by the seam (a shared seam's id; "<ns>:<seam id>"
// for a module seam). An organization's list replaces the default for that seam, and an empty list declines it. An
// exception with no risk acceptor, no end (a date or a milestone), or a contract its seam does not carry is not valid
// and does not apply (org/exception-valid reports it). Past its end it stops applying: a date that has passed, or a
// milestone reached. An end naming a milestone this build cannot see (another design's, in a design's own build) is
// taken as in force here and judged in the portfolio, which sees every design.
//
// Two modes. The portfolio passes every design composed (its compiled model, its own ids bare). A design's own build
// passes itself alone, with `own` set: its outside records (shared parts, the far ends of crossings at its edge) carry
// their home, and the far ends carry the marks the seam's exposure declares.

import type {
  ComposedDesign, CrossingJudgement, ExceptionInBuild, Mark, Marks, Model, Plan, Relationship, RootInput, Seam, SeamReport, SeamView, Severity,
} from "../types.ts";
import { parseRef, SHARED } from "./namespace.ts";
import { markSentence } from "./marks.ts";
import { exceptionEnded, readOrgView } from "./org.ts";
import { natCompare } from "./util.ts";

/** A design the seam rule reads: a ComposedDesign, or a design's own compiled state. */
export interface SeamDesign { namespace: string; title: string; model: Model; plan: Plan }

export interface SeamInput {
  root?: RootInput;
  designs: SeamDesign[];
  own?: string;                          // a design's own build: its namespace (designs holds it alone)
  marks?: Marks;
  marksAvailable?: boolean;              // false: no derivation reached this build (marks is then empty)
  today?: string;                        // the build date, YYYY-MM-DD
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) { const xs = v.filter((x) => x != null && String(x).trim()).map(String); return xs.length ? xs.join(" and ") : undefined; }
  const s = String(v).trim();
  return s ? s : undefined;
};

/** A reference in composed form: "<ns>:<id>", the kind dropped. */
const composedOf = (ns: string, id: string) => `${ns}:${id}`;
/** A design's canonical reference (own bare, the rest "<ns>:<id>") in composed form. */
export function designRef(ns: string, ref: string): string {
  const r = parseRef(ref);
  return r.ns === undefined ? composedOf(ns, ref) : composedOf(r.ns, r.id);
}
/** A reference written in the root (seams.yaml, org.yaml, a root patch) in composed form: bare is the shared layer's. */
export function rootRef(ref: string): string {
  const r = parseRef(ref);
  return r.ns === undefined || r.ns === SHARED ? composedOf(SHARED, r.id) : composedOf(r.ns, r.id);
}
const homeOf = (composed: string) => parseRef(composed).ns ?? SHARED;
const localOf = (composed: string) => parseRef(composed).id;

/** Every element a build can name, in composed form: its name, its home and the module it sits in. */
interface ElInfo { name: string; home: string; module?: string }

function elementIndex(input: SeamInput): Map<string, ElInfo> {
  const out = new Map<string, ElInfo>();
  for (const d of input.designs) for (const e of d.model.elements) {
    if (e.home) { if (!out.has(e.id)) out.set(e.id, { name: e.name, home: e.home }); continue; } // an outside record: its id is composed already
    const mod = e.attrs?.module;
    out.set(composedOf(d.namespace, e.id), { name: e.name, home: d.namespace, ...(typeof mod === "string" && mod ? { module: mod } : {}) });
  }
  const sh = input.root?.shared;
  for (const p of sh?.parts ?? []) { const k = composedOf(SHARED, p.id); if (!out.has(k)) out.set(k, { name: p.name, home: SHARED }); }
  for (const [k, n] of Object.entries(sh?.names ?? {})) { const c = rootRef(k); if (!out.has(c) && parseRef(k).ns) out.set(c, { name: n, home: homeOf(c) }); }
  return out;
}

/** How a home is named in a sentence. */
function homeTitle(input: Pick<SeamInput, "designs" | "root">, ns: string): string {
  if (ns === SHARED) return "the shared layer";
  return input.designs.find((d) => d.namespace === ns)?.title ?? input.root?.shared?.names[ns] ?? ns;
}

/** A module seam's sides: which side of the seam an own part sits on, or undefined when it sits on neither. */
function sideOf(sm: Seam, module: string | undefined): string | undefined {
  const sides = sm.between;
  if (sides.length !== 2) return undefined;
  for (const s of sides) if (s !== "core" && module === s) return s;
  // "core" is the rest of the design: every part not in the seam's module side(s)
  if (sides.includes("core")) return "core";
  return undefined;
}

type Pending = Omit<CrossingJudgement, "severity" | "excepted_by" | "exception" | "mark">;

/** Every crossing the build can see, with whether it is declared; seams assigned below. */
function findCrossings(input: SeamInput, els: Map<string, ElInfo>, notes: string[]): Pending[] {
  const out: Pending[] = [];
  const composedNs = new Set(input.designs.map((d) => d.namespace));
  const nameOf = (c: string) => els.get(c)?.name ?? localOf(c);
  // (a) the shared layer's crossings: declared, because the shared layer holds them whole
  for (const x of input.root?.shared?.crossings ?? []) {
    const from = rootRef(x.from), to = rootRef(x.to);
    const homes = [homeOf(from), homeOf(to)];
    if (homes[0] === homes[1]) continue; // not a crossing
    if (input.own) { if (!homes.includes(input.own)) continue; }
    else {
      const missing = homes.filter((h) => h !== SHARED && !composedNs.has(h));
      if (missing.length) { notes.push(`The shared layer's crossing ${x.id} names ${missing.join(" and ")}, which this portfolio does not compose; it is skipped here.`); continue; }
    }
    out.push({
      id: composedOf(SHARED, x.id), rel: x.id, home: SHARED, from, to, fromName: nameOf(from), toName: nameOf(to), kind: x.kind,
      ...(x.label ? { label: x.label } : {}), carries: (x.carries ?? []).map(rootRef), seams: [], declared: true, declaredBy: "shared layer",
    });
  }
  for (const d of input.designs) {
    const own = (r: Relationship) => !r.home;
    // (b) a design's own relationship whose ends have different homes: undeclared, since only the shared layer declares one
    for (const r of d.model.relationships.filter(own)) {
      const from = designRef(d.namespace, r.from), to = designRef(d.namespace, r.to);
      const homes = [homeOf(from), homeOf(to)];
      if (homes[0] === homes[1]) continue;
      const other = homes.find((h) => h !== d.namespace) ?? homes[1];
      out.push({
        id: composedOf(d.namespace, r.id), rel: r.id, home: d.namespace, from, to, fromName: nameOf(from), toName: nameOf(to), kind: r.kind,
        ...(r.label ? { label: r.label } : {}), carries: (r.carries ?? []).map((c) => designRef(d.namespace, c)), seams: [], declared: false,
        why: other === SHARED ? "the shared layer does not hold it" : `it names ${homeTitle(input, other)} from inside ${d.title}, and only the shared layer holds a crossing between two designs`,
      });
    }
    // (c) module crossings: an own relationship with one end on each side of one of the design's module seams
    const seams = d.model.seams ?? [];
    if (!seams.length) continue;
    const byId = new Map(d.model.elements.filter((e) => !e.home).map((e) => [e.id, e]));
    for (const r of d.model.relationships.filter(own)) {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) continue;
      const carries = (r.carries ?? []).map((c) => designRef(d.namespace, c));
      const crossed: { key: string; named: boolean; missing: string[]; name: string }[] = [];
      for (const sm of seams) {
        const sa = sideOf(sm, a.attrs?.module as string | undefined), sb = sideOf(sm, b.attrs?.module as string | undefined);
        if (!sa || !sb || sa === sb) continue;
        const named = (sm.crossings ?? []).find((x) => x.id === r.id);
        const namedCarries = new Set((named?.carries ?? []).map((c) => designRef(d.namespace, c)));
        crossed.push({ key: composedOf(d.namespace, sm.id), named: !!named, missing: named ? carries.filter((c) => !namedCarries.has(c)) : carries, name: str(sm.attrs?.name) ?? sm.id });
      }
      if (!crossed.length) continue;
      const declared = crossed.every((c) => c.named && !c.missing.length);
      const from = composedOf(d.namespace, r.from), to = composedOf(d.namespace, r.to);
      const whys = crossed.filter((c) => !c.named || c.missing.length).map((c) => (!c.named
        ? `the module seam ${c.name} (${c.key}) does not name it`
        : `the module seam ${c.name} (${c.key}) names it without ${c.missing.map(localOf).join(" and ")}`));
      out.push({
        id: composedOf(d.namespace, r.id), rel: r.id, home: d.namespace, from, to, fromName: nameOf(from), toName: nameOf(to), kind: r.kind,
        ...(r.label ? { label: r.label } : {}), carries, seams: crossed.map((c) => c.key), declared,
        ...(declared ? { declaredBy: "module seam" as const } : { why: whys.join("; ") }),
      });
    }
  }
  return out.sort((x, y) => natCompare(x.id, y.id));
}

/**
 * The exceptions each seam takes, as src/core/org.ts reads them (the organization's list where it declares one, else
 * the shipped default; valid or not), with their state on the build date.
 */
function exceptionsBySeam(input: SeamInput, notes: string[]): Record<string, ExceptionInBuild[]> {
  if (!input.root) return {};
  const compose = input.designs as unknown as ComposedDesign[]; // what org.ts reads of them: namespace, model and plan
  const view = readOrgView(input.root, { ...(input.today ? { today: input.today } : {}), compose });
  const out: Record<string, ExceptionInBuild[]> = {};
  for (const [key, list] of Object.entries(view?.exceptions ?? {})) out[key] = list.map((ex): ExceptionInBuild => {
    if (!ex.valid) return { ...ex, state: "not applied", judged: true };
    const end = ex.until && !DATE.test(ex.until) ? parseRef(ex.until) : undefined;
    const judged = !end?.ns || input.designs.some((d) => d.namespace === end.ns);
    if (!judged) notes.push(`The ${ex.source === "org" ? "organization's" : "default"} exception on ${key} ends at ${end!.ns}:${end!.id}, which this build ${input.own ? "cannot see" : "does not compose"}; it is taken as in force${input.own ? " here and judged in the portfolio" : ""}.`);
    return { ...ex, state: exceptionEnded(ex, input.today, compose) ? "ended" : "in force", judged };
  });
  return out;
}

/** Judge every crossing a build can see: declared or not, its mark, the exceptions in force and the seam rule's severity. */
export function seamReport(input: SeamInput): SeamReport {
  const notes: string[] = [];
  const els = elementIndex(input);
  const pending = findCrossings(input, els, notes);
  // seams: the shared layer's (between two homes), then each design's module seams
  type Entry = { view: SeamView; seam: Seam; design?: SeamDesign };
  const entries: Entry[] = [];
  for (const sm of input.root?.shared?.seams ?? []) {
    if (input.own && !sm.between.includes(input.own)) continue;
    entries.push({ seam: sm, view: { key: sm.id, id: sm.id, kind: "shared", between: [...sm.between], ...seamWords(sm), crossings: [], undeclared: [], exceptions: [] } });
  }
  for (const d of input.designs) for (const sm of d.model.seams ?? [])
    entries.push({ seam: sm, design: d, view: { key: composedOf(d.namespace, sm.id), id: sm.id, kind: "module", design: d.namespace, between: [...sm.between], ...seamWords(sm), crossings: [], undeclared: [], exceptions: [] } });
  const byKey = new Map(entries.map((e) => [e.view.key, e]));
  // a crossing between two homes sits on every shared seam between exactly those two homes
  for (const c of pending) {
    if (c.seams.length) continue; // a module crossing knows its seams
    const homes = new Set([homeOf(c.from), homeOf(c.to)]);
    for (const e of entries) if (e.view.kind === "shared" && e.seam.between.length === 2 && e.seam.between.every((b) => homes.has(b)) && homes.size === 2) c.seams.push(e.view.key);
  }
  const exceptions = exceptionsBySeam(input, notes);
  for (const e of entries) e.view.exceptions = exceptions[e.view.key] ?? [];

  const available = input.marksAvailable ?? !!input.marks;
  const judged: CrossingJudgement[] = pending.map((c) => {
    const mark: Mark | undefined = input.marks?.crossings[c.id];
    const out: CrossingJudgement = { ...c, ...(mark ? { mark } : {}) };
    if (c.declared) return out;
    const relevant = mark ? mark.relevant : true; // no derivation, or none for this crossing: fail closed
    let severity: Severity = relevant ? "error" : "warning";
    if (relevant && c.carries.length) {
      const ex = c.seams.flatMap((k) => byKey.get(k)?.view.exceptions ?? []).find((x) => x.state === "in force" && c.carries.every((k) => x.contracts.includes(k)));
      if (ex) { severity = "warning"; out.excepted_by = `${ex.source === "org" ? "org" : "default"} exception on ${ex.seam}`; out.exception = ex; }
    }
    out.severity = severity;
    return out;
  });
  for (const c of judged) for (const k of c.seams) { const v = byKey.get(k)?.view; if (v) (c.declared ? v.crossings : v.undeclared).push(c.id); }
  const rank = (c: CrossingJudgement) => (c.severity === "error" ? 0 : (c.mark?.relevant ?? true) ? 1 : 2);
  const undeclared = judged.filter((c) => !c.declared).sort((a, b) => rank(a) - rank(b) || natCompare(a.id, b.id));
  const order = new Map(undeclared.map((c, i) => [c.id, i]));
  for (const e of entries) e.view.undeclared.sort((a, b) => order.get(a)! - order.get(b)!);
  return { seams: entries.map((e) => e.view), crossings: judged, undeclared, marksAvailable: available, notes };
}

function seamWords(sm: Seam): Partial<SeamView> {
  const name = str(sm.attrs?.name);
  return { ...(name ? { name } : {}), ...(sm.owner_role ? { owner_role: sm.owner_role } : {}), ...(sm.checks ? { checks: [...sm.checks] } : {}), ...(sm.never_cross ? { never_cross: sm.never_cross.map(rootRef) } : {}) };
}

/** The seam rule's message for one undeclared crossing, in plain words. */
export function crossingSentence(c: CrossingJudgement, input: Pick<SeamInput, "designs" | "root">): string {
  const what = c.carries.length ? c.carries.map(localOf).join(" and ") : "no contract";
  const sides = [...new Set([homeOf(c.from), homeOf(c.to)])].sort((a, b) => Number(a === SHARED) - Number(b === SHARED)); // a design before the shared layer
  const where = sides.length === 1
    ? `across ${c.seams.length === 1 ? "a module seam" : "module seams"} of ${homeTitle(input, c.home)}`
    : `between ${sides.map((h) => homeTitle(input, h)).join(" and ")}`;
  const head = `Relationship ${c.rel} carries ${what} from ${c.fromName} to ${c.toName}, ${where}, and nothing declares it: ${c.why ?? "it is not declared"}.`;
  const mark = markSentence(c.mark);
  if (c.exception) {
    const ex = c.exception;
    const end = ex.until ? ` until ${ex.until}` : "";
    return `${head} ${mark}; the ${ex.source === "org" ? "organization's" : "default"} exception on ${ex.seam}, accepted by ${ex.accepted_by}${end}, makes it a warning.`;
  }
  return `${head} ${mark}.`;
}

