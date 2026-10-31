// The shared root: one folder at the root of the import graph. Its engine.yaml says
// kind: root; seams.yaml (and manual-work.yaml when the catalog is its own file) holds the shared layer, namespace
// `shared`, as the editions ship it; org.yaml, optional, holds the org layer, namespace `org`; team-map.yaml maps every
// owner string and role to teams; patches/ holds the organization's changes to either namespace; notes.yaml pins notes
// to records of either. Reading resolves namespaces, applies patches and retains the team map, notes and hashes.
// Reading never throws on content: what it cannot read is a problem in words, kept on
// the result.
//
// Patches: nobody edits seams.yaml, and agents never edit org.yaml. Changes arrive as patches in <root>/patches/, in
// the shape of an instance's patches, and the accepted ones apply in natural id order when the root loads, so every
// design that imports the root, and the root's own build, read the layers as patched. The kind says the namespace:
// team, activity, slowdown and exception are the org layer's; element (a shared part), relationship (a crossing),
// contract, capability, seam, system, zone, claim and manual-work are the shared layer's. An op's id may be written
// bare or with its namespace. A modify's `set` replaces each field it names (a set replaces a whole estimate), except
// `security` on a contract or crossing, whose keys merge into the record's mark, so a raise adds to it. `root.shipped`
// keeps the shared layer exactly as the file holds it: shared/file-intact, the shipped floor and a stale shared file
// all read the file, never the patches. An exception record is a seam's list of exceptions, keyed by the seam: add
// `{ seam, exceptions: [...] }` declares the organization's list for that seam (replacing the shipped default; an
// empty list declines it), add `{ seam, contracts, accepted_by, until, why }` appends one exception to it, modify
// `<seam>` with `set: { exceptions: [...] }` replaces the list, and remove `<seam>` lets the default apply again.
//
// Inside seams.yaml the shared layer's own records are named bare (or `shared:<id>`); a design's records are always
// namespaced (`premerge:s1.x`). The reader keeps references as written; src/core/resolve.ts puts them in canonical form
// for each design that imports the root.
//
// Key names, with the alternatives the reader also accepts (alternate names are accepted):
//   systems; zones (trust_zones); parts (elements); contracts; crossings (relationships); capabilities; seams;
//   manual_work (manual-work); claims; names. Every other top-level key is kept in `extra`, untouched.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Claim, Finding, ManualWork, OrgKind, OrgLayer, OrgRecord, Patch, RootApplyResult, RootConfig, RootInput, RootKind, RootLoadOptions,
  Seam, SharedCapability, SharedKind, SharedLayer, ExposureEntry, Team,
} from "../types.ts";
import { normClaim, normContract, normElement, normNamed, normPatch, normRelationship, patchKey, patchProblem } from "./load.ts";
import { NOTE_TARGET_KINDS, parseNotes, notesVersion } from "./notes.ts";
import { readTeamMap } from "./teams.ts";
import { ORG, parseRef, SHARED } from "./namespace.ts";
import { canonicalJson, clone, natCompare, sha256 } from "./util.ts";

type Raw = Record<string, unknown>;
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as unknown[]).filter((x): x is Raw => !!x && typeof x === "object" && !Array.isArray(x)) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => x !== undefined && x !== null).map(String) : v === undefined || v === null ? [] : [String(v)]);
const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

function readYamlFile(path: string): { raw?: unknown; bytes?: string; problem?: string } {
  if (!existsSync(path)) return {};
  const bytes = readFileSync(path, "utf8");
  try { return { raw: Bun.YAML.parse(bytes), bytes }; } catch (e) { return { bytes, problem: `YAML parse error: ${(e as Error).message}` }; }
}

/** Is this folder a shared root (its engine.yaml says kind: root)? */
export function isRootDir(dir: string): boolean {
  const r = readYamlFile(join(dir, "engine.yaml")).raw as Raw | undefined;
  return !!r && typeof r === "object" && r.kind === "root";
}

/** The sha256 of a file's bytes, or undefined when it is not there. */
export function fileSha256(path: string): string | undefined {
  return existsSync(path) ? new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex") : undefined;
}

function exposureOf(v: unknown): Record<string, ExposureEntry[]> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, ExposureEntry[]> = {};
  for (const [side, xs] of Object.entries(v as Raw)) {
    out[side] = (Array.isArray(xs) ? xs : [xs]).flatMap((x): ExposureEntry[] => {
      if (typeof x === "string") return [{ part: x, marks: { agent_reachable: true } }];
      if (x && typeof x === "object" && !Array.isArray(x) && (x as Raw).part != null) {
        // { part, <marks> } as written, or { part, marks: {...} } as read (a patch re-reads a seam it changes)
        const { part, marks: m, ...rest } = x as Raw;
        const marks = isMap(m) ? { ...m, ...rest } : m === undefined ? rest : { marks: m, ...rest };
        return [{ part: String(part), marks: Object.keys(marks).length ? marks : { agent_reachable: true } }];
      }
      return [];
    });
  }
  return out;
}

export function normSeam(r: Raw): Seam {
  const known = ["id", "between", "owner_role", "checks", "never_cross", "exposure", "default_exceptions", "crossings", "attrs"];
  const attrs: Raw = { ...((r.attrs && typeof r.attrs === "object" && !Array.isArray(r.attrs)) ? r.attrs as Raw : {}) };
  for (const [k, v] of Object.entries(r)) if (!known.includes(k)) attrs[k] = v;
  const s: Seam = { id: String(r.id), between: strs(r.between) };
  if (r.owner_role != null) s.owner_role = String(r.owner_role);
  if (r.checks != null) s.checks = strs(r.checks);
  if (r.never_cross != null) s.never_cross = strs(r.never_cross);
  const ex = exposureOf(r.exposure); if (ex) s.exposure = ex;
  if (Array.isArray(r.default_exceptions)) s.default_exceptions = r.default_exceptions;
  if (Array.isArray(r.crossings)) s.crossings = list(r.crossings).map((c) => ({ id: String(c.id), ...(c.carries != null ? { carries: strs(c.carries) } : {}) }));
  if (Object.keys(attrs).length) s.attrs = attrs;
  return s;
}

export function normCapability(r: Raw): SharedCapability {
  return { id: String(r.id), ...(r.name != null ? { name: String(r.name) } : {}), provided_by: strs(r.provided_by), required_by: strs(r.required_by) };
}

export function normManualWork(r: Raw): ManualWork {
  return { id: String(r.id), name: str(r.name) ?? String(r.id), ...(r.description != null ? { description: String(r.description) } : {}), ...(r.flow_item != null ? { flow_item: String(r.flow_item) } : {}) };
}

function namesOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) { for (const x of list(v)) if (x.id != null && x.name != null) out[String(x.id)] = String(x.name); }
  else if (v && typeof v === "object") for (const [k, n] of Object.entries(v as Raw)) if (n != null) out[k] = String(n);
  return out;
}

const SHARED_KEYS = ["namespace", "version", "schema", "systems", "zones", "trust_zones", "parts", "elements", "contracts", "crossings", "relationships", "capabilities", "seams", "manual_work", "manual-work", "claims", "names"];

/** A premise register's rests_on describes the records relying on it, rather than other claims it relies on. */
function registerClaim(r: Raw): Claim {
  if (r.strength === undefined || ["evidence", "inference", "judgment", "untested"].includes(String(r.grade))) return normClaim(r);
  const untested = r.verdict !== "holds" && r.verdict !== "drop" && /\b(none|weak)\b/.test(String(r.strength));
  const grade = untested ? "untested" : /\b(moderate|strong)\b/.test(String(r.strength)) ? "evidence" : /practice|organizational/.test(String(r.type)) ? "judgment" : "inference";
  const { rests_on, ...rest } = r;
  return normClaim({ ...rest, grade, kind: r.verdict === "drop" ? "claim" : "premise", source: "Shared premise register (seams.yaml)", fallback: r.if_it_flips,
    attrs: { ...(isMap(r.attrs) ? r.attrs : {}), ...(rests_on ? { rests_on_records: rests_on } : {}), ...(r.grade ? { shipped_grade: r.grade } : {}) } });
}

/** Read <root>/seams.yaml (and <root>/manual-work.yaml when present) as the shared layer, as the files hold it. */
export function loadShared(rootDir: string): SharedLayer | undefined {
  const f = readYamlFile(join(rootDir, "seams.yaml"));
  if (f.bytes === undefined) return undefined;
  const problems: string[] = [];
  if (f.problem) problems.push(`seams.yaml: ${f.problem}`);
  const r = (f.raw && typeof f.raw === "object" && !Array.isArray(f.raw) ? f.raw : {}) as Raw;
  if (f.raw !== undefined && f.raw !== null && (typeof f.raw !== "object" || Array.isArray(f.raw))) problems.push("seams.yaml: must be a mapping");
  const schema = r.schema && typeof r.schema === "object" && !Array.isArray(r.schema) ? r.schema as SharedLayer["schema"] : undefined;
  const layer: SharedLayer = {
    file: "seams.yaml", sha256: fileSha256(join(rootDir, "seams.yaml"))!, namespace: str(r.namespace) ?? "shared", ...(r.version != null ? { version: String(r.version) } : {}), ...(schema ? { schema } : {}),
    systems: list(r.systems).map(normNamed), zones: [...list(r.zones), ...list(r.trust_zones)].map(normNamed),
    parts: [...list(r.parts), ...list(r.elements)].map((p) => normElement({ ...p, ...(p.zone === undefined && p.trust_zone ? { zone: p.trust_zone } : {}), ...(p.description === undefined && p.responsibility ? { description: p.responsibility } : {}) })),
    contracts: list(r.contracts).map(normContract),
    crossings: [...list(r.crossings), ...list(r.relationships)].map(normRelationship),
    capabilities: list(r.capabilities).map(normCapability),
    seams: list(r.seams).map(normSeam),
    manual_work: [...list(r.manual_work), ...list(r["manual-work"])].map(normManualWork),
    claims: list(r.claims).map(registerClaim),
    names: namesOf(r.names),
    extra: Object.fromEntries(Object.entries(r).filter(([k]) => !SHARED_KEYS.includes(k))),
    problems,
  };
  for (const c of list(r.claims)) {
    const ro = isMap(c.rests_on) ? c.rests_on : undefined;
    for (const ref of strs(ro?.parts)) {
      const id = parseRef(ref);
      if (id.ns && id.ns !== SHARED) continue;
      const p = layer.parts.find((x) => x.id === id.id);
      if (p) p.rests_on = [...new Set([...(p.rests_on ?? []), String(c.id)])];
    }
  }
  const mw = readYamlFile(join(rootDir, "manual-work.yaml"));
  if (mw.bytes !== undefined) {
    if (mw.problem) problems.push(`manual-work.yaml: ${mw.problem}`);
    const m = mw.raw as unknown;
    const items = Array.isArray(m) ? list(m) : m && typeof m === "object" ? [...list((m as Raw).manual_work), ...list((m as Raw)["manual-work"]), ...list((m as Raw).kinds)] : [];
    layer.manual_work.push(...items.map(normManualWork));
    layer.manualWorkFile = { file: "manual-work.yaml", sha256: fileSha256(join(rootDir, "manual-work.yaml"))! };
  }
  return layer;
}

// ---------- the org layer ----------

const ORG_KEYS = ["namespace", "teams", "activities", "slowdowns", "seam_exceptions"];

/** org.yaml as written: every record raw, so a patch changes it as written and src/core/org.ts reads it once. */
interface OrgRaw { file: string; sha256: string; teams: Raw[]; activities: Raw[]; slowdowns: Raw[]; seam_exceptions: Record<string, unknown[]>; extra: Raw; problems: string[] }

function readOrgRaw(rootDir: string): OrgRaw | undefined {
  const f = readYamlFile(join(rootDir, "org.yaml"));
  if (f.bytes === undefined) return undefined;
  const problems: string[] = [];
  if (f.problem) problems.push(`org.yaml: ${f.problem}`);
  const r = (f.raw && typeof f.raw === "object" && !Array.isArray(f.raw) ? f.raw : {}) as Raw;
  const se: Record<string, unknown[]> = {};
  if (r.seam_exceptions && typeof r.seam_exceptions === "object" && !Array.isArray(r.seam_exceptions))
    for (const [k, v] of Object.entries(r.seam_exceptions as Raw)) se[k] = Array.isArray(v) ? v : [];
  const withId = (xs: Raw[], what: string) => xs.filter((x) => { if (x.id == null) { problems.push(`org.yaml: a ${what} has no id, so nothing can name it; it is skipped`); return false; } return true; });
  return {
    file: "org.yaml", sha256: fileSha256(join(rootDir, "org.yaml"))!,
    teams: withId(list(r.teams), "team"), activities: withId(list(r.activities), "activity"), slowdowns: withId(list(r.slowdowns), "slowdown"), seam_exceptions: se,
    extra: Object.fromEntries(Object.entries(r).filter(([k]) => !ORG_KEYS.includes(k))),
    problems,
  };
}

const emptyOrg = (): OrgRaw => ({ file: "org.yaml", sha256: "", teams: [], activities: [], slowdowns: [], seam_exceptions: {}, extra: {}, problems: [] });

/** The org layer from its raw records: teams as a design's model holds them (id, name, description, lead), the rest in attrs. */
function orgLayerOf(o: OrgRaw): OrgLayer {
  const rec = (x: Raw): OrgRecord => ({ ...x, id: String(x.id) });
  return {
    file: o.file, sha256: o.sha256,
    teams: o.teams.map((t) => {
      const { id, name, description, lead, ...rest } = t;
      return { ...normNamed({ id, name, description, lead }), ...(Object.keys(rest).length ? { attrs: rest } : {}) } as Team;
    }),
    activities: o.activities.map(rec), slowdowns: o.slowdowns.map(rec), seam_exceptions: o.seam_exceptions,
    extra: o.extra, problems: o.problems,
  };
}

/** Read <root>/org.yaml as the org layer, as written (no patches): its teams in full, its other records by id. */
export function loadOrg(rootDir: string): OrgLayer | undefined {
  const o = readOrgRaw(rootDir);
  return o ? orgLayerOf(o) : undefined;
}

// ---------- the root's patches ----------

export const ORG_KINDS: OrgKind[] = ["team", "activity", "slowdown", "exception"];
export const SHARED_KINDS: SharedKind[] = ["element", "relationship", "contract", "capability", "seam", "system", "zone", "claim", "manual-work"];
export const ROOT_KINDS: RootKind[] = [...ORG_KINDS, ...SHARED_KINDS];
/** The namespace a root record kind lives in. */
export const kindNs = (k: RootKind): "org" | "shared" => ((ORG_KINDS as string[]).includes(k) ? ORG : SHARED);

/** Read <root>/patches/*.yaml in natural order; a file that does not read is a core/patch-loads finding. */
function readRootPatches(dir: string, findings: Finding[]): Patch[] {
  const pdir = join(dir, "patches");
  if (!existsSync(pdir)) return [];
  const out: Patch[] = [];
  for (const f of readdirSync(pdir).filter((x) => /\.ya?ml$/.test(x)).sort(natCompare)) {
    const rel = `patches/${f}`;
    let raw: unknown;
    try { raw = Bun.YAML.parse(readFileSync(join(pdir, f), "utf8")); }
    catch (e) { findings.push(patchProblem(rel, `${rel}: YAML parse error: ${(e as Error).message}; the patch is skipped`)); continue; }
    if (raw === null || raw === undefined) raw = {};
    if (typeof raw !== "object" || Array.isArray(raw)) { findings.push(patchProblem(rel, `${rel}: a patch file must be a mapping (id, title, status, why, ops), not a ${Array.isArray(raw) ? "list" : typeof raw}; the patch is skipped`)); continue; }
    out.push(normPatch(raw as Raw, rel, findings));
  }
  out.sort((a, b) => natCompare(a.id, b.id) || natCompare(a.file ?? "", b.file ?? ""));
  const byId = new Map<string, Patch[]>();
  for (const p of out) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  for (const [id, ps] of byId) if (ps.length > 1)
    findings.push({ pack: "core", rule: "patch-ids-unique", severity: "error", at: id, atKind: "instance", message: `${ps.length} root patch files share the id "${id}" (${ps.map((p) => p.file ?? "?").join(", ")}); give each its own id` });
  return out;
}

/** The layers a root patch changes, as it works on them. */
interface Work { shared?: SharedLayer; org?: OrgRaw }

type AnyRec = Record<string, any>;
const NORM: Record<SharedKind, (r: Raw) => AnyRec> = {
  element: normElement, relationship: normRelationship, contract: normContract, capability: normCapability, seam: normSeam,
  system: normNamed, zone: normNamed, claim: normClaim, "manual-work": normManualWork,
};

function sharedTable(l: SharedLayer, k: SharedKind): { arr: AnyRec[]; key: "id" | "name" } {
  switch (k) {
    case "element": return { arr: l.parts, key: "id" };
    case "relationship": return { arr: l.crossings, key: "id" };
    case "contract": return { arr: l.contracts, key: "name" };
    case "capability": return { arr: l.capabilities, key: "id" };
    case "seam": return { arr: l.seams, key: "id" };
    case "system": return { arr: l.systems, key: "id" };
    case "zone": return { arr: l.zones, key: "id" };
    case "claim": return { arr: l.claims, key: "id" };
    case "manual-work": return { arr: l.manual_work, key: "id" };
  }
}

/** A modify's `set` over a normalized shared record: unknown keys land in attrs (as the loader puts them), `security` merges. */
function mergeShared(kind: SharedKind, cur: AnyRec, set: Raw): AnyRec {
  const merged: AnyRec = { ...cur, ...clone(set), attrs: { ...(cur.attrs ?? {}), ...(isMap(set.attrs) ? clone(set.attrs) : {}) } };
  if ((kind === "contract" || kind === "relationship") && isMap(set.security)) {
    const prior = isMap(cur.attrs?.security) ? cur.attrs.security as Raw : {};
    merged.security = { ...prior, ...set.security };
  }
  for (const k of Object.keys(set)) if (set[k] === null) { delete merged[k]; if (merged.attrs) delete merged.attrs[k]; }
  return NORM[kind](merged);
}

const article = (w: string) => (/^[aeiou]/.test(w) ? "an" : "a");

/**
 * An op's id, written bare or with its kind's namespace; another namespace is an error. An exception record's id is
 * the seam it is keyed by: a shared seam's id (bare, or shared:<id>), or <namespace>:<seam id> for a module seam.
 */
function opId(raw: unknown, kind: RootKind): { id?: string; problem?: string } {
  if (raw === undefined || raw === null || raw === "") return { problem: "names no id" };
  const r = parseRef(String(raw));
  if (kind === "exception") return { id: r.ns === SHARED || r.ns === ORG ? r.id : String(raw) };
  if (r.ns === undefined) return { id: String(raw) };
  const ns = kindNs(kind);
  if (r.ns !== ns) return { problem: `names ${String(raw)}, but ${article(kind)} ${kind} lives in the ${ns} layer` };
  return { id: r.id };
}

/** Every top-level field an op set, for the history of estimates. */
function fieldsSet(kind: RootKind, id: string, v: Raw, op: "add" | "modify"): RootApplyResult["sets"] {
  const skip = kind === "contract" ? ["name", "id"] : ["id"];
  return Object.keys(v).filter((k) => !skip.includes(k)).map((field) => ({ kind, id, field, value: clone(v[field]), op }));
}

/** Apply one root patch to the working layers in place. Ops that cannot apply are skipped and reported in errors. */
export function applyRootPatch(w: Work, patch: Patch): RootApplyResult {
  const r: RootApplyResult = { added: [], removed: [], modified: [], cascade: [], errors: [], sets: [], namespaces: [] };
  const nsSeen = new Set<"shared" | "org">();
  let created = false;
  patch.ops.forEach((op, i) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) { r.errors.push(`${patch.id} op ${i + 1}: an op must be a mapping like {op: modify, kind: activity, id: ..., set: {...}}, not ${JSON.stringify(op)}`); return; }
    const o = op as unknown as AnyRec;
    const where = `${patch.id} op ${i + 1} (${o.op} ${o.kind})`;
    const kind = o.kind as RootKind;
    if (!(ROOT_KINDS as string[]).includes(String(o.kind))) {
      r.errors.push(`${where}: a root patch changes the org layer (${ORG_KINDS.join(", ")}) or the shared layer (${SHARED_KINDS.join(", ")}), not ${JSON.stringify(o.kind)}${["unit", "phase", "view"].includes(String(o.kind)) ? `: a ${o.kind} belongs to a design, so its patch goes in that design's folder` : ""}`);
      return;
    }
    const ns = kindNs(kind);
    if (ns === SHARED && !w.shared) { r.errors.push(`${where}: the root has no shared layer (seams.yaml), so there is no ${kind} to change`); return; }
    if (ns === ORG && !w.org) { w.org = emptyOrg(); created = true; } // an org patch can bring the org layer into being (bun plumb.ts migrate --root moves teams this way)
    nsSeen.add(ns);
    if (o.op === "add") {
      const v = o.value as Raw | undefined;
      if (!isMap(v)) { r.errors.push(`${where}: add needs a value`); return; }
      if (kind === "exception") return addException(w.org!, v, where, r);
      const rec: AnyRec = ns === SHARED ? NORM[kind as SharedKind](kind === "contract" && v.name === undefined ? { ...v, name: v.id } : v) : { ...v, ...(v.id != null ? { id: String(v.id) } : {}) };
      const key = kind === "contract" ? "name" : "id";
      const idw = opId(rec[key], kind);
      if (!idw.id) { r.errors.push(`${where}: the value ${idw.problem === "names no id" ? `has no ${key}` : idw.problem}`); return; }
      rec[key] = idw.id;
      const arr = ns === SHARED ? sharedTable(w.shared!, kind as SharedKind).arr : orgTable(w.org!, kind as Exclude<OrgKind, "exception">);
      if (arr.some((x) => String(x[key]) === idw.id)) { r.errors.push(`${where}: ${kind} "${idw.id}" already exists`); return; }
      arr.push(rec);
      r.added.push({ kind, id: idw.id });
      r.sets.push(...fieldsSet(kind, idw.id, v, "add"));
    } else if (o.op === "modify") {
      const set = o.set as Raw | undefined;
      if (!isMap(set)) { r.errors.push(`${where}: modify needs \`set\`, a mapping of the fields to change${set === undefined ? "" : `, not ${JSON.stringify(set)}`}`); return; }
      const idw = opId(o.id, kind);
      if (!idw.id) { r.errors.push(`${where}: ${idw.problem}`); return; }
      if (kind === "exception") {
        if (!(idw.id in w.org!.seam_exceptions)) { r.errors.push(`${where}: the org layer declares no exceptions for the seam "${idw.id}"; add them instead`); return; }
        if (!Array.isArray(set.exceptions)) { r.errors.push(`${where}: an exception record is its seam's list, so modify sets exceptions: [ ... ] (an empty list declines the shipped default)`); return; }
        w.org!.seam_exceptions[idw.id] = clone(set.exceptions);
        r.modified.push({ kind, id: idw.id, fields: ["exceptions"] });
        r.sets.push({ kind, id: idw.id, field: "exceptions", value: clone(set.exceptions), op: "modify" });
        return;
      }
      const key = kind === "contract" ? "name" : "id";
      const arr = ns === SHARED ? sharedTable(w.shared!, kind as SharedKind).arr : orgTable(w.org!, kind as Exclude<OrgKind, "exception">);
      const idx = arr.findIndex((x) => String(x[key]) === idw.id);
      if (idx < 0) { r.errors.push(`${where}: unknown ${kind} "${idw.id}"`); return; }
      if (set[key] !== undefined && String(set[key]) !== idw.id) { r.errors.push(`${where}: modify cannot change the ${key} of "${idw.id}"; remove and add instead`); return; }
      if (ns === SHARED) arr[idx] = mergeShared(kind as SharedKind, arr[idx], set);
      else {
        const merged: AnyRec = { ...arr[idx], ...clone(set) };
        for (const k of Object.keys(set)) if (set[k] === null) delete merged[k];
        arr[idx] = merged;
      }
      r.modified.push({ kind, id: idw.id, fields: Object.keys(set).sort(natCompare) });
      r.sets.push(...fieldsSet(kind, idw.id, set, "modify"));
    } else if (o.op === "remove") {
      const idw = opId(o.id, kind);
      if (!idw.id) { r.errors.push(`${where}: ${idw.problem}`); return; }
      if (kind === "exception") {
        if (!(idw.id in w.org!.seam_exceptions)) { r.errors.push(`${where}: the org layer declares no exceptions for the seam "${idw.id}"`); return; }
        delete w.org!.seam_exceptions[idw.id];
        r.removed.push({ kind, id: idw.id });
        return;
      }
      const key = kind === "contract" ? "name" : "id";
      const arr = ns === SHARED ? sharedTable(w.shared!, kind as SharedKind).arr : orgTable(w.org!, kind as Exclude<OrgKind, "exception">);
      const idx = arr.findIndex((x) => String(x[key]) === idw.id);
      if (idx < 0) { r.errors.push(`${where}: unknown ${kind} "${idw.id}"`); return; }
      arr.splice(idx, 1);
      r.removed.push({ kind, id: idw.id });
      if (kind === "element") cascadePart(w.shared!, idw.id, r);
    } else r.errors.push(`${where}: unknown op "${o.op}"; expected add, modify or remove`);
  });
  const ord = (a: { kind: string; id: string }, b: { kind: string; id: string }) => natCompare(a.kind, b.kind) || natCompare(a.id, b.id);
  r.added.sort(ord); r.removed.sort(ord); r.modified.sort(ord); r.cascade.sort(ord);
  r.namespaces = [...nsSeen].sort();
  // an org layer that this patch brought into being and left empty (every op on it failed) is no org layer
  if (created && w.org && !w.org.teams.length && !w.org.activities.length && !w.org.slowdowns.length && !Object.keys(w.org.seam_exceptions).length) delete w.org;
  return r;
}

function orgTable(o: OrgRaw, k: Exclude<OrgKind, "exception">): Raw[] {
  return k === "team" ? o.teams : k === "activity" ? o.activities : o.slowdowns;
}

/** add exception: `{ seam, exceptions: [...] }` declares the seam's list; `{ seam, contracts, ... }` appends one to it. */
function addException(o: OrgRaw, v: Raw, where: string, r: RootApplyResult): void {
  const written = str(v.seam)?.trim();
  const seam = written ? opId(written, "exception").id : undefined;
  if (!seam) { r.errors.push(`${where}: an exception names its seam (seam: <seam id>, or <namespace>:<seam id> for a module seam)`); return; }
  if (Array.isArray(v.exceptions)) {
    if (seam in o.seam_exceptions) { r.errors.push(`${where}: the org layer already declares exceptions for the seam "${seam}"; modify them instead`); return; }
    o.seam_exceptions[seam] = clone(v.exceptions);
    r.added.push({ kind: "exception", id: seam });
    r.sets.push({ kind: "exception", id: seam, field: "exceptions", value: clone(v.exceptions), op: "add" });
    return;
  }
  const { seam: _s, ...one } = v;
  const had = seam in o.seam_exceptions;
  (o.seam_exceptions[seam] ??= []).push(clone(one));
  if (had) r.modified.push({ kind: "exception", id: seam, fields: ["exceptions"] });
  else r.added.push({ kind: "exception", id: seam });
  r.sets.push({ kind: "exception", id: seam, field: "exceptions", value: clone(o.seam_exceptions[seam]), op: "add" });
}

/** Removing a shared part removes the crossings that touch it and drops it from contracts' producers and consumers. */
function cascadePart(l: SharedLayer, id: string, r: RootApplyResult): void {
  const names = new Set([id, `${SHARED}:${id}`]);
  const because = `shared part ${id} was removed`;
  const gone = l.crossings.filter((x) => names.has(x.from) || names.has(x.to));
  if (gone.length) {
    l.crossings = l.crossings.filter((x) => !gone.includes(x));
    for (const g of gone) r.cascade.push({ kind: "relationship", id: g.id, because: `${because}; the crossing touched it` });
  }
  for (const c of l.contracts) {
    const p = c.produced_by?.some((x) => names.has(x)), q = c.consumed_by?.some((x) => names.has(x));
    if (p) c.produced_by = c.produced_by!.filter((x) => !names.has(x));
    if (q) c.consumed_by = c.consumed_by!.filter((x) => !names.has(x));
    if (p || q) r.cascade.push({ kind: "contract", id: c.name, because: `${because}; it was listed as a ${p ? "producer" : "consumer"}${p && q ? " and consumer" : ""}` });
  }
}

// ---------- notes on the root ----------

/** The kinds a note in the root may be pinned to, and the namespace each lives in. */
export const ROOT_NOTE_KINDS: Record<string, "shared" | "org" | ""> = {
  element: SHARED, relationship: SHARED, contract: SHARED, claim: SHARED, seam: SHARED, capability: SHARED, system: SHARED, zone: SHARED, "manual-work": SHARED,
  team: ORG, activity: ORG, slowdown: ORG, exception: ORG,
  patch: "", finding: "",
};

/** <root>/notes.yaml, with each target canonical: "org:<id>" for an org record, "shared:<id>" for a shared one. */
export function loadRootNotes(dir: string): RootInput["notes"] {
  const path = join(dir, "notes.yaml");
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const parsed = parseNotes(text);
  // the notes reader knows a design's target kinds; the root's own ones are checked here instead
  const kindIn = (p: string) => /target kind "([^"]+)" is not one of/.exec(p)?.[1];
  const problems = parsed.problems.filter((p) => { const k = kindIn(p); return !k || !(k in ROOT_NOTE_KINDS); });
  for (const n of parsed.notes) if (!(n.target.kind in ROOT_NOTE_KINDS) && (NOTE_TARGET_KINDS as string[]).includes(n.target.kind)) problems.push(`notes.yaml ${n.id}: a note in the root is pinned to a record of the shared or org layer (${Object.keys(ROOT_NOTE_KINDS).join(", ")}), not a ${n.target.kind}`);
  const notes = parsed.notes.map((n) => {
    const ns = ROOT_NOTE_KINDS[n.target.kind];
    if (!ns || parseRef(n.target.id).ns) return n;
    return { ...n, target: { ...n.target, id: `${ns}:${n.target.id}` } };
  });
  return { notes, problems, version: notesVersion(text) };
}

// ---------- loading ----------

/** Load a shared root. A folder that is missing, or whose engine.yaml does not say kind: root, is a problem, not a throw. */
export function loadRoot(dirIn: string, opts: RootLoadOptions = {}): RootInput {
  const dir = resolve(dirIn);
  const problems: string[] = [];
  const e = readYamlFile(join(dir, "engine.yaml"));
  let config: RootConfig = { kind: "" };
  if (!existsSync(dir)) problems.push(`there is no folder at ${dir}`);
  else if (e.bytes === undefined) problems.push(`${dir} has no engine.yaml, so it is not a shared root (its engine.yaml says kind: root)`);
  else if (e.problem) problems.push(`engine.yaml: ${e.problem}`);
  else {
    const r = (e.raw ?? {}) as Raw;
    config = { ...r, kind: String(r.kind ?? "") };
    if (config.kind !== "root") problems.push(`${dir} is not a shared root: its engine.yaml says kind: ${r.kind == null ? "(nothing)" : String(r.kind)}, not kind: root`);
  }
  const here = existsSync(dir);
  const shipped = here ? loadShared(dir) : undefined;
  const orgRaw = here ? readOrgRaw(dir) : undefined;
  const teamMap = here ? readTeamMap(join(dir, "team-map.yaml")) : undefined;
  const loadFindings: Finding[] = [];
  const patches = here ? readRootPatches(dir, loadFindings) : [];
  // the accepted patches, in natural id order, on copies of the layers as written
  const keys = new Set(patches.map(patchKey));
  const is = (p: Patch, ref?: string) => ref !== undefined && (keys.has(ref) ? patchKey(p) === ref : p.id === ref);
  const chosen = patches.filter((p) => (p.status === "accepted" || is(p, opts.with)) && !is(p, opts.without));
  const work: Work = { ...(shipped ? { shared: clone(shipped) } : {}), ...(orgRaw ? { org: clone(orgRaw) } : {}) };
  const results: Record<string, RootApplyResult> = {}, applied: string[] = [];
  for (const p of chosen) {
    const res = applyRootPatch(work, p);
    results[patchKey(p)] = res;
    applied.push(p.id);
    for (const m of res.errors) loadFindings.push({ pack: "core", rule: "patch-applies", severity: "error", at: p.id, atKind: "instance", message: m });
  }
  const notes = here ? loadRootNotes(dir) : undefined;
  const input: RootInput = {
    dir, config,
    ...(work.shared ? { shared: work.shared } : {}), ...(shipped ? { shipped } : {}),
    ...(work.org ? { org: orgLayerOf(work.org) } : {}), ...(orgRaw ? { orgWritten: orgLayerOf(clone(orgRaw)) } : {}),
    ...(teamMap ? { teamMap } : {}),
    patches, applied, results,
    ...(notes ? { notes } : {}),
    ...(loadFindings.length ? { loadFindings } : {}),
    problems,
  };
  input.modelHash = sha256(canonicalJson(modelInputs(input, orgRaw)));
  input.hash = sha256(canonicalJson({ premiseLinks: fileSha256(join(input.dir, "premise-links.yaml")), model: modelInputs(input, orgRaw), patches: input.patches ?? [], notes: input.notes?.notes }));
  return input;
}

// ---------- hashes ----------

/** Leads and estimate notes are wording; explicit row_owner stays in the model hash. An unwritten owner defaults to the lead only in the org view. */
function withoutWording(o: OrgRaw | undefined): unknown {
  if (!o) return undefined;
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!isMap(v)) return v;
    const out: Raw = {};
    for (const [k, x] of Object.entries(v)) if (!(k === "note" && "value" in v)) out[k] = strip(x);
    return out;
  };
  return {
    teams: o.teams.map(({ lead: _l, ...t }) => strip(t)), activities: strip(o.activities), slowdowns: strip(o.slowdowns),
    seam_exceptions: strip(o.seam_exceptions), extra: o.extra,
  };
}

/** The shared layer's records, without the file's name, hash and the reader's problems. */
function layerRecords(l: SharedLayer | undefined): unknown {
  if (!l) return undefined;
  const { file: _f, sha256: _s, problems: _p, manualWorkFile: _m, ...rest } = l;
  return rest;
}

/**
 * What the root's model is: its engine.yaml, the shared layer as shipped, the org layer as written and the team map,
 * all before any patch. Its sha256 (RootInput.modelHash) is what a root patch is written against (provenance.based_on):
 * patches, notes and wording (a team's lead, an estimate's note) leave it unchanged. An explicit row_owner is part of
 * the model: changing it makes pending patches' based_on older. RootInput.hash adds every patch and the notes.
 */
function modelInputs(r: RootInput, orgRaw: OrgRaw | undefined): unknown {
  const { tracker: _t, importer: _i, glossary: _g, ...config } = r.config;
  const tm = r.teamMap ? { owners: r.teamMap.owners, unit_roles: r.teamMap.unit_roles, teams: r.teamMap.teams.map(({ lead: _l, ...t }) => t) } : undefined;
  return { root: config, shared: layerRecords(r.shipped), org: withoutWording(orgRaw), teamMap: tm };
}

