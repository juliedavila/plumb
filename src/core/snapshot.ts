// Report snapshots: `bun plumb.ts report <instance> [--presented]`.
//
// A snapshot is compact: the digest the "since you last looked" panel uses (one short hash per record, with state),
// plus phase status, the tracker's state summary, a findings summary, the premise risk summary and the ownership gap.
// It is saved in <instance>/reports/<timestamp>.json. One flagged `presented` is what the room saw: the present deck's
// "what changed" compares the build with the last presented snapshot, falling back to the last saved one, and says which.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Bundle, HistoryColumn, ReportRef, ReportSnapshot, SinceReport, StatusHistory } from "../types.ts";
import { DIGEST } from "./digest.ts";

export const REPORTS_DIR = "reports";

const isoSecond = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Load-bearing untested premises: the premises pack's warnings. */
function loadBearingIds(b: Bundle): string[] {
  return b.findings.filter((f) => f.pack === "premises" && f.rule === "load-bearing-untested").map((f) => f.at);
}

/** The snapshot of a built bundle. */
export function makeSnapshot(b: Bundle, opts: { presented?: boolean; now?: Date } = {}): ReportSnapshot {
  const now = isoSecond(opts.now ?? new Date());
  const frontier = new Set(b.analysis?.frontier ?? []);
  const seen = new Set<string>();
  const units = b.plan.units.filter((u) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  const phases = [...b.plan.phases].sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((p) => {
    const us = units.filter((u) => u.phase === p.id);
    return {
      id: p.id, name: p.name, order: p.order, total: us.length,
      done: us.filter((u) => u.status === "done").length,
      doing: us.filter((u) => u.status === "doing").length,
      ready: us.filter((u) => u.status !== "done" && u.status !== "doing" && frontier.has(u.id)).length,
    };
  });
  const byRule: Record<string, number> = {};
  for (const f of b.findings) byRule[`${f.pack}/${f.rule}`] = (byRule[`${f.pack}/${f.rule}`] ?? 0) + 1;
  const errors = b.findings.filter((f) => f.severity === "error").length;
  const snap: ReportSnapshot = {
    v: 1, saved: now, ...(opts.presented ? { presented: now } : {}),
    built: b.engine.built, hash: b.engine.hash, ...(b.engine.modelHash ? { modelHash: b.engine.modelHash } : {}),
    digest: DIGEST.digest(b),
    phases,
    findings: { errors, warnings: b.findings.length - errors, byRule },
    engineVersion: b.engine.version, ...(b.engine.rules ? { rules: b.engine.rules } : {}),
    ...(b.importer ? { importer: b.importer } : {}),
  };
  if (b.status) snap.status = { overall: b.status.overall.status, milestones: b.status.milestones.map((m) => ({ id: m.phase, status: m.status, computed: m.computed })) };
  const r = b.tracker?.reconcile;
  if (b.tracker) snap.tracker = {
    ...(b.tracker.latestUpdate ? { latestUpdate: b.tracker.latestUpdate } : {}),
    linked: r?.counts.linked ?? 0, proposed: r?.counts.proposed ?? 0,
    statusDisagreements: r?.counts.statusDisagreements ?? 0, dependencyOneSided: r?.counts.dependencyOneSided ?? 0,
    phaseDisagreements: r?.counts.phaseDisagreements ?? 0, ownerDisagreements: r?.ownerDisagreements?.length ?? 0,
  };
  const claims = (b.model.claims ?? []).filter((c) => !c.home); // a 0.4 design's own claims
  if (claims.length) snap.premises = { claims: claims.length, untested: claims.filter((c) => c.grade === "untested").length, loadBearing: loadBearingIds(b) };
  if (b.teams) snap.owners = {
    parts: b.model.elements.filter((e) => !e.home).length, unownedParts: b.teams.unownedParts.length, // a 0.4 design's own parts, not its outside ones
    units: Object.keys(b.teams.units).length, unassignedUnits: b.teams.unassigned.reduce((n, g) => n + g.units.length, 0),
  };
  return snap;
}

/** The file name for a snapshot saved at an ISO time: 2026-10-22T14-03-07Z.json (colons do not travel well). */
export function snapshotFile(saved: string): string {
  return saved.replace(/:/g, "-").replace(/[^0-9A-Za-z.-]/g, "-") + ".json";
}

/** Write a snapshot into <dir>/reports/, never over another one; returns the file name relative to the instance. */
export function saveSnapshot(dir: string, snap: ReportSnapshot): string {
  const rdir = join(dir, REPORTS_DIR);
  mkdirSync(rdir, { recursive: true });
  let name = snapshotFile(snap.saved);
  for (let i = 2; existsSync(join(rdir, name)); i++) name = snapshotFile(snap.saved).replace(/\.json$/, `-${i}.json`);
  const tmp = join(rdir, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(snap, null, 1) + "\n");
  renameSync(tmp, join(rdir, name));
  return `${REPORTS_DIR}/${name}`;
}

/** Every readable snapshot of an instance, oldest first. Unreadable files are skipped. */
export function loadReports(dir: string): (ReportSnapshot & { file: string })[] {
  const rdir = join(dir, REPORTS_DIR);
  if (!existsSync(rdir)) return [];
  const out: (ReportSnapshot & { file: string })[] = [];
  for (const f of readdirSync(rdir).filter((x) => x.endsWith(".json") && !x.startsWith("."))) {
    try {
      const j = JSON.parse(readFileSync(join(rdir, f), "utf8"));
      if (j && j.v === 1 && typeof j.saved === "string" && j.digest && j.digest.r) out.push({ ...j, file: `${REPORTS_DIR}/${f}` });
    } catch { /* skipped */ }
  }
  return out.sort((a, b) => a.saved.localeCompare(b.saved) || a.file.localeCompare(b.file));
}

export const reportRef = (s: ReportSnapshot & { file: string }): ReportRef =>
  ({ file: s.file, saved: s.saved, ...(s.presented ? { presented: s.presented } : {}), hash: s.hash, built: s.built });

/** The deck's baseline: the last snapshot marked presented, else the last saved one. */
export function baseline(reports: (ReportSnapshot & { file: string })[]): { snap: ReportSnapshot & { file: string }; basis: "presented" | "saved" } | undefined {
  const presented = reports.filter((r) => r.presented).sort((a, b) => a.presented!.localeCompare(b.presented!) || a.saved.localeCompare(b.saved));
  if (presented.length) return { snap: presented[presented.length - 1], basis: "presented" };
  if (reports.length) return { snap: reports[reports.length - 1], basis: "saved" };
  return undefined;
}

/** What changed between the baseline snapshot and this build. */
export function sinceReport(b: Bundle, reports: (ReportSnapshot & { file: string })[]): SinceReport | undefined {
  const base = baseline(reports);
  if (!base) return undefined;
  const s = base.snap;
  // The snapshot's own status, when the digest predates it, so an older report still shows status moves.
  const old = s.digest.s || !s.status ? s.digest : { ...s.digest, s: { o: s.status.overall, m: Object.fromEntries(s.status.milestones.map((m) => [m.id, m.status])), c: Object.fromEntries(s.status.milestones.map((m) => [m.id, m.computed])) } };
  const d = DIGEST.compare(old, DIGEST.digest(b), DIGEST.names(b));
  return {
    basis: base.basis,
    ...(s.importer || b.importer ? { importer: { ...(s.importer ? { from: s.importer } : {}), ...(b.importer ? { to: b.importer } : {}) } } : {}),
    against: { ...reportRef(s), phases: s.phases, findings: s.findings, ...(s.owners ? { owners: s.owners } : {}), ...(s.premises ? { premises: s.premises } : {}), ...(s.tracker ? { tracker: s.tracker } : {}), ...(s.status ? { status: s.status } : {}), ...(s.engineVersion ? { engineVersion: s.engineVersion } : {}), ...(s.rules ? { rules: s.rules } : {}) },
    diff: {
      ...(s.importer || b.importer ? { importer: { ...(s.importer ? { from: s.importer } : {}), ...(b.importer ? { to: b.importer } : {}) } } : {}),
      from: { label: base.basis === "presented" ? `the report presented ${s.presented}` : `the report saved ${s.saved}`, built: s.built, hash: s.hash },
      to: { label: "this build", built: b.engine.built, hash: b.engine.hash },
      ...d,
    },
  };
}

/** One snapshot per build hash: the presented one where there is one, else the last saved; oldest first. */
export function uniqueReports<T extends Pick<ReportSnapshot, "hash" | "saved" | "presented">>(reports: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of reports) {
    const k = r.hash || r.saved, cur = by.get(k);
    if (!cur || (!!r.presented && !cur.presented) || (!!r.presented === !!cur.presented && r.saved > cur.saved)) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => a.saved.localeCompare(b.saved));
}

/**
 * Status over time: one column per distinct report (the same build saved twice is one column), oldest first, then this
 * build, unless the newest report is this build. Each column: every milestone's status and progress, the plan's status,
 * and how many load-bearing premises were untested. A report older than status records says so ("not recorded").
 */
export function statusHistory(b: Bundle, reports: (ReportSnapshot & { file?: string })[]): StatusHistory {
  const phases = [...b.plan.phases].sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((p) => p.id);
  const cols: HistoryColumn[] = uniqueReports(reports).map((r) => ({
    label: r.presented ? "presented" : "saved", saved: r.saved, ...(r.presented ? { presented: r.presented } : {}), ...(r.file ? { file: r.file } : {}),
    recorded: !!r.status, ...(r.status ? { overall: r.status.overall } : {}),
    milestones: Object.fromEntries(phases.map((id) => {
      const p = r.phases?.find((x) => x.id === id), m = r.status?.milestones.find((x) => x.id === id);
      return [id, { ...(m ? { status: m.status, computed: m.computed } : {}), done: p?.done ?? 0, total: p?.total ?? 0 }];
    })),
    ...(r.premises ? { untested: r.premises.loadBearing.length } : {}),
  }));
  const now = makeSnapshot(b);
  const nowCol: HistoryColumn = {
    label: "now", now: true, recorded: true, ...(b.status ? { overall: b.status.overall.status } : {}),
    milestones: Object.fromEntries(phases.map((id) => { const p = now.phases.find((x) => x.id === id), m = b.status?.milestones.find((x) => x.phase === id); return [id, { ...(m ? { status: m.status, computed: m.computed } : {}), done: p?.done ?? 0, total: p?.total ?? 0 }]; })),
    ...(now.premises ? { untested: now.premises.loadBearing.length } : {}),
  };
  const last = uniqueReports(reports).at(-1);
  if (last && last.hash === b.engine.hash) cols[cols.length - 1] = { ...nowCol, label: cols[cols.length - 1].label, ...(last.presented ? { presented: last.presented } : {}), ...(last.file ? { file: last.file } : {}), saved: last.saved };
  else cols.push(nowCol);
  return { phases, columns: cols };
}
