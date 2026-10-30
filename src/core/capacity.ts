// Load by team across designs: capacity as a WIP limit, the share of it that a
// team's standing activities take, the allowance left for design work, the units every design has in doing against it,
// the queue behind it, the relief and slowdown timeline, the most contended team and the flow distribution.
// A portfolio build computes it once (src/core/portfolio.ts) when its root has an org layer; the portfolio pack's
// team-over-capacity reads it, and the portfolio page draws it.
//
// The numbers:
//   - capacity(T): the WIP limit in force, org.yaml's estimate after the root's accepted patches. A team with none
//     stated gets no finding, and the page says "capacity not stated".
//   - share(A, day): an activity's share as written, brought down by each relief that has landed (a unit done, a
//     milestone reached; retire takes it to 0, reduce to `to`) and by a slowdown in force (to its share_during). A
//     relief or a slowdown only ever lowers a share, so the order they land in does not matter.
//   - allowance(T) = capacity(T) × (1 − the sum of T's shares in force today), never below 0.
//   - doing(T): the units in doing, in every design composed, whose owner teams include T (a unit with several owner
//     teams takes a slot on each, as teams/team-load counts). ready(T): its open units that can start now and are not
//     in doing (every capability they require is available, across designs).
//   - Over capacity: doing(T) > allowance(T). An error when T owns an open unit on the path (status.ts pathOf, read
//     across the composed plan) to any composed design's current milestone, the first not reached; a warning otherwise.
//   - The projection: a milestone lands on its target date, "if on target", and a unit lands with its milestone. A
//     milestone with no target, or one whose target has passed while it is not reached, cannot be dated: its reliefs go
//     to the "No date" column. A slowdown ending at a milestone ends on that target; one whose end cannot be dated runs
//     on to the horizon (and to max_until, the latest it may run).
//   - The most contended team: open units on the paths to every design's next milestone, divided by the allowance. A
//     team with no allowance left (its shares take all of its capacity) ranks first; ties go to the most open units; a
//     team with no capacity stated ranks by its open units alone, as though it had one slot, and the page says so.
// Nothing here changes a file, a mark or another finding.

import type {
  ActivityLoad, Activity, ComposedDesign, ContendedTeam, DesignPath, FlowDistribution, FlowItemSource, LoadEvent, LoadFacts, LoadTimeline,
  LoadUnit, ManualWorkLoad, MeasureSummary, Model, OrgView, Phase, Plan, ReliefFacts, RootInput, Severity, Slowdown, SlowdownBet, TeamLoad,
  TeamLoadDelta, TransitionWork, Unit,
} from "../types.ts";
import { FLOW_ITEMS } from "./load.ts";
import { analyzePlan, uniqueUnits } from "./plan.ts";
import { unitRoles } from "./teams.ts";
import { estimateSettings, milestoneReached, milestoneTarget, slowdownInForce } from "./org.ts";
import { isDate } from "./estimate.ts";
import { ORG, parseRef, SHARED } from "./namespace.ts";
import { clause, dayText } from "./status.ts";
import { natCompare } from "./util.ts";
import { count, fmt, list, quote, sentence, verb } from "../site/prose.ts";

export const DEFAULT_HORIZON_MONTHS = 12;
const EPS = 1e-9;

/** A design composed in the portfolio, with what the load views read beyond its records. */
export interface LoadDesign extends ComposedDesign {
  imported?: boolean;                    // its plan comes from an edition's importer: a flow item in it is the edition's default
  transition?: TransitionWork;           // transition work (bundle.current.transition), own ids bare
}

export interface LoadInput {
  root: RootInput;
  org?: OrgView;                         // the org layer read with these designs composed (src/core/org.ts), measured values attached
  designs: LoadDesign[];
  graph: { model: Model; plan: Plan };   // every design and the shared layer as one namespaced graph (composeGraph)
  today?: string;                        // the build date, YYYY-MM-DD
  horizonMonths?: number;
  measure?: MeasureSummary;              // the root's latest measure, without its per-issue rows
}

export const CONTENDED_RULE = "The most contended team is the one whose open units on the paths to every design's next milestone, divided by its allowance, is highest. A team with no allowance left ranks first; ties go to the most open units; a team with no capacity stated ranks by its open units alone.";

// ---------- small words ----------

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number) => fmt(Math.round(x * 100) / 100);
const possessive = (t: string) => (/s$/i.test(t) ? `${t}'` : `${t}'s`);
const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** A unit's flow item: progress.yaml's (set here) over the plan's, which is the edition's default in an imported design. */
export function unitFlowItem(u: Pick<Unit, "attrs">, imported = false): LoadUnit["flow"] {
  const plan = typeof u.attrs?.flow_item === "string" ? (u.attrs.flow_item as string) : undefined;
  const set = typeof u.attrs?.flow_item_set === "string" ? (u.attrs.flow_item_set as string) : undefined;
  if (set) return { item: set, source: "set", ...(plan !== undefined && plan !== set ? { plan } : {}) };
  if (plan !== undefined) return { item: plan, source: imported ? "default" : "plan" };
  return undefined;
}

/** Is it one of the four flow items? */
export const isFlowItem = (x: string | undefined): boolean => !!x && (FLOW_ITEMS as readonly string[]).includes(x);

// ---------- dates ----------

const ym = (d: string) => d.slice(0, 7);
function addMonths(month: string, k: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, "0")}`;
}
function nextDay(date: string): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

// ---------- the computation ----------

interface Act { a: Activity; reliefs: ReliefFacts[]; slowdowns: Slowdown[] }

/** Load by team across the composed designs, or undefined when the root has no org layer (no team has a limit to read). */
export function loadFacts(input: LoadInput): LoadFacts | undefined {
  const { root, org, designs, graph } = input;
  if (!root.org || !org) return undefined;
  const today = input.today && isDate(input.today) ? input.today.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const months = input.horizonMonths && input.horizonMonths > 0 ? Math.floor(input.horizonMonths) : DEFAULT_HORIZON_MONTHS;
  const horizonEnd = lastDayOf(addMonths(ym(today), months - 1));
  const notes: string[] = [];
  const byNs = new Map(designs.map((d) => [d.namespace, d]));
  const titleOf = (ns: string) => byNs.get(ns)?.title ?? ns;

  // ── units across the designs ──
  const units = uniqueUnits(graph.plan);
  const unitById = new Map(units.map((u) => [u.id, u]));
  const roles = unitRoles(graph.model, graph.plan);
  const analysis = analyzePlan(graph.plan);
  const frontier = new Set(analysis.frontier);
  const statusOf = (u: Unit): LoadUnit["status"] => (u.status === "done" || u.status === "doing" ? u.status : "todo");
  const open = (id: string) => { const u = unitById.get(id); return !!u && statusOf(u) !== "done"; };
  const phaseById = new Map(graph.plan.phases.map((p) => [p.id, p]));
  const loadUnits: Record<string, LoadUnit> = {};
  for (const u of units) {
    const r = parseRef(u.id), ns = r.ns ?? "", d = byNs.get(ns);
    const tw = d?.transition;
    const lu: LoadUnit = { id: u.id, design: ns, title: u.title, milestone: u.phase, status: statusOf(u), owners: roles[u.id]?.owners ?? [] };
    const fl = unitFlowItem(u, !!d?.imported);
    if (fl) lu.flow = fl;
    if (tw?.units.includes(r.id)) { lu.transition = true; if (tw.discovered.includes(r.id)) lu.discovered = true; }
    if (lu.status === "todo" && frontier.has(u.id)) lu.ready = true;
    loadUnits[u.id] = lu;
  }

  // ── each design's current milestone and its path ──
  const paths: DesignPath[] = [];
  for (const d of designs) {
    const ns = d.namespace;
    const phases = graph.plan.phases.filter((p) => parseRef(p.id).ns === ns).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || natCompare(a.id, b.id));
    const mine = units.filter((u) => parseRef(u.id).ns === ns);
    const reachedSet = new Set(phases.filter((p) => { const us = mine.filter((u) => u.phase === p.id); return us.length > 0 && us.every((u) => statusOf(u) === "done"); }).map((p) => p.id));
    const current = phases.find((p) => !reachedSet.has(p.id));
    const idx = new Map(phases.map((p, i) => [p.id, i]));
    const path: string[] = [];
    if (current) {
      const mi = idx.get(current.id)!;
      const seen = new Set<string>();
      const stack = mine.filter((u) => u.phase === current.id && open(u.id)).map((u) => u.id);
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        const u = unitById.get(id);
        if (!u || !open(id)) continue;
        // an earlier milestone of this design that is not reached is its own path's (none, for the current milestone)
        if (parseRef(id).ns === ns && u.phase !== current.id && (idx.get(u.phase) ?? -1) < mi && !reachedSet.has(u.phase)) continue;
        seen.add(id);
        stack.push(...(analysis.deps[id] ?? []));
      }
      const order = (id: string) => { const u = unitById.get(id)!; const p = phaseById.get(u.phase); return [parseRef(id).ns === ns ? 0 : 1, p?.order ?? 0] as const; };
      path.push(...[...seen].sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1] || natCompare(a, b)));
      for (const id of path) if (loadUnits[id] && !loadUnits[id].onPath) loadUnits[id].onPath = current.id;
    }
    paths.push({ design: ns, title: d.title, ...(current ? { milestone: current.id, name: current.name, ...(current.target ? { target: current.target } : {}) } : {}), units: path, reached: phases.filter((p) => reachedSet.has(p.id)).map((p) => p.id) });
  }

  // ── activities: reliefs read, slowdowns gathered ──
  const compose: ComposedDesign[] = designs;
  const acts: Act[] = org.activities.map((a) => ({ a, reliefs: a.relieved_by.map((r) => reliefFacts(r, compose, today)), slowdowns: org.slowdowns.filter((s) => s.activity === `${ORG}:${a.id}`) }));
  for (const x of acts) for (const r of x.reliefs) if (r.kind === "unknown" && !byNs.has(parseRef(r.at).ns ?? "")) notes.push(`${x.a.name}'s relief at ${r.at} names a design this portfolio does not compose, so it never lands here.`);

  /** A slowdown in force on `day` (today or later): today as org.ts judges it; later, ending on its milestone's target. */
  const slowdownOn = (sd: Slowdown, day: string): boolean => {
    if (day <= today) return slowdownInForce(sd, day, compose);
    if (!sd.valid || !isDate(sd.from) || day < sd.from) return false;
    if (sd.max_until && isDate(sd.max_until) && day > sd.max_until) return false;
    if (isDate(sd.until)) return day <= sd.until;
    if (milestoneReached(sd.until, compose) === true) return false;
    const t = milestoneTarget(sd.until, compose);
    return t && isDate(t) && t > today ? day < t : true;
  };
  /** An activity's share on `day`: as written, lowered by the reliefs landed by then and a slowdown in force. */
  const shareOn = (x: Act, day: string, skip?: Slowdown): { share: number; why: string[] } => {
    let s = x.a.share?.value ?? 0;
    const why: string[] = [];
    for (const r of x.reliefs) {
      if (!(r.landed || (r.date && r.date <= day))) continue;
      const to = r.effect === "retire" ? 0 : r.to;
      if (to < s - EPS) { s = to; why.push(r.landed ? `${reliefName(r, titleOf)} ${r.kind === "unit" ? "is done" : "is reached"}` : `${reliefName(r, titleOf)} lands, if on target`); }
    }
    for (const sd of x.slowdowns) {
      if (sd === skip || !sd.share_during || !slowdownOn(sd, day)) continue;
      if (sd.share_during.value < s - EPS) { s = sd.share_during.value; why.push(`the slowdown from ${dayText(sd.from)} holds it at ${pct(sd.share_during.value)}`); }
    }
    return { share: s, why };
  };

  // ── teams ──
  const measured = new Map((input.measure?.teams ?? []).map((t) => [`${ORG}:${t.team}`, t]));
  const teams: TeamLoad[] = org.teams.map((t) => {
    const id = `${ORG}:${t.id}`;
    const cap = t.capacity?.value;
    const mine = acts.filter((x) => x.a.team === id);
    const shares = mine.map((x) => { const s = shareOn(x, today); return { activity: `${ORG}:${x.a.id}`, name: x.a.name, type: x.a.type, share: r4(s.share), ...(cap !== undefined ? { slots: r4(s.share * cap) } : {}), why: s.why }; });
    const standing = r4(shares.reduce((n, s) => n + s.share, 0));
    const allTaken = standing >= 1 - EPS;
    const allowance = cap === undefined ? undefined : r4(cap * Math.max(0, 1 - standing));
    const owned = Object.values(loadUnits).filter((u) => u.owners.includes(id));
    const doing = owned.filter((u) => u.status === "doing").map((u) => u.id);
    const doingBy = designs.map((d) => {
      const us = owned.filter((u) => u.status === "doing" && u.design === d.namespace);
      return { design: d.namespace, units: us.length, transition: us.filter((u) => u.transition).length, discovered: us.filter((u) => u.discovered).length };
    }).filter((x) => x.units);
    const ready = owned.filter((u) => u.ready).map((u) => u.id);
    const onPath = owned.filter((u) => u.onPath).map((u) => u.id);
    const free = allowance === undefined ? undefined : r4(allowance - doing.length);
    const over = allowance !== undefined && doing.length > allowance + EPS;
    const severity: Severity | undefined = over ? (onPath.length ? "error" : "warning") : undefined;
    const m = measured.get(id);
    const tl: TeamLoad = {
      team: id, name: t.name, ...(t.lead ? { lead: t.lead } : {}), ...(cap !== undefined ? { capacity: cap } : {}),
      shares, standing, allTaken, ...(allowance !== undefined ? { allowance } : {}),
      doing, doingBy, ready, onPath, ...(free !== undefined ? { free } : {}), over, ...(severity ? { severity } : {}),
      contention: { rank: 0, open: onPath.length, basis: "nothing on a path" },
      ...(m && m.days > 0 ? { unclassified: { share: m.unclassified.share, ...(cap !== undefined ? { slots: r4(m.unclassified.share * cap) } : {}), as_of: input.measure!.as_of, file: input.measure!.file } } : {}),
      ...(m?.calibration ? { calibration: { text: m.calibration.text, ...(m.calibration.verdict ? { verdict: m.calibration.verdict } : {}), ...(m.calibration.proposed !== undefined ? { proposed: m.calibration.proposed } : {}) } } : {}),
      timeline: { steps: [], months: [], undated: [] },
      text: "",
    };
    tl.timeline = timelineOf(tl, mine, cap, { today, horizonEnd, shareOn, slowdownOn, titleOf, compose });
    tl.text = teamText(tl, loadUnits, titleOf);
    return tl;
  });

  // ── the most contended team ──
  const score = (t: TeamLoad): number => {
    const n = t.onPath.length;
    if (!n) return 0;
    if (t.allowance === undefined) return n;            // capacity not stated: its work alone
    if (t.allowance <= EPS) return Number.POSITIVE_INFINITY; // no allowance left: first
    return n / t.allowance;
  };
  for (const t of teams) {
    const n = t.onPath.length;
    t.contention = {
      rank: 0, open: n,
      basis: !n ? "nothing on a path" : t.allowance === undefined ? "work alone" : t.allowance <= EPS ? "no allowance" : "allowance",
      ...(n && t.allowance !== undefined && t.allowance > EPS ? { ratio: r4(n / t.allowance) } : {}),
    };
  }
  const ranked = [...teams].sort((a, b) => score(b) - score(a) || b.onPath.length - a.onPath.length || natCompare(a.name, b.name) || natCompare(a.team, b.team));
  ranked.forEach((t, i) => { t.contention.rank = i + 1; });
  const top = ranked.find((t) => score(t) > 0);
  const contended: ContendedTeam | undefined = top ? {
    team: top.team, name: top.name, open: top.onPath.length, ...(top.allowance !== undefined ? { allowance: top.allowance } : {}),
    ...(top.contention.ratio !== undefined ? { ratio: top.contention.ratio } : {}), basis: top.contention.basis,
    units: top.onPath.map((id) => { const u = loadUnits[id]; const p = phaseById.get(u.onPath ?? u.milestone); return { unit: id, title: u.title, design: u.design, milestone: u.onPath ?? u.milestone, ...(p ? { milestoneName: p.name } : {}) }; }),
    next: ranked.filter((t) => t !== top && score(t) > 0).slice(0, 3).map((t) => ({ team: t.team, name: t.name, open: t.onPath.length, basis: t.contention.basis, ...(t.contention.ratio !== undefined ? { ratio: t.contention.ratio } : {}) })),
    text: contendedText(top),
  } : undefined;

  // ── activities, slowdown bets, distribution, manual work ──
  const capOf = new Map(teams.map((t) => [t.team, t.capacity]));
  const teamName = new Map(teams.map((t) => [t.team, t.name]));
  const gapShare = estimateSettings(root).gap.share;
  const activities: ActivityLoad[] = acts.map((x) => activityLoad(x, { today, capOf, teamName, org, gapShare, shareOn, titleOf }));
  const slowdowns: SlowdownBet[] = org.slowdowns.map((sd) => slowdownBet(sd, { today, acts, capOf, teamName, org, shareOn, slowdownOn, compose, phaseById }));
  const distribution = flowDistribution(designs, loadUnits, acts, teams, today, shareOn);
  const manualWork = manualWorkLoad(root, org, designs, loadUnits);

  const out: LoadFacts = {
    today, horizon: { months, to: horizonEnd }, rule: CONTENDED_RULE,
    units: loadUnits, paths, teams: ranked, ...(contended ? { contended } : {}),
    activities, slowdowns, distribution, manualWork,
    counts: { teams: teams.length, stated: teams.filter((t) => t.capacity !== undefined).length, over: teams.filter((t) => t.over).length, overOnPath: teams.filter((t) => t.severity === "error").length, slowdownsRunning: slowdowns.filter((s) => s.state === "running").length },
    notes: [...new Set(notes)],
  };
  return out;
}

// ---------- reliefs ----------

/** A relief as this build reads it: what it names, whether it has landed, and when it would land if on target. */
export function reliefFacts(r: Activity["relieved_by"][number], compose: ComposedDesign[], today: string): ReliefFacts {
  const ref = parseRef(r.at);
  const ns = ref.ns ?? "";
  const at = `${ns}:${ref.id}`;
  const to = r.effect === "retire" ? 0 : r.to?.value ?? 0;
  const base = { at, effect: r.effect, to } as const;
  const d = compose.find((x) => x.namespace === ns);
  if (!d) return { ...base, kind: "unknown", landed: false, undated: `${ns} is not composed here` };
  const unit = ref.kind !== "phase" ? d.plan.units.find((u) => u.id === ref.id) : undefined;
  const phase = unit ? d.plan.phases.find((p) => p.id === unit.phase) : ref.kind !== "unit" ? d.plan.phases.find((p) => p.id === ref.id) : undefined;
  if (!unit && !phase) return { ...base, kind: "unknown", design: ns, landed: false, undated: `${d.title} holds no unit or milestone ${ref.id}` };
  const doneDate = (u: Unit) => { const s = u.attrs?.status_set as { date?: string } | undefined; return u.status === "done" && s?.date ? s.date : undefined; };
  let landed: boolean, reachedOn: string | undefined;
  if (unit) { landed = unit.status === "done"; reachedOn = doneDate(unit); }
  else {
    landed = milestoneReached(`${ns}:${phase!.id}`, compose) === true;
    const us = d.plan.units.filter((u) => u.phase === phase!.id);
    const dates = us.map(doneDate);
    reachedOn = landed && dates.every(Boolean) ? (dates as string[]).sort().at(-1) : undefined;
  }
  const target = phase?.target;
  const out: ReliefFacts = {
    ...base, kind: unit ? "unit" : "milestone", name: unit ? unit.title : phase!.name, design: ns,
    ...(phase ? { milestone: `${ns}:${phase.id}`, milestoneName: phase.name } : {}), ...(target ? { target } : {}),
    landed, ...(reachedOn ? { reachedOn } : {}),
  };
  if (!landed) {
    if (!phase) out.undated = "its unit sits in no milestone";
    else if (!target || !isDate(target)) out.undated = `${quote(phase.name)} has no target date`;
    else if (target.slice(0, 10) <= today) out.undated = `${quote(phase.name)} was due ${dayText(target)} and is not reached`;
    else out.date = target.slice(0, 10);
  }
  return out;
}

/** "Findings intake's “Triage agent drafts severity and owner”" or "Asset inventory cleanup's “Know what we have”". */
function reliefName(r: ReliefFacts, titleOf: (ns: string) => string): string {
  return r.design ? `${possessive(titleOf(r.design))} ${quote(r.name ?? r.at)}` : r.at;
}

// ---------- the timeline ----------

interface TimelineCtx {
  today: string; horizonEnd: string;
  shareOn: (x: Act, day: string, skip?: Slowdown) => { share: number; why: string[] };
  slowdownOn: (sd: Slowdown, day: string) => boolean;
  titleOf: (ns: string) => string;
  compose: ComposedDesign[];
}

/** A team's standing load from today to the horizon: a step at each date it changes, each month's end, and what cannot be dated. */
function timelineOf(t: TeamLoad, mine: Act[], cap: number | undefined, c: TimelineCtx): LoadTimeline {
  const allowance = (standing: number) => (cap === undefined ? undefined : r4(cap * Math.max(0, 1 - standing)));
  const at = (day: string) => {
    const shares: Record<string, number> = {};
    let standing = 0;
    for (const x of mine) { const s = c.shareOn(x, day).share; shares[`${ORG}:${x.a.id}`] = r4(s); standing += s; }
    return { shares, standing: r4(standing), ...(cap !== undefined ? { allowance: allowance(standing) } : {}) };
  };
  // the dates the load may change: reliefs landing, slowdowns starting and ending
  const dates = new Set<string>();
  const sources: { day: string; make: (from: number, to: number) => LoadEvent; x: Act }[] = [];
  for (const x of mine) {
    const a = x.a, aid = `${ORG}:${a.id}`;
    for (const r of x.reliefs) {
      if (r.landed || !r.date || r.date <= c.today || r.date > c.horizonEnd) continue;
      dates.add(r.date);
      sources.push({ day: r.date, x, make: (from, to) => ({ kind: "relief", activity: aid, name: a.name, at: r.at, date: r.date, ifOnTarget: true, from, to, text: reliefText(a.name, r, c.titleOf) }) });
    }
    for (const sd of x.slowdowns) {
      if (!sd.valid) continue;
      if (isDate(sd.from) && sd.from > c.today && sd.from <= c.horizonEnd) {
        dates.add(sd.from);
        sources.push({ day: sd.from, x, make: (from, to) => ({ kind: "slowdown-start", activity: aid, name: a.name, slowdown: `${ORG}:${sd.id}`, date: sd.from, from, to, text: sentence(`The slowdown of ${quote(a.name)} starts: ${from - to > EPS ? `its share falls from ${pct(from)} to ${pct(to)}` : "it frees nothing, since the share is already lower"}`) }) });
      }
      const end = slowdownEnd(sd, c);
      if (end && end.day > c.today && end.day <= c.horizonEnd) {
        dates.add(end.day);
        sources.push({ day: end.day, x, make: (from, to) => ({ kind: "slowdown-end", activity: aid, name: a.name, slowdown: `${ORG}:${sd.id}`, date: end.day, ...(end.ifOnTarget ? { ifOnTarget: true } : {}), from, to, text: sentence(`The slowdown of ${quote(a.name)} from ${dayText(sd.from)} ends ${end.how}${Math.abs(to - from) > EPS ? `: its share goes from ${pct(from)} to ${pct(to)}` : ""}`) }) });
      }
    }
  }
  const first = at(c.today);
  const steps: LoadTimeline["steps"] = [{ from: c.today, ...first, events: [] }];
  let prev = first;
  for (const day of [...dates].sort()) {
    const now = at(day);
    const events = sources.filter((s) => s.day === day).map((s) => { const k = `${ORG}:${s.x.a.id}`; return s.make(prev.shares[k] ?? 0, now.shares[k] ?? 0); });
    if (Math.abs(now.standing - prev.standing) > EPS || events.length) steps.push({ from: day, ...now, events });
    prev = now;
  }
  const monthsOut: LoadTimeline["months"] = [];
  for (let m = ym(c.today); m <= ym(c.horizonEnd); m = addMonths(m, 1)) { const v = at(lastDayOf(m)); monthsOut.push({ month: m, standing: v.standing, ...(v.allowance !== undefined ? { allowance: v.allowance } : {}) }); }
  // what cannot be dated: reliefs not landed whose milestone has no target, or is past it
  const undated: LoadEvent[] = [];
  for (const x of mine) for (const r of x.reliefs) {
    if (r.landed || r.date) continue;
    const from = c.shareOn(x, c.horizonEnd).share, to = Math.min(from, r.effect === "retire" ? 0 : r.to);
    undated.push({ kind: "relief", activity: `${ORG}:${x.a.id}`, name: x.a.name, at: r.at, from: r4(from), to: r4(to), text: sentence(`${quote(x.a.name)} ${r.effect === "retire" ? "ends" : `falls to ${pct(r.to)}`} when ${reliefWhen(r, c.titleOf)}, which cannot be dated: ${r.undated ?? "it has no date"}`) });
  }
  return { steps, months: monthsOut, undated };
}

/** When a slowdown stops being in force, as the projection reads it, or undefined when its end cannot be dated. */
function slowdownEnd(sd: Slowdown, c: TimelineCtx): { day: string; how: string; ifOnTarget?: boolean } | undefined {
  const cap = sd.max_until && isDate(sd.max_until) ? nextDay(sd.max_until) : undefined;
  let end: { day: string; how: string; ifOnTarget?: boolean } | undefined;
  if (isDate(sd.until)) end = { day: nextDay(sd.until), how: `after ${dayText(sd.until)}` };
  else if (milestoneReached(sd.until, c.compose) !== true) {
    const t = milestoneTarget(sd.until, c.compose);
    const r = parseRef(sd.until);
    const d = c.compose.find((x) => x.namespace === r.ns);
    const name = d?.plan.phases.find((p) => p.id === r.id)?.name ?? sd.until;
    if (t && isDate(t) && t.slice(0, 10) > c.today) end = { day: t.slice(0, 10), how: `with ${possessive(c.titleOf(r.ns ?? ""))} ${quote(name)} (target ${dayText(t)}), if on target`, ifOnTarget: true };
  }
  if (cap && (!end || cap < end.day)) end = { day: cap, how: `at the latest it may run, ${dayText(sd.max_until)}` };
  return end;
}

function reliefWhen(r: ReliefFacts, titleOf: (ns: string) => string): string {
  if (r.kind === "unit") return `${reliefName(r, titleOf)} is done${r.milestoneName ? `, with ${quote(r.milestoneName)}` : ""}`;
  return `${reliefName(r, titleOf)} is reached`;
}

/** A relief landing, in words: what the relief itself does to the share. The step it sits on carries the net change. */
function reliefText(name: string, r: ReliefFacts, titleOf: (ns: string) => string): string {
  const what = r.effect === "retire" ? "ends" : `falls to ${pct(r.to)}`;
  return sentence(`${quote(name)} ${what} when ${reliefWhen(r, titleOf)} (target ${dayText(r.date)}), if on target`);
}

// ---------- words for a team ----------

/** Units by title, each with its design: "Findings intake's “A”, “B” and 2 more". */
export function unitsText(ids: string[], units: Record<string, LoadUnit>, titleOf: (ns: string) => string, max = 3): string {
  const byDesign = new Map<string, string[]>();
  for (const id of ids) { const u = units[id]; if (!u) continue; byDesign.set(u.design, [...(byDesign.get(u.design) ?? []), quote(u.title)]); }
  const parts: string[] = [];
  let shown = 0;
  for (const [ns, ts] of byDesign) {
    if (shown >= max) break;
    const take = ts.slice(0, max - shown);
    shown += take.length;
    parts.push(`${possessive(titleOf(ns))} ${list(take)}`);
  }
  const more = ids.length - shown;
  return more > 0 ? `${parts.join("; ")} and ${more} more` : parts.join("; ");
}

function teamText(t: TeamLoad, units: Record<string, LoadUnit>, titleOf: (ns: string) => string): string {
  if (t.capacity === undefined) return sentence(`${t.name}'s capacity is not stated, so its load cannot be weighed; it has ${count(t.doing.length, "unit")} in doing`);
  const standing = t.capacity * Math.min(1, t.standing);
  const whole = t.capacity === 1 ? "its 1 slot" : `all ${count(t.capacity, "slot")} of its limit`;
  const load = t.allTaken ? `keeping the lights on and other streams take ${whole}, which leaves none for design work`
    : t.standing > EPS ? `keeping the lights on and other streams take ${num(standing)} of its ${count(t.capacity, "slot")}, leaving an allowance of ${num(t.allowance!)} for design work`
    : `nothing goes to keeping the lights on or other streams, so ${whole} ${t.capacity === 1 ? "is" : "are"} its allowance for design work`;
  const doing = t.doing.length ? `${count(t.doing.length, "unit")} in doing (${unitsText(t.doing, units, titleOf)})` : "no unit in doing";
  const state = t.over ? `over by ${num(-(t.free ?? 0))}` : `${num(t.free ?? 0)} free`;
  return `${sentence(`${t.name}: ${load}`)} ${sentence(`It carries ${doing}, ${state}`)}`;
}

/** The finding's words (portfolio/team-over-capacity). */
export function overCapacityText(t: TeamLoad, f: LoadFacts, titleOf: (ns: string) => string): string {
  const cap = t.capacity!, standing = cap * Math.min(1, t.standing);
  const n = count(t.doing.length, "unit");
  const first = sentence(t.allTaken
    ? `${t.name} (${t.team}) has ${n} in doing, and its activities take all of its capacity: keeping the lights on and other streams leave none of its ${count(cap, "slot")} for design work`
    : t.standing > EPS ? `${t.name} (${t.team}) has ${n} in doing against an allowance of ${num(t.allowance!)}: a limit of ${cap}, less ${num(standing)} for keeping the lights on and other streams`
    : `${t.name} (${t.team}) has ${n} in doing against an allowance of ${num(t.allowance!)}: a limit of ${cap}, with nothing taken for keeping the lights on or other streams`);
  const doing = sentence(`In doing: ${unitsText(t.doing, f.units, titleOf)}`);
  if (t.severity === "error") {
    const byPath = new Map<string, number>();
    for (const id of t.onPath) { const m = f.units[id]?.onPath; if (m) byPath.set(m, (byPath.get(m) ?? 0) + 1); }
    const toward = [...byPath].map(([m, n]) => { const p = f.paths.find((x) => x.milestone === m); return `${count(n, "unit")} toward ${possessive(titleOf(p?.design ?? parseRef(m).ns ?? ""))} ${quote(p?.name ?? m)}`; });
    return `${first} ${doing} ${sentence(`It owns open work on the path to a next milestone: ${list(toward)}, so the overrun holds ${byPath.size === 1 ? "that milestone" : "those milestones"} back`)}`;
  }
  return `${first} ${doing} ${sentence("None of its open work is on the path to a design's next milestone, so the overrun slows later work rather than the next milestones")}`;
}

function contendedText(t: TeamLoad): string {
  const n = count(t.onPath.length, "open unit");
  if (t.contention.basis === "no allowance") return sentence(`${t.name} is the most contended: ${n} on the paths to the next milestones, and keeping the lights on and other streams take all of its capacity`);
  if (t.contention.basis === "work alone") return sentence(`${t.name} is the most contended by its work alone: ${n} on the paths to the next milestones; its capacity is not stated`);
  return sentence(`${t.name} is the most contended: ${n} on the paths to the next milestones, against an allowance of ${num(t.allowance!)} after keeping the lights on and other streams`);
}

// ---------- activities and slowdowns ----------

function activityLoad(x: Act, c: { today: string; capOf: Map<string, number | undefined>; teamName: Map<string, string>; org: OrgView; gapShare: number; shareOn: (x: Act, day: string, skip?: Slowdown) => { share: number; why: string[] }; titleOf: (ns: string) => string }): ActivityLoad {
  const a = x.a, id = `${ORG}:${a.id}`;
  const now = c.shareOn(x, c.today);
  const cap = c.capOf.get(a.team);
  const est = c.org.estimates.find((e) => e.record === id && e.field === "share");
  const latest = est?.measured?.latest;
  const out: ActivityLoad = {
    activity: id, name: a.name, team: a.team, teamName: c.teamName.get(a.team) ?? a.team, type: a.type, ...(a.flow_item ? { flow_item: a.flow_item } : {}),
    ...(a.share ? { share: a.share.value } : {}), now: r4(now.share), ...(cap !== undefined ? { slots: r4(now.share * cap) } : {}), why: now.why,
    reliefs: x.reliefs, slowdowns: x.slowdowns.map((s) => `${ORG}:${s.id}`), ...(a.manual_work ? { manual_work: a.manual_work } : {}),
    ...(latest ? { measured: { value: latest.value, as_of: latest.as_of, confidence: latest.confidence } } : {}),
  };
  // the payoff: once a relief has landed, the share it projects against the latest measure
  const landed = x.reliefs.filter((r) => r.landed);
  if (landed.length && a.share) {
    let projected = a.share.value;
    for (const r of landed) projected = Math.min(projected, r.effect === "retire" ? 0 : r.to);
    const after = landed.map((r) => `${reliefName(r, c.titleOf)}${r.reachedOn ? ` (${r.kind === "unit" ? "done" : "reached"} ${dayText(r.reachedOn)})` : ` (${r.kind === "unit" ? "done" : "reached"})`}`);
    const head = `Projected ${pct(projected)} after ${list(after)}`;
    if (!latest) out.payoff = { projected: r4(projected), measured: NaN, landed: false, after: landed.map((r) => r.at), text: sentence(`${head}; not measured yet, so whether the payoff has landed is not known`) };
    else {
      const before = landed.every((r) => r.reachedOn && latest.as_of < r.reachedOn);
      const ok = latest.value <= projected + c.gapShare + EPS;
      out.payoff = {
        projected: r4(projected), measured: latest.value, landed: !before && ok, after: landed.map((r) => r.at),
        text: sentence(before ? `${head}; measured ${pct(latest.value)} over the window to ${dayText(latest.as_of)}, before it landed, so measure again to see the payoff`
          : `${head}; measured ${pct(latest.value)}: the payoff has ${ok ? "landed" : "not landed"}`),
      };
    }
    if (Number.isNaN(out.payoff.measured)) delete (out.payoff as { measured?: number }).measured;
  }
  return out;
}

function slowdownBet(sd: Slowdown, c: { today: string; acts: Act[]; capOf: Map<string, number | undefined>; teamName: Map<string, string>; org: OrgView; shareOn: (x: Act, day: string, skip?: Slowdown) => { share: number; why: string[] }; slowdownOn: (sd: Slowdown, day: string) => boolean; compose: ComposedDesign[]; phaseById: Map<string, Phase> }): SlowdownBet {
  const x = c.acts.find((y) => `${ORG}:${y.a.id}` === sd.activity);
  const team = x?.a.team ?? "", cap = c.capOf.get(team);
  const id = `${ORG}:${sd.id}`;
  const flags = c.org.problems.filter((p) => p.at === id && (p.rule === "org/slowdown-overdue" || p.rule === "org/slowdown-valid")).map((p) => p.message);
  const state: SlowdownBet["state"] = !sd.valid ? "not applied" : isDate(sd.from) && c.today < sd.from ? "not started" : c.slowdownOn(sd, c.today) ? "running" : "ended";
  const share = x ? r4(c.shareOn(x, c.today, sd).share) : undefined;
  const during = sd.share_during?.value;
  const frees = share !== undefined && during !== undefined && cap !== undefined ? r4(Math.max(0, share - during) * cap) : undefined;
  const r = parseRef(sd.until);
  const d = !isDate(sd.until) && r.ns ? c.compose.find((y) => y.namespace === r.ns) : undefined;
  const ph = d?.plan.phases.find((p) => p.id === r.id);
  const out: SlowdownBet = {
    id, activity: sd.activity, activityName: x?.a.name ?? sd.activity, team, teamName: c.teamName.get(team) ?? team, what: sd.what, state,
    from: sd.from, until: sd.until, ...(ph ? { untilName: ph.name, ...(ph.target ? { untilTarget: ph.target } : {}) } : {}), ...(sd.max_until ? { max_until: sd.max_until } : {}),
    ...(share !== undefined ? { share } : {}), ...(during !== undefined ? { during } : {}), ...(frees !== undefined ? { frees } : {}),
    risk: sd.risk, accepted_by: sd.accepted_by, accepted_at: sd.accepted_at, ...(sd.review_by ? { review_by: sd.review_by } : {}), flags, text: "",
  };
  out.text = betText(out, d?.title);
  return out;
}

/** The bet in words: what slows from when until when, what it frees, the risk meanwhile, who accepted it. */
function betText(b: SlowdownBet, design?: string): string {
  if (b.state === "not applied") return sentence(`The slowdown of ${quote(b.activityName)}${b.from ? ` from ${dayText(b.from)}` : ""} is not applied: it is not a whole, accepted bet yet`);
  const until = b.untilName ? `${design ? `${possessive(design)} ` : ""}${quote(b.untilName)}${b.untilTarget ? ` (target ${dayText(b.untilTarget)})` : ""}` : dayText(b.until);
  const verbs = { running: "We are slowing", "not started": "We will slow", ended: "We slowed" } as const;
  const head = sentence(`${verbs[b.state as keyof typeof verbs]} ${quote(b.activityName)} from ${dayText(b.from)} until ${until}: ${clause(b.what)}`);
  const frees = b.frees !== undefined ? sentence(b.frees > EPS ? `That ${b.state === "ended" ? "freed" : "frees"} ${num(b.frees)} of a slot for ${b.teamName}, from ${pct(b.share!)} of its capacity to ${pct(b.during!)}` : `That frees nothing for ${b.teamName}: the share is already at or below ${pct(b.during!)}`) : sentence(`What it frees cannot be counted: ${b.teamName}'s capacity is not stated`);
  const risk = b.risk.rises ? sentence(`Meanwhile, ${clause(b.risk.rises)}`) : "";
  const who = sentence(`Accepted by ${list(b.accepted_by)} on ${dayText(b.accepted_at)}${b.review_by ? `; review by ${dayText(b.review_by)}` : ""}`);
  return [head, frees, risk, who].filter(Boolean).join(" ");
}

// ---------- the distribution and manual work ----------

function flowDistribution(designs: LoadDesign[], units: Record<string, LoadUnit>, acts: Act[], teams: TeamLoad[], today: string, shareOn: (x: Act, day: string) => { share: number }): FlowDistribution {
  const items = [...FLOW_ITEMS] as string[];
  const zero = () => Object.fromEntries(items.map((i) => [i, 0])) as Record<string, number>;
  const totals = { units: zero(), activities: zero(), open: 0, defaults: 0, set: 0, missing: 0 };
  const perDesign = designs.map((d) => {
    const by = zero();
    let openN = 0, defaults = 0, set = 0, missing = 0;
    for (const u of Object.values(units)) {
      if (u.design !== d.namespace || u.status === "done") continue;
      openN++;
      const it = u.flow?.item;
      if (isFlowItem(it)) by[it!]++; else missing++;
      if (u.flow?.source === "default") defaults++;
      if (u.flow?.source === "set") set++;
    }
    for (const i of items) totals.units[i] += by[i];
    totals.open += openN; totals.defaults += defaults; totals.set += set; totals.missing += missing;
    return { design: d.namespace, title: d.title, open: openN, by, defaults, set, missing };
  });
  const perTeam = teams.map((t) => {
    const by: Record<string, { count: number; share: number; slots?: number }> = {};
    for (const x of acts.filter((y) => y.a.team === t.team)) {
      const it = isFlowItem(x.a.flow_item) ? x.a.flow_item! : "unmapped";
      const s = shareOn(x, today).share;
      const cell = by[it] ??= { count: 0, share: 0, ...(t.capacity !== undefined ? { slots: 0 } : {}) };
      cell.count++; cell.share = r4(cell.share + s);
      if (cell.slots !== undefined) cell.slots = r4(cell.slots + s * t.capacity!);
      if (it !== "unmapped") totals.activities[it]++;
    }
    return { team: t.team, name: t.name, by };
  }).filter((x) => Object.keys(x.by).length);
  const split = items.filter((i) => totals.units[i]).map((i) => `${totals.units[i]} ${i}`);
  const text = !totals.open ? "No unit is open." : [
    sentence(`${count(totals.open, "open unit")}: ${list(split)}${totals.missing ? `, and ${totals.missing} with no flow item` : ""}`),
    sentence(totals.defaults ? `${totals.defaults} of them still ${verb(totals.defaults, "carries", "carry")} an edition's default` : "None still carries an edition's default"),
    ...(totals.set ? [sentence(`${count(totals.set, "value")} ${verb(totals.set, "is", "are")} set here, over the plan's`)] : []),
  ].join(" ");
  return { items, designs: perDesign, teams: perTeam, totals, text };
}

function manualWorkLoad(root: RootInput, org: OrgView, designs: LoadDesign[], units: Record<string, LoadUnit>): ManualWorkLoad[] {
  const sh = root.shared;
  const out: ManualWorkLoad[] = [];
  const sharedClaims = new Map((sh?.claims ?? []).map((c) => [c.id, c]));
  for (const k of sh?.manual_work ?? []) {
    const kind = `${SHARED}:${k.id}`;
    const linking = org.activities.filter((a) => a.manual_work === kind);
    const named = new Set(linking.flatMap((a) => a.relieved_by.map((r) => { const p = parseRef(r.at); return `${p.ns}:${p.id}`; })));
    const rows: ManualWorkLoad["units"] = [];
    for (const d of designs) {
      const own = new Map((d.model.claims ?? []).filter((c) => !c.home).map((c) => [c.id, c]));
      for (const u of d.plan.units) {
        const rel = Array.isArray(u.attrs?.relieves) ? (u.attrs!.relieves as unknown[]) : [];
        for (const x of rel) {
          if (!x || typeof x !== "object") continue;
          const r = x as Record<string, unknown>;
          const mw = typeof r.manual_work === "string" ? parseRef(r.manual_work) : undefined;
          if (!mw || (mw.ns && mw.ns !== SHARED) || mw.id !== k.id) continue;
          const id = `${d.namespace}:${u.id}`;
          const restsW = typeof r.rests_on === "string" ? r.rests_on : undefined;
          const rr = restsW ? parseRef(restsW) : undefined;
          const claim = rr ? (rr.ns === SHARED ? sharedClaims.get(rr.id) : !rr.ns ? own.get(rr.id) ?? sharedClaims.get(rr.id) : undefined) : undefined;
          const rests = rr ? (rr.ns ? `${rr.ns}:${rr.id}` : own.has(rr.id) ? `${d.namespace}:${rr.id}` : sharedClaims.has(rr.id) ? `${SHARED}:${rr.id}` : `${d.namespace}:${rr.id}`) : undefined;
          rows.push({
            unit: id, design: d.namespace, title: u.title, status: units[id]?.status ?? u.status ?? "todo", effect: String(r.effect ?? ""),
            ...(rests ? { rests_on: rests } : {}), ...(claim ? { grade: claim.grade } : {}),
            linked: named.has(id) || named.has(`${d.namespace}:${u.phase}`),
          });
        }
      }
    }
    out.push({ kind, name: k.name, ...(k.flow_item ? { flow_item: k.flow_item } : {}), activities: linking.map((a) => `${ORG}:${a.id}`), units: rows });
  }
  return out;
}

// ---------- a root patch's effect on the load ----------

/**
 * The teams whose allowance or free slots a root patch moves, before and after, each in one sentence: "Detection and
 * response's free slots fall from 0.4 to none, 0.08 over: it goes over capacity."
 */
export function loadDeltas(before: LoadFacts | undefined, after: LoadFacts | undefined): TeamLoadDelta[] {
  if (!before || !after) return [];
  const out: TeamLoadDelta[] = [];
  const side = (t: TeamLoad | undefined) => ({ ...(t?.allowance !== undefined ? { allowance: t.allowance } : {}), doing: t?.doing.length ?? 0, ...(t?.free !== undefined ? { free: t.free } : {}), over: !!t?.over });
  const names = new Map([...before.teams, ...after.teams].map((t) => [t.team, t.name]));
  for (const id of [...names.keys()].sort(natCompare)) {
    const b = before.teams.find((t) => t.team === id), a = after.teams.find((t) => t.team === id);
    const bs = side(b), as = side(a);
    if (bs.allowance === as.allowance && bs.free === as.free && bs.over === as.over && bs.doing === as.doing) continue;
    out.push({ team: id, name: names.get(id)!, before: bs, after: as, text: deltaText(names.get(id)!, bs, as) });
  }
  // the team that crosses the line first, then the rest by name
  const rank = (d: TeamLoadDelta) => (d.after.over !== d.before.over ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || natCompare(x.name, y.name));
}

function deltaText(name: string, b: TeamLoadDelta["before"], a: TeamLoadDelta["after"]): string {
  const freeWord = (f: number | undefined) => (f === undefined ? "not counted" : f > EPS ? num(f) : "none");
  if (b.free === undefined && a.free !== undefined) return sentence(`${name}'s capacity comes into force; ${a.over ? `it is ${num(-a.free)} over capacity` : `it has ${freeWord(a.free)} free`}`);
  if (b.free !== undefined && a.free === undefined) return sentence(`${name}'s capacity is no longer stated, so its load cannot be weighed`);
  // within before and after: its free slots; otherwise its allowance against the work in doing
  if (!a.over && !b.over) {
    const dir = a.free! < b.free! - EPS ? "fall" : a.free! > b.free! + EPS ? "rise" : "stay";
    return sentence(`${name}'s free slots ${dir === "stay" ? `stay at ${freeWord(a.free)}` : `${dir} from ${freeWord(b.free)} to ${freeWord(a.free)}`}; it stays within capacity`);
  }
  const dir = a.allowance! < b.allowance! - EPS ? "falls" : a.allowance! > b.allowance! + EPS ? "rises" : "stays";
  const allowance = `${name}'s allowance ${dir === "stays" ? `stays at ${num(a.allowance!)}` : `${dir} from ${num(b.allowance!)} to ${num(a.allowance!)}`}`;
  const work = count(a.doing, "unit");
  if (a.over && !b.over) return sentence(`${allowance}, under its ${work} in doing; it goes over capacity`);
  if (!a.over && b.over) return sentence(`${allowance}, enough for its ${work} in doing; it comes back within capacity`);
  return sentence(`${allowance}, still under its ${work} in doing; it stays over capacity`);
}
