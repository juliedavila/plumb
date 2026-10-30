// Jira live state: every exported issue normalized to a TrackerIssue (status, assignee, sprint, parent, links,
// and other field values as text for the mapping to pick from).

import type { RawExport } from "../adapter.ts";
import type { TrackerInventory, TrackerIssue, TrackerIssueLink } from "../../types.ts";
import { natCompare } from "../../core/util.ts";
import { discoverJira } from "./discover.ts";
import { CATEGORY, levelOf, richText, sortRaw, valueText } from "./raw.ts";

type J = Record<string, any>;

/** The sprint an issue is in now: the active one, else the next future one, else the last it was in. */
function currentSprint(v: unknown): string | undefined {
  const xs: J[] = Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
  if (!xs.length) {
    // Data Center can return sprints as strings like "com.atlassian...Sprint@1[id=1,state=ACTIVE,name=Sprint 1,...]"
    const ss = (Array.isArray(v) ? v : []).filter((x) => typeof x === "string") as string[];
    const parsed = ss.map((s) => ({ name: /name=([^,\]]+)/.exec(s)?.[1], state: /state=([^,\]]+)/.exec(s)?.[1]?.toLowerCase() }));
    return (parsed.find((p) => p.state === "active") ?? parsed.find((p) => p.state === "future") ?? parsed[parsed.length - 1])?.name;
  }
  const by = (s: string) => xs.filter((x) => String(x.state).toLowerCase() === s);
  return (by("active")[0] ?? by("future")[0] ?? xs[xs.length - 1])?.name;
}

export function readJiraState(raw: RawExport, invIn?: TrackerInventory): TrackerIssue[] {
  const inv = invIn ?? discoverJira(raw);
  const r = sortRaw(raw);
  const role = (x: string) => inv.fields.filter((f) => f.role === x).map((f) => f.id);
  const sprintF = role("sprint"), pointF = role("story-points"), epicLinkF = role("epic-link"), acceptF = role("acceptance");
  const typeLevel = new Map(inv.issueTypes.map((t) => [t.id, t.level]));
  const out: TrackerIssue[] = [];
  for (const i of r.issues) {
    const f: J = i.fields ?? {};
    const t: J = f.issuetype ?? {};
    const links: TrackerIssueLink[] = [];
    for (const l of f.issuelinks ?? []) {
      if (l.outwardIssue?.key) links.push({ type: String(l.type?.name), direction: "outward", phrase: String(l.type?.outward ?? ""), key: String(l.outwardIssue.key) });
      if (l.inwardIssue?.key) links.push({ type: String(l.type?.name), direction: "inward", phrase: String(l.type?.inward ?? ""), key: String(l.inwardIssue.key) });
    }
    links.sort((a, b) => natCompare(a.type, b.type) || natCompare(a.direction, b.direction) || natCompare(a.key, b.key));
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (k.startsWith("customfield_")) { const s = valueText(v); if (s) values[k] = s; }
    const desc = richText(f.description);
    if (desc) values.description = desc;
    const pick = (ids: string[]) => { for (const id of ids) { const s = valueText(f[id]); if (s) return s; } return undefined; };
    const points = (() => { for (const id of pointF) if (typeof f[id] === "number") return f[id] as number; return undefined; })();
    const parent = f.parent?.key ? String(f.parent.key) : pick(epicLinkF);
    const sprint = (() => { for (const id of sprintF) { const s = currentSprint(f[id]); if (s) return s; } return undefined; })();
    const acceptance = (() => { for (const id of acceptF) { const s = richText(f[id]) ?? valueText(f[id]); if (s) return s; } return undefined; })();
    // Status history, when the export was fetched with expand=changelog: oldest first.
    const transitions: NonNullable<TrackerIssue["transitions"]> = [];
    for (const h of (i.changelog?.histories ?? []) as J[]) for (const it of (h.items ?? []) as J[])
      if (String(it.field).toLowerCase() === "status" && h.created && it.toString != null)
        transitions.push({ at: String(h.created), ...(it.fromString != null ? { from: String(it.fromString) } : {}), to: String(it.toString) });
    transitions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const iss: TrackerIssue = {
      key: String(i.key), project: String(f.project?.key ?? String(i.key).split("-")[0]),
      type: String(t.name ?? "?"), level: typeLevel.get(String(t.id)) ?? levelOf(t),
      summary: String(f.summary ?? ""),
      status: String(f.status?.name ?? "?"), statusCategory: CATEGORY[String(f.status?.statusCategory?.key)] ?? "todo",
      statusCategoryName: String(f.status?.statusCategory?.name ?? "To Do"),
      ...(f.assignee ? { assignee: String(f.assignee.displayName ?? f.assignee.name ?? f.assignee.accountId) } : {}),
      ...(sprint ? { sprint } : {}),
      ...(parent ? { parent } : {}),
      ...(points !== undefined ? { points } : {}),
      components: (f.components ?? []).map((c: J) => String(c.name)).sort(natCompare),
      labels: (f.labels ?? []).map(String).sort(natCompare),
      fixVersions: (f.fixVersions ?? []).map((v: J) => String(v.name)).sort(natCompare),
      links,
      ...(acceptance ? { acceptance } : {}),
      ...(f.updated ? { updated: String(f.updated) } : {}),
      ...(f.created ? { created: String(f.created) } : {}),
      ...(transitions.length ? { transitions } : {}),
      ...(Object.keys(values).length ? { values } : {}),
    };
    out.push(iss);
  }
  return out.sort((a, b) => natCompare(a.key, b.key));
}
