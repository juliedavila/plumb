// <instance>/tracker/mapping.yaml: how this organization's tracker holds the engine's concepts.
// Each concept is a choice the organization declares (see the drafted file's comments for the options).
// normalizeMapping reads the YAML into a TrackerMapping and reports shape problems; whether the names it uses
// exist in the tracker is the tracker rule pack's job (mapping-matches-inventory).
//
// A shared root's tracker/mapping.yaml says `kind: org`: it measures the teams' standing work
// rather than lining up a plan, so it has no phase or unit sections. It names how an issue names its team (`team:`, in
// owner_team's shape, read into owner_team), the status map, the window (`window_days`, ending at the export's date),
// the label prefix that marks design work (`designs.label_prefix`: <prefix><namespace>:<unit>), the activity rules
// (first match wins, top to bottom) and each issue type's flow item.

import type { ActivityMatch, ActivityRule, FlowItem, TrackerMapping, TrackerStatus } from "../types.ts";

export const PHASE_AS = ["epic", "initiative", "fix-version", "label"] as const;
export const OWNER_AS = ["component", "custom-field", "project"] as const;
export const STATUS_BY = ["category", "name"] as const;
export const DIRECTIONS = ["outward", "inward"] as const;
export const FLOW_ITEMS: FlowItem[] = ["feature", "defect", "risk", "debt"];
/** What an activity rule may match on. */
export const MATCH_KEYS = ["project", "type", "labels", "components", "parent", "field"] as const;
export const DEFAULT_WINDOW_DAYS = 90;
export const DEFAULT_LABEL_PREFIX = "de-unit:";
const STATUSES: TrackerStatus[] = ["todo", "doing", "done"];

type Raw = Record<string, unknown>;
const isMap = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (isMap(v)) for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null) out[k] = String(x);
  return out;
};
/** A value written as one string or a list of them, as a list of non-empty strings. */
const strList = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
  .filter((x) => x !== undefined && x !== null && !(typeof x === "object")).map((x) => String(x).trim()).filter(Boolean);

/** Is this mapping a shared root's org mapping? */
export const isOrgMapping = (m: TrackerMapping | undefined): boolean => m?.kind === "org";

/** The team section of an org mapping (`team:`, or owner_team's own key), in owner_team's shape. */
function teamOf(v: unknown, p: string[]): TrackerMapping["owner_team"] {
  if (!isMap(v)) { p.push("team is missing: say how an issue names its team, as team: { as: custom-field, field: <field id>, match: { <team id>: <value> } } (or as: component or project)"); return undefined; }
  const as = String(v.as ?? "custom-field");
  if (!OWNER_AS.includes(as as any)) p.push(`team.as is "${as}"; choose one of ${OWNER_AS.join(", ")}`);
  if (as === "custom-field" && !v.field) p.push("team.field is missing: name the custom field that holds the team");
  const match = strMap(v.match);
  if (!Object.keys(match).length) p.push("team.match is empty: map each org team id to the value the tracker holds for it");
  return { as: as as "component" | "custom-field" | "project", ...(v.field ? { field: String(v.field) } : {}), match };
}

/** One activity rule as written: { activity, match: { project | type | labels | components | parent | field } }. */
function ruleOf(v: unknown, n: number, p: string[]): ActivityRule | undefined {
  const where = `activities[${n}]`;
  if (!isMap(v)) { p.push(`${where} must be a mapping { activity: <org activity id>, match: { ... } }`); return undefined; }
  const activity = v.activity === undefined || v.activity === null ? "" : String(v.activity).trim();
  if (!activity) { p.push(`${where} names no activity (activity: <org activity id>)`); return undefined; }
  const w = `${where} (${activity})`;
  if (!isMap(v.match)) { p.push(`${w} has no match: give at least one of ${MATCH_KEYS.join(", ")}`); return undefined; }
  const match: ActivityMatch = {};
  for (const [k, x] of Object.entries(v.match)) {
    if (k === "field") {
      if (!isMap(x)) { p.push(`${w}: match.field must be a mapping { <field id>: <value or list of values> }`); continue; }
      const f: Record<string, string[]> = {};
      for (const [id, vals] of Object.entries(x)) { const l = strList(vals); if (l.length) f[id] = l; else p.push(`${w}: match.field.${id} names no value`); }
      if (Object.keys(f).length) match.field = f;
    } else if ((MATCH_KEYS as readonly string[]).includes(k)) {
      const l = strList(x);
      if (l.length) match[k as Exclude<keyof ActivityMatch, "field">] = l;
      else p.push(`${w}: match.${k} names nothing`);
    } else p.push(`${w}: match.${k} is not something a rule matches on; use ${MATCH_KEYS.join(", ")}`);
  }
  if (!Object.keys(match).length) { p.push(`${w} matches on nothing, so no issue lands in it`); return undefined; }
  return { activity, match };
}

/** The org mapping's own sections, onto the status map read in common. */
function normalizeOrg(raw: Raw, p: string[], status: TrackerMapping["status"]): TrackerMapping {
  for (const k of ["phase", "unit", "dependency", "done_condition", "flow"]) if (raw[k] !== undefined)
    p.push(`${k} belongs to a design's own mapping; an org mapping (kind: org) measures the teams' standing work and has no ${k}`);
  const owner = teamOf(raw.team ?? raw.owner_team, p);
  let windowDays = DEFAULT_WINDOW_DAYS;
  if (raw.window_days !== undefined) {
    const n = Number(raw.window_days);
    if (Number.isInteger(n) && n >= 1) windowDays = n;
    else p.push(`window_days is ${JSON.stringify(raw.window_days)}; give a whole number of days of at least 1 (default ${DEFAULT_WINDOW_DAYS})`);
  }
  const designs = isMap(raw.designs) ? raw.designs : {};
  if (raw.designs !== undefined && !isMap(raw.designs)) p.push(`designs must be a mapping { label_prefix: "${DEFAULT_LABEL_PREFIX}" }`);
  const prefix = designs.label_prefix === undefined || designs.label_prefix === null ? DEFAULT_LABEL_PREFIX : String(designs.label_prefix);
  if (!prefix.trim()) p.push("designs.label_prefix is empty, so every label would read as design work");
  const activities: ActivityRule[] = [];
  if (raw.activities !== undefined && !Array.isArray(raw.activities)) p.push("activities must be a list of { activity, match } rules, first match wins");
  else (raw.activities as unknown[] | undefined ?? []).forEach((v, i) => { const r = ruleOf(v, i + 1, p); if (r) activities.push(r); });
  const flowItems: Record<string, FlowItem> = {};
  for (const [type, item] of Object.entries(strMap(raw.flow_items))) {
    if ((FLOW_ITEMS as string[]).includes(item)) flowItems[type] = item as FlowItem;
    else p.push(`flow_items."${type}" is "${item}"; give each issue type one of ${FLOW_ITEMS.join(", ")}`);
  }
  if (raw.flow_items !== undefined && !isMap(raw.flow_items)) p.push("flow_items must be a mapping { <issue type>: feature | defect | risk | debt }");
  return {
    adapter: String(raw.adapter ?? "jira"), kind: "org",
    unit_label_prefix: prefix,
    phase: { as: "epic", match: {} }, unit: { issue_type: "" },
    status, ...(owner ? { owner_team: owner } : {}),
    org: { window_days: windowDays, designs: { label_prefix: prefix }, activities, flow_items: flowItems },
  };
}

export function normalizeMapping(raw: unknown): { mapping?: TrackerMapping; problems: string[] } {
  const p: string[] = [];
  if (!isMap(raw)) return { problems: ["mapping.yaml must be a mapping"] };
  // the status map, read once for both kinds; its problems keep their place after the phase and unit ones
  const status = isMap(raw.status) ? raw.status : {};
  const sp: string[] = [];
  const by = String(status.by ?? "category");
  if (!STATUS_BY.includes(by as any)) sp.push(`status.by is "${by}"; choose category or name`);
  const smap: Record<string, TrackerStatus> = {};
  for (const [k, v] of Object.entries(strMap(status.map))) {
    if (STATUSES.includes(v as TrackerStatus)) smap[k] = v as TrackerStatus;
    else sp.push(`status.map.${k} is "${v}"; map each status to todo, doing or done`);
  }
  if (raw.kind !== undefined && raw.kind !== null && raw.kind !== "org" && raw.kind !== "instance")
    p.push(`kind is "${String(raw.kind)}"; a shared root's mapping says kind: org, and a design's own says nothing (or kind: instance)`);
  if (raw.kind === "org") { p.push(...sp); return { mapping: normalizeOrg(raw, p, { by: by as TrackerMapping["status"]["by"], map: smap }), problems: p }; }
  const phase = isMap(raw.phase) ? raw.phase : {};
  const unit = isMap(raw.unit) ? raw.unit : {};
  const phaseAs = String(phase.as ?? "epic");
  if (!PHASE_AS.includes(phaseAs as any)) p.push(`phase.as is "${phaseAs}"; choose one of ${PHASE_AS.join(", ")}`);
  if (!unit.issue_type) p.push("unit.issue_type is missing: name the issue type a unit becomes");
  p.push(...sp);
  const m: TrackerMapping = {
    adapter: String(raw.adapter ?? "jira"),
    ...(raw.project ? { project: String(raw.project) } : {}),
    unit_label_prefix: String(raw.unit_label_prefix ?? "de-unit:"),
    phase: { as: phaseAs as TrackerMapping["phase"]["as"], match: strMap(phase.match) },
    unit: { issue_type: String(unit.issue_type ?? ""), ...(unit.project ? { project: String(unit.project) } : {}) },
    status: { by: by as TrackerMapping["status"]["by"], map: smap },
  };
  if (isMap(raw.dependency)) {
    const d = raw.dependency, dir = String(d.direction ?? "outward");
    if (!d.link_type) p.push("dependency.link_type is missing");
    if (!DIRECTIONS.includes(dir as any)) p.push(`dependency.direction is "${dir}"; choose outward or inward`);
    m.dependency = { link_type: String(d.link_type ?? ""), direction: dir as "outward" | "inward" };
  }
  if (isMap(raw.owner_team)) {
    const o = raw.owner_team, as = String(o.as ?? "component");
    if (!OWNER_AS.includes(as as any)) p.push(`owner_team.as is "${as}"; choose one of ${OWNER_AS.join(", ")}`);
    if (as === "custom-field" && !o.field) p.push("owner_team.field is missing: name the custom field that holds the team");
    m.owner_team = { as: as as "component" | "custom-field" | "project", ...(o.field ? { field: String(o.field) } : {}), match: strMap(o.match) };
  }
  if (isMap(raw.done_condition) && raw.done_condition.field) m.done_condition = { field: String(raw.done_condition.field) };
  if (raw.flow !== undefined) {
    // flow: which status means which stream step, waiting or worked on; which statuses end a change's lead time
    const f = isMap(raw.flow) ? raw.flow : {};
    if (!isMap(raw.flow)) p.push("flow must be a mapping: { statuses: { <status>: { step: <part id>, as: wait | work } }, done: [<status>] }");
    const statuses: NonNullable<TrackerMapping["flow"]>["statuses"] = {};
    if (isMap(f.statuses)) for (const [name, v] of Object.entries(f.statuses)) {
      if (!isMap(v) || !v.step) { p.push(`flow.statuses."${name}" needs a step: the part id the status stands for`); continue; }
      const as = String(v.as ?? "wait");
      if (as !== "wait" && as !== "work") { p.push(`flow.statuses."${name}".as is "${as}"; choose wait or work`); continue; }
      statuses[name] = { step: String(v.step), as };
    }
    const done = Array.isArray(f.done) ? f.done.map(String) : Object.entries(m.status.map).filter(([, v]) => v === "done").map(([k]) => k);
    m.flow = { statuses, done };
  }
  return { mapping: m, problems: p };
}

/**
 * The engine status a tracker status maps to, or undefined when the mapping does not say.
 * By name: the map's keys are status names. By category: its keys are category names ("To Do", "In Progress",
 * "Done" on Jira), and a category the map leaves out maps to its own meaning.
 */
export function mapStatus(m: TrackerMapping, name: string, categoryName: string, category: TrackerStatus): TrackerStatus | undefined {
  if (m.status.by === "name") return m.status.map[name];
  return m.status.map[categoryName] ?? m.status.map[category] ?? category;
}
