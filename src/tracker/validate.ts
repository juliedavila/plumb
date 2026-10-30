// Mapping validation: everything mapping.yaml names must exist in the inventory (issue types, fields, link
// types, statuses, projects, containers, versions), and everything it maps from must exist in the instance
// (phase ids, team ids). Run by the tracker rule pack as mapping-matches-inventory and mapping-covers-statuses.
// An org mapping (kind: org, in a shared root) is checked the same way by validateOrgMapping: its team field and
// values, its statuses, and every project, type, label, component, parent, field and field value its activity rules
// match on, against the inventory; its teams and activities against the org layer.

import type { Model, Plan, TrackerInventory, TrackerMapping } from "../types.ts";
import { natCompare } from "../core/util.ts";

export interface MappingProblem { message: string; kind: "missing" | "coverage" }

/** What an org mapping names in the org layer: its teams and activities (bare ids). Absent: not checked. */
export interface OrgNames { teams?: { id: string; name: string }[]; activities?: { id: string; name: string; team: string }[] }

const bareOrg = (s: string) => (s.startsWith("org:") ? s.slice(4) : s);
const some = (xs: Iterable<string>, max = 12) => { const a = [...xs].sort(natCompare); return a.length > max ? `${a.slice(0, max).join(", ")} and ${a.length - max} more` : a.join(", ") || "none"; };

/** The statuses an org or instance mapping names, and those in use it leaves out. */
function statusProblems(m: TrackerMapping, inv: TrackerInventory, out: MappingProblem[]) {
  if (m.status.by === "name") {
    const names = new Set(inv.statuses.map((s) => s.name));
    for (const s of Object.keys(m.status.map)) if (!names.has(s)) out.push({ kind: "missing", message: `status.map names status "${s}", which is not in the inventory` });
    for (const s of inv.statuses) if (s.count && !(s.name in m.status.map)) out.push({ kind: "coverage", message: `status "${s.name}" is on ${s.count} issue${s.count === 1 ? "" : "s"} but not in status.map` });
  } else {
    const cats = new Set(inv.statuses.flatMap((s) => [s.categoryName, s.category]));
    for (const s of Object.keys(m.status.map)) if (!cats.has(s)) out.push({ kind: "missing", message: `status.map names category "${s}", which is not a status category in the inventory` });
  }
}

/** An org mapping against the inventory and, when given, the org layer's teams and activities. */
export function validateOrgMapping(m: TrackerMapping, inv: TrackerInventory, org: OrgNames = {}): MappingProblem[] {
  const out: MappingProblem[] = [];
  const miss = (message: string) => out.push({ message, kind: "missing" });
  const projects = new Set(inv.projects.map((p) => p.key));
  const types = new Set(inv.issueTypes.map((t) => t.name));
  const labels = new Set(inv.labels.map((l) => l.name));
  const components = new Set(inv.components.map((c) => c.name));
  const containers = new Set(inv.containers.map((c) => c.key));
  const field = (id: string) => inv.fields.find((f) => f.id === id || f.name === id);

  const t = m.owner_team;
  if (t) {
    let values: Set<string> | undefined;
    if (t.as === "custom-field") {
      const f = t.field ? field(t.field) : undefined;
      if (t.field && !f) miss(`team.field ${t.field} is not a field in the inventory`);
      if (f?.values) values = new Set(f.values.map((v) => v.name));
    } else values = t.as === "component" ? components : projects;
    const teamIds = org.teams ? new Set(org.teams.map((x) => x.id)) : undefined;
    for (const [team, v] of Object.entries(t.match)) {
      if (teamIds && !teamIds.has(bareOrg(team))) miss(`team.match names team ${team}, which the org layer does not hold`);
      if (values && !values.has(v)) miss(`team.match.${team} is "${v}", which no issue carries (values: ${some(values)})`);
    }
    if (org.teams) {
      const named = new Set(Object.keys(t.match).map(bareOrg));
      for (const x of org.teams) if (!named.has(x.id)) out.push({ kind: "coverage", message: `team ${x.id} (${x.name}) has no value in team.match, so its issues count for no team` });
    }
  }
  statusProblems(m, inv, out);

  const acts = org.activities ? new Map(org.activities.map((a) => [a.id, a])) : undefined;
  (m.org?.activities ?? []).forEach((r, i) => {
    const w = `activities[${i + 1}] (${r.activity})`;
    if (acts && !acts.has(bareOrg(r.activity))) miss(`${w} names the activity ${r.activity}, which the org layer does not hold`);
    const mt = r.match;
    for (const x of mt.project ?? []) if (!projects.has(x)) miss(`${w} matches project ${x}, which is not in the inventory (projects: ${some(projects)})`);
    for (const x of mt.type ?? []) if (!types.has(x)) miss(`${w} matches issue type "${x}", which is not in the inventory (types: ${some(types)})`);
    for (const x of mt.labels ?? []) if (!labels.has(x)) miss(`${w} matches label "${x}", which no issue carries`);
    for (const x of mt.components ?? []) if (!components.has(x)) miss(`${w} matches component "${x}", which no issue carries (components: ${some(components)})`);
    for (const x of mt.parent ?? []) if (!containers.has(x)) miss(`${w} matches parent ${x}, which is not an epic or above in the export`);
    for (const [id, vals] of Object.entries(mt.field ?? {})) {
      const f = field(id);
      if (!f) { miss(`${w} matches field ${id}, which is not a field in the inventory`); continue; }
      if (f.values) for (const v of vals) if (!f.values.some((x) => x.name === v)) miss(`${w} matches ${f.name} (${f.id}) "${v}", which no issue carries (values: ${some(f.values.map((x) => x.name))})`);
    }
  });
  for (const type of Object.keys(m.org?.flow_items ?? {})) if (!types.has(type)) miss(`flow_items names issue type "${type}", which is not in the inventory (types: ${some(types)})`);
  return out;
}

export function validateMapping(m: TrackerMapping, inv: TrackerInventory, model: Model, plan: Plan): MappingProblem[] {
  const out: MappingProblem[] = [];
  const miss = (message: string) => out.push({ message, kind: "missing" });
  const projects = new Set(inv.projects.map((p) => p.key));
  const project = m.unit.project ?? m.project;
  if (m.project && !projects.has(m.project)) miss(`project ${m.project} is not in the inventory (projects: ${[...projects].join(", ") || "none"})`);
  if (m.unit.project && !projects.has(m.unit.project)) miss(`unit.project ${m.unit.project} is not in the inventory`);
  const types = inv.issueTypes.filter((t) => !t.project || !project || t.project === project);
  if (m.unit.issue_type && !types.some((t) => t.name === m.unit.issue_type))
    miss(`unit.issue_type "${m.unit.issue_type}" is not an issue type${project ? ` of ${project}` : ""} (types: ${[...new Set(types.map((t) => t.name))].join(", ")})`);
  else if (m.unit.issue_type && types.filter((t) => t.name === m.unit.issue_type).every((t) => t.level !== 0))
    miss(`unit.issue_type "${m.unit.issue_type}" is not a standard-level type; units are standard issues, not epics or sub-tasks`);

  const phaseIds = new Set(plan.phases.map((p) => p.id));
  const containers = new Map(inv.containers.map((c) => [c.key, c]));
  for (const [phase, v] of Object.entries(m.phase.match)) {
    if (!phaseIds.has(phase)) miss(`phase.match names phase ${phase}, which is not in the plan`);
    if (m.phase.as === "epic" || m.phase.as === "initiative") {
      const c = containers.get(v);
      if (!c) miss(`phase.match.${phase} is ${v}, which is not an issue above the standard level in the export`);
      else if (m.phase.as === "epic" && c.level !== 1) miss(`phase.match.${phase} is ${v}, of type ${c.type} (level ${c.level}), not an epic`);
      else if (m.phase.as === "initiative" && c.level < 2) miss(`phase.match.${phase} is ${v}, of type ${c.type} (level ${c.level}), not an initiative`);
    } else if (m.phase.as === "fix-version" && !inv.fixVersions.some((x) => x.name === v)) miss(`phase.match.${phase} is fix version "${v}", which no issue carries`);
  }
  for (const p of plan.phases) if (!(p.id in m.phase.match)) out.push({ kind: "coverage", message: `phase ${p.id} (${p.name}) has no ${m.phase.as} in phase.match, so its issues cannot be found` });

  if (m.dependency) {
    const lt = inv.linkTypes.find((l) => l.name === m.dependency!.link_type);
    if (!lt) miss(`dependency.link_type "${m.dependency.link_type}" is not a link type (types: ${inv.linkTypes.map((l) => l.name).join(", ")})`);
  }
  const field = (id: string) => inv.fields.find((f) => f.id === id || f.name === id);
  if (m.owner_team) {
    const teamIds = new Set(model.teams.map((t) => t.id));
    let values: Set<string> | undefined;
    if (m.owner_team.as === "custom-field") {
      const f = m.owner_team.field ? field(m.owner_team.field) : undefined;
      if (m.owner_team.field && !f) miss(`owner_team.field ${m.owner_team.field} is not a field in the inventory`);
      if (f?.values) values = new Set(f.values.map((v) => v.name));
    } else if (m.owner_team.as === "component") values = new Set(inv.components.map((c) => c.name));
    else values = projects;
    for (const [team, v] of Object.entries(m.owner_team.match)) {
      if (!teamIds.has(team)) miss(`owner_team.match names team ${team}, which is not in the model`);
      if (values && !values.has(v)) miss(`owner_team.match.${team} is "${v}", which no issue carries (values: ${[...values].sort(natCompare).join(", ")})`);
    }
    for (const t of model.teams) if (!(t.id in m.owner_team.match)) out.push({ kind: "coverage", message: `team ${t.id} (${t.name}) has no value in owner_team.match` });
  }
  if (m.done_condition && m.done_condition.field !== "description" && !field(m.done_condition.field))
    miss(`done_condition.field ${m.done_condition.field} is not a field in the inventory`);

  if (m.status.by === "name") {
    const names = new Set(inv.statuses.map((s) => s.name));
    for (const s of Object.keys(m.status.map)) if (!names.has(s)) miss(`status.map names status "${s}", which is not in the inventory`);
    for (const s of inv.statuses) if (s.count && !(s.name in m.status.map)) out.push({ kind: "coverage", message: `status "${s.name}" is on ${s.count} issue${s.count === 1 ? "" : "s"} but not in status.map` });
  } else {
    const cats = new Set(inv.statuses.flatMap((s) => [s.categoryName, s.category]));
    for (const s of Object.keys(m.status.map)) if (!cats.has(s)) miss(`status.map names category "${s}", which is not a status category in the inventory`);
  }
  return out;
}
