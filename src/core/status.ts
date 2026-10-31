// Status: red, amber or green for each milestone and for the plan, computed from criteria declared in engine.yaml,
// each with its reasons as plain sentences, and for every milestone that is not green the path to green: the actions
// that would turn it green, in order, each naming the work by title, the team that owns it (or that it needs an owner)
// and what it unblocks. Also the leadership view's challenges (the few things most in the way) and its risks, each
// load-bearing untested premise written as a bet. Everything is read off the plan analysis, the owners, the findings,
// the premises and the tracker; nothing is invented.
//
//   status:                         # engine.yaml, optional; these are the defaults
//     red:   [no-provider, unowned-blocker, error-finding, slipped]
//     amber: [unowned, untested-premise, tracker-disagrees, idle-ready, earlier-milestone]
//
// A criterion may be moved between the lists or left out. A milestone's path is its own open work and everything that
// work waits on, except what sits in an earlier milestone not yet reached (that milestone answers for it, and the
// later one says it waits on it). Red needs the path blocked: by work nobody provides, by unowned work others wait on,
// by an error finding, or by work past its due date. Amber: unowned work, a load-bearing premise behind it untested,
// the tracker disagreeing about its work, work ready with nothing in progress (the current milestone only), or an
// earlier milestone not green. A person may override a milestone's status in plan.yaml or milestones.yaml (status,
// reason, date, by); the override is what shows, and the computed status stays beside it.

import type {
  Bundle, Challenge, Claim, InstanceConfig, MilestoneStatus, OverrideFlag, PathAction, Phase, PlanStatus, RagStatus, ReportSnapshot, RiskBet,
  StatusCriterion, StatusReason, StatusRef, Unit,
} from "../types.ts";
import { PROSE } from "../site/prose.ts";
import { natCompare } from "./util.ts";
import { weight as premiseWeight } from "./premise.ts";

const { cap, list, quote, sentence } = PROSE;

export const RED_DEFAULT: StatusCriterion[] = ["no-provider", "unowned-blocker", "error-finding", "slipped"];
export const AMBER_DEFAULT: StatusCriterion[] = ["unowned", "untested-premise", "tracker-disagrees", "idle-ready", "earlier-milestone"];
export const CRITERIA: StatusCriterion[] = [...RED_DEFAULT, ...AMBER_DEFAULT];
const RANK: Record<RagStatus, number> = { green: 0, amber: 1, red: 2 };
export const RAG_WORD: Record<RagStatus, string> = { red: "Red", amber: "Amber", green: "Green" };

/** engine.yaml's `status:` block: which criteria make a milestone red and which amber. Unknown names are reported. */
export function statusCriteria(config: InstanceConfig): { red: StatusCriterion[]; amber: StatusCriterion[]; problems: string[] } {
  const raw = (config.status && typeof config.status === "object" && !Array.isArray(config.status) ? config.status : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const read = (k: "red" | "amber", dflt: StatusCriterion[]) => {
    if (raw[k] == null) return dflt;
    const xs = Array.isArray(raw[k]) ? (raw[k] as unknown[]).map(String) : [String(raw[k])];
    for (const x of xs) if (!CRITERIA.includes(x as StatusCriterion)) problems.push(`engine.yaml status.${k}: "${x}" is not a criterion (${CRITERIA.join(", ")})`);
    return xs.filter((x): x is StatusCriterion => CRITERIA.includes(x as StatusCriterion));
  };
  const red = read("red", RED_DEFAULT);
  const amber = read("amber", AMBER_DEFAULT).filter((c) => !red.includes(c));
  return { red, amber, problems };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Oct 2026" from an ISO date, read as a calendar date (no time zone shift). */
export function dayText(iso: string | undefined): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso ?? "";
}
const day = (iso: string | undefined) => (/^\d{4}-\d\d-\d\d/.exec(iso ?? "") ?? [""])[0];
/** A clause after "that": the first letter lowered unless it starts an acronym or a name, the full stop dropped. */
export function clause(t: string): string {
  const s = t.trim().replace(/[.\s]+$/, "");
  return (/^[A-Z][a-z]/.test(s) || /^(A|An|The)\s/.test(s)) && !/^(I|Jira)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

interface Ctx {
  b: Bundle; asOf: string;
  units: Unit[]; byId: Map<string, Unit>; order: Phase[]; idx: Map<string, number>;
  open: (id: string) => boolean;
  owners: (id: string) => string[]; teamName: (id: string) => string; title: (id: string) => string;
  noProvider: Set<string>; downstream: (id: string) => number;
  red: StatusCriterion[];                // the criteria engine.yaml makes red
  behind: Map<string, Set<string>>;      // phase id -> the claims behind it
}

function ctxOf(b: Bundle, red: StatusCriterion[]): Ctx {
  const seen = new Set<string>();
  const units = b.plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  const byId = new Map(units.map((u) => [u.id, u]));
  const order = [...b.plan.phases].sort((a, c) => (a.order ?? 0) - (c.order ?? 0) || natCompare(a.id, c.id));
  const provided = new Set(units.flatMap((u) => u.provides ?? []));
  const across = b.analysis.outside ?? {}; // provided across a seam by another design (a 0.4 design): never "no provider"
  const noProvider = new Set<string>([...(b.analysis.unprovided ?? []), ...units.flatMap((u) => (u.requires ?? []).filter((c) => !provided.has(c) && !(c in across)))]);
  return {
    b, asOf: b.engine.built, units, byId, order, idx: new Map(order.map((p, i) => [p.id, i])),
    open: (id) => byId.get(id)?.status !== "done",
    owners: (id) => b.teams?.units[id]?.owners ?? (byId.get(id)?.owner ? [byId.get(id)!.owner!] : []),
    teamName: (id) => b.model.teams.find((t) => t.id === id)?.name ?? id,
    title: (id) => byId.get(id)?.title ?? id,
    noProvider, downstream: (id) => b.analysis.unblocksTransitive?.[id] ?? 0, red, behind: claimsBehind(b, units),
  };
}

const uref = (id: string): StatusRef => ({ kind: "unit", id });
/** "“A”", "“A” and “B”", "“A”, “B” and other work": titles first, never a count. */
function titles(c: Ctx, ids: string[], max = 2): string {
  const t = ids.slice(0, max).map((id) => quote(c.title(id)));
  return ids.length > max ? `${t.join(", ")} and other work` : list(t);
}
/** Team names: "Platform", "Platform and Product", "Platform, Product and other teams" past two. */
function teamsText(c: Ctx, teams: string[]): string {
  const n = teams.map(c.teamName);
  return n.length > 2 ? `${n.slice(0, 2).join(", ")} and other teams` : list(n);
}
/** How much rests on a claim: the Strategy page's ranking (src/core/premise.ts). */
const claimWeight = (c: Ctx, id: string) => (c.b.premises?.[id] ? premiseWeight(c.b.premises[id]) : 0);

/** The open units that wait on a unit directly, nearest and most consequential first. */
function waitersOf(c: Ctx, id: string, within?: Set<string>): string[] {
  return (c.b.analysis.unblocks[id] ?? []).filter((x) => x !== id && c.open(x) && (!within || within.has(x)))
    .sort((x, y) => c.downstream(y) - c.downstream(x) || natCompare(x, y));
}

/** A milestone's path: its open work and what that work waits on, transitively, leaving out earlier unreached milestones' work. */
function pathOf(c: Ctx, m: Phase, reached: (p: string) => boolean): Set<string> {
  const mi = c.idx.get(m.id)!;
  const earlierOpen = (u: Unit) => { const i = c.idx.get(u.phase) ?? -1; return i < mi && !reached(u.phase); };
  const out = new Set<string>(), stack = c.units.filter((u) => u.phase === m.id && c.open(u.id)).map((u) => u.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    const u = c.byId.get(id);
    if (!u || !c.open(id) || (u.phase !== m.id && earlierOpen(u))) continue;
    out.add(id);
    stack.push(...(c.b.analysis.deps[id] ?? []));
  }
  return out;
}

const loadBearing = (b: Bundle) => new Set(b.findings.filter((f) => f.pack === "premises" && f.rule === "load-bearing-untested").map((f) => f.at));
/**
 * The claims behind each milestone: the ones it rests on, the ones its units rest on, and the ones the parts its units
 * change rest on, each with the claims those rest on in turn. (A premise's whole plan slice would put nearly every
 * premise behind every milestone of a large plan; this keeps to what the milestone's own work names.)
 */
function claimsBehind(b: Bundle, units: Unit[]): Map<string, Set<string>> {
  const cl = new Map((b.model.claims ?? []).map((x) => [x.id, x]));
  const el = new Map(b.model.elements.map((e) => [e.id, e]));
  const out = new Map<string, Set<string>>();
  for (const p of b.plan.phases) {
    const stack = [...(p.rests_on ?? [])];
    for (const u of units) if (u.phase === p.id) { stack.push(...(u.rests_on ?? [])); for (const m of u.elements ?? []) stack.push(...(el.get(m.id)?.rests_on ?? [])); }
    const set = new Set<string>();
    while (stack.length) { const x = stack.pop()!; if (set.has(x) || !cl.has(x)) continue; set.add(x); stack.push(...(cl.get(x)!.rests_on ?? [])); }
    out.set(p.id, set);
  }
  return out;
}
const milestonesOfClaim = (c: Ctx, id: string) => c.order.filter((p) => c.behind.get(p.id)?.has(id)).map((p) => p.id);
/** The claims a milestone's own work names: the milestone's and its units' rests_on, with the claims those rest on; never through a part. */
function claimsNamed(b: Bundle, units: Unit[]): Map<string, Set<string>> {
  const cl = new Map((b.model.claims ?? []).map((x) => [x.id, x]));
  const out = new Map<string, Set<string>>();
  for (const p of b.plan.phases) {
    const stack = [...(p.rests_on ?? [])];
    for (const u of units) if (u.phase === p.id) stack.push(...(u.rests_on ?? []));
    const set = new Set<string>();
    while (stack.length) { const x = stack.pop()!; if (set.has(x) || !cl.has(x)) continue; set.add(x); stack.push(...(cl.get(x)!.rests_on ?? [])); }
    out.set(p.id, set);
  }
  return out;
}

function reasonsFor(c: Ctx, m: Phase, crit: Set<StatusCriterion>, isCurrent: boolean, reached: (p: string) => boolean, earlierStatus: { id: string; status: RagStatus; teams: string[] }[]): { reasons: StatusReason[]; actions: PathAction[] } {
  const b = c.b, reasons: StatusReason[] = [], actions: PathAction[] = [];
  const lvl = (k: StatusCriterion): "red" | "amber" => (c.red.includes(k) ? "red" : "amber");
  const path = pathOf(c, m, reached);
  const mine = c.units.filter((u) => u.phase === m.id);
  const add = (k: StatusCriterion, text: string, refs: StatusRef[], action?: Omit<PathAction, "criterion" | "level">) => {
    const L = lvl(k);
    // red that rests on a unit the tracker has elsewhere may be a stale record: say so, and settle it first
    const says = L === "red" && refs[0]?.kind === "unit" && k !== "tracker-disagrees" ? trackerSays(b, refs[0].id) : undefined;
    reasons.push({ criterion: k, level: L, text: sentence(says ? `${text} (${says}; settle first)` : text), refs });
    if (action) actions.push({ criterion: k, level: L, ...action, text: sentence(action.text) });
  };
  const has = (k: StatusCriterion) => crit.has(k);
  const pathSorted = [...path].sort((x, y) => (c.idx.get(c.byId.get(x)!.phase)! - c.idx.get(c.byId.get(y)!.phase)!) || c.downstream(y) - c.downstream(x) || natCompare(x, y));
  const unownedBlockers = new Set<string>();

  if (has("no-provider")) for (const id of pathSorted) {
    const miss = (b.analysis.blocked[id]?.missing ?? []).filter((x) => c.noProvider.has(x));
    if (!miss.length) continue;
    const w = waitersOf(c, id, path);
    add("no-provider", `${quote(c.title(id))} waits on something no planned work provides`, [uref(id), ...miss.map((x) => ({ kind: "unit" as const, id: x }))],
      { text: `Plan the work ${quote(c.title(id))} is missing`, work: uref(id), teams: c.owners(id), unblocks: [id, ...w] });
  }
  if (b.teams && (has("unowned-blocker") || has("unowned"))) for (const id of pathSorted) {
    if (c.owners(id).length) continue;
    const w = waitersOf(c, id, path);
    if (w.length && has("unowned-blocker")) {
      unownedBlockers.add(id);
      add("unowned-blocker", `Nobody owns ${quote(c.title(id))}, and ${titles(c, w)} ${w.length === 1 ? "waits" : "wait"} on it`, [uref(id), ...w.map(uref)],
        { text: `Name an owner team for ${quote(c.title(id))}`, work: uref(id), teams: [], unblocks: w });
    }
  }
  if (has("error-finding")) {
    const els = new Set(c.units.filter((u) => path.has(u.id)).flatMap((u) => (u.elements ?? []).map((e) => e.id)));
    const errs = b.findings.filter((f) => f.severity === "error" && ((f.atKind === "phase" && f.at === m.id) || (f.atKind === "unit" && path.has(f.at)) || (f.atKind === "element" && els.has(f.at))));
    for (const f of errs) {
      const rule = b.instance.packs.find((p) => p.name === f.pack)?.rules.find((r) => r.id === f.rule)?.title ?? f.rule;
      const name = f.atKind === "unit" ? c.title(f.at) : f.atKind === "element" ? b.model.elements.find((e) => e.id === f.at)?.name ?? f.at : m.name;
      const teams = f.atKind === "unit" ? c.owners(f.at) : f.atKind === "element" ? [b.model.elements.find((e) => e.id === f.at)?.owner].filter((x): x is string => !!x) : [];
      add("error-finding", `The check ${quote(rule)} fails on ${quote(name)}`, [{ kind: "finding", id: `${f.pack}/${f.rule}@${f.at}` }],
        { text: `Fix ${quote(name)} so that ${quote(rule)} passes`, work: { kind: "finding", id: `${f.pack}/${f.rule}@${f.at}` }, teams, unblocks: f.atKind === "unit" ? waitersOf(c, f.at, path) : [] });
    }
  }
  if (has("slipped")) for (const id of pathSorted) {
    const u = c.byId.get(id)!;
    if (!u.due || !(day(u.due) < day(c.asOf))) continue;
    const w = waitersOf(c, id);
    add("slipped", `${quote(u.title)} was due ${dayText(u.due)} and is not done`, [uref(id), ...w.map(uref)],
      { text: `Finish ${quote(u.title)}, due ${dayText(u.due)}`, work: uref(id), teams: c.owners(id), unblocks: w });
  }
  if (b.teams && has("unowned")) for (const u of mine) {
    if (!c.open(u.id) || c.owners(u.id).length || unownedBlockers.has(u.id)) continue;
    add("unowned", `Nobody owns ${quote(u.title)}`, [uref(u.id)], { text: `Name an owner team for ${quote(u.title)}`, work: uref(u.id), teams: [], unblocks: waitersOf(c, u.id) });
  }
  if (has("untested-premise")) {
    const lb = loadBearing(b);
    const cs = (b.model.claims ?? []).filter((x) => lb.has(x.id) && c.behind.get(m.id)?.has(x.id))
      .sort((x, y) => claimWeight(c, y.id) - claimWeight(c, x.id) || natCompare(x.id, y.id));
    if (cs.length) {
      add("untested-premise", cs.length === 1 ? `It rests on an untested belief: ${clause(cs[0].statement)}` : `It rests on untested beliefs, the heaviest that ${clause(cs[0].statement)}`, cs.map((x) => ({ kind: "claim" as const, id: x.id })));
      // The heaviest first, as the reason, the challenges and the risks name them: one milestone, one belief, on every slide.
      const pick = cs.slice(0, 2);
      for (const cl of pick) {
        const tests = testsOf(c, cl);
        actions.push({ criterion: "untested-premise", level: lvl("untested-premise"), ...(tests.length
          ? { text: sentence(`Test the belief that ${clause(cl.statement)}, through ${titles(c, tests)}`), work: { kind: "claim", id: cl.id }, teams: [...new Set(tests.flatMap(c.owners))], unblocks: [] }
          : { text: sentence(`Plan a test of the belief that ${clause(cl.statement)}`), work: { kind: "claim", id: cl.id }, teams: [], unblocks: [] }) });
      }
    }
  }
  const rec = b.tracker?.reconcile;
  if (rec && has("tracker-disagrees")) {
    const tn = b.tracker!.adapter === "jira" ? "Jira" : b.tracker!.adapter;
    const W: Record<string, string> = { todo: "not started", doing: "in progress", done: "done" };
    const inM = (u: string) => c.byId.get(u)?.phase === m.id;
    for (const d of rec.statusDisagreements.filter((x) => inM(x.unit)))
      add("tracker-disagrees", `${tn} has ${quote(c.title(d.unit))} as ${d.trackerStatus}; the plan has it ${W[d.unitStatus] ?? d.unitStatus}`, [uref(d.unit)],
        { text: `Settle where ${quote(c.title(d.unit))} really stands: the plan says ${W[d.unitStatus] ?? d.unitStatus}, ${tn} says ${d.trackerStatus}`, work: uref(d.unit), teams: c.owners(d.unit), unblocks: [] });
    for (const d of (rec.ownerDisagreements ?? []).filter((x) => inM(x.unit)))
      add("tracker-disagrees", `The plan gives ${quote(c.title(d.unit))} to ${teamsText(c, d.owners)}; ${tn} gives it to ${c.teamName(d.trackerTeam)}`, [uref(d.unit)],
        { text: `Settle which team owns ${quote(c.title(d.unit))}`, work: uref(d.unit), teams: d.owners, unblocks: [] });
    for (const d of rec.phaseDisagreements.filter((x) => inM(x.unit)))
      add("tracker-disagrees", `${tn} files ${quote(c.title(d.unit))} under ${d.issuePhase ? quote(c.order.find((p) => p.id === d.issuePhase)?.name ?? d.issuePhase) : "no milestone"}`, [uref(d.unit)],
        { text: `File ${quote(c.title(d.unit))} under ${quote(m.name)} in ${tn}`, work: uref(d.unit), teams: c.owners(d.unit), unblocks: [] });
    for (const d of rec.dependencyOneSided.filter((x) => inM(x.unit)))
      add("tracker-disagrees", d.side === "model" ? `The plan has ${quote(c.title(d.unit))} waiting on ${quote(c.title(d.dependsOn))}; ${tn} does not link them` : `${tn} links ${quote(c.title(d.unit))} to ${quote(c.title(d.dependsOn))}; the plan has no such dependency`, [uref(d.unit), uref(d.dependsOn)],
        { text: d.side === "model" ? `Link ${quote(c.title(d.unit))} to ${quote(c.title(d.dependsOn))} in ${tn}` : `Decide whether ${quote(c.title(d.unit))} waits on ${quote(c.title(d.dependsOn))}`, work: uref(d.unit), teams: c.owners(d.unit), unblocks: [] });
  }
  if (has("idle-ready") && isCurrent) {
    const frontier = new Set(b.analysis.frontier);
    const ready = mine.filter((u) => frontier.has(u.id) && (u.status ?? "todo") === "todo").sort((x, y) => c.downstream(y.id) - c.downstream(x.id) || natCompare(x.id, y.id));
    const doing = mine.some((u) => u.status === "doing");
    if (ready.length && !doing) {
      add("idle-ready", `Nothing in it is in progress, although ${titles(c, ready.map((u) => u.id))} could start now`, ready.map((u) => uref(u.id)));
      for (const u of ready.slice(0, 2)) actions.push({ criterion: "idle-ready", level: lvl("idle-ready"), text: sentence(`Start ${quote(u.title)}`), work: uref(u.id), teams: c.owners(u.id), unblocks: waitersOf(c, u.id) });
    }
  }
  if (has("earlier-milestone")) {
    // An earlier milestone not yet reached and not green (computed, never a person's override) keeps this one at least
    // amber: its work waits on it, or, with no dependency between them, it can be reached only after it.
    const mi = c.idx.get(m.id)!;
    const deps = new Set([...path].flatMap((id) => c.b.analysis.deps[id] ?? []));
    const notGreen = earlierStatus.filter((e) => e.status !== "green" && (c.idx.get(e.id) ?? 0) < mi);
    const waited = notGreen.filter((e) => c.units.some((u) => u.phase === e.id && c.open(u.id) && deps.has(u.id)));
    const shown = waited.length ? waited : notGreen.slice(-1);
    for (const e of shown) {
      const ep = c.order.find((p) => p.id === e.id)!;
      const text = waited.length ? `Its work waits on ${quote(ep.name)}, which is ${RAG_WORD[e.status].toLowerCase()}` : `It can be reached only after ${quote(ep.name)}, which is ${RAG_WORD[e.status].toLowerCase()}`;
      add("earlier-milestone", text, [{ kind: "phase", id: e.id }],
        { text: `Bring ${quote(ep.name)} to green first, by its own path`, work: { kind: "phase", id: e.id }, teams: e.teams, unblocks: [] });
    }
  }
  return { reasons, actions };
}

function testsOf(c: Ctx, cl: Claim): string[] {
  const t = cl.attrs?.tested_by;
  const ids = (Array.isArray(t) ? t.map(String) : t != null ? String(t).split(/[,\s]+/) : []).filter((x) => c.byId.has(x));
  return ids.sort((x, y) => Number(c.open(y)) - Number(c.open(x)) || natCompare(x, y));
}

/** Order a milestone's actions: red before amber, then the work that unblocks the most, then plan order. One action per work and criterion. */
function orderActions(c: Ctx, xs: PathAction[]): PathAction[] {
  const seen = new Set<string>();
  const weight = (a: PathAction) => a.unblocks.reduce((n, u) => n + 1 + c.downstream(u), 0) + (a.work?.kind === "unit" ? c.downstream(a.work.id) : 0);
  return xs.filter((a) => { const k = `${a.criterion}|${a.text}`; return seen.has(k) ? false : (seen.add(k), true); })
    .sort((x, y) => RANK[y.level] - RANK[x.level] || weight(y) - weight(x));
}

/** A reason in one line, naming the work and never counting it: what the road, the deck, the Overview's opening
 * sentence and the milestone's card all say, so the four agree word for word. */
export function shortOf(b: Bundle, r: StatusReason): string {
  const line = shortLine(b, r), first = r.refs[0];
  const says = r.level === "red" && first?.kind === "unit" && r.criterion !== "tracker-disagrees" ? trackerSays(b, first.id) : undefined;
  return says ? sentence(`${line.replace(/[.\s]+$/, "")} (${says}; settle first)`) : line;
}
function shortLine(b: Bundle, r: StatusReason): string {
  const first = r.refs[0];
  const unitTitle = (id: string) => b.plan.units.find((u) => u.id === id)?.title ?? id;
  const t = first?.kind === "unit" ? quote(unitTitle(first.id)) : "";
  const tn = b.tracker?.adapter === "jira" ? "Jira" : b.tracker?.adapter ?? "the tracker";
  switch (r.criterion) {
    case "slipped": return sentence(`${t} has slipped past its due date`);
    case "no-provider": return sentence(`${t} waits on work nobody has planned`);
    case "unowned-blocker": return sentence(`Nobody owns ${t}, and other work waits on it`);
    case "unowned": return sentence(`Nobody owns ${t}`);
    case "error-finding": return "A check fails on the work it needs.";
    case "untested-premise": return "It rests on a belief nothing has tested yet.";
    case "tracker-disagrees": return sentence(`${tn} and the plan disagree about ${t || "its work"}`);
    case "idle-ready": return "Work could start now, and nothing is in progress.";
    case "earlier-milestone": return sentence(`It waits on ${quote(b.plan.phases.find((p) => p.id === first?.id)?.name ?? first?.id ?? "")}, which is not yet green`);
  }
  return r.text;
}

/** The plan's status: every milestone in order, the plan overall, the challenges and the risks. */
export function planStatus(b: Bundle, config: InstanceConfig, opts: { reports?: ReportSnapshot[] } = {}): { status: PlanStatus; problems: string[]; atStake: Record<string, string[]>; amberBy: Record<string, string[]> } {
  const { red, amber, problems } = statusCriteria(config);
  const c = ctxOf(b, red);
  const crit = new Set<StatusCriterion>([...red, ...amber]);
  const reachedSet = new Set(c.order.filter((p) => { const us = c.units.filter((u) => u.phase === p.id); return us.length > 0 && us.every((u) => u.status === "done"); }).map((p) => p.id));
  const reached = (p: string) => reachedSet.has(p);
  const current = c.order.find((p) => !reached(p.id));
  const milestones: MilestoneStatus[] = [];
  for (const m of c.order) {
    if (reached(m.id)) { milestones.push({ phase: m.id, status: m.override?.status ?? "green", computed: "green", reached: true, current: false, reasons: [], ...(m.override ? { override: m.override } : {}), path: [] }); continue; }
    const earlier = milestones.filter((x) => !x.reached).map((x) => ({ id: x.phase, status: x.computed, teams: [...new Set(x.path.flatMap((a) => a.teams))] })); // computed: a person's override never clears what comes after
    const { reasons, actions } = reasonsFor(c, m, crit, current?.id === m.id, reached, earlier);
    for (const r of reasons) r.short = shortOf(b, r);
    const computed: RagStatus = reasons.some((r) => r.level === "red") ? "red" : reasons.length ? "amber" : "green";
    milestones.push({
      phase: m.id, status: m.override?.status ?? computed, computed, reached: false, current: current?.id === m.id,
      reasons, ...(m.override ? { override: m.override } : {}), path: computed === "green" ? [] : orderActions(c, actions),
    });
  }
  for (const m of c.order) {
    const x = milestones.find((y) => y.phase === m.id);
    if (x && m.accountable) x.accountable = m.accountable;
    if (x && m.confirmed_by) x.confirmed_by = m.confirmed_by;
  }
  overrideFlags(c, milestones, opts.reports ?? []);
  const worst = milestones.filter((x) => !x.reached).reduce<RagStatus>((w, x) => (RANK[x.status] > RANK[w] ? x.status : w), "green");
  const worstComputed = milestones.filter((x) => !x.reached).reduce<RagStatus>((w, x) => (RANK[x.computed] > RANK[w] ? x.computed : w), "green");
  const nameOf = (id: string) => c.order.find((p) => p.id === id)?.name ?? id;
  const lead = milestones.find((x) => !x.reached && x.status === worst);
  const others = milestones.filter((x) => !x.reached && x !== lead && x.status !== "green");
  const overallText = !c.order.length ? "The plan has no milestones yet."
    : !lead ? "Every milestone is reached."
    : worst === "green" ? sentence(`Every remaining milestone is green; the current one is ${quote(nameOf(current!.id))}`)
    : sentence(`${quote(nameOf(lead.phase))} is ${RAG_WORD[worst].toLowerCase()}${lead.override ? ` (set by ${lead.override.by})` : lead.reasons[0] ? `: ${clause(lead.reasons[0].text)}` : ""}${others.length ? `; ${list(others.map((x) => `${quote(nameOf(x.phase))} is ${RAG_WORD[x.status].toLowerCase()}`))}` : ""}`);
  // Milestones at stake, per claim: those not reached whose own work (the milestone or its units) names it, directly or
  // through other claims. Apart from them, the milestones its being untested turns amber: their reasons name it, which
  // also counts a claim reached only through a part the work changes.
  const named = claimsNamed(b, c.units);
  const atStake: Record<string, string[]> = {}, amberBy: Record<string, string[]> = {};
  for (const cl of b.model.claims ?? []) {
    atStake[cl.id] = c.order.filter((p) => !reached(p.id) && named.get(p.id)?.has(cl.id)).map((p) => p.id);
    amberBy[cl.id] = milestones.filter((m) => !m.reached && m.reasons.some((r) => r.criterion === "untested-premise" && r.refs.some((x) => x.id === cl.id))).map((m) => m.phase);
  }
  // The one status sentence: the Overview's brief opens with it and the deck's road leads with it, and its reason is the
  // milestone's own first reason, the one its card shows.
  const leadText = !c.order.length ? "The plan has no milestones yet."
    : !lead ? "Every milestone is reached."
    : worst === "green" ? sentence(`Overall green: every milestone still ahead is on course${lead.computed !== "green" ? `, ${quote(nameOf(lead.phase))} by ${lead.override?.by ?? "a person"}'s override (computed ${lead.computed})` : ""}`)
    : `Overall ${worst}. ${sentence(`${quote(nameOf(lead.phase))} ${worst === "red" ? "is blocked" : "needs attention"}${lead.override
        ? ` by ${lead.override.by}'s override${lead.override.reason ? `: ${clause(lead.override.reason.split(/\.\s/)[0])}` : ""}${lead.computed !== lead.status ? ` (computed ${lead.computed})` : ""}`
        : lead.reasons[0] ? `: ${clause(lead.reasons[0].short ?? lead.reasons[0].text)}` : ""}`)}`;
  return {
    atStake, amberBy,
    status: {
      criteria: { red, amber },
      overall: { status: worst, computed: worstComputed, text: overallText, lead: { ...(lead ? { phase: lead.phase } : {}), text: leadText } },
      milestones, challenges: challengesOf(c, milestones), risks: risksOf(c),
    },
    problems,
  };
}

/**
 * What makes a person's status call need a second look, said on the card, the road and the slide: a green set while
 * an earlier milestone it waits on (or can only be reached after) is red; a computed status worse now than in the last
 * report saved on or before the day the override was set; a review-by date already past.
 */
function overrideFlags(c: Ctx, ms: MilestoneStatus[], reports: ReportSnapshot[]) {
  const today = day(c.asOf);
  for (const m of ms) {
    const o = m.override;
    if (!o || m.reached) continue;
    const flags: OverrideFlag[] = [];
    const mi = c.idx.get(m.phase)!;
    if (o.status === "green") {
      const red = ms.find((x) => !x.reached && x.computed === "red" && (c.idx.get(x.phase) ?? 0) < mi);
      const waits = m.reasons.some((r) => r.criterion === "earlier-milestone" && r.refs[0]?.id === red?.phase && /^Its work waits/.test(r.text));
      if (red) flags.push({ kind: "upstream-red", text: sentence(`Set to green while ${quote(c.order[c.idx.get(red.phase)!].name)}, which ${waits ? "it waits on" : "must be reached first"}, is red`) });
    }
    const then = reports.filter((r) => day(r.saved) <= day(o.date) && r.status?.milestones.some((x) => x.id === m.phase)).sort((a, b) => a.saved.localeCompare(b.saved)).at(-1);
    const was = then?.status?.milestones.find((x) => x.id === m.phase)?.computed;
    if (was && RANK[m.computed] > RANK[was]) flags.push({ kind: "worsened", text: sentence(`Its computed status went from ${was} to ${m.computed} after the override was set on ${dayText(o.date)}`) });
    if (o.review_by && day(o.review_by) < today) flags.push({ kind: "review-due", text: sentence(`Its review was due ${dayText(o.review_by)}`) });
    if (flags.length) m.flags = flags;
  }
}

/** The tracker's word on a unit the plan has as not done, when it disagrees: "Jira says In Review". */
export function trackerSays(b: Bundle, unit: string): string | undefined {
  const d = b.tracker?.reconcile?.statusDisagreements.find((x) => x.unit === unit);
  if (!d) return undefined;
  return `${b.tracker!.adapter === "jira" ? "Jira" : b.tracker!.adapter} says ${d.trackerStatus}`;
}

/** The three to five things most in the way: red reasons first, then amber, the heaviest first; one per piece of work. */
function challengesOf(c: Ctx, ms: MilestoneStatus[]): Challenge[] {
  const nameOf = (id: string) => c.order.find((p) => p.id === id)?.name ?? id;
  const msText = (ids: string[]) => list(ids.map((p) => quote(nameOf(p))));
  const tn = c.b.tracker?.adapter === "jira" ? "Jira" : c.b.tracker?.adapter ?? "the tracker";
  const whoOwns = (teams: string[]) => (teams.length ? `${teamsText(c, teams)} ${teams.length === 1 ? "owns" : "own"} it` : "It needs an owner team");
  /** One team named, the rest as "and other teams": a challenge is read aloud. */
  const lead = (teams: string[]) => (teams.length > 1 ? `${c.teamName(teams[0])} and other teams` : teams.length ? c.teamName(teams[0]) : "");
  // one entry per piece of work and criterion, with every milestone it holds up
  type Hit = { level: "red" | "amber"; criterion: StatusCriterion; refs: StatusRef[]; milestones: string[]; first: number };
  const hits = new Map<string, Hit>();
  ms.forEach((m, mi) => m.reasons.forEach((r) => {
    if (r.criterion === "earlier-milestone") return;
    const group = r.criterion === "unowned" || r.criterion === "unowned-blocker" ? "owner" : r.criterion;
    const key = `${group}|${r.refs[0]?.kind}:${r.refs[0]?.id}`;
    const h = hits.get(key);
    if (h) { if (!h.milestones.includes(m.phase)) h.milestones.push(m.phase); if (r.level === "red") h.level = "red"; return; }
    hits.set(key, { level: r.level, criterion: r.criterion, refs: r.refs, milestones: [m.phase], first: mi });
  }));
  const all = [...hits.values()];
  const unitW = (id: string) => 1 + c.downstream(id);
  const out: (Challenge & { w: number; first: number })[] = [];
  // work that slipped, or that nothing provides, or that fails an error check: one challenge each
  for (const h of all.filter((x) => x.criterion === "slipped" || x.criterion === "no-provider" || x.criterion === "error-finding")) {
    const id = h.refs[0].id, w = h.refs[0].kind === "unit" ? waitersOf(c, id) : [];
    const hold = w.length ? `${titles(c, w)} ${w.length === 1 ? "waits" : "wait"} on it` : `${msText(h.milestones)} cannot be reached without it`;
    const teams = h.refs[0].kind === "unit" ? c.owners(id) : [];
    let text: string;
    if (h.criterion === "slipped") text = `${quote(c.title(id))} was due ${dayText(c.byId.get(id)?.due)} and is not done, and ${hold}. ${whoOwns(teams)}`;
    else if (h.criterion === "no-provider") text = `${quote(c.title(id))} waits on something no planned work provides, so ${msText(h.milestones)} cannot be reached as planned. ${whoOwns(teams)}`;
    else {
      const f = c.b.findings.find((y) => `${y.pack}/${y.rule}@${y.at}` === id);
      const rule = f ? c.b.instance.packs.find((p) => p.name === f.pack)?.rules.find((r) => r.id === f.rule)?.title ?? f.rule : id;
      text = `The design fails the check ${quote(rule)}, and ${msText(h.milestones)} ${h.milestones.length === 1 ? "depends" : "depend"} on the work it fails on. Whoever owns that work fixes it`;
    }
    out.push({ level: h.level, criterion: h.criterion, text, teams, milestones: h.milestones, refs: h.refs, w: h.refs[0].kind === "unit" ? unitW(id) : 0, first: h.first });
  }
  // unowned work: one challenge, the work others wait on first
  const own = all.filter((x) => x.criterion === "unowned-blocker" || x.criterion === "unowned")
    .sort((x, y) => (x.level === "red" ? 0 : 1) - (y.level === "red" ? 0 : 1) || unitW(y.refs[0].id) - unitW(x.refs[0].id));
  if (own.length) {
    const ids = own.map((x) => x.refs[0].id), w = waitersOf(c, ids[0]);
    const mss = [...new Set(own.flatMap((x) => x.milestones))].sort((x, y) => c.idx.get(x)! - c.idx.get(y)!);
    const text = ids.length === 1
      ? `Nobody owns ${quote(c.title(ids[0]))}${w.length ? `, and ${titles(c, w)} ${w.length === 1 ? "waits" : "wait"} on it` : `, which ${msText(mss)} ${mss.length === 1 ? "needs" : "need"}`}. It needs an owner team`
      : `Work that ${mss.length > 2 ? `${quote(nameOf(mss[0]))} and later milestones` : msText(mss)} need has no owner team, starting with ${quote(c.title(ids[0]))}${w.length ? `, which ${titles(c, w, 1)} ${w.length === 1 ? "waits" : "wait"} on` : ""}. Each piece needs an owner team`;
    out.push({ level: own[0].level, criterion: own[0].criterion, text, teams: [], milestones: mss, refs: own.map((x) => x.refs[0]), w: unitW(ids[0]), first: Math.min(...own.map((x) => x.first)) });
  }
  // the tracker: one challenge
  const tr = all.filter((x) => x.criterion === "tracker-disagrees");
  if (tr.length) {
    const ids = [...new Set(tr.map((x) => x.refs[0].id))], mss = [...new Set(tr.flatMap((x) => x.milestones))].sort((x, y) => c.idx.get(x)! - c.idx.get(y)!);
    const teams = [...new Set(ids.flatMap(c.owners))];
    out.push({ level: tr[0].level, criterion: "tracker-disagrees", text: `The plan and ${tn} disagree about ${titles(c, ids)}, so where ${msText(mss)} ${mss.length === 1 ? "stands" : "stand"} is uncertain until someone settles it. ${teams.length ? `${lead(teams)} ${teams.length === 1 ? "owns" : "own"} the work` : "The work needs an owner team"}`, teams, milestones: mss, refs: ids.map(uref), w: 0, first: Math.min(...tr.map((x) => x.first)) });
  }
  // the heaviest untested belief: one challenge
  const pr = all.filter((x) => x.criterion === "untested-premise");
  if (pr.length) {
    const claims = [...new Set(pr.flatMap((x) => x.refs.map((r) => r.id)))].map((id) => (c.b.model.claims ?? []).find((y) => y.id === id)).filter((x): x is Claim => !!x)
      .sort((x, y) => claimWeight(c, y.id) - claimWeight(c, x.id) || natCompare(x.id, y.id));
    const cl = claims[0], tests = testsOf(c, cl), tt = [...new Set(tests.flatMap(c.owners))];
    const mss = milestonesOfClaim(c, cl.id).filter((p) => ms.some((x) => x.phase === p && !x.reached));
    const many = mss.length > 2 ? `${quote(nameOf(mss[0]))} and every milestone after it` : msText(mss);
    const who = tests.length ? `${tt.length ? lead(tt) : "Nobody yet"} ${tt.length === 1 ? "tests" : "test"} it through ${titles(c, tests, 1)}` : "Nothing tests it yet, and nobody owns testing it";
    out.push({ level: pr[0].level, criterion: "untested-premise", text: `${cap(many)} ${mss.length === 1 ? "rests" : "rest"} on an untested belief: ${clause(cl.statement)}. ${who}`, teams: tt, milestones: mss, refs: [{ kind: "claim", id: cl.id }], w: claimWeight(c, cl.id), first: Math.min(...pr.map((x) => x.first)) });
  }
  // nothing in progress in the current milestone
  for (const h of all.filter((x) => x.criterion === "idle-ready")) {
    const first = h.refs[0].id, ow = c.owners(first);
    out.push({ level: h.level, criterion: h.criterion, text: `Nothing in ${msText(h.milestones)} is in progress, although ${titles(c, h.refs.map((r) => r.id), 1)} could start now. ${ow.length ? `${lead(ow)} ${ow.length === 1 ? "owns" : "own"} it` : "It needs an owner team"}`, teams: ow, milestones: h.milestones, refs: h.refs, w: unitW(first), first: h.first });
  }
  return out.sort((x, y) => RANK[y.level] - RANK[x.level] || x.first - y.first || y.w - x.w).slice(0, 5)
    .map(({ w: _w, first: _f, text, ...x }) => ({ ...x, text: text.split(/(?<=[a-z0-9”)])\. (?=[A-Z“])/).map(sentence).join(" ") }));
}

/** Each load-bearing untested premise as a bet: what we bet, what is in question if it is wrong, how we are testing it. */
function risksOf(c: Ctx): RiskBet[] {
  const lb = loadBearing(c.b);
  const nameOf = (id: string) => c.order.find((p) => p.id === id)?.name ?? id;
  const remaining = c.order.filter((p) => c.units.some((u) => u.phase === p.id && c.open(u.id))).map((p) => p.id);
  return (c.b.model.claims ?? []).filter((x) => lb.has(x.id))
    .map((cl) => ({ cl, weight: claimWeight(c, cl.id) }))
    .sort((x, y) => y.weight - x.weight || natCompare(x.cl.id, y.cl.id))
    .map(({ cl, weight }) => {
      const ms = milestonesOfClaim(c, cl.id).filter((p) => remaining.includes(p));
      const tests = testsOf(c, cl);
      const teams = [...new Set(tests.flatMap(c.owners))];
      const affected = !ms.length ? "the design that rests on it is in question"
        : ms.length === remaining.length && ms.length > 2 ? `every remaining milestone is in question, starting with ${quote(nameOf(ms[0]))}`
        : `reaching ${list(ms.map((p) => quote(nameOf(p))))} is in question`;
      const outside = c.b.premises?.[cl.id]?.exposure?.outsidePlanOrder;
      const testing = outside?.length ? `It is settled in ${list(outside)}, outside this design's plan order`
        : !tests.length ? "Nothing tests it yet: it needs a test and an owner"
        : `We are testing it by ${quote(c.title(tests[0]))}${tests.length > 1 ? " and other work" : ""} (${c.owners(tests[0]).length ? teamsText(c, c.owners(tests[0])) : "needs an owner"})`;
      const bet = sentence(`We are betting that ${clause(cl.statement)}`), ifWrong = sentence(`If it is wrong, ${affected}`), t = sentence(testing);
      return { claim: cl.id, text: [bet, ifWrong, t].join(" "), bet, ifWrong, testing: t, milestones: ms, testedBy: tests, teams, weight };
    });
}
