// Flow along a value stream: the declared waits, work and WIP limits on the model's parts with their provenance, the
// tracker's measured values beside them, each stream view's path with its totals and team handoffs, and a patch's
// lead-time effect. Pure functions over the compiled model; the flow pack checks the inputs, the site draws the facts.
//
// Conventions (the flow pack's): a handoff is a relationship of kind "handoff"; "feedback" relationships are loops
// back and never part of a forward path; start and end parts carry attrs.start / attrs.end (else a stream's sources
// and sinks); person and process steps carry attrs.wait_days and may carry attrs.work_days; queues carry
// attrs.wip_limit; every flow number has attrs.flow_source (measured | estimated | declared) and attrs.flow_as_of.

import type { ClaimFlowCheck,
  Element, FlowFacts, FlowHop, FlowMeasure, FlowMeasured, FlowSource, FlowStep, FlowSum, FlowValue, InstanceConfig, Model,
  PatchFlowEffect, Relationship, StreamFlow, View,
} from "../types.ts";
import { acyclic, makeAdj, topo } from "./graph.ts";
import { natCompare, natSort } from "./util.ts";

export const FLOW_SOURCES: FlowSource[] = ["measured", "estimated", "declared"];
export const STEP_KINDS = new Set(["person", "person-step", "process", "activity", "step"]);
export const PERSON_KINDS = new Set(["person", "person-step"]);
export const FLOW_KEYS = { wait: "wait_days", work: "work_days", wip: "wip_limit" } as const;
export const isHandoff = (r: Relationship) => r.kind === "handoff";
export const isStep = (e: Element) => STEP_KINDS.has(e.kind);
export const isQueue = (e: Element) => e.kind === "queue";

export interface FlowSettings { limit: number; maxAgeDays: number; streams?: string[]; source?: string; asOf?: string }

/**
 * engine.yaml `flow: { max_handoffs: 4, max_age_days: 90, streams: [view ids], source: <word>, as_of: <date> }`;
 * `source` and `as_of` are the instance's provenance for every flow number whose part does not give its own.
 */
export function flowSettings(config: InstanceConfig): FlowSettings {
  const f = (config.flow ?? {}) as { max_handoffs?: unknown; max_age_days?: unknown; streams?: unknown; source?: unknown; as_of?: unknown };
  const n = Number(f.max_handoffs), a = Number(f.max_age_days);
  return {
    limit: Number.isFinite(n) && n >= 0 ? n : 4,
    maxAgeDays: Number.isFinite(a) && a > 0 ? a : 90,
    ...(Array.isArray(f.streams) ? { streams: f.streams.map(String) } : {}),
    ...(f.source != null ? { source: String(f.source) } : {}),
    ...(f.as_of != null ? { asOf: String(f.as_of) } : {}),
  };
}

const DAY = 86_400_000;
/** An ISO date or date-time as milliseconds; Jira's "+0000" offsets are read too. NaN when it is not a date. */
export function parseTime(s: string | undefined): number {
  if (!s) return NaN;
  const t = String(s).trim().replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return NaN;
  return Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t);
}
/** Whole calendar days from a to b (both ISO dates or date-times). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseTime(b.slice(0, 10)) - parseTime(a.slice(0, 10))) / DAY);
}

/** A flow attribute as read, with what is wrong with it in words (empty when it is whole). */
export interface ReadValue { value?: FlowValue; present: boolean; problems: string[] }

/**
 * Read one flow attribute of a part: numeric and not negative (a WIP limit a whole number), with flow_source one of
 * measured, estimated or declared and flow_as_of a date, no older than `maxAgeDays` before `today`.
 */
export function readFlowValue(e: Element, key: string, today: string | undefined, settings: Pick<FlowSettings, "maxAgeDays" | "source" | "asOf">): ReadValue {
  const maxAgeDays = settings.maxAgeDays;
  const a = e.attrs ?? {};
  if (!(key in a) || a[key] === null || a[key] === undefined) return { present: false, problems: [] };
  const raw = a[key], problems: string[] = [];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { present: true, problems: [`${key} is ${JSON.stringify(raw)}, not a number`] };
  if (raw < 0) problems.push(`${key} is ${raw}, below zero`);
  if (key === FLOW_KEYS.wip && !Number.isInteger(raw)) problems.push(`${key} is ${raw}, not a whole number`);
  const src = a.flow_source ?? settings.source, asOf = a.flow_as_of ?? settings.asOf;
  let source: FlowSource | undefined;
  if (src === undefined || src === null) problems.push(`${key} has no flow_source (measured, estimated or declared)`);
  else if (!FLOW_SOURCES.includes(String(src) as FlowSource)) problems.push(`flow_source is "${src}"; use measured, estimated or declared`);
  else source = String(src) as FlowSource;
  let as: string | undefined, ageDays: number | undefined, stale = false;
  if (asOf === undefined || asOf === null) problems.push(`${key} has no flow_as_of date`);
  else if (Number.isNaN(parseTime(String(asOf)))) problems.push(`flow_as_of is "${asOf}", not a date`);
  else {
    as = String(asOf).slice(0, 10);
    if (today) {
      ageDays = daysBetween(as, today);
      if (ageDays < 0) problems.push(`flow_as_of ${as} is after the build date ${today}`);
      else if (ageDays > maxAgeDays) { stale = true; problems.push(`${key} is ${ageDays} days old (as of ${as}), older than the ${maxAgeDays} days allowed (engine.yaml flow.max_age_days)`); }
    }
  }
  return { present: true, problems, value: { value: raw, ...(source ? { source } : {}), ...(as ? { asOf: as } : {}), ...(ageDays !== undefined ? { ageDays } : {}), ...(stale ? { stale } : {}) } };
}

/** The views that are streams: engine.yaml flow.streams, else every view whose drawn relationships include a handoff. */
export function streamViews(model: Model, config: InstanceConfig): View[] {
  const s = flowSettings(config);
  if (s.streams) return s.streams.map((id) => model.views.find((v) => v.id === id)).filter((v): v is View => !!v);
  return model.views.filter((v) => viewRels(model, v).some(isHandoff));
}

function viewRels(model: Model, v: View): Relationship[] {
  const ids = new Set(v.elements);
  const rels = v.relationships ? v.relationships.map((id) => model.relationships.find((r) => r.id === id)).filter((r): r is Relationship => !!r) : model.relationships;
  return rels.filter((r) => ids.has(r.from) && ids.has(r.to));
}

/**
 * The path from a start to an end that crosses the most team handoffs (ties: the most steps, then natural order),
 * over every relationship but feedback. Starts and ends are the parts marked attrs.start / attrs.end among `ids`,
 * else the sources and sinks. Returns one path per start, in natural order of the start, each with its handoff count.
 */
export function handoffPaths(model: Model, ids: string[], relsIn: Relationship[]): { start: string; path: string[]; handoffs: number }[] {
  const idSet = new Set(ids);
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const rels = relsIn.filter((r) => r.kind !== "feedback" && idSet.has(r.from) && idSet.has(r.to) && r.from !== r.to);
  const dag = acyclic(makeAdj(ids, rels.map((r) => [r.from, r.to])));
  const w = new Map<string, number>();
  for (const r of rels) { const k = `${r.from}\u0000${r.to}`; w.set(k, Math.max(w.get(k) ?? 0, isHandoff(r) ? 1 : 0)); }
  const order = topo(dag);
  const hasIn = new Set<string>(), hasOut = new Set<string>();
  for (const [a, bs] of dag) for (const b of bs) { hasOut.add(a); hasIn.add(b); }
  const marked = (k: "start" | "end") => ids.filter((id) => el.get(id)?.attrs?.[k] === true);
  const starts = marked("start").length ? natSort(marked("start")) : natSort(ids.filter((n) => hasOut.has(n) && !hasIn.has(n)));
  const ends = new Set(marked("end").length ? marked("end") : ids.filter((n) => hasIn.has(n) && !hasOut.has(n)));
  const out: { start: string; path: string[]; handoffs: number }[] = [];
  for (const s of starts) {
    const best = new Map<string, [number, number]>([[s, [0, 0]]]), prev = new Map<string, string>();
    for (const n of order) {
      if (!best.has(n)) continue;
      const [h, len] = best.get(n)!;
      for (const m of dag.get(n)!) {
        const v: [number, number] = [h + (w.get(`${n}\u0000${m}`) ?? 0), len + 1];
        const cur = best.get(m);
        if (!cur || v[0] > cur[0] || (v[0] === cur[0] && v[1] > cur[1])) { best.set(m, v); prev.set(m, n); }
      }
    }
    let worst: string | undefined, wv: [number, number] = [-1, -1];
    for (const e of natSort(ends)) {
      const v = best.get(e);
      if (v && e !== s && (v[0] > wv[0] || (v[0] === wv[0] && v[1] > wv[1]))) { wv = v; worst = e; }
    }
    if (worst === undefined) continue;
    const path: string[] = [];
    for (let n: string | undefined = worst; n !== undefined; n = n === s ? undefined : prev.get(n)) path.unshift(n);
    out.push({ start: s, path, handoffs: wv[0] });
  }
  return out;
}

/** The handoffs along a path: each consecutive pair joined by a handoff relationship, with its two owner teams. */
export function hopsOf(model: Model, path: string[]): FlowHop[] {
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const out: FlowHop[] = [];
  for (let i = 1; i < path.length; i++) {
    const r = model.relationships.filter((x) => x.from === path[i - 1] && x.to === path[i] && isHandoff(x)).sort((a, b) => natCompare(a.id, b.id))[0];
    if (!r) continue;
    out.push({ relationship: r.id, from: r.from, to: r.to, fromTeam: el.get(r.from)?.owner ?? "", toTeam: el.get(r.to)?.owner ?? "" });
  }
  return out;
}

/** Every part's flow numbers, declared and (where the tracker maps a status to it) measured. */
export function flowSteps(model: Model, settings: FlowSettings, today: string | undefined, measured?: FlowMeasured): Record<string, FlowStep> {
  const out: Record<string, FlowStep> = {};
  const streamIds = new Set<string>();
  for (const e of model.elements) {
    const s: FlowStep = { element: e.id, ...(e.owner ? { team: e.owner } : {}) };
    for (const [k, key] of Object.entries(FLOW_KEYS) as [keyof typeof FLOW_KEYS, string][]) {
      const r = readFlowValue(e, key, today, settings);
      if (r.value) s[k] = r.value;
    }
    const m = measured?.steps[e.id];
    if (m && (m.wait || m.work)) s.measured = { ...(m.wait ? { wait: m.wait } : {}), ...(m.work ? { work: m.work } : {}) };
    if (s.wait || s.work || s.wip || s.measured || streamIds.has(e.id)) out[e.id] = s;
  }
  return out;
}

function sumOf(path: string[], steps: Record<string, FlowStep>, el: Map<string, Element>, k: "wait" | "work", needed: (e: Element) => boolean): FlowSum {
  const bySource: FlowSum["bySource"] = {};
  let days = 0;
  const has: string[] = [], missing: string[] = [];
  for (const id of path) {
    const v = steps[id]?.[k];
    if (v) { days += v.value; const s = v.source ?? "unknown"; bySource[s] = (bySource[s] ?? 0) + v.value; has.push(id); }
    else if (el.get(id) && needed(el.get(id)!)) missing.push(id);
  }
  return { days: round(days), bySource: Object.fromEntries(Object.entries(bySource).map(([s, d]) => [s, round(d!)])), steps: has, missing };
}

export const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** One stream view's flow: its path, the sums by source, efficiency where work is known at every waited step, handoffs and hops, and the tracker's lead time over the steps it covers. */
export function streamFlow(model: Model, view: View, settings: FlowSettings, steps: Record<string, FlowStep>, measured?: FlowMeasured): StreamFlow | undefined {
  const paths = handoffPaths(model, view.elements, viewRels(model, view));
  if (!paths.length) return undefined;
  const best = paths.slice().sort((a, b) => b.handoffs - a.handoffs || b.path.length - a.path.length || natCompare(a.start, b.start))[0];
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const path = best.path;
  const wait = sumOf(path, steps, el, "wait", isStep);
  const anyWork = path.some((id) => steps[id]?.work);
  const work = anyWork ? sumOf(path, steps, el, "work", isStep) : undefined;
  const raw = hopsOf(model, path);
  const pairs = new Set(raw.map((h) => `${h.from}\u0000${h.to}`));
  const hops = raw.map((h) => withBehind(h, path, steps, el, pairs));
  const sources = new Set<FlowSource>();
  let oldest: string | undefined;
  for (const id of path) for (const k of ["wait", "work"] as const) {
    const v = steps[id]?.[k];
    if (!v) continue;
    if (v.source) sources.add(v.source);
    if (v.asOf && (!oldest || v.asOf < oldest)) oldest = v.asOf;
  }
  const out: StreamFlow = {
    view: view.id, title: view.title, path, wait, ...(work ? { work } : {}),
    handoffs: best.handoffs, limit: settings.limit, hops,
    ...(oldest ? { oldest } : {}), sources: FLOW_SOURCES.filter((s) => sources.has(s)),
  };
  // Lead time and flow efficiency only where work is declared at every step that declares a wait.
  if (work && wait.steps.every((id) => steps[id]?.work) && !wait.missing.length) {
    out.lead = round(wait.days + work.days);
    if (out.lead > 0) out.efficiency = round(work.days / out.lead, 4);
  }
  if (measured?.available && measured.lead) {
    const covered = path.filter((id) => measured.steps[id]);
    if (covered.length) {
      const declared = covered.reduce((t, id) => t + (steps[id]?.wait?.value ?? 0) + (steps[id]?.work?.value ?? 0), 0);
      out.measured = { lead: measured.lead, covered, declared: round(declared) };
    }
  }
  return out;
}

/** The step whose wait a handoff feeds: the first step at or after its receiving end, before the next handoff on the path. */
function withBehind(h: FlowHop, path: string[], steps: Record<string, FlowStep>, el: Map<string, Element>, handoffPairs: Set<string>): FlowHop {
  for (let j = path.indexOf(h.to); j >= 0 && j < path.length; j++) {
    const e = el.get(path[j]);
    if (!e) break;
    if (isStep(e)) {
      const s = steps[path[j]];
      return { ...h, behind: path[j], ...(s?.wait ? { waitBehind: s.wait } : {}), ...(s?.measured?.wait ? { measuredBehind: s.measured.wait } : {}) };
    }
    if (handoffPairs.has(`${path[j]}\u0000${path[j + 1]}`)) break; // a queue or service hands on again before any step
  }
  return { ...h };
}

/** The days a handoff could save at most: the tracker's measure where there is one, else the declared wait. */
export function hopDays(h: FlowHop): { days: number; source: FlowSource | "tracker" | "unknown" } | undefined {
  if (h.measuredBehind) return { days: h.measuredBehind.days, source: "tracker" };
  if (h.waitBehind) return { days: h.waitBehind.value, source: h.waitBehind.source ?? "unknown" };
  return undefined;
}

/** Handoffs ranked by the days of wait behind them, most first; hops with no wait behind them last. */
export function rankHops(hops: FlowHop[]): FlowHop[] {
  return hops.slice().sort((a, b) => (hopDays(b)?.days ?? -1) - (hopDays(a)?.days ?? -1) || natCompare(a.relationship, b.relationship));
}

/** Every handoff relationship between two owner teams, counted per pair (direction kept). */
export function teamHandoffs(model: Model): FlowFacts["teamHandoffs"] {
  const el = new Map(model.elements.map((e) => [e.id, e]));
  const m = new Map<string, { from: string; to: string; count: number; relationships: string[] }>();
  for (const r of model.relationships.filter(isHandoff).sort((a, b) => natCompare(a.id, b.id))) {
    const a = el.get(r.from)?.owner, b = el.get(r.to)?.owner;
    if (!a || !b || a === b) continue;
    const k = `${a}\u0000${b}`;
    const x = m.get(k) ?? { from: a, to: b, count: 0, relationships: [] };
    x.count++; x.relationships.push(r.id); m.set(k, x);
  }
  return [...m.values()].sort((x, y) => y.count - x.count || natCompare(x.from, y.from) || natCompare(x.to, y.to));
}

/** The flow facts the bundle carries: every part's numbers, each stream view, the team handoffs, the tracker's measures. */
export function flowFacts(model: Model, config: InstanceConfig, today: string, measured?: FlowMeasured): FlowFacts {
  const settings = flowSettings(config);
  const steps = flowSteps(model, settings, today, measured);
  const streams = streamViews(model, config).map((v) => streamFlow(model, v, settings, steps, measured)).filter((s): s is StreamFlow => !!s);
  // every step on a stream path is listed, with or without numbers
  for (const s of streams) for (const id of s.path) if (!steps[id]) { const e = model.elements.find((x) => x.id === id); if (e) steps[id] = { element: id, ...(e.owner ? { team: e.owner } : {}) }; }
  return {
    limit: settings.limit, maxAgeDays: settings.maxAgeDays, asOf: today,
    elements: steps, streams, teamHandoffs: teamHandoffs(model),
    ...(measured ? { measured } : {}),
  };
}

/** How many badge lines a part's box carries on a stream drawing: its wait, the tracker's measure, its WIP limit (or that it has none). */
export function flowBadgeLines(model: Model, facts: FlowFacts, id: string): number {
  const e = model.elements.find((x) => x.id === id), s = facts.elements[id];
  if (!e) return 0;
  // a queue whose next step the tracker measures also says how many wait in it now (client/flow.js wipNow)
  const now = isQueue(e) && !!facts.measured?.available && model.relationships.some((r) => r.from === id && facts.measured!.steps[r.to]?.wait);
  return (s?.wait ? 1 : 0) + (s?.measured?.wait ? 1 : 0) + (isQueue(e) ? 1 : 0) + (now ? 1 : 0);
}

/**
 * A claim that names a flow metric (attrs.measured_by: { metric: wait-share | lead-days | handoffs, above?, below?,
 * view? }) gets that metric's value today, its source, and whether it holds. Only a value measured in the tracker can
 * back a regrade to evidence, and a person makes that call: the engine never changes a grade.
 */
export function claimFlowChecks(model: Model, facts: FlowFacts): Record<string, ClaimFlowCheck> {
  const out: Record<string, ClaimFlowCheck> = {};
  for (const c of model.claims ?? []) {
    const mb = c.attrs?.measured_by as Record<string, unknown> | undefined;
    if (!mb || typeof mb !== "object") continue;
    const metric = String(mb.metric ?? "");
    const st = facts.streams.find((x) => x.view === mb.view) ?? facts.streams[0];
    if (!st || !["wait-share", "lead-days", "handoffs"].includes(metric)) { out[c.id] = { metric, text: `It names the flow metric "${metric}", which this build cannot compute: wait-share, lead-days or handoffs, on a stream view.` }; continue; }
    let value: number | undefined, source: ClaimFlowCheck["source"] = "declared";
    const m = st.measured, mw = facts.measured?.available ? st.path.reduce((t, id) => t + (facts.measured!.steps[id]?.wait?.days ?? 0), 0) : 0;
    if (metric === "wait-share") {
      if (m && m.lead.days > 0 && mw > 0) { value = Math.min(1, mw / m.lead.days); source = "tracker"; }
      else if (st.lead) value = st.wait.days / st.lead;
    } else if (metric === "lead-days") {
      if (m) { value = m.lead.days; source = "tracker"; } else value = st.lead;
    } else value = st.handoffs;
    if (value === undefined) { out[c.id] = { metric, view: st.view, text: "Its flow metric cannot be computed yet: work is not declared at every step that waits." }; continue; }
    const above = mb.above != null ? Number(mb.above) : undefined, below = mb.below != null ? Number(mb.below) : undefined;
    const holds = (above === undefined || value > above) && (below === undefined || value < below);
    const shown = metric === "wait-share" ? `${Math.round(value * 100)}% of lead time is waiting` : metric === "lead-days" ? `lead time is ${fmtDays(value)}` : `a change crosses ${value} team handoffs`;
    const bar = metric === "wait-share" ? [above != null ? `more than ${Math.round(above * 100)}%` : "", below != null ? `less than ${Math.round(below * 100)}%` : ""] : [above != null ? `more than ${above}` : "", below != null ? `less than ${below}` : ""];
    const covered = m ? m.covered.length : 0;
    const from = source === "tracker" ? `measured in the tracker over the ${covered === 1 ? "step" : `${covered} steps`} its statuses cover` : `from the model's ${st.sources.length ? st.sources.join(" and ") : "unsourced"} values`;
    const verdict = !holds ? "The measure contradicts it" : source === "tracker" ? (c.grade === "evidence" ? "The measure backs its grade" : "The measure supports it: a person may regrade it to evidence") : "It holds on the declared values, which cannot make it evidence; a measurement from the tracker could";
    out[c.id] = { metric, view: st.view, value, source, holds, text: `The flow measure that can regrade it: ${shown}, ${from}, against a bar of ${bar.filter(Boolean).join(" and ") || "no threshold"}. ${verdict}.` };
  }
  return out;
}

// ---------- words ----------

/** "4 days", "1 day", "0.5 days", "4.8 days". */
export function fmtDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1);
  return `${s} ${r === 1 ? "day" : "days"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "1 Oct", or "1 Oct 2025" when the year is not the build's. */
export function shortDate(iso: string | undefined, today?: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}${today && Number(today.slice(0, 4)) === y ? "" : ` ${y}`}`;
}

/** The source word a reader sees beside a number. */
export function sourceWord(s: FlowSource | "unknown" | "tracker" | undefined): string {
  return s === "tracker" ? "measured in the tracker" : s && s !== "unknown" ? s : "source not given";
}

/** "4 days, estimated, as of 1 Oct". */
export function valueText(v: FlowValue, today?: string, unit: "days" | "limit" = "days"): string {
  const n = unit === "days" ? fmtDays(v.value) : String(v.value);
  return `${n}, ${sourceWord(v.source)}${v.asOf ? `, as of ${shortDate(v.asOf, today)}` : ", date not given"}`;
}

/** "12 estimated, 9 measured": a sum split by source, largest share first. */
export function bySourceText(by: FlowSum["bySource"]): string {
  const xs = Object.entries(by).filter(([, d]) => (d ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return xs.map(([s, d]) => `${fmtDays(d!).replace(/ days?$/, "")} ${sourceWord(s as FlowSource)}`).join(", ");
}

function teamName(model: Model, id: string): string { return model.teams.find((t) => t.id === id)?.name ?? id; }
/** "Engineering to Quality". */
export function hopText(model: Model, h: Pick<FlowHop, "fromTeam" | "toTeam">): string { return `${teamName(model, h.fromTeam)} to ${teamName(model, h.toTeam)}`; }

/**
 * Where flow explains a milestone's status in plain words: a milestone with a flow target (lead_days, handoffs) that is
 * not reached, against the first stream's numbers with their sources. Undefined when there is no stream or no target.
 */
export function milestoneFlowLine(b: { flow?: FlowFacts; plan: { phases: { id: string; flow_target?: { lead_days?: number; handoffs?: number } }[] } }, phase: string): string | undefined {
  const t = b.plan.phases.find((p) => p.id === phase)?.flow_target, s = b.flow?.streams[0];
  if (!t || !s) return undefined;
  const now: string[] = [], goal: string[] = [];
  if (t.lead_days !== undefined && s.lead !== undefined) { now.push(`takes about ${fmtDays(s.lead)}`); goal.push(`${fmtDays(t.lead_days)}`); }
  if (t.handoffs !== undefined) { now.push(`crosses ${s.handoffs} team ${s.handoffs === 1 ? "handoff" : "handoffs"}`); goal.push(`at most ${t.handoffs} ${t.handoffs === 1 ? "handoff" : "handoffs"}`); }
  if (!now.length) return undefined;
  const src = s.sources.length ? `from ${s.sources.join(" and ")} values` : "from values whose source is not given";
  return `Today a change ${now.join(" and ")} (${src}, as of ${shortDate(s.oldest, b.flow!.asOf)}); its target is ${goal.join(" and ")}.`;
}

// ---------- a patch's lead-time effect ----------

/**
 * What a patch does to each stream: the declared wait before and after by source, lead time where both sides have
 * it, team handoffs before and after against the limit, the hops it adds and removes, and what the tracker measured
 * at the steps it removes. Streams the patch leaves unchanged are left out.
 */
export function patchFlowEffect(config: InstanceConfig, before: Model, after: Model, today: string, measured?: FlowMeasured, own: string[] = []): PatchFlowEffect[] {
  const settings = flowSettings(config);
  const sb = flowSteps(before, settings, today, measured), sa = flowSteps(after, settings, today, measured);
  const views = new Map<string, [View | undefined, View | undefined]>();
  for (const v of streamViews(before, config)) views.set(v.id, [v, undefined]);
  for (const v of streamViews(after, config)) views.set(v.id, [views.get(v.id)?.[0], v]);
  const out: PatchFlowEffect[] = [];
  for (const [id, [vb, va]] of views) {
    const b = vb ? streamFlow(before, vb, settings, sb, measured) : undefined;
    const a = va ? streamFlow(after, va, settings, sa, measured) : undefined;
    if (!b || !a) continue;
    const key = (h: FlowHop) => `${h.fromTeam}>${h.toTeam}`;
    const kb = b.hops.map(key), ka = a.hops.map(key);
    const hopsAdded = a.hops.filter((h) => !kb.includes(key(h)) || ka.filter((k) => k === key(h)).length > kb.filter((k) => k === key(h)).length);
    const hopsRemoved = b.hops.filter((h) => !ka.includes(key(h)) || kb.filter((k) => k === key(h)).length > ka.filter((k) => k === key(h)).length);
    const stepsRemoved = b.path.filter((x) => !a.path.includes(x));
    const removed: PatchFlowEffect["wait"]["removed"] = {}, added: PatchFlowEffect["wait"]["added"] = {};
    for (const s of [...FLOW_SOURCES, "unknown"] as const) {
      const d = round((b.wait.bySource[s] ?? 0) - (a.wait.bySource[s] ?? 0));
      if (d > 0) removed[s] = d; else if (d < 0) added[s] = -d;
    }
    const workB = b.work?.days ?? 0, workA = a.work?.days ?? 0;
    const same = b.wait.days === a.wait.days && workB === workA && b.handoffs === a.handoffs && !hopsAdded.length && !hopsRemoved.length && JSON.stringify(b.path) === JSON.stringify(a.path);
    if (same) continue;
    const ms = stepsRemoved.map((x) => ({ element: x, ...(measured?.steps[x]?.wait ? { wait: measured.steps[x].wait } : {}), ...(measured?.steps[x]?.work ? { work: measured.steps[x].work } : {}) })).filter((x) => x.wait || x.work);
    const e: PatchFlowEffect = {
      view: id, title: (va ?? vb)!.title,
      wait: { before: b.wait.days, after: a.wait.days, removed, added },
      ...(b.lead !== undefined && a.lead !== undefined ? { lead: { before: b.lead, after: a.lead } } : {}),
      handoffs: { before: b.handoffs, after: a.handoffs, limit: settings.limit },
      hopsAdded, hopsRemoved, stepsRemoved,
      ...(ms.length ? { measured: ms } : {}),
      ...(b.work || a.work ? { work: { before: workB, after: workA } } : {}),
      text: "",
    };
    // values the patch writes itself, on a step of either path: an estimate in the patch, not a measurement
    const ownOn = own.filter((x) => b.path.includes(x) || a.path.includes(x));
    const ownRows: NonNullable<PatchFlowEffect["own"]> = [];
    for (const x of ownOn) for (const k of ["wait", "work", "wip"] as const) {
      const vb = sb[x]?.[k]?.value, va = sa[x]?.[k]?.value;
      if (vb !== va) ownRows.push({ element: x, key: k, ...(vb != null ? { before: vb } : {}), ...(va != null ? { after: va } : {}) });
    }
    if (ownRows.length) e.own = ownRows;
    e.text = effectText(e, before, after);
    out.push(e);
  }
  return out;
}

/** "Removes 4 days of estimated wait (lead time 30.5 to 26 days); team handoffs 7 to 6, at the limit of 6. New handoff: Quality to Platform." */
export function effectText(e: PatchFlowEffect, before: Model, after: Model): string {
  const parts: string[] = [];
  const amount = (by: Partial<Record<string, number>>) => {
    const xs = Object.entries(by).filter(([, d]) => (d ?? 0) > 0);
    const total = round(xs.reduce((t, [, d]) => t + (d ?? 0), 0));
    if (xs.length === 1) return `${fmtDays(total)} of ${xs[0][0] === "unknown" ? "wait whose source is not given" : `${sourceWord(xs[0][0] as FlowSource)} wait`}`;
    return `${fmtDays(total)} of wait (${xs.map(([s, d]) => `${fmtDays(d!).replace(/ days?$/, "")} ${sourceWord(s as FlowSource)}`).join(", ")})`;
  };
  const rem = Object.keys(e.wait.removed).length, add = Object.keys(e.wait.added).length;
  let first = rem && add ? `Removes ${amount(e.wait.removed)} and adds ${amount(e.wait.added)}` : rem ? `Removes ${amount(e.wait.removed)}` : add ? `Adds ${amount(e.wait.added)}` : "Leaves the declared wait as it is";
  // work removed counts as well as wait: lead time is both
  const dw = e.work ? round(e.work.before - e.work.after) : 0;
  if (dw > 0) first += ` and ${fmtDays(dw)} of work`; else if (dw < 0) first += ` and adds ${fmtDays(-dw)} of work`;
  if (e.lead && e.lead.before !== e.lead.after) first += ` (lead time ${fmtDays(e.lead.before).replace(/ days?$/, "")} to ${fmtDays(e.lead.after)}, from the same values)`;
  const h = e.handoffs;
  const where = h.after > h.limit ? `over the limit of ${h.limit}` : h.after === h.limit ? `at the limit of ${h.limit}` : `within the limit of ${h.limit}`;
  parts.push(`${first}; team handoffs ${h.before === h.after ? `stay at ${h.after}` : `${h.before} to ${h.after}`}, ${where}.`);
  if (e.hopsAdded.length) parts.push(`New handoff${e.hopsAdded.length > 1 ? "s" : ""}: ${e.hopsAdded.map((x) => hopText(after, x)).join(", ")}.`);
  if (e.hopsRemoved.length) parts.push(`Gone: ${e.hopsRemoved.map((x) => hopText(before, x)).join(", ")}.`);
  // a value the patch sets itself is its own estimate: said apart from what the structure removes
  const ownWait = (e.own ?? []).filter((o) => o.key === "wait" || o.key === "work");
  if (ownWait.length) {
    const nm = (id: string) => after.elements.find((x) => x.id === id)?.name ?? before.elements.find((x) => x.id === id)?.name ?? id;
    const delta = round(ownWait.reduce((t, o) => t + (o.before ?? 0) - (o.after ?? 0), 0));
    const what = ownWait.map((o) => `the ${o.key} at ${nm(o.element)}${o.before != null ? ` from ${fmtDays(o.before)}` : ""} to ${o.after != null ? fmtDays(o.after) : "none"}`).join(" and ");
    const structural = round((e.wait.before - e.wait.after) + (e.work ? e.work.before - e.work.after : 0) - delta);
    parts.push(`This patch sets ${what} itself: its own estimate, with no measurement behind it${delta && structural ? `; ${fmtDays(Math.abs(structural))} of the change comes from the structure` : ""}.`);
  }
  for (const m of e.measured ?? []) {
    const name = before.elements.find((x) => x.id === m.element)?.name ?? m.element;
    if (m.wait) parts.push(`The tracker measured ${fmtDays(m.wait.days)} of waiting before ${name} (median of ${m.wait.n} ${m.wait.n === 1 ? "change" : "changes"}).`);
  }
  return parts.join(" ");
}

// ---------- a done unit the model contradicts ----------

/** A unit's assertion about the model: every part of `every` kind (in view `in`, when given) carries `has` (an attribute or a field). */
export interface UnitAssert { every: string; has: string; in?: string }

export function unitAsserts(attrs: Record<string, unknown> | undefined): UnitAssert[] {
  const xs = attrs?.asserts;
  if (!Array.isArray(xs)) return [];
  return xs.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x) && "every" in x && "has" in x)
    .map((x) => ({ every: String(x.every), has: String(x.has), ...(x.in ? { in: String(x.in) } : {}) }));
}

/** The parts that contradict an assertion. */
export function contradicting(model: Model, a: UnitAssert): Element[] {
  const inView = a.in ? new Set(model.views.find((v) => v.id === a.in)?.elements ?? []) : undefined;
  return model.elements.filter((e) => e.kind === a.every && (!inView || inView.has(e.id)))
    .filter((e) => {
      const v = (e as unknown as Record<string, unknown>)[a.has] ?? e.attrs?.[a.has];
      return v === undefined || v === null || v === "";
    })
    .sort((x, y) => natCompare(x.id, y.id));
}
