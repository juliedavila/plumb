// Reconciliation: line the plan's units up with the tracker's issues, adapter-independent.
//
// - exact matches are linked: a confirmed entry in links.yaml, or a label like de-unit:U-05 on the issue (in a namespaced
//   design, de-unit:<namespace>:U-05 too; a label naming another design's namespace is that design's);
// - likely matches (similar title, same phase container, same team) are proposed for a person to confirm;
// - units with no issue, and issues in the mapped phase containers with no unit, are listed;
// - for linked pairs: status disagreements, issues under another phase's container, and dependency links
//   present on one side only (in the model and not the tracker, or the other way round), and, where the mapping maps
//   a team field, the unit's owner teams (inherited from its parts) against the team the tracker assigns the issue.
//
// The tracker's state never overwrites a unit: a unit keeps its own status, and a disagreement is a finding.

import type { Model, Plan, TrackerIssue, TrackerLink, TrackerMapping, TrackerReconcile, TrackerStatus, TrackerUnitState } from "../types.ts";
import { analyzePlan, uniqueUnits } from "../core/plan.ts";
import { unitRoles } from "../core/teams.ts";
import { natCompare } from "../core/util.ts";
import { parseRef } from "../core/namespace.ts";
import { mapStatus } from "./mapping.ts";
import { round2, similarity } from "./text.ts";

export interface ReconcileInput {
  model: Model; plan: Plan;
  mapping: TrackerMapping;
  issues: TrackerIssue[];
  links: TrackerLink[];
  namespace?: string;                    // a namespaced design's own: de-unit:<namespace>:<unit> labels its own unit
}

// score = 0.8 x title similarity + 0.1 for the same phase container + 0.1 for the same team, from 0 to 1
export const PROPOSE_MIN = 0.5;   // combined score at which a likely match is proposed
export const TITLE_MIN = 0.4;     // and the title similarity it needs at least

/** The phase an issue sits in under the mapping, or undefined when it sits in none of the mapped containers. */
export function issuePhase(m: TrackerMapping, issue: TrackerIssue, byKey: Map<string, TrackerIssue>): string | undefined {
  const inv = new Map<string, string>();
  for (const [phase, v] of Object.entries(m.phase.match)) inv.set(v, phase);
  if (m.phase.as === "fix-version") { for (const v of issue.fixVersions) if (inv.has(v)) return inv.get(v); return undefined; }
  if (m.phase.as === "label") { for (const l of issue.labels) if (inv.has(l)) return inv.get(l); return undefined; }
  // epic or initiative: walk up the parent chain
  const seen = new Set<string>();
  let cur: string | undefined = issue.parent;
  while (cur && !seen.has(cur)) {
    if (inv.has(cur)) return inv.get(cur);
    seen.add(cur);
    cur = byKey.get(cur)?.parent;
  }
  return undefined;
}

/** The tracker value an issue carries for the owner-team mapping (component, field value or project). */
function teamValues(m: TrackerMapping, issue: TrackerIssue): string[] {
  const o = m.owner_team;
  if (!o) return [];
  if (o.as === "component") return issue.components;
  if (o.as === "project") return [issue.project];
  const v = o.field ? issue.values?.[o.field] : undefined;
  return v ? [v] : [];
}

/** The engine team id an issue belongs to, through owner_team.match. */
export function issueTeam(m: TrackerMapping, issue: TrackerIssue): string | undefined {
  const vals = teamValues(m, issue);
  for (const [team, v] of Object.entries(m.owner_team?.match ?? {})) if (vals.includes(v)) return team;
  return undefined;
}

export function inUnitScope(m: TrackerMapping, issue: TrackerIssue): boolean {
  const project = m.unit.project ?? m.project;
  return issue.level === 0 && (!project || issue.project === project);
}

export function reconcile(inp: ReconcileInput): TrackerReconcile {
  const { mapping: m } = inp;
  const problems: string[] = [];
  const units = uniqueUnits(inp.plan).sort((a, b) => natCompare(a.id, b.id));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const byKey = new Map(inp.issues.map((i) => [i.key, i]));
  const roles = unitRoles(inp.model, inp.plan); // owners as inherited from the parts a unit changes (src/core/teams.ts)
  const ownersOf = (id: string) => roles[id]?.owners ?? [];

  // ---- exact matches ----
  const unitIssue = new Map<string, { issue: string; how: "confirmed" | "label"; by?: string; at?: string }>();
  const issueUnit = new Map<string, string>();
  for (const l of inp.links) {
    if (!unitById.has(l.unit)) { problems.push(`links.yaml links ${l.unit} to ${l.issue}, but there is no unit ${l.unit}`); continue; }
    if (!byKey.has(l.issue)) { problems.push(`links.yaml links ${l.unit} to ${l.issue}, but ${l.issue} is not in the tracker export`); continue; }
    if (issueUnit.has(l.issue)) { problems.push(`links.yaml links ${l.issue} to both ${issueUnit.get(l.issue)} and ${l.unit}; one issue holds one unit`); continue; }
    unitIssue.set(l.unit, { issue: l.issue, how: "confirmed", by: l.confirmed_by, at: l.confirmed_at });
    issueUnit.set(l.issue, l.unit);
  }
  const prefix = m.unit_label_prefix;
  const elsewhere = new Set<string>(); // issues labelled as another design's unit: never this design's to match or list
  for (const i of inp.issues) for (const lab of i.labels) {
    if (!prefix || !lab.startsWith(prefix)) continue;
    let uid = lab.slice(prefix.length);
    if (inp.namespace) {
      // a namespaced label: this design's own unit, or another design's (that design reconciles it, so it is no problem here)
      const r = parseRef(uid);
      if (r.ns) { if (r.ns !== inp.namespace) { elsewhere.add(i.key); continue; } uid = r.id; }
    }
    if (!unitById.has(uid)) { problems.push(`${i.key} carries the label ${lab}, but there is no unit ${uid}`); continue; }
    const cur = unitIssue.get(uid);
    if (cur && cur.issue === i.key) continue;
    if (cur) { problems.push(`${i.key} carries the label ${lab}, but ${uid} is already linked to ${cur.issue}`); continue; }
    if (issueUnit.has(i.key)) { problems.push(`${i.key} carries the label ${lab}, but it is already linked to ${issueUnit.get(i.key)}`); continue; }
    unitIssue.set(uid, { issue: i.key, how: "label" });
    issueUnit.set(i.key, uid);
  }

  // ---- likely matches ----
  const scoped = inp.issues.filter((i) => inUnitScope(m, i) && (issueUnit.has(i.key) || !elsewhere.has(i.key)));
  const phaseOf = new Map(inp.issues.map((i) => [i.key, issuePhase(m, i, byKey)]));
  const candidates: { unit: string; issue: string; score: number; reasons: string[] }[] = [];
  for (const u of units) {
    if (unitIssue.has(u.id)) continue;
    for (const i of scoped) {
      if (issueUnit.has(i.key)) continue;
      const sim = similarity(u.title, i.summary);
      if (sim < TITLE_MIN) continue;
      const reasons = [`title ${Math.round(sim * 100)}% alike`];
      let score = 0.8 * sim;
      if (phaseOf.get(i.key) === u.phase) { score += 0.1; reasons.push(`same phase (${u.phase})`); }
      else if (phaseOf.get(i.key)) reasons.push(`under phase ${phaseOf.get(i.key)}, not ${u.phase}`);
      const team = issueTeam(m, i);
      const owners = ownersOf(u.id);
      if (team && owners.includes(team)) { score += 0.1; reasons.push(`same team (${team})`); }
      else if (owners.length && team) reasons.push(`team ${team}, not ${owners.join(" or ")}`);
      if (score >= PROPOSE_MIN) candidates.push({ unit: u.id, issue: i.key, score: round2(score), reasons });
    }
  }
  candidates.sort((a, b) => b.score - a.score || natCompare(a.unit, b.unit) || natCompare(a.issue, b.issue));
  const proposed: TrackerReconcile["proposed"] = [];
  const pu = new Set<string>(), pi = new Set<string>();
  for (const c of candidates) {
    if (pu.has(c.unit) || pi.has(c.issue)) continue;
    pu.add(c.unit); pi.add(c.issue); proposed.push(c);
  }
  proposed.sort((a, b) => natCompare(a.unit, b.unit));

  // ---- the gaps ----
  const unitsWithoutIssue = units.filter((u) => !unitIssue.has(u.id) && !pu.has(u.id)).map((u) => u.id);
  const issuesWithoutUnit = scoped.filter((i) => phaseOf.get(i.key) && !issueUnit.has(i.key) && !pi.has(i.key))
    .map((i) => ({ issue: i.key, summary: i.summary, phase: phaseOf.get(i.key), type: i.type }));

  // ---- linked pairs: state, status, phase ----
  const state: Record<string, TrackerUnitState> = {};
  const linked: TrackerReconcile["linked"] = [];
  const statusDisagreements: TrackerReconcile["statusDisagreements"] = [];
  const phaseDisagreements: TrackerReconcile["phaseDisagreements"] = [];
  const ownerDisagreements: NonNullable<TrackerReconcile["ownerDisagreements"]> = [];
  const unmapped = new Set<string>();
  for (const u of units) {
    const l = unitIssue.get(u.id);
    if (!l) continue;
    const i = byKey.get(l.issue)!;
    linked.push({ unit: u.id, issue: l.issue, how: l.how, ...(l.by ? { confirmed_by: l.by } : {}), ...(l.at ? { confirmed_at: l.at } : {}) });
    const mapped = mapStatus(m, i.status, i.statusCategoryName ?? "", i.statusCategory);
    if (!mapped) unmapped.add(i.status);
    const team = issueTeam(m, i) ?? teamValues(m, i)[0];
    state[u.id] = {
      unit: u.id, issue: i.key, how: l.how, status: i.status, statusCategory: i.statusCategory, mapped: mapped ?? i.statusCategory,
      summary: i.summary,
      ...(i.assignee ? { assignee: i.assignee } : {}), ...(i.sprint ? { sprint: i.sprint } : {}),
      ...(i.parent ? { parent: i.parent } : {}), ...(team ? { team } : {}),
    };
    const own: TrackerStatus = u.status ?? "todo";
    if ((mapped ?? i.statusCategory) !== own) statusDisagreements.push({ unit: u.id, issue: i.key, unitStatus: own, trackerStatus: i.status, mapped: mapped ?? i.statusCategory });
    const ip = phaseOf.get(i.key);
    if (ip !== u.phase) phaseDisagreements.push({ unit: u.id, issue: i.key, unitPhase: u.phase, ...(ip ? { issuePhase: ip } : {}) });
    // the owner the model gives the unit (inherited from its parts) against the team the tracker assigns its issue;
    // typing a name into the model cannot settle this one, which is why it is checked
    const assigned = m.owner_team ? issueTeam(m, i) : undefined;
    const owners = ownersOf(u.id);
    if (assigned && owners.length && !owners.includes(assigned)) ownerDisagreements.push({ unit: u.id, issue: i.key, owners, trackerTeam: assigned });
  }
  for (const s of [...unmapped].sort(natCompare)) problems.push(`status "${s}" is not in status.map, so its unit status is taken from its category`);

  // ---- dependencies, both sides ----
  const dependencyOneSided: TrackerReconcile["dependencyOneSided"] = [];
  if (m.dependency) {
    const deps = analyzePlan(inp.plan).deps;
    const model = new Set<string>(), tracker = new Set<string>();
    for (const u of units) {
      if (!unitIssue.has(u.id)) continue;
      for (const d of deps[u.id] ?? []) if (unitIssue.has(d)) model.add(`${u.id}\u0000${d}`);
      const i = byKey.get(unitIssue.get(u.id)!.issue)!;
      for (const l of i.links) {
        if (l.type !== m.dependency.link_type || l.direction !== m.dependency.direction) continue;
        const d = issueUnit.get(l.key);
        if (d && d !== u.id) tracker.add(`${u.id}\u0000${d}`);
      }
    }
    const row = (k: string, side: "model" | "tracker") => {
      const [unit, dependsOn] = k.split("\u0000");
      return { unit, dependsOn, issue: unitIssue.get(unit)!.issue, dependsOnIssue: unitIssue.get(dependsOn)!.issue, side };
    };
    for (const k of model) if (!tracker.has(k)) dependencyOneSided.push(row(k, "model"));
    for (const k of tracker) if (!model.has(k)) dependencyOneSided.push(row(k, "tracker"));
    dependencyOneSided.sort((a, b) => natCompare(a.unit, b.unit) || natCompare(a.dependsOn, b.dependsOn));
  }

  return {
    adapter: m.adapter,
    counts: {
      linked: linked.length, proposed: proposed.length, unitsWithoutIssue: unitsWithoutIssue.length, issuesWithoutUnit: issuesWithoutUnit.length,
      statusDisagreements: statusDisagreements.length, dependencyOneSided: dependencyOneSided.length, phaseDisagreements: phaseDisagreements.length,
    },
    linked, proposed, unitsWithoutIssue, issuesWithoutUnit, statusDisagreements, dependencyOneSided, phaseDisagreements,
    ...(m.owner_team ? { ownerDisagreements } : {}),
    state, problems,
  };
}
