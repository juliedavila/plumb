// Jira discovery: what this organization's Jira actually uses, with usage counts, read from raw REST responses.
// Every organization arranges Jira differently (hierarchy levels above Epic, which field holds the team, a
// custom dependency link type, statuses in surprising categories), so the inventory records what is there
// rather than assuming, and the drafted mapping is built from it.

import type { RawExport } from "../adapter.ts";
import type { TrackerCount, TrackerInventory } from "../../types.ts";
import { natCompare } from "../../core/util.ts";
import { CATEGORY, levelOf, sortRaw, valueText, type JiraRaw } from "./raw.ts";

type J = Record<string, any>;

/** What a field is for, from its schema (which differs between Cloud, Data Center and team-managed projects). */
export function fieldRole(f: J): string {
  const custom = String(f.schema?.custom ?? ""), sys = String(f.schema?.system ?? (f.custom ? "" : f.id));
  const name = String(f.name ?? "").toLowerCase();
  if (sys === "parent") return "parent";
  if (sys === "description") return "description";
  if (["summary", "status", "assignee", "labels", "components", "fixVersions", "issuelinks", "issuetype", "project", "updated"].includes(sys)) return sys;
  if (custom.endsWith(":gh-epic-link")) return "epic-link";
  if (custom.endsWith(":gh-epic-label")) return "epic-name";
  if (custom.endsWith(":gh-sprint")) return "sprint";
  if (custom.endsWith(":jsw-story-points") || /^story ?points?( estimate)?$/.test(name)) return "story-points";
  if (custom.endsWith(":atlassian-team") || /\bteam\b/.test(name)) return "team";
  if (/acceptance/.test(name) || /definition of done/.test(name)) return "acceptance";
  if (/start date/.test(name)) return "start-date";
  if (/target|due/.test(name)) return "target-date";
  return "other";
}

const count = (m: Map<string, number>, k: string | undefined, by = 1) => { if (k) m.set(k, (m.get(k) ?? 0) + by); };
const counts = (m: Map<string, number>, extra?: (k: string) => Partial<TrackerCount>): TrackerCount[] =>
  [...m].map(([name, n]) => ({ name, count: n, ...(extra?.(name) ?? {}) })).sort((a, b) => b.count - a.count || natCompare(a.name, b.name));

const present = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length) && v !== "";

export function discoverJira(raw: RawExport, sourceDir?: string): TrackerInventory {
  const r: JiraRaw = sortRaw(raw);
  const notes: string[] = [];
  const issues = r.issues;
  const deploy = String(r.serverInfo?.deploymentType ?? "").toLowerCase();
  const flavor = deploy === "cloud" ? "cloud" : deploy === "server" || deploy === "datacenter" ? "data-center"
    : r.issueTypes.some((t) => typeof t.hierarchyLevel === "number") ? "cloud" : r.issueTypes.length ? "data-center" : undefined;

  // projects
  const perProject = new Map<string, number>();
  for (const i of issues) count(perProject, i.fields?.project?.key);
  const projMeta = new Map<string, J>();
  for (const p of r.projects) projMeta.set(p.key, p);
  for (const i of issues) { const p = i.fields?.project; if (p?.key && !projMeta.has(p.key)) projMeta.set(p.key, p); }
  const styleOf = (p: J) => p.style === "next-gen" || p.simplified === true ? "team-managed" : p.style === "classic" || p.simplified === false ? "company-managed" : undefined;
  const projects = [...projMeta.values()].map((p) => ({ key: String(p.key), name: String(p.name ?? p.key), ...(styleOf(p) ? { style: styleOf(p) } : {}), issues: perProject.get(p.key) ?? 0 }))
    .sort((a, b) => natCompare(a.key, b.key));
  for (const p of projects) if (p.style === "team-managed")
    notes.push(`${p.key} is a team-managed project: its issue types, statuses and fields are its own, and its estimate field is usually "Story point estimate", not "Story Points".`);

  // issue types and hierarchy
  const projectIdKey = new Map<string, string>();
  for (const p of projMeta.values()) if (p.id) projectIdKey.set(String(p.id), String(p.key));
  const typeUse = new Map<string, number>();
  for (const i of issues) count(typeUse, String(i.fields?.issuetype?.id ?? i.fields?.issuetype?.name));
  const typeMeta = new Map<string, J>();
  for (const t of r.issueTypes) typeMeta.set(String(t.id), t);
  for (const i of issues) { const t = i.fields?.issuetype; if (t && !typeMeta.has(String(t.id ?? t.name))) typeMeta.set(String(t.id ?? t.name), t); }
  const issueTypes = [...typeMeta.values()].map((t) => {
    const scope = t.scope?.project?.id ? projectIdKey.get(String(t.scope.project.id)) ?? String(t.scope.project.id) : undefined;
    return { id: String(t.id ?? t.name), name: String(t.name), level: levelOf(t), subtask: Boolean(t.subtask), ...(scope ? { project: scope } : {}), count: typeUse.get(String(t.id ?? t.name)) ?? 0 };
  }).sort((a, b) => b.level - a.level || natCompare(a.name, b.name) || natCompare(a.id, b.id));
  const levels = new Map<number, { types: Set<string>; count: number }>();
  for (const t of issueTypes) if (t.count) {
    const l = levels.get(t.level) ?? { types: new Set<string>(), count: 0 };
    l.types.add(t.name); l.count += t.count; levels.set(t.level, l);
  }
  const hierarchy = [...levels].sort((a, b) => b[0] - a[0]).map(([level, v]) => ({ level, types: [...v.types].sort(natCompare), count: v.count }));
  if (hierarchy.some((h) => h.level >= 2)) notes.push(`The hierarchy has a level above Epic: ${hierarchy.filter((h) => h.level >= 2).map((h) => `${h.types.join(", ")} (level ${h.level})`).join("; ")}.`);

  // fields that matter
  const fieldUse = new Map<string, number>();
  const fieldValues = new Map<string, Map<string, number>>();
  for (const i of issues) for (const [k, v] of Object.entries(i.fields ?? {})) if (present(v)) {
    count(fieldUse, k);
    if (k.startsWith("customfield_") && v && typeof v === "object" && !Array.isArray(v) && !(v as J).type) {
      const t = valueText(v);
      if (t) { const m = fieldValues.get(k) ?? new Map(); count(m, t); fieldValues.set(k, m); }
    }
  }
  const fieldList = r.fields.length ? r.fields : [...fieldUse.keys()].map((id) => ({ id, name: id, custom: id.startsWith("customfield_") }));
  const fields = fieldList.map((f) => {
    const role = fieldRole(f);
    const vals = fieldValues.get(String(f.id));
    return {
      id: String(f.id), name: String(f.name ?? f.id), role, ...(f.schema?.type ? { type: String(f.schema.type) } : {}),
      custom: Boolean(f.custom), count: fieldUse.get(String(f.id)) ?? 0,
      ...(vals && (role === "team" || f.schema?.type === "option") ? { values: counts(vals) } : {}),
    };
  }).filter((f) => (f.custom && (f.role !== "other" || f.count > 0)) || ["parent", "description"].includes(f.role))
    .sort((a, b) => natCompare(a.role, b.role) || b.count - a.count || natCompare(a.id, b.id));
  const epicLink = fields.find((f) => f.role === "epic-link"), parent = fields.find((f) => f.role === "parent");
  if (epicLink && !epicLink.count && parent?.count) notes.push(`${epicLink.name} (${epicLink.id}) is defined but no issue uses it: issues reach their epic through Parent, as on Jira Cloud.`);
  if (epicLink?.count) notes.push(`${epicLink.name} (${epicLink.id}) is in use: issues reach their epic through it, as on Jira Data Center.`);
  const teamFields = fields.filter((f) => f.role === "team");
  if (teamFields.length > 1) notes.push(`${teamFields.length} fields look like a team: ${teamFields.map((f) => `${f.name} (${f.id}, on ${f.count} issues)`).join(", ")}. The mapping must pick one.`);
  const pointFields = fields.filter((f) => f.role === "story-points" && f.count);
  if (pointFields.length > 1) notes.push(`Estimates live in ${pointFields.length} fields: ${pointFields.map((f) => `${f.name} (${f.id})`).join(", ")}.`);

  // link types
  const linkUse = new Map<string, number>();
  const seenLink = new Set<string>();
  for (const i of issues) for (const l of i.fields?.issuelinks ?? []) {
    const id = String(l.id ?? `${i.key}:${l.type?.name}:${l.outwardIssue?.key ?? l.inwardIssue?.key}`);
    if (seenLink.has(id)) continue; // Jira returns a link on both of its issues
    seenLink.add(id); count(linkUse, l.type?.name);
  }
  const ltMeta = new Map<string, J>();
  for (const l of r.linkTypes) ltMeta.set(String(l.name), l);
  for (const i of issues) for (const l of i.fields?.issuelinks ?? []) if (l.type?.name && !ltMeta.has(l.type.name)) ltMeta.set(l.type.name, l.type);
  const linkTypes = [...ltMeta.values()].map((l) => ({ ...(l.id ? { id: String(l.id) } : {}), name: String(l.name), inward: String(l.inward ?? ""), outward: String(l.outward ?? ""), count: linkUse.get(String(l.name)) ?? 0 }))
    .sort((a, b) => b.count - a.count || natCompare(a.name, b.name));

  // statuses
  const statusUse = new Map<string, number>();
  for (const i of issues) count(statusUse, i.fields?.status?.name);
  const stMeta = new Map<string, J>();
  for (const s of r.statuses) if (!stMeta.has(s.name)) stMeta.set(String(s.name), s);
  for (const i of issues) { const s = i.fields?.status; if (s?.name && !stMeta.has(s.name)) stMeta.set(s.name, s); }
  const statuses = [...stMeta.values()].map((s) => ({
    ...(s.id ? { id: String(s.id) } : {}), name: String(s.name),
    category: CATEGORY[String(s.statusCategory?.key)] ?? "todo", categoryName: String(s.statusCategory?.name ?? "To Do"), count: statusUse.get(String(s.name)) ?? 0,
  })).sort((a, b) => ["todo", "doing", "done"].indexOf(a.category) - ["todo", "doing", "done"].indexOf(b.category) || b.count - a.count || natCompare(a.name, b.name));
  for (const s of statuses) if (s.category === "done" && s.count && !/^(done|closed|resolved|won'?t do)$/i.test(s.name))
    notes.push(`"${s.name}" is in the ${s.categoryName} category; if the team does not mean finished by it, map statuses by name.`);

  // components, labels, versions
  const comp = new Map<string, number>(), compProject = new Map<string, string>(), lab = new Map<string, number>(), ver = new Map<string, number>(), verReleased = new Map<string, boolean>();
  for (const i of issues) {
    for (const c of i.fields?.components ?? []) { count(comp, c.name); compProject.set(c.name, i.fields?.project?.key); }
    for (const l of i.fields?.labels ?? []) count(lab, String(l));
    for (const v of i.fields?.fixVersions ?? []) { count(ver, v.name); if (typeof v.released === "boolean") verReleased.set(v.name, v.released); }
  }

  // containers: issues above the standard level, with how many issues sit under each
  const children = new Map<string, number>();
  const epicLinkId = epicLink?.id;
  for (const i of issues) {
    const p = i.fields?.parent?.key ?? (epicLinkId ? valueText(i.fields?.[epicLinkId]) : undefined);
    if (p) count(children, p);
  }
  const containers = issues.filter((i) => levelOf(i.fields?.issuetype ?? {}) >= 1 || (typeMeta.get(String(i.fields?.issuetype?.id)) && levelOf(typeMeta.get(String(i.fields?.issuetype?.id))!) >= 1))
    .map((i) => {
      const t = typeMeta.get(String(i.fields?.issuetype?.id)) ?? i.fields?.issuetype ?? {};
      return { key: String(i.key), type: String(t.name ?? "?"), level: levelOf(t), summary: String(i.fields?.summary ?? ""), ...(i.fields?.parent?.key ? { parent: String(i.fields.parent.key) } : {}), children: children.get(i.key) ?? 0 };
    }).sort((a, b) => b.level - a.level || natCompare(a.key, b.key));

  if (r.unknown.length) notes.push(`Not read (no known Jira response shape): ${r.unknown.join(", ")}.`);
  if (!issues.length) notes.push("The export holds no issues: save the search results (POST /rest/api/3/search/jql with fields=*all) beside the metadata.");

  return {
    adapter: "jira", ...(flavor ? { flavor } : {}),
    ...(sourceDir !== undefined ? { source: { dir: sourceDir, files: raw.files.map((f) => f.name) } } : {}),
    issues: issues.length,
    projects, issueTypes, hierarchy, fields, linkTypes, statuses,
    components: counts(comp, (n) => (compProject.get(n) ? { project: compProject.get(n) } : {})),
    labels: counts(lab),
    fixVersions: counts(ver, (n) => (verReleased.has(n) ? { released: verReleased.get(n) } : {})) as TrackerInventory["fixVersions"],
    containers, notes,
  };
}
