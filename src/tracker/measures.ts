// Measure snapshots: <root>/tracker/measures/<as_of>.json, one file per run of
// `bun plumb.ts tracker measure`, kept like report snapshots and never packaged. A run that measures exactly what a
// snapshot already holds (same export, mapping and numbers) writes nothing new; one that differs on the same date gets
// a suffix (-2, -3, ...).
//
// What the root's build reads from them: per estimate, the measured series (an activity's share; a team's observed
// WIP where the limit is calibrated), the latest point, and the gap between a person's stated figure and the measured
// value; per team, the latest measure without its per-issue rows, with the flow calibration read against the limit
// in force. A measured value never changes an estimate: only an accepted root patch does.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { CalibrationRead, EstimateFacts, FlowCalibration, MeasureGap, MeasureSnapshot, MeasureSummary, MeasuredPoint, OrgView, RootBundle } from "../types.ts";
import { canonicalJson, natCompare, sha256 } from "../core/util.ts";
import { ORG } from "../core/namespace.ts";
import { DEFAULT_GAP } from "../core/estimate.ts";
import { COUNT_LABEL } from "./bau.ts";
import { TRACKER_DIR } from "./load.ts";

export const MEASURES_DIR = "measures";

/** <dir>/tracker/measures/ */
export const measuresDir = (dir: string) => join(dir, TRACKER_DIR, MEASURES_DIR);

/** A snapshot's content key: everything but the run date, so measuring the same thing twice is one snapshot. */
const contentKey = (s: MeasureSnapshot) => { const { measured: _m, ...rest } = s; return sha256(canonicalJson(rest)); };

/** Every readable snapshot, oldest first (by as_of, then by file); unreadable files are skipped. */
export function loadMeasures(dir: string): (MeasureSnapshot & { file: string })[] {
  const md = measuresDir(dir);
  if (!existsSync(md)) return [];
  const out: (MeasureSnapshot & { file: string })[] = [];
  for (const f of readdirSync(md).filter((x) => x.endsWith(".json") && !x.startsWith("."))) {
    try {
      const j = JSON.parse(readFileSync(join(md, f), "utf8"));
      if (j && j.v === 1 && typeof j.as_of === "string" && Array.isArray(j.teams)) out.push({ ...j, file: `${TRACKER_DIR}/${MEASURES_DIR}/${f}` });
    } catch { /* skipped */ }
  }
  return out.sort((a, b) => a.as_of.localeCompare(b.as_of) || runOf(a.file) - runOf(b.file) || natCompare(a.file, b.file));
}

/** A snapshot's run on its date: <as_of>.json is the first, <as_of>-2.json the second, and so on. */
const runOf = (file: string) => Number(/-(\d+)\.json$/.exec(file.replace(/^.*\//, "").replace(/^\d{4}-\d{2}-\d{2}/, ""))?.[1] ?? 1);

/** A snapshot as written: indented, with one line per issue row so a long export stays readable and diffs by issue. */
export function snapshotText(snap: MeasureSnapshot): string {
  const { issues, ...rest } = snap;
  const head = JSON.stringify({ ...rest, issues: [] }, null, 1);
  return head.replace(/"issues": \[\]\n\}$/, `"issues": [${issues.length ? "\n" + issues.map((r) => "  " + JSON.stringify(r)).join(",\n") + "\n " : ""}]\n}`) + "\n";
}

/** Write a snapshot as tracker/measures/<as_of>.json, unless one with the same content is there. Returns the file, relative to the root. */
export function writeMeasure(dir: string, snap: MeasureSnapshot): { file: string; written: boolean } {
  const key = contentKey(snap);
  const same = loadMeasures(dir).find((s) => s.as_of === snap.as_of && contentKey((({ file: _f, ...x }) => x)(s) as MeasureSnapshot) === key);
  if (same) return { file: same.file, written: false };
  const md = measuresDir(dir);
  mkdirSync(md, { recursive: true });
  let name = `${snap.as_of}.json`;
  for (let i = 2; existsSync(join(md, name)); i++) name = `${snap.as_of}-${i}.json`;
  const tmp = join(md, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, snapshotText(snap));
  renameSync(tmp, join(md, name));
  return { file: `${TRACKER_DIR}/${MEASURES_DIR}/${name}`, written: true };
}

// ---------- words ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1 November 2026" */
export const longDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * The calibration read against the limit in force: the suggestion beside the limit, in words. `gap`: how far
 * the observed WIP may sit from the limit before the page calls it not held or above what the team carries (the root's
 * estimates.gap.capacity, default 1 slot).
 */
export function readCalibration(cal: FlowCalibration, opts: { team: string; limit?: number; gap?: number; windowDays: number; asOf: string }): CalibrationRead {
  const gap = opts.gap ?? DEFAULT_GAP.capacity;
  if (cal.status === "no-history") return { ...cal, text: `${opts.team}'s issues have no status history in the export, so its limit cannot be calibrated by flow.` };
  if (cal.status === "too-little")
    return { ...cal, text: `Flow calibration needs at least ${cal.needs.finished} finished items and ${cal.needs.days} days of status history; ${opts.team} has ${cal.finished} finished over ${Math.round(cal.historyDays)} days.` };
  const L = cal.wip!, lambda = cal.throughput!, W = cal.cycle!, lw = cal.littles!;
  const span = `over the ${opts.windowDays} days to ${longDate(opts.asOf)}`;
  const observed = cal.holds
    ? `Observed: ${one(L)} items in progress on average ${span} (${two(lambda)} finished a day × ${one(W)} days each gives ${one(lw)}, close to it).`
    : `Observed: ${one(L)} items in progress on average ${span}, but ${two(lambda)} finished a day × ${one(W)} days each gives ${one(lw)}: work in progress went from ${cal.wipStart} to ${cal.wipEnd} over the window, so the average describes a changing load.`;
  const proposed = Math.max(1, Math.round(L));
  if (opts.limit === undefined) return { ...cal, verdict: "no-limit", proposed, text: `${observed} No limit is stated; ${proposed} would match what the team carries.` };
  const verdict = L - opts.limit > gap ? "over" : opts.limit - L > gap ? "under" : "holds";
  const limitLine = verdict === "over" ? `The limit is ${opts.limit}. Either the limit is not being held, or it sits below what the team carries.`
    : verdict === "under" ? `The limit is ${opts.limit}, above what the team carries: either it could come down, or the team has room to start more.`
    : `The limit is ${opts.limit}, and the team holds it.`;
  return { ...cal, limit: opts.limit, verdict, proposed, text: `${observed} ${limitLine}` };
}

/** The latest snapshot per team without its per-issue rows, the calibration read against each team's limit in force. */
export function measureSummary(s: MeasureSnapshot & { file: string }, view: OrgView | undefined, gap?: number): MeasureSummary {
  return {
    file: s.file, as_of: s.as_of, measured: s.measured, mode: s.mode, window: s.window, totals: s.totals,
    teams: s.teams.map(({ calibration, ...t }) => {
      const limit = view?.teams.find((x) => x.id === t.team)?.capacity?.value;
      return { ...t, ...(calibration ? { calibration: readCalibration(calibration, { team: t.name, ...(limit !== undefined ? { limit } : {}), ...(gap !== undefined ? { gap } : {}), windowDays: s.window.days, asOf: s.as_of }) } : {}) };
    }),
  };
}

/** Stated against measured, in the page's words: "Stated 10%, measured 22%: 12 points apart." */
export function gapOf(kind: "share" | "capacity", stated: { value: number; by?: string }, measured: number, threshold: number): MeasureGap {
  const apart = Math.abs(measured - stated.value);
  const over = apart > threshold + 1e-9;
  const text = kind === "share"
    ? `Stated ${pct(stated.value)}, measured ${pct(measured)}: ${Math.round(apart * 100)} point${Math.round(apart * 100) === 1 ? "" : "s"} apart.`
    : `Limit ${stated.value}, observed ${one(measured)} in progress on average: ${one(apart)} apart.`;
  return { stated: stated.value, ...(stated.by ? { by: stated.by } : {}), measured, apart: Math.round(apart * 1000) / 1000, over, text };
}

/**
 * Attach each estimate's measured series, latest point and gap (EstimateFacts.measured) from the root's snapshots:
 * an activity's share from each measure that has it; a team's capacity from each measure that calibrated it (the
 * observed WIP), one point per date. The gap compares a person's figure (the value in force when a person stated it, else the `stated`
 * kept beside a measured value) with the latest measured value (a snapshot's, else the value in force when an accepted
 * refresh measured it), against the root's estimates.gap.
 */
export function attachMeasured(view: OrgView, snaps: (MeasureSnapshot & { file: string })[], gap: { share: number; capacity: number }): void {
  const series = new Map<string, MeasuredPoint[]>();
  // one point per date: a later run on the same date (a tuned mapping) replaces the earlier one
  const add = (k: string, p: MeasuredPoint) => {
    const pts = series.get(k) ?? [];
    if (pts.length && pts[pts.length - 1].as_of === p.as_of) pts.pop();
    pts.push(p); series.set(k, pts);
  };
  for (const s of snaps) for (const t of s.teams) {
    const of = { mode: s.mode, file: s.file, window_days: s.window.days, issues: t.issues };
    for (const a of t.activities) if (t.days > 0) add(`${ORG}:${a.activity} share`, { as_of: s.as_of, value: a.share, confidence: t.confidence, ...of, ...(t.coverage !== undefined ? { coverage: t.coverage } : {}) });
    if (t.calibration?.status === "calibrated" && t.calibration.wip !== undefined) add(`${ORG}:${t.team} capacity`, { as_of: s.as_of, value: t.calibration.wip, confidence: t.calibration.holds ? "medium" : "low", ...of });
  }
  for (const e of view.estimates) {
    if (e.field !== "share" && e.field !== "capacity") continue;
    const pts = series.get(`${e.record} ${e.field}`) ?? [];
    const latest = pts[pts.length - 1];
    const v = e.value;
    // measured: the latest measure, else a value in force that an accepted refresh measured
    const measured = latest?.value ?? (v && v.source === "tracker" ? v.value : undefined);
    if (measured === undefined) continue;
    const stated = v?.source === "person" ? { value: v.value, by: v.by } : v?.stated ? { value: v.stated.value, by: v.stated.by } : undefined;
    const facts: NonNullable<EstimateFacts["measured"]> = { series: pts, ...(latest ? { latest } : {}) };
    if (stated) facts.gap = gapOf(e.field as "share" | "capacity", stated, measured, e.field === "share" ? gap.share : gap.capacity);
    if (latest || facts.gap) e.measured = facts;
  }
}

/** What the root's bundle carries about its tracker: every measure, and the latest summarized. */
export function rootTrackerFacts(adapter: string, snaps: (MeasureSnapshot & { file: string })[], view: OrgView | undefined, gap?: number): NonNullable<RootBundle["tracker"]> {
  const latest = snaps[snaps.length - 1];
  return { adapter, measures: snaps.map((s) => ({ file: s.file, as_of: s.as_of, mode: s.mode })), ...(latest ? { latest: measureSummary(latest, view, gap) } : {}) };
}

/** A team's shares as one line: "Manual vulnerability triage and validation 0.38; design work 0.52; unclassified 0.10". */
export function sharesLine(t: MeasureSnapshot["teams"][number]): string {
  if (!t.days) return "nothing in doing";
  const parts = [...t.activities.map((a) => `${a.name} ${two(a.share)}`), `design work ${two(t.design.share)}`, `unclassified ${two(t.unclassified.share)}`];
  return parts.join("; ");
}

/** The measure as Markdown: what the CLI prints after a run. */
export function measureMd(s: MeasureSnapshot, file: string, written: boolean, view: OrgView | undefined, gap?: number, title?: string): string {
  const L: string[] = [`# Measured: ${title ? `${title}, ` : ""}${s.window.days} days to ${longDate(s.as_of)}`, ""];
  const lo = s.totals.left_out;
  const out = Object.entries(lo).filter(([, n]) => n).map(([k, n]) => `${n} ${{ no_team: "with no team value", other_team: "naming a team the mapping does not map", container: "epics or above", subtask: "sub-tasks", before_window: "finished before the window", after_window: "created after it" }[k as keyof typeof lo]}`);
  const from = { export: "the export's own date", "latest-update": "the newest issue update in the export (the export does not say when it was taken)", "as-of": "--as-of" }[s.export.at_from];
  L.push(`- export: ${s.export.dir}, ${s.totals.issues} issues, ending ${s.export.at} (${from})`,
    `- counted ${s.totals.counted} issues${out.length ? `; left out: ${out.join(", ")}` : ""}`,
    `- ${s.mode === "time" ? `time in ${s.doing.join(" and ") || "no status"}, from status history` : `shares ${COUNT_LABEL}: the export has no status history`}`,
    `- design work: labels ${s.designs.label_prefix}<namespace>:<unit>${s.designs.links.length ? `, and the tracker/links.yaml of ${s.designs.links.join(", ")}` : s.designs.portfolio ? `; no design in ${s.designs.portfolio} has a tracker/links.yaml` : "; no design's links.yaml read (pass --portfolio <portfolio.yaml> to read them)"}`, "");
  L.push(`| Team | ${s.mode === "time" ? "Days in doing" : "In doing now"} | Shares | Coverage | Issues | Confidence |`, "|---|---|---|---|---|---|");
  for (const t of s.teams) L.push(`| ${t.name} | ${t.days} | ${sharesLine(t)} | ${t.coverage === undefined ? "none" : two(t.coverage)} | ${t.issues} | ${t.confidence} |`);
  const sum = measureSummary({ ...s, file }, view, gap);
  const cal = sum.teams.filter((t) => t.calibration);
  if (cal.length) { L.push("", "## Flow calibration", ""); for (const t of cal) L.push(`- ${t.name}: ${t.calibration!.text}`); }
  const notes = [...s.notes, ...s.teams.flatMap((t) => t.notes.map((n) => `${t.name}: ${n}`))];
  if (notes.length) { L.push("", "## Notes", ""); for (const n of notes) L.push(`- ${n}`); }
  L.push("", written ? `wrote ${file}` : `this measure is already saved as ${file}; nothing new written`);
  return L.join("\n");
}
