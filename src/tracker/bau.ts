// BAU measured from the tracker: a shared root's org mapping (tracker/mapping.yaml,
// kind: org) over the raw export, read into one measure of each team's standing work. Generic over adapters: it reads
// the normalized TrackerIssue list, with each issue's status history (TrackerIssue.transitions) when the export has it.
//
// Each issue counts for the team its team field names. It is left out, and counted, when it names no team, names a
// value the mapping does not map, is an epic or above (a container, not a piece of work), is a sub-task (its parent is
// the piece of work), finished before the window began, or was created after it ended. Each issue left in lands in one
// bucket, in this order:
//   1. design work: a label <prefix><namespace>:<unit> (a bare <prefix><unit> is a lone instance's label, not design
//      work here), or the issue listed in a composed design's tracker/links.yaml;
//   2. the first activity rule, top to bottom, among the rules for the activities of the issue's own team, that the
//      issue matches (an activity is one team's standing work, so another team's rule never takes the issue);
//   3. unclassified, its own band, never spread over the activities.
//
// The window is `window_days` ending at the export's date. With status history, an issue counts its days in statuses
// the mapping maps to doing, inside the window: a stay that began before the window is clipped, and one still open at
// the export date runs to the window's end. An issue with no recorded status change has held its current status since
// it was created. Without any status history, a team's shares are by count of the issues in doing now, labelled "by
// count of open items, not time", at confidence low at most.
//
// Per team: share(activity) = the days its issues spent in doing ÷ the same for all the team's issues counted (design
// work, activities and unclassified). Coverage = 1 - the unclassified share. Confidence is high with coverage of at
// least 0.8, at least 30 issues and status history; medium with coverage of at least 0.5 and at least 10 issues; low
// otherwise.
//
// Flow calibration (Little's law), with status history: observed average WIP L = days in doing inside the
// window ÷ days in the window; throughput λ = items finished inside the window ÷ days in the window; cycle time W =
// the mean days in doing of the items finished (their whole history, so a stay before the window counts to its item's
// cycle). L and λ × W agree when they are within LITTLE_TOLERANCE of L; past that, the window starts or ends with
// enough work in progress that the averages describe a changing load. It needs at least 20 finished items and 56 days
// of status history (from the team's first status change in the export to the window's end), and otherwise says how
// many it has. The measure keeps the numbers only; the limit is compared when it is read (src/tracker/measures.ts).

import type {
  ActivityMatch, ActivityMeasure, ActivityRule, Confidence, FlowCalibration, FlowItem, LeftOut, MeasureMode, MeasureSnapshot,
  MeasuredIssue, TeamMeasure, TrackerInventory, TrackerIssue, TrackerLink, TrackerMapping, TrackerStatus,
} from "../types.ts";
import { parseTime } from "../core/flow.ts";
import { ORG, parseRef, SHARED } from "../core/namespace.ts";
import { natCompare } from "../core/util.ts";
import { staysOf } from "./flow.ts";
import { mapStatus } from "./mapping.ts";

const DAY = 86_400_000;

/** The thresholds a team's confidence reads. */
export const CONFIDENCE_RULES = { high: { coverage: 0.8, issues: 30 }, medium: { coverage: 0.5, issues: 10 } } as const;
/** What flow calibration needs before it says anything about the limit. */
export const CALIBRATION_FLOOR = { finished: 20, days: 56 } as const;
/** L and λ × W agree when they differ by at most this share of L. */
export const LITTLE_TOLERANCE = 0.2;
/** The label on every share measured without status history. */
export const COUNT_LABEL = "by count of open items, not time";

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const bareOrg = (s: string) => { const r = parseRef(s); return r.ns === ORG ? r.id : s; };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");

export interface BauInput {
  issues: TrackerIssue[];
  inventory?: TrackerInventory;
  mapping: TrackerMapping;               // kind: org
  teams: { id: string; name: string }[]; // the org layer's teams, bare ids, in org.yaml order
  activities: { id: string; name: string; team: string }[]; // the org layer's activities, team bare
  end: { at: string; from: MeasureSnapshot["export"]["at_from"] }; // the window's end
  measured: string;                      // the run date, YYYY-MM-DD
  source: { dir: string; files: string[] };
  mappingSha256: string;
  designs?: { namespace: string; links: TrackerLink[] }[]; // composed designs whose tracker/links.yaml were read
  portfolio?: string;                    // the portfolio those designs came from, as passed
}

/** A team's confidence from its coverage, its issue count and whether time was measured. */
export function confidenceOf(coverage: number | undefined, issues: number, mode: MeasureMode): Confidence {
  if (coverage === undefined || mode !== "time") return "low";
  const { high, medium } = CONFIDENCE_RULES;
  if (coverage >= high.coverage - EPS && issues >= high.issues) return "high";
  if (coverage >= medium.coverage - EPS && issues >= medium.issues) return "medium";
  return "low";
}

/** Does an issue hold everything a rule matches on? `ancestors`: its parent, its parent's parent and so on. */
export function matchesRule(i: TrackerIssue, mt: ActivityMatch, ancestors: string[], fieldId: (s: string) => string = (s) => s): boolean {
  let any = false;
  if (mt.project) { any = true; if (!mt.project.includes(i.project)) return false; }
  if (mt.type) { any = true; if (!mt.type.includes(i.type)) return false; }
  if (mt.labels) { any = true; if (!i.labels.some((l) => mt.labels!.includes(l))) return false; }
  if (mt.components) { any = true; if (!i.components.some((c) => mt.components!.includes(c))) return false; }
  if (mt.parent) { any = true; if (!ancestors.some((a) => mt.parent!.includes(a))) return false; }
  if (mt.field) for (const [f, vals] of Object.entries(mt.field)) {
    any = true;
    const v = i.values?.[fieldId(f)];
    if (!v || !(vals.includes(v) || v.split(", ").some((x) => vals.includes(x)))) return false;
  }
  return any;
}

/** The unit a design-work label names, <namespace>:<unit>, or undefined for a bare label or another label. */
export function designLabel(label: string, prefix: string): string | undefined {
  if (!prefix || !label.startsWith(prefix)) return undefined;
  const r = parseRef(label.slice(prefix.length));
  return r.ns && r.ns !== SHARED && r.ns !== ORG && r.id ? `${r.ns}:${r.id}` : undefined;
}

interface Stay { status: string; start: number; end?: number }

interface Acc {
  issues: number; inDoing: number; days: number;
  design: { issues: number; days: number; by: Map<string, number> };
  acts: Map<string, { issues: number; days: number }>;
  unc: { issues: number; days: number };
  flow: Map<FlowItem | "unmapped", number>;
  finished: number; cycles: number[]; firstChange: number; wipStart: number; wipEnd: number;
  elsewhere: Map<string, { issues: number; days: number }>; // unclassified issues another team's rule matches, by activity
}
const emptyAcc = (): Acc => ({
  issues: 0, inDoing: 0, days: 0, design: { issues: 0, days: 0, by: new Map() }, acts: new Map(), unc: { issues: 0, days: 0 },
  flow: new Map(), finished: 0, cycles: [], firstChange: Infinity, wipStart: 0, wipEnd: 0, elsewhere: new Map(),
});

/** One measure of every team the mapping names, over the export, as a snapshot. */
export function measureBau(inp: BauInput): MeasureSnapshot {
  const m = inp.mapping;
  const o = m.org;
  if (!o) throw new Error("tracker/mapping.yaml is not an org mapping (kind: org)");
  const W1 = parseTime(inp.end.at);
  if (Number.isNaN(W1)) throw new Error(`the window's end "${inp.end.at}" is not a date`);
  const W0 = W1 - o.window_days * DAY;
  const notes: string[] = [];
  const mode: MeasureMode = inp.issues.some((i) => (i.transitions ?? []).length) ? "time" : "count";
  if (mode === "count") notes.push(`The export has no status history, so every share is ${COUNT_LABEL}, at confidence low at most. Export the issues with their changelog (Jira: expand=changelog) to measure time.`);

  // statuses: by name from the map; by category through what the inventory (or the issue itself) says of each status
  const cat = new Map<string, { name: string; category: TrackerStatus }>();
  for (const s of inp.inventory?.statuses ?? []) cat.set(s.name, { name: s.categoryName, category: s.category });
  for (const i of inp.issues) if (!cat.has(i.status)) cat.set(i.status, { name: i.statusCategoryName ?? "", category: i.statusCategory });
  const unmappedSeen = new Set<string>();
  const mapped = (status: string): TrackerStatus | undefined => {
    let v: TrackerStatus | undefined;
    if (m.status.by === "name") v = m.status.map[status];
    else { const c = cat.get(status); v = c ? mapStatus(m, status, c.name, c.category) : undefined; }
    if (v === undefined) unmappedSeen.add(status);
    return v;
  };
  const isDoing = (s: string | undefined) => !!s && mapped(s) === "doing";
  const isDone = (s: string | undefined) => !!s && mapped(s) === "done";
  const doingStatuses = m.status.by === "name"
    ? Object.entries(m.status.map).filter(([, v]) => v === "doing").map(([k]) => k)
    : [...cat.keys()].filter((s) => mapped(s) === "doing");

  // the rules for each team's own activities, in the mapping's order
  const actById = new Map(inp.activities.map((a) => [a.id, a]));
  const rulesFor = new Map<string, ActivityRule[]>();
  const ruled = new Set<string>();
  for (const r of o.activities) {
    const a = actById.get(bareOrg(r.activity));
    if (!a) { notes.push(`The rule for ${r.activity} names no activity of the org layer, so it applies to no team.`); continue; }
    ruled.add(a.id);
    if (!rulesFor.has(a.team)) rulesFor.set(a.team, []);
    rulesFor.get(a.team)!.push({ ...r, activity: a.id });
  }

  // the team an issue names
  const ids = new Map<string, string>();
  const fieldId = (s: string) => { if (!ids.has(s)) ids.set(s, inp.inventory?.fields.find((f) => f.id === s || f.name === s)?.id ?? s); return ids.get(s)!; };
  const t = m.owner_team;
  if (!t) throw new Error("tracker/mapping.yaml says no team (team: { as, field, match })");
  const teamValues = (i: TrackerIssue): string[] => {
    if (t.as === "component") return i.components;
    if (t.as === "project") return [i.project];
    const v = t.field ? i.values?.[fieldId(t.field)] : undefined;
    return v ? [v] : [];
  };
  const teamOf = (vals: string[]): string | undefined => {
    for (const [team, v] of Object.entries(t.match)) if (vals.includes(v)) return bareOrg(team);
    return undefined;
  };
  // the mapping's teams, in the org layer's order, then any the org layer does not hold
  const named = Object.keys(t.match).map(bareOrg);
  const teamOrder = [...inp.teams.map((x) => x.id).filter((x) => named.includes(x)), ...named.filter((x) => !inp.teams.some((y) => y.id === x))];
  const nameOf = (id: string) => inp.teams.find((x) => x.id === id)?.name ?? id;

  // design work: labels, then composed designs' links
  const prefix = o.designs.label_prefix;
  const linked = new Map<string, string>();
  for (const d of inp.designs ?? []) for (const l of d.links) linked.set(l.issue, `${d.namespace}:${l.unit}`);
  const designOf = (i: TrackerIssue): { unit: string; via: "label" | "links" } | undefined => {
    for (const lab of i.labels) { const u = designLabel(lab, prefix); if (u) return { unit: u, via: "label" }; }
    const u = linked.get(i.key);
    return u ? { unit: u, via: "links" } : undefined;
  };

  const byKey = new Map(inp.issues.map((i) => [i.key, i]));
  const ancestors = (i: TrackerIssue): string[] => {
    const out: string[] = [], seen = new Set([i.key]);
    for (let cur = i.parent; cur && !seen.has(cur); cur = byKey.get(cur)?.parent) { out.push(cur); seen.add(cur); }
    return out;
  };

  const left: LeftOut = { no_team: 0, other_team: 0, container: 0, subtask: 0, before_window: 0, after_window: 0 };
  const acc = new Map<string, Acc>();
  const rows: MeasuredIssue[] = [];
  let counted = 0;

  for (const i of [...inp.issues].sort((a, b) => natCompare(a.key, b.key))) {
    const vals = teamValues(i);
    if (!vals.length) { left.no_team++; continue; }
    const team = teamOf(vals);
    if (!team) { left.other_team++; continue; }
    if (i.level >= 1) { left.container++; continue; }
    if (i.level < 0) { left.subtask++; continue; }
    const created = parseTime(i.created);
    if (!Number.isNaN(created) && created > W1) { left.after_window++; continue; }

    // its stays; an issue with no recorded change has held its current status since it was created
    let stays: Stay[] = [];
    if (mode === "time") {
      stays = staysOf(i);
      if (!stays.length && !Number.isNaN(created)) stays = [{ status: i.status, start: created }];
    }
    const at = (ms: number): Stay | undefined => { let s: Stay | undefined; for (const x of stays) if (x.start <= ms && (x.end === undefined || ms < x.end)) s = x; return s; };
    let days = 0;
    if (mode === "time") { for (const s of stays) if (isDoing(s.status)) days += Math.max(0, Math.min(s.end ?? Infinity, W1) - Math.max(s.start, W0)) / DAY; }
    else days = isDoing(i.status) ? 1 : 0;

    // finished inside the window: done at its end, in a run of done stays that began inside it
    let finishAt: number | undefined;
    if (mode === "time") {
      const s = at(W1);
      if (s && isDone(s.status)) {
        let k = stays.indexOf(s), start = s.start;
        while (k > 0 && isDone(stays[k - 1].status) && stays[k - 1].end === stays[k].start) { k--; start = stays[k].start; }
        if (start > W0) finishAt = start;
        else if (days === 0) { left.before_window++; continue; } // done before the window began, and no work in it
      }
    }
    counted++;
    const cycle = finishAt === undefined ? undefined
      : stays.filter((s) => isDoing(s.status) && s.start < finishAt!).reduce((n, s) => n + (Math.min(s.end ?? finishAt!, finishAt!) - s.start) / DAY, 0);

    const a = acc.get(team) ?? emptyAcc();
    acc.set(team, a);
    a.issues++;
    a.days += days;
    const doingAtEnd = mode === "time" ? isDoing(at(W1)?.status) : isDoing(i.status);
    if (doingAtEnd) { a.inDoing++; a.wipEnd++; }
    if (mode === "time" && isDoing(at(W0)?.status)) a.wipStart++;
    if (finishAt !== undefined) { a.finished++; a.cycles.push(cycle!); }
    const first = parseTime(i.transitions?.[0]?.at);
    if (!Number.isNaN(first) && first <= W1) a.firstChange = Math.min(a.firstChange, first);
    const item: FlowItem | "unmapped" = o.flow_items[i.type] ?? "unmapped";
    a.flow.set(item, (a.flow.get(item) ?? 0) + days);

    let row: MeasuredIssue = { key: i.key, team, bucket: "unclassified", days: r2(days) };
    const d = designOf(i);
    if (d) {
      row = { key: i.key, team, bucket: "design", of: d.unit, via: d.via, days: r2(days) };
      a.design.issues++; a.design.days += days;
      const ns = parseRef(d.unit).ns!;
      a.design.by.set(ns, (a.design.by.get(ns) ?? 0) + days);
    } else {
      const anc = ancestors(i);
      const rule = (rulesFor.get(team) ?? []).find((r) => matchesRule(i, r.match, anc, fieldId));
      if (rule) {
        row = { key: i.key, team, bucket: "activity", of: rule.activity, days: r2(days) };
        const s = a.acts.get(rule.activity) ?? { issues: 0, days: 0 };
        s.issues++; s.days += days; a.acts.set(rule.activity, s);
      } else {
        a.unc.issues++; a.unc.days += days;
        // another team's rule matches it: say so, for whoever tunes the mapping
        for (const [other, rs] of rulesFor) if (other !== team) {
          const r = rs.find((x) => matchesRule(i, x.match, anc, fieldId));
          if (r) { const e = a.elsewhere.get(r.activity) ?? { issues: 0, days: 0 }; e.issues++; e.days += days; a.elsewhere.set(r.activity, e); break; }
        }
      }
    }
    if (finishAt !== undefined) { row.finished = true; row.cycle = r2(cycle!); }
    rows.push(row);
  }

  if (unmappedSeen.size)
    notes.push(`Statuses the issues held that the mapping cannot place (not in status.map, or of no known category), counted as not in doing: ${[...unmappedSeen].sort(natCompare).join(", ")}.`);

  const teams: TeamMeasure[] = teamOrder.map((id) => {
    const a = acc.get(id) ?? emptyAcc();
    const name = nameOf(id);
    const share = (d: number) => (a.days > 0 ? r4(d / a.days) : 0);
    const tnotes: string[] = [];
    const activities: ActivityMeasure[] = inp.activities.filter((x) => x.team === id && ruled.has(x.id)).map((x) => {
      const s = a.acts.get(x.id) ?? { issues: 0, days: 0 };
      return { activity: x.id, name: x.name, issues: s.issues, days: r2(s.days), share: share(s.days) };
    });
    const unruled = inp.activities.filter((x) => x.team === id && !ruled.has(x.id));
    if (unruled.length) tnotes.push(`Not measured, since no rule names ${unruled.length === 1 ? "it" : "them"}: ${unruled.map((x) => x.name).join(", ")}. ${unruled.length === 1 ? "Its" : "Their"} share stays as stated.`);
    const coverage = a.days > 0 ? r4(1 - a.unc.days / a.days) : undefined;
    if (a.days === 0) tnotes.push(mode === "time" ? "No time in doing inside the window, so no share is measured." : "No issue in doing now, so no share is measured.");
    if (mode === "count" && a.days > 0) tnotes.push(`Shares ${COUNT_LABEL}.`);
    for (const [act, e] of [...a.elsewhere].sort((x, y) => natCompare(x[0], y[0]))) {
      const owner = actById.get(act);
      tnotes.push(`${e.issues} of its unclassified issues (${r2(e.days)} ${mode === "time" ? "days" : "in doing"}) ${e.issues === 1 ? "matches" : "match"} the rule for ${owner?.name ?? act}, an activity of ${nameOf(owner?.team ?? "")}; ${e.issues === 1 ? "it counts" : "they count"} as ${name}'s own. If this is ${name}'s standing work, give it an activity of its own.`);
    }
    const flow: TeamMeasure["flow"] = {};
    for (const k of ["feature", "defect", "risk", "debt", "unmapped"] as const) if (a.flow.has(k)) flow[k] = r2(a.flow.get(k)!);
    const tm: TeamMeasure = {
      team: id, name, issues: a.issues, inDoing: a.inDoing, days: r2(a.days),
      design: { issues: a.design.issues, days: r2(a.design.days), share: share(a.design.days), by: Object.fromEntries([...a.design.by].sort((x, y) => natCompare(x[0], y[0])).map(([k, v]) => [k, r2(v)])) },
      activities,
      unclassified: { issues: a.unc.issues, days: r2(a.unc.days), share: share(a.unc.days) },
      ...(coverage !== undefined ? { coverage } : {}),
      confidence: confidenceOf(coverage, a.issues, mode),
      flow,
      ...(mode === "time" ? { calibration: calibrate(a, o.window_days, W1) } : {}),
      notes: tnotes,
    };
    return tm;
  });

  return {
    v: 1, as_of: iso(W1).slice(0, 10), measured: inp.measured,
    window: { from: iso(W0), to: iso(W1), days: o.window_days },
    export: { dir: inp.source.dir, files: inp.source.files, at: iso(W1), at_from: inp.end.from },
    mapping: { sha256: inp.mappingSha256 },
    mode, doing: doingStatuses.sort(natCompare),
    totals: { issues: inp.issues.length, counted, left_out: left },
    designs: { label_prefix: prefix, links: (inp.designs ?? []).filter((d) => d.links.length).map((d) => d.namespace).sort(natCompare), ...(inp.portfolio ? { portfolio: inp.portfolio } : {}) },
    notes, teams, issues: rows,
  };
}

/** Little's law over a team's window: the numbers, and whether there are enough of them. */
function calibrate(a: Acc, windowDays: number, W1: number): FlowCalibration {
  const historyDays = Number.isFinite(a.firstChange) ? Math.round(((W1 - a.firstChange) / DAY) * 10) / 10 : 0;
  const base = { finished: a.finished, historyDays, needs: { finished: CALIBRATION_FLOOR.finished, days: CALIBRATION_FLOOR.days } };
  if (!historyDays) return { status: "no-history", ...base };
  if (a.finished < CALIBRATION_FLOOR.finished || historyDays < CALIBRATION_FLOOR.days) return { status: "too-little", ...base };
  const L = a.days / windowDays, lambda = a.finished / windowDays, W = a.cycles.reduce((n, c) => n + c, 0) / a.cycles.length;
  const lw = lambda * W;
  return {
    status: "calibrated", ...base,
    wip: Math.round(L * 1000) / 1000, throughput: r4(lambda), cycle: r2(W), littles: Math.round(lw * 1000) / 1000,
    holds: L > 0 ? Math.abs(L - lw) <= LITTLE_TOLERANCE * L + EPS : lw === 0,
    wipStart: a.wipStart, wipEnd: a.wipEnd,
  };
}
