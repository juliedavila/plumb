// Measured flow from the tracker: the time issues spent in each status, read from their status history (Jira's
// changelog), turned into waits and work at the stream steps tracker/mapping.yaml `flow:` names, and a lead time from
// a change's first mapped status to its first done status. Medians over completed stays only; a stay still open at
// export time is counted apart. Generic over adapters: it reads TrackerIssue.transitions.

import type { FlowMeasure, FlowMeasured, Model, TrackerIssue, TrackerMapping } from "../types.ts";
import { parseTime, round } from "../core/flow.ts";
import { natCompare } from "../core/util.ts";

const DAY = 86_400_000;

export function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b), n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

interface Stay { status: string; start: number; end?: number }

/** An issue's stays in each status, oldest first: from `created` (or its first transition) to each next transition. */
export function staysOf(i: TrackerIssue): Stay[] {
  const ts = (i.transitions ?? []).filter((t) => !Number.isNaN(parseTime(t.at)));
  if (!ts.length) return [];
  const out: Stay[] = [];
  const created = parseTime(i.created);
  if (ts[0].from && !Number.isNaN(created) && created <= parseTime(ts[0].at)) out.push({ status: ts[0].from, start: created, end: parseTime(ts[0].at) });
  ts.forEach((t, k) => out.push({ status: t.to, start: parseTime(t.at), ...(k + 1 < ts.length ? { end: parseTime(ts[k + 1].at) } : {}) }));
  return out;
}

function measure(values: { issue: string; days: number }[], open: number, from?: number, to?: number): FlowMeasure | undefined {
  if (!values.length) return undefined;
  return {
    days: round(median(values.map((v) => v.days))), n: values.length, issues: values.map((v) => v.issue).sort(natCompare),
    ...(open ? { open } : {}),
    ...(from !== undefined ? { from: new Date(from).toISOString().slice(0, 10) } : {}),
    ...(to !== undefined ? { to: new Date(to).toISOString().slice(0, 10) } : {}),
  };
}

/** What the export measures: per step, the median wait and work; the median lead time; or why it measures nothing. */
export function measureFlow(issues: TrackerIssue[], mapping: TrackerMapping | undefined, model: Model): FlowMeasured {
  const flow = mapping?.flow;
  const statuses = Object.entries(flow?.statuses ?? {}).map(([status, v]) => ({ status, step: v.step, as: v.as })).sort((a, b) => natCompare(a.status, b.status));
  const done = flow?.done ?? [];
  const withHistory = issues.filter((i) => (i.transitions ?? []).length);
  const transitions = withHistory.reduce((t, i) => t + i.transitions!.length, 0);
  const base: FlowMeasured = { available: false, issues: withHistory.length, transitions, statuses, done, steps: {} };
  const known = new Set(model.elements.map((e) => e.id));
  const unknownSteps = [...new Set(statuses.map((s) => s.step).filter((s) => !known.has(s)))].sort(natCompare);
  if (unknownSteps.length) base.unknownSteps = unknownSteps;
  if (!flow || !statuses.length) return { ...base, reason: "The tracker mapping names no status for a stream step, so nothing is measured; add flow: statuses to tracker/mapping.yaml." };
  if (!withHistory.length) return { ...base, reason: "The tracker export has no status history, so waits cannot be measured; export the issues with their changelog (Jira: expand=changelog)." };
  const byStatus = new Map(statuses.map((s) => [s.status, s]));
  const acc = new Map<string, { values: { issue: string; days: number }[]; open: number }>();
  const lead: { issue: string; days: number }[] = [];
  let leadOpen = 0, first = Infinity, last = -Infinity;
  for (const i of withHistory) {
    const stays = staysOf(i);
    const sums = new Map<string, { days: number; open: boolean }>();
    for (const s of stays) {
      first = Math.min(first, s.start); if (s.end !== undefined) last = Math.max(last, s.end); else last = Math.max(last, s.start);
      const m = byStatus.get(s.status);
      if (!m || !known.has(m.step)) continue;
      const k = `${m.step}\u0000${m.as}`;
      const x = sums.get(k) ?? { days: 0, open: false };
      if (s.end === undefined) x.open = true; else x.days += (s.end - s.start) / DAY;
      sums.set(k, x);
    }
    for (const [k, x] of sums) {
      const a = acc.get(k) ?? { values: [], open: 0 };
      if (x.open) a.open++; else a.values.push({ issue: i.key, days: x.days });
      acc.set(k, a);
    }
    const startAt = stays.find((s) => byStatus.has(s.status))?.start;
    if (startAt === undefined) continue;
    const end = stays.find((s) => s.start >= startAt && done.includes(s.status))?.start;
    if (end === undefined) leadOpen++; else lead.push({ issue: i.key, days: (end - startAt) / DAY });
  }
  const steps: FlowMeasured["steps"] = {};
  for (const [k, a] of [...acc].sort((x, y) => natCompare(x[0], y[0]))) {
    const [step, as] = k.split("\u0000") as [string, "wait" | "work"];
    const m = measure(a.values, a.open);
    if (!m && !a.open) continue;
    steps[step] ??= {};
    if (m) steps[step][as] = m;
  }
  for (const k of Object.keys(steps)) if (!steps[k].wait && !steps[k].work) delete steps[k];
  const leadM = measure(lead, leadOpen);
  const span = Number.isFinite(first) ? { from: new Date(first).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) } : {};
  if (!Object.keys(steps).length && !leadM) return { ...base, ...span, reason: "No issue in the tracker export has finished a stay in a status the mapping names, so nothing is measured yet." };
  return { ...base, ...span, available: true, steps, ...(leadM ? { lead: leadM } : {}) };
}
