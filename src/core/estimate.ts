// Estimates with provenance. Every number in the org layer is an estimate: its value, its
// source (person, agent, tracker or derived), who or what gave it (`by`), the date it holds for (`as_of`) and how sure
// it is (`confidence`), with an optional note, a person's `stated` figure kept beside a measured value, and `history`
// for values from before the engine kept a record. A share is between 0 and 1; a capacity is a whole number of at
// least 1. An estimate missing one of the five required fields, or with a value out of range, is not stated: it is an
// org/estimate-valid error and nothing computes with it.
//
// History, as the page draws it: the record's own `history` (oldest first), then the value org.yaml writes, then every
// accepted root patch that set the field, in natural id order, each with its provenance and decision. After day one
// nobody writes history by hand; the patches are the rest of it.

import type { EstimatePoint, Estimate, Patch, RootApplyResult, StatedFigure } from "../types.ts";

/** A patch's key, as src/core/load.ts gives it: its file, else its id (kept here so this module imports no loader). */
const patchKey = (p: Pick<Patch, "id" | "file">): string => p.file ?? p.id;

export const ESTIMATE_SOURCES = ["person", "agent", "tracker", "derived"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export type EstimateKind = "share" | "capacity";

/** How old an estimate may be before it is stale (engine.yaml of the root: estimates.stale_after_days). */
export const DEFAULT_STALE_AFTER_DAYS = 90;
/** How far apart a stated and a measured value may be before the page says so: 0.05 of a share, or 1 slot. */
export const DEFAULT_GAP = { share: 0.05, capacity: 1 };

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** A date as written: a YAML date becomes YYYY-MM-DD; a string is trimmed; anything else is undefined. */
export function dateOf(v: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

/** Is this a calendar date, YYYY-MM-DD (a time after it is allowed)? */
export const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(s) && !Number.isNaN(Date.parse(s.slice(0, 10)));

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10) + "T00:00:00Z") - Date.parse(from.slice(0, 10) + "T00:00:00Z")) / 86_400_000);
}

const text = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === "string" ? (v.trim() || undefined) : String(v));

/** What is wrong with a value for this kind of estimate, in words, or undefined. */
function valueProblem(v: unknown, kind: EstimateKind): string | undefined {
  if (v === undefined || v === null || v === "") return "has no value";
  if (typeof v !== "number" || !Number.isFinite(v)) return `has value ${JSON.stringify(v)}, which is not a number`;
  if (kind === "share" && (v < 0 || v > 1)) return `has value ${v}, and a share is between 0 and 1`;
  if (kind === "capacity" && (!Number.isInteger(v) || v < 1)) return `has value ${v}, and a capacity is a whole number of at least 1`;
  return undefined;
}

/**
 * What is wrong with an estimate as written, in words: empty when it is whole. The five required fields and the
 * value's range decide whether it is stated; a `stated` figure or a history entry that is not whole is a problem too,
 * and is dropped, but leaves the value in force standing.
 */
export function estimateProblems(raw: unknown, kind: EstimateKind): { required: string[]; extra: string[] } {
  if (!isMap(raw)) return { required: [raw === undefined || raw === null ? "is not given" : `is ${JSON.stringify(raw)}, not an estimate: write { value, source, by, as_of, confidence }`], extra: [] };
  const required: string[] = [];
  const vp = valueProblem(raw.value, kind); if (vp) required.push(vp);
  const source = text(raw.source);
  if (!source) required.push("does not say its source (person, agent, tracker or derived)");
  else if (!(ESTIMATE_SOURCES as readonly string[]).includes(source)) required.push(`has source "${source}", which is not person, agent, tracker or derived`);
  if (!text(raw.by)) required.push("does not say who or what gave it (by)");
  const asOf = dateOf(raw.as_of);
  if (!asOf) required.push("has no as_of date");
  else if (!isDate(asOf)) required.push(`has as_of "${asOf}", which is not a date (YYYY-MM-DD)`);
  const conf = text(raw.confidence);
  if (!conf) required.push("has no confidence (low, medium or high)");
  else if (!(CONFIDENCES as readonly string[]).includes(conf)) required.push(`has confidence "${conf}", which is not low, medium or high`);
  const extra: string[] = [];
  if (raw.stated != null) {
    const sp = statedProblem(raw.stated, kind);
    if (sp) extra.push(`its stated figure ${sp}`);
  }
  if (raw.history != null) {
    if (!Array.isArray(raw.history)) extra.push("its history is not a list");
    else raw.history.forEach((h, i) => {
      const hp = !isMap(h) ? "is not a mapping" : valueProblem(h.value, kind) ?? (!isDate(dateOf(h.as_of)) ? "has no as_of date (YYYY-MM-DD)" : undefined);
      if (hp) extra.push(`its history entry ${i + 1} ${hp}`);
    });
  }
  return { required, extra };
}

function statedProblem(v: unknown, kind: EstimateKind): string | undefined {
  if (!isMap(v)) return "is not a mapping of value, by and as_of";
  return valueProblem(v.value, kind) ?? (!text(v.by) ? "does not say who stated it (by)" : !isDate(dateOf(v.as_of)) ? "has no as_of date (YYYY-MM-DD)" : undefined);
}

/** The estimate as the engine computes with it, or undefined when it is not stated (estimateProblems says why). */
export function normEstimate(raw: unknown, kind: EstimateKind): Estimate | undefined {
  if (estimateProblems(raw, kind).required.length) return undefined;
  const r = raw as Raw;
  const e: Estimate = { value: r.value as number, source: text(r.source) as Estimate["source"], by: text(r.by)!, as_of: dateOf(r.as_of)!.slice(0, 10), confidence: text(r.confidence) as Estimate["confidence"] };
  const note = text(r.note); if (note) e.note = note;
  if (r.stated != null && !statedProblem(r.stated, kind)) {
    const s = r.stated as Raw;
    e.stated = { value: s.value as number, by: text(s.by)!, as_of: dateOf(s.as_of)!.slice(0, 10) } satisfies StatedFigure;
  }
  return e;
}

/** An estimate's age in days at `today`, or undefined when either date is missing. */
export function ageDays(e: Pick<Estimate, "as_of"> | undefined, today: string | undefined): number | undefined {
  return e && isDate(e.as_of) && isDate(today) ? daysBetween(e.as_of, today) : undefined;
}

/** Stale: older than `afterDays` at `today`. */
export function isStale(e: Pick<Estimate, "as_of"> | undefined, today: string | undefined, afterDays = DEFAULT_STALE_AFTER_DAYS): boolean {
  const a = ageDays(e, today);
  return a !== undefined && a > afterDays;
}

/** A point of history from a raw estimate-like mapping (value and as_of at least), or undefined. */
function pointOf(raw: unknown, from: EstimatePoint["from"], kind: EstimateKind): EstimatePoint | undefined {
  if (!isMap(raw) || valueProblem(raw.value, kind)) return undefined;
  const p: EstimatePoint = { value: raw.value as number, from };
  for (const k of ["source", "by", "confidence", "note"] as const) { const t = text(raw[k]); if (t) p[k] = t; }
  const d = dateOf(raw.as_of); if (d) p.as_of = d.slice(0, 10);
  if (raw.stated != null && !statedProblem(raw.stated, kind)) { const s = raw.stated as Raw; p.stated = { value: s.value as number, by: text(s.by)!, as_of: dateOf(s.as_of)!.slice(0, 10) }; }
  return p;
}

const byDate = (a: EstimatePoint, b: EstimatePoint) => (a.as_of ?? "").localeCompare(b.as_of ?? "");

/**
 * The history of one estimate field of one org record, oldest first: its own `history` from the file as it was
 * before any patch, then the value the file writes, then each accepted root patch that set the field (in the order
 * they applied), with the patch's provenance and decision. The last point is the value in force.
 *
 * `base`: the field as org.yaml writes it (undefined when an accepted patch added the record). `patches`: the root's
 * patches; `results`: what each applied patch set, by patch key.
 */
export function estimateHistory(base: unknown, kind: EstimateKind, rec: { kind: string; id: string; field: string }, patches: Patch[], applied: string[], results: Record<string, RootApplyResult>): EstimatePoint[] {
  const out: EstimatePoint[] = [];
  if (isMap(base)) {
    const hist = Array.isArray(base.history) ? base.history.map((h) => pointOf(h, "history", kind)).filter((p): p is EstimatePoint => !!p) : [];
    out.push(...hist.sort(byDate));
    const file = pointOf(base, "file", kind); if (file) out.push(file);
  }
  const byKey = new Map(patches.map((p) => [patchKey(p), p]));
  const keys = Object.keys(results);
  // applied holds ids in order; results is keyed by patch key, which tells two patches with one id apart
  const ordered = applied.flatMap((id) => keys.filter((k) => byKey.get(k)?.id === id)).filter((k, i, a) => a.indexOf(k) === i);
  for (const key of ordered) {
    const p = byKey.get(key)!;
    for (const s of results[key].sets) {
      if (s.kind !== rec.kind || s.id !== rec.id || s.field !== rec.field) continue;
      const pt = pointOf(s.value, "patch", kind);
      if (!pt) continue;
      out.push({ ...pt, patch: p.id, ...(p.provenance ? { provenance: p.provenance } : {}), ...(p.decision ? { decision: p.decision } : {}) });
    }
  }
  return out;
}

/** One line of provenance for an estimate, as the page says it: "4 · stated by the AppSec platform lead, 2026-11-02, medium". */
export function provenanceLine(e: Estimate): string {
  const how = e.source === "person" ? `stated by ${e.by}` : e.source === "tracker" ? `measured from the tracker (${e.by.replace(/^tracker:/, "")})` : e.source === "agent" ? `estimated by ${e.by.replace(/^agent:/, "")}` : `derived (${e.by.replace(/^derived:/, "")})`;
  return `${e.value} · ${how}, ${e.as_of}, ${e.confidence}`;
}
