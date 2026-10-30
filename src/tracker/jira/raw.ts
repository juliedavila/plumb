// Sort raw Jira REST responses by shape, not by file name, so an agent can save them under any names.
// Handles Jira Cloud (REST v3, Atlassian Document Format rich text, /search/jql token paging) and
// Data Center (REST v2, plain-text rich text, startAt paging), company-managed and team-managed projects.

import type { RawExport } from "../adapter.ts";

type J = Record<string, any>;
export interface JiraRaw {
  serverInfo?: J;
  projects: J[];
  issueTypes: J[];
  fields: J[];
  linkTypes: J[];
  statuses: J[];
  issues: J[];
  unknown: string[]; // files that matched no known response
}

const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);
const objs = (v: unknown): J[] => (Array.isArray(v) ? v.filter(isObj) : []);

function kindOfArray(xs: J[]): keyof Omit<JiraRaw, "serverInfo" | "unknown" | "issues"> | "issues" | undefined {
  if (!xs.length) return undefined;
  const x = xs[0];
  if (x.statusCategory) return "statuses";
  if (x.fields && x.key) return "issues";
  if ("schema" in x || "clauseNames" in x || ("custom" in x && "navigable" in x)) return "fields";
  if ("subtask" in x || "hierarchyLevel" in x) return "issueTypes";
  if (x.key && ("projectTypeKey" in x || "style" in x || "simplified" in x)) return "projects";
  if ("inward" in x && "outward" in x) return "linkTypes";
  return undefined;
}

export function sortRaw(raw: RawExport): JiraRaw {
  const out: JiraRaw = { projects: [], issueTypes: [], fields: [], linkTypes: [], statuses: [], issues: [], unknown: [] };
  const seenIssue = new Set<string>();
  const add = (k: keyof Omit<JiraRaw, "serverInfo" | "unknown">, xs: J[]) => {
    for (const x of xs) {
      if (k === "issues") { if (seenIssue.has(x.key)) continue; seenIssue.add(x.key); }
      out[k].push(x);
    }
  };
  for (const f of raw.files) {
    const j = f.json;
    if (Array.isArray(j)) {
      const k = kindOfArray(objs(j));
      if (k) add(k, objs(j)); else out.unknown.push(f.name);
    } else if (isObj(j)) {
      if (Array.isArray(j.issueLinkTypes)) add("linkTypes", objs(j.issueLinkTypes));
      else if (Array.isArray(j.issues)) add("issues", objs(j.issues));
      else if (Array.isArray(j.values)) { const k = kindOfArray(objs(j.values)); if (k) add(k, objs(j.values)); else out.unknown.push(f.name); }
      else if ("deploymentType" in j || ("baseUrl" in j && "versionNumbers" in j)) out.serverInfo = j;
      else if (j.fields && j.key) add("issues", [j]);
      else out.unknown.push(f.name);
    } else out.unknown.push(f.name);
  }
  // Issue types and fields can come back once per project; keep each id once.
  const uniq = (xs: J[]) => { const s = new Set<string>(); return xs.filter((x) => (s.has(String(x.id)) ? false : (s.add(String(x.id)), true))); };
  out.issueTypes = uniq(out.issueTypes); out.fields = uniq(out.fields); out.statuses = uniq(out.statuses);
  out.linkTypes = uniq(out.linkTypes.map((l) => ({ ...l, id: l.id ?? l.name })));
  out.projects = (() => { const s = new Set<string>(); return out.projects.filter((p) => (s.has(p.key) ? false : (s.add(p.key), true))); })();
  return out;
}

/** Plain text from a Jira rich-text value: an Atlassian Document Format document (v3) or a string (v2). */
export function richText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (!isObj(v)) return undefined;
  const blocks: string[] = [];
  const walk = (n: J, acc: string[]) => {
    if (n.type === "text" && typeof n.text === "string") acc.push(n.text);
    else if (n.type === "hardBreak") acc.push("\n");
    for (const c of objs(n.content)) walk(c, acc);
  };
  if (v.type === "doc") {
    for (const b of objs(v.content)) { const acc: string[] = []; walk(b, acc); const t = acc.join("").trim(); if (t) blocks.push(t); }
  } else { const acc: string[] = []; walk(v, acc); if (acc.length) blocks.push(acc.join("").trim()); }
  return blocks.length ? blocks.join("\n") : undefined;
}

/** A field value as text: option, user, team, version, component, sprint, rich text, number or list. */
export function valueText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) { const xs = v.map(valueText).filter((x): x is string => !!x); return xs.length ? xs.join(", ") : undefined; }
  if (isObj(v)) {
    if (v.type === "doc") return richText(v);
    for (const k of ["value", "displayName", "name", "title", "key"]) if (typeof v[k] === "string" && v[k]) return v[k];
  }
  return undefined;
}

/** Hierarchy level of an issue type: Cloud gives hierarchyLevel; Data Center does not, so derive it. */
export function levelOf(t: J): number {
  if (typeof t.hierarchyLevel === "number") return t.hierarchyLevel;
  if (t.subtask) return -1;
  const n = String(t.name ?? "").toLowerCase();
  if (n === "epic") return 1;
  if (n === "initiative" || n === "theme") return 2;
  return 0;
}

export const CATEGORY: Record<string, "todo" | "doing" | "done"> = { new: "todo", indeterminate: "doing", done: "done", undefined: "todo" };
