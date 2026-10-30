// Compile = base model and plan plus patches applied in natural id order.
// applyPatch mutates a working state and reports what it changed, including the remove cascade.
// A 0.4 design is then resolved (src/core/resolve.ts): its references in canonical form, and the records it names
// outside itself brought in as outside records. A 0.4 design's current state (src/core/current.ts) brings its parts
// that exist only today in before the patches, and its records are resolved and checked after. A lone instance is
// compiled exactly as before.

import type { CurrentCompiled, Impact, Instance, Model, Patch, Plan, RecordKind } from "../types.ts";
import { DEFAULT_LADDER, normalize, patchKey, RECORD_KINDS } from "./load.ts";
import { byId, clone, natCompare } from "./util.ts";
import { resolveState, type ResolveResult } from "./resolve.ts";
import { addTodayOnly, compileCurrent, currentContext } from "./current.ts";

export interface State { model: Model; plan: Plan }

export type ApplyResult = Pick<Impact, "added" | "removed" | "modified" | "cascade" | "errors">;

export interface Compiled extends State {
  applied: string[];                       // patch ids applied, in order
  results: Record<string, ApplyResult>;    // per applied patch id (the first, when two patches share an id)
  resultsByKey: Record<string, ApplyResult>; // per applied patch, keyed by patchKey (its file), so duplicate ids stay apart
  ns?: ResolveResult;                      // a 0.4 design: resolution's findings, the homes of its outside records, the shared records it names
  current?: CurrentCompiled;               // a 0.4 design with a current.yaml: its records resolved, core/current-valid's findings, transition work
}

type AnyRec = Record<string, any>;

function table(s: State, kind: RecordKind): { arr: AnyRec[]; key: "id" | "name" } {
  switch (kind) {
    case "element": return { arr: s.model.elements, key: "id" };
    case "relationship": return { arr: s.model.relationships, key: "id" };
    case "contract": return { arr: s.model.contracts, key: "name" };
    case "team": return { arr: s.model.teams, key: "id" };
    case "system": return { arr: s.model.systems, key: "id" };
    case "zone": return { arr: s.model.zones, key: "id" };
    case "view": return { arr: s.model.views, key: "id" };
    case "unit": return { arr: s.plan.units, key: "id" };
    case "phase": return { arr: s.plan.phases, key: "id" };
    case "claim": return { arr: (s.model.claims ??= []), key: "id" };
  }
}

export function emptyResult(): ApplyResult {
  return { added: [], removed: [], modified: [], cascade: [], errors: [] };
}

/** Apply one patch's ops to `s` in place. Ops that cannot apply are skipped and reported in errors. */
export function applyPatch(s: State, patch: Patch): ApplyResult {
  const r = emptyResult();
  patch.ops.forEach((op, i) => {
    if (!op || typeof op !== "object" || Array.isArray(op)) {
      r.errors.push(`${patch.id} op ${i + 1}: an op must be a mapping like {op: add, kind: element, value: {...}}, not ${JSON.stringify(op)}`);
      return;
    }
    const where = `${patch.id} op ${i + 1} (${(op as AnyRec).op} ${(op as AnyRec).kind})`;
    if (!RECORD_KINDS.includes(op.kind)) {
      r.errors.push(`${where}: unknown record kind "${(op as AnyRec)?.kind}"; expected one of ${RECORD_KINDS.join(", ")}`);
      return;
    }
    const { arr, key } = table(s, op.kind);
    if (op.op === "add") {
      const v = op.value as AnyRec | undefined;
      if (!v || typeof v !== "object") { r.errors.push(`${where}: add needs a value`); return; }
      const rec = normalize(op.kind, v.name === undefined && key === "name" ? { ...v, name: v.id } : v);
      const id = rec[key];
      if (id === undefined || id === "undefined") { r.errors.push(`${where}: added value has no ${key}`); return; }
      if (arr.some((x) => x[key] === id)) { r.errors.push(`${where}: ${op.kind} "${id}" already exists`); return; }
      arr.push(rec);
      r.added.push({ kind: op.kind, id });
    } else if (op.op === "modify") {
      const set = (op as AnyRec).set as AnyRec | undefined;
      if (!set || typeof set !== "object" || Array.isArray(set)) {
        r.errors.push(`${where}: modify needs \`set\`, a mapping of the fields to change${set === undefined ? "" : `, not ${JSON.stringify(set)}`}`); return;
      }
      const idx = arr.findIndex((x) => x[key] === op.id);
      if (idx < 0) { r.errors.push(`${where}: unknown ${op.kind} "${op.id}"`); return; }
      if (set[key] !== undefined && String(set[key]) !== op.id) {
        r.errors.push(`${where}: modify cannot change the ${key} of "${op.id}"; remove and add instead`); return;
      }
      const cur = arr[idx];
      const merged: AnyRec = { ...cur, ...set };
      if (set.attrs && typeof set.attrs === "object") merged.attrs = { ...(cur.attrs ?? {}), ...set.attrs };
      for (const k of Object.keys(set)) if (set[k] === null) delete merged[k]; // null unsets a field
      arr[idx] = normalize(op.kind, merged);
      const fields: string[] = [];
      for (const k of Object.keys(set).sort(natCompare)) {
        if (k === "attrs" && set.attrs && typeof set.attrs === "object") {
          for (const a of Object.keys(set.attrs).sort(natCompare)) fields.push(`attrs.${a}`);
        } else fields.push(k);
      }
      r.modified.push({ kind: op.kind, id: op.id, fields });
    } else if (op.op === "remove") {
      const idx = arr.findIndex((x) => x[key] === op.id);
      if (idx < 0) { r.errors.push(`${where}: unknown ${op.kind} "${op.id}"`); return; }
      arr.splice(idx, 1);
      r.removed.push({ kind: op.kind, id: op.id });
      if (op.kind === "element") cascadeElement(s, op.id, r);
      if (op.kind === "relationship") cascadeRelationships(s, new Set([op.id]), `relationship ${op.id} was removed`, r);
    } else {
      r.errors.push(`${where}: unknown op "${(op as AnyRec).op}"; expected add, modify or remove`);
    }
  });
  // A record the patch removes outright is listed under removed, not again as cascade.
  const removed = new Set(r.removed.map((x) => `${x.kind}\u0000${x.id}`));
  r.cascade = dedupeCascade(r.cascade).filter((x) => !removed.has(`${x.kind}\u0000${x.id}`));
  const ord = (a: { kind: string; id: string }, b: { kind: string; id: string }) => natCompare(a.kind, b.kind) || natCompare(a.id, b.id);
  r.added.sort(ord); r.removed.sort(ord); r.modified.sort(ord);
  r.cascade.sort((a, b) => ord(a, b) || natCompare(a.because, b.because));
  return r;
}

function cascadeElement(s: State, id: string, r: ApplyResult) {
  const because = `element ${id} was removed`;
  const gone = s.model.relationships.filter((x) => x.from === id || x.to === id).sort(byId);
  if (gone.length) {
    const ids = new Set(gone.map((x) => x.id));
    s.model.relationships = s.model.relationships.filter((x) => !ids.has(x.id));
    for (const g of gone) r.cascade.push({ kind: "relationship", id: g.id, because: `${because}; the relationship touched it` });
    cascadeRelationships(s, ids, `relationships touching element ${id} were removed`, r);
  }
  for (const c of s.model.contracts) {
    const p = c.produced_by?.includes(id), q = c.consumed_by?.includes(id);
    if (p) c.produced_by = c.produced_by!.filter((x) => x !== id);
    if (q) c.consumed_by = c.consumed_by!.filter((x) => x !== id);
    if (p || q) r.cascade.push({ kind: "contract", id: c.name, because: `${because}; it was listed as a ${p ? "producer" : "consumer"}${p && q ? " and consumer" : ""}` });
  }
  for (const v of s.model.views) {
    if (v.elements.includes(id)) {
      v.elements = v.elements.filter((x) => x !== id);
      r.cascade.push({ kind: "view", id: v.id, because: `${because}; the view showed it` });
    }
  }
  for (const u of s.plan.units) {
    if (u.elements?.some((m) => m.id === id)) {
      u.elements = u.elements.filter((m) => m.id !== id);
      r.cascade.push({ kind: "unit", id: u.id, because: `${because}; the unit moved its fidelity` });
    }
  }
}

function cascadeRelationships(s: State, ids: Set<string>, because: string, r: ApplyResult) {
  for (const v of s.model.views) {
    if (v.relationships?.some((x) => ids.has(x))) {
      v.relationships = v.relationships.filter((x) => !ids.has(x));
      r.cascade.push({ kind: "view", id: v.id, because: `${because}; the view listed it` });
    }
  }
}

function dedupeCascade(c: ApplyResult["cascade"]): ApplyResult["cascade"] {
  const seen = new Set<string>();
  return c.filter((x) => {
    const k = `${x.kind}\u0000${x.id}\u0000${x.because}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Sort every record list into natural id order (phases by order, then id) so output is deterministic. */
export function sortState(s: State): void {
  const m = s.model;
  m.teams.sort(byId); m.systems.sort(byId); m.zones.sort(byId);
  m.elements.sort(byId); m.relationships.sort(byId); m.views.sort(byId);
  m.contracts.sort((a, b) => natCompare(a.name, b.name));
  m.claims?.sort(byId);
  s.plan.units.sort(byId);
  s.plan.phases.sort((a, b) => a.order - b.order || natCompare(a.id, b.id));
}

export interface CompileOptions {
  with?: string;      // also apply this patch whatever its status (a patchKey, or an id)
  without?: string;   // skip this patch even if accepted (a patchKey, or an id)
}

export function compile(inst: Pick<Instance, "model" | "plan" | "patches"> & Partial<Pick<Instance, "ns" | "current" | "config">>, opts: CompileOptions = {}): Compiled {
  const s: State = { model: clone(inst.model), plan: clone(inst.plan) };
  addTodayOnly(s.model, inst.current, inst.ns?.namespace); // parts that exist only today, so a unit can retire them
  // Match with/without by key first; fall back to the id only when no patch has that key.
  const keys = new Set(inst.patches.map(patchKey));
  const is = (p: Patch, ref?: string) => ref !== undefined && (keys.has(ref) ? patchKey(p) === ref : p.id === ref);
  const chosen = inst.patches
    .filter((p) => (p.status === "accepted" || is(p, opts.with)) && !is(p, opts.without))
    .sort((a, b) => natCompare(a.id, b.id) || natCompare(patchKey(a), patchKey(b)));
  const results: Record<string, ApplyResult> = {}, resultsByKey: Record<string, ApplyResult> = {};
  for (const p of chosen) {
    const res = applyPatch(s, p);
    resultsByKey[patchKey(p)] = res;
    results[p.id] ??= res;
  }
  const ns = inst.ns ? resolveState(s, inst.ns) : undefined;
  const current = inst.current ? compileCurrent(s.model, s.plan, inst.current, currentContext(inst, inst.config?.ladder ?? DEFAULT_LADDER)) : undefined;
  sortState(s);
  return { ...s, applied: chosen.map((p) => p.id), results, resultsByKey, ...(ns ? { ns } : {}), ...(current ? { current } : {}) };
}
