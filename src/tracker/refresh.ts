// The drafted refresh: `bun plumb.ts tracker measure <root> --draft-patch` puts every
// measured change of one run into one proposed root patch in <root>/patches/, which the approver accepts or rejects
// whole. Nothing changes until then: an agent never edits org.yaml, and a proposed patch is never applied.
//
// Each activity whose share the run measured gets one op: `modify activity <id>` setting `share` to the measured
// value (two decimals), source tracker, by "tracker:activity/<id>", as of the window's end, at its team's confidence.
// The figure a person stated stays beside it as `stated`: the value in force when a person stated it, else the
// `stated` the value in force already keeps. A share measured without status history carries the note "by count of
// open items, not time". An activity whose value in force is already exactly this is left out.
//
// With `limits`, each team whose WIP limit the run calibrated by flow also gets `modify team <id>` setting `capacity`
// to the observed WIP rounded to a whole number (at least 1), when that differs from the limit in force: medium
// confidence where Little's law agrees, low where it does not, with the person's limit kept as `stated`. A WIP limit
// is a policy, not a measurement, so this is asked for, never drafted by default.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Confidence, Estimate, MeasureSnapshot, OrgView, RootInput, StatedFigure } from "../types.ts";
import { canonicalJson } from "../core/util.ts";
import { COUNT_LABEL } from "./bau.ts";
import { longDate, readCalibration } from "./measures.ts";

export interface RefreshOptions {
  created: string;                       // the run date, YYYY-MM-DD
  agent?: { name: string; tool: string; model?: string }; // the named agent that ran the refresh (author: agent)
  by?: string;                           // or the person who ran it (author: that role)
  requestedBy?: string;
  limits?: boolean;                      // also propose each calibrated team's WIP limit
  gap?: number;                          // the root's estimates.gap.capacity, for the calibration's words
}

export interface RefreshChange {
  kind: "activity" | "team"; id: string; name: string; field: "share" | "capacity";
  before?: number; after: number; confidence: Confidence;
}

export interface DraftedRefresh { id: string; file: string; text: string; changes: RefreshChange[]; ops: unknown[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const KEYWORD = /^(true|false|null|yes|no|on|off|y|n|~)$/i;
/** A YAML scalar: plain where it is safe, else double-quoted (JSON's quoting is valid YAML). */
export function yamlScalar(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  return /^[A-Za-z][A-Za-z0-9 ._'()-]*$/.test(s) && !KEYWORD.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s);
}
/** A flow mapping on one line: { k: v, ... }, nested mappings likewise. */
export function yamlFlow(o: Record<string, unknown>): string {
  return `{ ${Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v && typeof v === "object" && !Array.isArray(v) ? yamlFlow(v as Record<string, unknown>) : yamlScalar(v)}`).join(", ")} }`;
}

/** The person's figure to keep beside a measured value. */
function statedOf(e: Estimate | undefined): StatedFigure | undefined {
  if (!e) return undefined;
  if (e.source === "person") return { value: e.value, by: e.by, as_of: e.as_of };
  return e.stated;
}

/** The next free root patch id, P-NNN, after the highest numbered one there. */
export function nextPatchId(root: Pick<RootInput, "patches">): string {
  let max = 0, width = 3;
  for (const p of root.patches ?? []) { const m = /^P-(\d+)$/.exec(p.id); if (m) { max = Math.max(max, Number(m[1])); width = Math.max(width, m[1].length); } }
  return `P-${String(max + 1).padStart(width, "0")}`;
}

/** The refresh one measure proposes, or undefined when it changes nothing in force. */
export function draftRefresh(snap: MeasureSnapshot, measureFile: string, root: RootInput, view: OrgView, opts: RefreshOptions): DraftedRefresh | undefined {
  const changes: RefreshChange[] = [];
  const ops: { op: "modify"; kind: "activity" | "team"; id: string; set: Record<string, Record<string, unknown>> }[] = [];
  const teamOf = new Map(snap.teams.map((t) => [t.team, t]));

  // shares, in org.yaml's order of activities
  for (const a of view.activities) {
    const team = teamOf.get(a.team.replace(/^org:/, ""));
    const m = team?.days ? team.activities.find((x) => x.activity === a.id) : undefined;
    if (!team || !m) continue;
    const stated = statedOf(a.share);
    const share: Record<string, unknown> = {
      value: r2(m.share), source: "tracker", by: `tracker:activity/${a.id}`, as_of: snap.as_of, confidence: team.confidence,
      ...(snap.mode === "count" ? { note: COUNT_LABEL } : {}),
      ...(stated ? { stated: { value: stated.value, by: stated.by, as_of: stated.as_of } } : {}),
    };
    if (a.share && canonicalJson(a.share) === canonicalJson(share)) continue;
    ops.push({ op: "modify", kind: "activity", id: a.id, set: { share } });
    changes.push({ kind: "activity", id: a.id, name: a.name, field: "share", ...(a.share ? { before: a.share.value } : {}), after: r2(m.share), confidence: team.confidence });
  }

  // WIP limits from flow, only when asked
  if (opts.limits) for (const t of view.teams) {
    const cal = teamOf.get(t.id)?.calibration;
    if (cal?.status !== "calibrated") continue;
    const read = readCalibration(cal, { team: t.name, ...(t.capacity ? { limit: t.capacity.value } : {}), ...(opts.gap !== undefined ? { gap: opts.gap } : {}), windowDays: snap.window.days, asOf: snap.as_of });
    const value = read.proposed!;
    if (t.capacity?.value === value) continue;
    const stated = statedOf(t.capacity);
    const confidence: Confidence = cal.holds ? "medium" : "low";
    const capacity: Record<string, unknown> = {
      value, source: "tracker", by: `tracker:team/${t.id}/wip`, as_of: snap.as_of, confidence,
      note: `Observed ${cal.wip} items in progress on average over ${snap.window.days} days (${cal.throughput} finished a day × ${cal.cycle} days each); ${cal.holds ? "Little's law agrees" : `Little's law does not agree, since work in progress went from ${cal.wipStart} to ${cal.wipEnd}`}.`,
      ...(stated ? { stated: { value: stated.value, by: stated.by, as_of: stated.as_of } } : {}),
    };
    ops.push({ op: "modify", kind: "team", id: t.id, set: { capacity } });
    changes.push({ kind: "team", id: t.id, name: t.name, field: "capacity", ...(t.capacity ? { before: t.capacity.value } : {}), after: value, confidence });
  }
  if (!ops.length) return undefined;

  const id = nextPatchId(root);
  let file = `${id}-tracker-refresh-${snap.as_of}.yaml`;
  for (let i = 2; existsSync(join(root.dir, "patches", file)); i++) file = `${id}-tracker-refresh-${snap.as_of}-${i}.yaml`;
  const span = `${snap.window.days} days to ${longDate(snap.as_of)}`;
  const covered = snap.teams.filter((t) => changes.some((c) => (c.kind === "team" ? c.id === t.team : view.activities.find((a) => a.id === c.id)?.team.replace(/^org:/, "") === t.team)) && t.coverage !== undefined);
  const fmt = (n: number | undefined, share: boolean) => (n === undefined ? "not stated" : share ? n.toFixed(2) : String(n));
  const shareLines = changes.filter((c) => c.field === "share").map((c) => `${c.name} ${fmt(c.before, true)} to ${fmt(c.after, true)} (${c.confidence})`);
  const capLines = changes.filter((c) => c.field === "capacity").map((c) => `${c.name} ${fmt(c.before, false)} to ${c.after} (${c.confidence})`);
  const why = [
    `Measured from the tracker over the ${span} (${measureFile}): ${snap.totals.issues} issues, ${snap.totals.counted} of them counted.`,
    snap.mode === "count" ? `The export has no status history, so the shares are ${COUNT_LABEL}.` : "",
    covered.length ? `Classified time: ${covered.map((t) => `${t.name} ${Math.round(t.coverage! * 100)}%`).join(", ")}.` : "",
    shareLines.length ? `Shares: ${shareLines.join("; ")}.` : "",
    capLines.length ? `WIP limits from flow: ${capLines.join("; ")}.` : "",
    "Each value keeps the figure a person stated beside it.",
  ].filter(Boolean).join(" ");

  const prov: string[] = [];
  if (opts.agent) {
    prov.push("  author: agent", `  agent: ${yamlFlow({ name: opts.agent.name, tool: opts.agent.tool, model: opts.agent.model })}`);
  } else prov.push(`  author: ${yamlScalar(opts.by ?? "agent")}`);
  if (opts.requestedBy) prov.push(`  requested_by: ${yamlScalar(opts.requestedBy)}`);
  prov.push(`  created: ${JSON.stringify(opts.created)}`);
  if (root.modelHash) prov.push(`  based_on: ${root.modelHash.slice(0, 12)}`);
  const L = [
    `# A tracker refresh, drafted by \`bun plumb.ts tracker measure --draft-patch\` from ${measureFile}.`,
    "# Proposed: it changes nothing until the approver accepts it (status: accepted, with decision: { by, at, reason }).",
    "# One refresh, one patch: accept or reject it whole.",
    `id: ${id}`,
    `title: ${yamlScalar(`Tracker refresh, ${span}`)}`,
    "status: proposed",
    "provenance:", ...prov,
    `why: ${JSON.stringify(why)}`,
    "ops:",
  ];
  for (const op of ops) {
    const [field, est] = Object.entries(op.set)[0];
    L.push(`  - op: modify`, `    kind: ${op.kind}`, `    id: ${yamlScalar(op.id)}`, "    set:", `      ${field}: ${yamlFlow(est)}`);
  }
  return { id, file, text: L.join("\n") + "\n", changes, ops };
}

/** Write a drafted refresh into <root>/patches/. Returns its path, relative to the root. */
export function writeRefresh(rootDir: string, d: DraftedRefresh): string {
  mkdirSync(join(rootDir, "patches"), { recursive: true });
  writeFileSync(join(rootDir, "patches", d.file), d.text);
  return `patches/${d.file}`;
}
