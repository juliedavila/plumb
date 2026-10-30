// The shared root's own build: what the root holds, checked by itself.
//
// `bun plumb.ts check <root>` and `bun plumb.ts build <root>` load the root with its accepted patches applied, read the org
// layer (src/core/org.ts), compute the marks on what crosses (src/core/shared.ts) and run two packs over them: org
// (estimates, shares, slowdowns, exceptions) and shared (marks, crossings, the shipped file left intact). Core findings
// come with them: a root patch that does not read or apply, and references inside the root that resolve nowhere
// (core/xref-resolves (b)); references from the root into a design are judged where that design is composed. Notes in
// the root may be pinned to records of either namespace. A portfolio build checks its root the same way, passing the
// designs it composes, so what reads into them (a milestone reached, a module seam's contracts) is judged too.
// A root with a tracker/ folder holds the organization's org mapping (kind: org): the tracker pack checks it against
// the inventory and the org layer, and the measures in tracker/measures/ give each estimate its measured series and
// gap (src/tracker/measures.ts).
//
// The root's build writes no page of its own; the portfolio page reads its bundle (RootBundle).

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { ComposedDesign, Finding, Note, RootBundle, RootCheck, RootInput, RootLoadOptions, RootProblem, RulePack, Team, TrackerInput } from "../types.ts";
import { buildContext, compareFindings, corePack, dedupeFindings, loadPacks, runRules } from "./rules.ts";
import { loadRoot, ROOT_NOTE_KINDS } from "./root.ts";
import { estimateSettings, readOrgView } from "./org.ts";
import { computeMarks, crossingProblems, fileIntactProblem, markProblems, sharedRefProblems } from "./shared.ts";
import { ownerTeams, teamMapRefs } from "./teams.ts";
import { ORG, parseRef, SHARED } from "./namespace.ts";
import { canonicalJson, natCompare, sha256 } from "./util.ts";
import { findingsMd } from "./report.ts";
import { pack as NOTES_PACK } from "../../packs/notes/index.ts";
import { ENGINE_VERSION } from "./bundle.ts";
import { loadTracker } from "../tracker/load.ts";
import { attachMeasured, loadMeasures, rootTrackerFacts } from "../tracker/measures.ts";

export const ROOT_PACKS = ["org", "shared"];

export interface RootBuildOptions extends RootLoadOptions {
  built?: string;                        // the build time; its date is "today" for ages and ends
  compose?: ComposedDesign[];            // designs composed with the root (a portfolio)
}

/** References in the team map to teams the root does not declare (when it declares any): core/xref-resolves (b). */
function teamMapProblems(root: RootInput): RootProblem[] {
  const out: RootProblem[] = [];
  const map = root.teamMap;
  if (!map) return out;
  for (const p of map.problems) out.push({ rule: "core/xref-resolves", at: "team-map.yaml", atKind: "instance", message: p, severity: "error" });
  const declared = new Set([...(root.org?.teams ?? []).map((t) => t.id), ...map.teams.map((t) => t.id)]);
  if (!declared.size) return out; // the teams live in each design (a root with no org layer): judged there
  for (const { team, where } of teamMapRefs(map)) {
    const id = parseRef(team).ns === ORG ? parseRef(team).id : team;
    if (!declared.has(id)) out.push({ rule: "core/xref-resolves", at: "team-map.yaml", atKind: "instance", message: `team-map.yaml ${where} names the team ${team}, which ${root.org ? "the org layer" : "the map's own teams"} does not hold`, severity: "error" });
  }
  return out;
}

/** Does a note's target exist in the root? Undefined for a finding (checked once the rules have run). */
function noteTargetExists(root: RootInput, note: Note): boolean | undefined {
  const { kind } = note.target;
  const r = parseRef(note.target.id);
  const sh = root.shared, org = root.org;
  if (kind === "finding") return undefined;
  // Composition exposes unmapped shared ownership roles as team-like records.
  if (kind === "team" && r.ns === SHARED) return !!sh?.parts.some((p) => p.owner === r.id) || !!sh?.seams.some((s) => s.owner_role === r.id);
  if (kind === "patch") return (root.patches ?? []).some((p) => p.id === note.target.id);
  if (ROOT_NOTE_KINDS[kind] === SHARED) {
    if (r.ns && r.ns !== SHARED) return false;
    switch (kind) {
      case "element": return !!sh?.parts.some((x) => x.id === r.id);
      case "relationship": return !!sh?.crossings.some((x) => x.id === r.id);
      case "contract": return !!sh?.contracts.some((x) => x.name === r.id);
      case "claim": return !!sh?.claims.some((x) => x.id === r.id);
      case "seam": return !!sh?.seams.some((x) => x.id === r.id);
      case "capability": return !!sh?.capabilities.some((x) => x.id === r.id);
      case "system": return !!sh?.systems.some((x) => x.id === r.id);
      case "zone": return !!sh?.zones.some((x) => x.id === r.id);
      case "manual-work": return !!sh?.manual_work.some((x) => x.id === r.id);
    }
  }
  if (ROOT_NOTE_KINDS[kind] === ORG) {
    const id = r.ns === ORG ? r.id : note.target.id;
    switch (kind) {
      case "team": return !!org?.teams.some((x) => x.id === id);
      case "activity": return !!org?.activities.some((x) => x.id === id);
      case "slowdown": return !!org?.slowdowns.some((x) => x.id === id);
      case "exception": return !!org && id in org.seam_exceptions;
    }
  }
  return false;
}

const asFinding = (p: RootProblem): Finding => {
  const [pack, rule] = p.rule.split("/");
  return { pack, rule, severity: p.severity ?? "error", at: p.at, atKind: p.atKind, message: p.message };
};

/** Check a root: the org and shared packs over its layers, its patches' problems, its references and its notes. */
export async function checkRoot(rootOrDir: RootInput | string, opts: RootBuildOptions = {}): Promise<{ root: RootInput; check: RootCheck; findings: Finding[]; packs: RulePack[]; tracker?: TrackerInput }> {
  const root = typeof rootOrDir === "string" ? loadRoot(rootOrDir, { ...(opts.with ? { with: opts.with } : {}), ...(opts.without ? { without: opts.without } : {}) }) : rootOrDir;
  const built = opts.built ?? new Date().toISOString();
  const today = /^\d{4}-\d{2}-\d{2}/.test(built) ? built.slice(0, 10) : undefined;
  const org = readOrgView(root, { ...(today ? { today } : {}), ...(opts.compose ? { compose: opts.compose } : {}) });
  const marks = computeMarks(root, opts.compose ?? []);
  const problems: RootProblem[] = [
    ...(org?.problems ?? []), ...markProblems(root, marks), ...crossingProblems(root), ...sharedRefProblems(root), ...teamMapProblems(root),
  ];
  const fi = fileIntactProblem(root); if (fi) problems.push(fi);
  const check: RootCheck = { input: root, ...(today ? { today } : {}), ...(opts.compose ? { compose: opts.compose } : {}), ...(org ? { org } : {}), marks, problems };
  // the org mapping in <root>/tracker/, when there is one: the tracker pack checks it; the measures give each estimate its measured values
  const tracker = loadTracker(root.dir);
  if (org) attachMeasured(org, loadMeasures(root.dir), estimateSettings(root).gap);
  const packNames = tracker ? [...ROOT_PACKS, "tracker"] : ROOT_PACKS;
  const { packs, errors } = await loadPacks(packNames);
  const config = { ...root.config, name: String(root.config.name ?? basename(root.dir)), title: String(root.config.title ?? root.config.name ?? basename(root.dir)), packs: packNames };
  const ctx = buildContext(config, { teams: [], systems: [], zones: [], elements: [], relationships: [], contracts: [], views: [] }, { phases: [], units: [] });
  ctx.root = check;
  if (tracker) ctx.tracker = tracker;
  ctx.today = today;
  const findings: Finding[] = [...runRules(packs, ctx)];
  for (const e of errors) findings.push({ pack: "core", rule: "pack-loads", severity: "error", at: e.name, atKind: "instance", message: `pack ${e.name} did not load: ${e.message}` });
  for (const p of root.problems) findings.push({ pack: "core", rule: "xref-resolves", severity: "error", at: "engine.yaml", atKind: "instance", message: p });
  for (const p of [...(root.shared?.problems ?? []), ...(root.org?.problems ?? [])]) findings.push({ pack: "core", rule: "xref-resolves", severity: "error", at: "engine.yaml", atKind: "instance", message: p });
  findings.push(...(root.loadFindings ?? []));
  findings.push(...problems.filter((p) => p.rule.startsWith("core/")).map(asFinding));
  // notes pinned to records of either namespace; notes on findings once every rule has run
  const notes = root.notes?.notes ?? [];
  for (const n of notes) if (noteTargetExists(root, n) === false)
    findings.push({ pack: "notes", rule: "target-exists", severity: "warning", at: n.id, atKind: "note", message: `${n.kind === "question" ? "Question" : "Note"} ${n.id} is pinned to ${n.target.kind} ${n.target.id}, which no longer exists` });
  const ids = new Set(findings.map((f) => `${f.pack}/${f.rule}@${f.at}`));
  for (const n of notes) if (n.target.kind === "finding" && !ids.has(n.target.id))
    findings.push({ pack: "notes", rule: "target-exists", severity: "warning", at: n.id, atKind: "note", message: `${n.kind === "question" ? "Question" : "Note"} ${n.id} is pinned to finding ${n.target.id}, which no longer fires` });
  const usedPacks: RulePack[] = [...packs];
  if (root.notes) usedPacks.push(NOTES_PACK);
  if (findings.some((f) => f.pack === "core")) usedPacks.unshift(corePack(true, findings));
  return { root, check, findings: dedupeFindings(findings).sort(compareFindings), packs: usedPacks, ...(tracker ? { tracker } : {}) };
}

/** Who owns each seam and each shared part, through the team map; the roles the map does not list. */
function teamMapFacts(root: RootInput): RootBundle["teamMap"] {
  const map = root.teamMap, sh = root.shared;
  if (!map && !sh) return undefined;
  const canon = (t: string) => (root.org && !parseRef(t).ns ? `${ORG}:${t}` : t);
  const seams: Record<string, string[]> = {}, parts: Record<string, string[]> = {};
  const unmapped = new Set<string>();
  for (const s of sh?.seams ?? []) if (s.owner_role) { const ts = ownerTeams(map, s.owner_role); if (ts.length) seams[`${SHARED}:${s.id}`] = ts.map(canon); else unmapped.add(s.owner_role); }
  for (const p of sh?.parts ?? []) if (p.owner) { const ts = ownerTeams(map, p.owner); if (ts.length) parts[`${SHARED}:${p.id}`] = ts.map(canon); else unmapped.add(p.owner); }
  return { owners: map?.owners ?? {}, seams, parts, unmapped: [...unmapped].sort(natCompare) };
}

/** Build a root: its checks and everything the portfolio page reads about it. */
export async function buildRoot(dir: string, opts: RootBuildOptions = {}): Promise<{ bundle: RootBundle; root: RootInput }> {
  const built = opts.built ?? new Date().toISOString();
  const { root, check, findings, packs, tracker } = await checkRoot(dir, { ...opts, built });
  const settings = estimateSettings(root);
  const c = root.config;
  const packList = packs.map((p) => ({ name: p.name, title: p.title, description: p.description, rules: p.rules.map((r) => ({ id: r.id, title: r.title, why: r.why, severity: r.severity, ...(r.how ? { how: r.how } : {}) })) }));
  const bundle: RootBundle = {
    engine: {
      version: ENGINE_VERSION, built, hash: root.hash ?? "", modelHash: root.modelHash ?? "",
      rules: sha256(canonicalJson(packList.map((p) => ({ p: p.name, r: p.rules.map((r) => `${r.id}:${r.severity}`) })))).slice(0, 12),
    },
    root: {
      kind: "root", name: String(c.name ?? basename(root.dir)), title: String(c.title ?? c.name ?? basename(root.dir)),
      ...(typeof c.description === "string" ? { description: c.description } : {}), ...(c.schema ? { schema: String(c.schema) } : {}),
      ...(typeof c.approver === "string" ? { approver: c.approver } : {}),
      packs: packList, ...(c.shared_from ? { shared_from: c.shared_from } : {}),
      estimates: { stale_after_days: settings.staleAfterDays, gap: settings.gap },
    },
    ...(root.shared ? { shared: root.shared } : {}),
    ...(check.org ? { org: check.org } : {}),
    marks: check.marks,
    ...(teamMapFacts(root) ? { teamMap: teamMapFacts(root) } : {}),
    ...(tracker ? { tracker: rootTrackerFacts(tracker.mapping?.adapter ?? tracker.inventory?.adapter ?? "jira", loadMeasures(root.dir), check.org, settings.gap.capacity) } : {}),
    patches: (root.patches ?? []).map((p) => { const res = root.results?.[p.file ?? p.id]; return { ...p, ...(res ? { result: res } : {}) }; }),
    findings,
    ...(root.notes ? { notes: { version: root.notes.version, items: [...root.notes.notes].sort((a, b) => natCompare(a.id, b.id)) } } : {}),
  };
  return { bundle, root };
}

export const ROOT_USAGE = "  bun plumb.ts check <root-dir>                       a shared root's own checks (its engine.yaml says kind: root)\n  bun plumb.ts build <root-dir> [--out <dir>]         write build/<name>/root.json";

/** `bun plumb.ts check|build <root>`: a shared root in place of an instance. */
export async function rootCli(cmd: string, dir: string, rest: string[], engineRoot: string): Promise<number> {
  const { bundle } = await buildRoot(dir);
  const title = `Checks: ${bundle.root.title}`;
  if (cmd === "check") { console.log(findingsMd(bundle.findings, title)); return bundle.findings.some((f) => f.severity === "error") ? 1 : 0; }
  const oi = rest.indexOf("--out");
  const outDir = oi >= 0 && rest[oi + 1] ? rest[oi + 1] : join(engineRoot, "build", bundle.root.name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "root.json"), JSON.stringify(bundle, null, 2) + "\n");
  const teams = (bundle.org?.teams ?? []) as Team[];
  console.log([`# Built ${bundle.root.title} (shared root)`, "", `- written: ${relative(process.cwd(), join(outDir, "root.json")) || join(outDir, "root.json")}`,
    `- model hash: ${bundle.engine.modelHash.slice(0, 12)} (a new root patch's provenance.based_on)`,
    `- shared layer: ${bundle.shared ? `${bundle.shared.parts.length} parts, ${bundle.shared.contracts.length} contracts, ${bundle.shared.crossings.length} crossings, ${bundle.shared.seams.length} seams` : "none"}`,
    `- org layer: ${bundle.org ? `${teams.length} teams, ${bundle.org.activities.length} activities, ${bundle.org.slowdowns.length} slowdowns` : "none"}`,
    `- patches: ${bundle.patches.length} (${bundle.patches.filter((p) => p.status === "accepted").length} accepted)`, ""].join("\n"));
  if (bundle.findings.length) console.log(findingsMd(bundle.findings, title));
  return bundle.findings.some((f) => f.severity === "error") ? 1 : 0;
}
