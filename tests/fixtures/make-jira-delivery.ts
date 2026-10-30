// Generates tests/fixtures/jira-delivery/: a fictional Jira Cloud export for the delivery-stream instance, shaped
// like the raw responses of the Jira REST API v3 an agent would save:
//   serverInfo.json      GET /rest/api/3/serverInfo
//   project.json         GET /rest/api/3/project/search          (paged: { values: [...] })
//   issuetype.json       GET /rest/api/3/issuetype
//   field.json           GET /rest/api/3/field
//   issueLinkType.json   GET /rest/api/3/issueLinkType
//   status.json          GET /rest/api/3/status
//   search-1.json, search-2.json   POST /rest/api/3/search/jql with fields=*all, two pages (nextPageToken / isLast)
//
// The organization is fictional: a product team building a note-taking app ("Notebook app", project NOTE) and a
// team-managed help desk project (HELP). Assignees are role handles, not people. Rich text is Atlassian Document
// Format, as v3 returns it. Issue links appear on both issues, as Jira returns them.
//
// What the sample is built to show (see DEMO.md):
// - a customized hierarchy: Initiative (level 2) above Epic (1), standard types (0) and Sub-task (-1);
// - two team fields (the Atlassian Team field, barely used, and a "Delivery team" select that is the real one),
//   plus the legacy Epic Link and Epic Name fields defined but unused, as on Jira Cloud;
// - a custom "Depends on" link type beside the built-in Blocks;
// - a custom status, "Ready for Release", that the workflow put in the Done category;
// - issues that match units exactly by label, issues that match by similar title, issues with no unit,
//   units with no issue, a status that disagrees with its unit, a label naming a unit that does not exist,
//   an issue under another phase's epic, and dependency links present on one side only;
// - status history (the changelog, as search with expand=changelog returns it) on the issues that moved through the
//   delivery workflow: Selected for Development, In Progress, In Review, Ready for Test, In Test, Ready for Release,
//   Done. Four changes finished it; others are part way. tracker/mapping.yaml `flow:` maps those statuses to stream
//   steps, so the delivery stream shows measured waits beside the declared ones.
//
// Run: bun tests/fixtures/make-jira-delivery.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "jira-delivery");
const BASE = "https://tracker.example.test";

const NOTE = { id: "10000", key: "NOTE", name: "Notebook app" };
const HELP = { id: "10001", key: "HELP", name: "Help desk" };

const T = {
  epic: { id: "10000", name: "Epic", subtask: false, hierarchyLevel: 1 },
  story: { id: "10001", name: "Story", subtask: false, hierarchyLevel: 0 },
  task: { id: "10002", name: "Task", subtask: false, hierarchyLevel: 0 },
  subtask: { id: "10003", name: "Sub-task", subtask: true, hierarchyLevel: -1 },
  bug: { id: "10004", name: "Bug", subtask: false, hierarchyLevel: 0 },
  initiative: { id: "10005", name: "Initiative", subtask: false, hierarchyLevel: 2 },
  spike: { id: "10006", name: "Spike", subtask: false, hierarchyLevel: 0 },
  helpTask: { id: "10100", name: "Task", subtask: false, hierarchyLevel: 0, scope: { type: "PROJECT", project: { id: HELP.id } } },
  helpEpic: { id: "10101", name: "Epic", subtask: false, hierarchyLevel: 1, scope: { type: "PROJECT", project: { id: HELP.id } } },
};

const CAT = {
  new: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
  indeterminate: { id: 4, key: "indeterminate", name: "In Progress", colorName: "yellow" },
  done: { id: 3, key: "done", name: "Done", colorName: "green" },
};
const S = {
  backlog: { id: "10000", name: "Backlog", statusCategory: CAT.new },
  todo: { id: "10001", name: "To Do", statusCategory: CAT.new },
  selected: { id: "10002", name: "Selected for Development", statusCategory: CAT.new },
  inProgress: { id: "3", name: "In Progress", statusCategory: CAT.indeterminate },
  inReview: { id: "10003", name: "In Review", statusCategory: CAT.indeterminate },
  readyForTest: { id: "10007", name: "Ready for Test", statusCategory: CAT.indeterminate },
  inTest: { id: "10008", name: "In Test", statusCategory: CAT.indeterminate },
  readyForRelease: { id: "10004", name: "Ready for Release", statusCategory: CAT.done },
  done: { id: "10005", name: "Done", statusCategory: CAT.done },
  wontDo: { id: "10006", name: "Won't Do", statusCategory: CAT.done },
  open: { id: "10100", name: "Open", statusCategory: CAT.new, scope: { type: "PROJECT", project: { id: HELP.id } } },
  waiting: { id: "10101", name: "Waiting for customer", statusCategory: CAT.indeterminate, scope: { type: "PROJECT", project: { id: HELP.id } } },
  resolved: { id: "10102", name: "Resolved", statusCategory: CAT.done, scope: { type: "PROJECT", project: { id: HELP.id } } },
};

const L = {
  blocks: { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  cloners: { id: "10001", name: "Cloners", inward: "is cloned by", outward: "clones" },
  duplicate: { id: "10002", name: "Duplicate", inward: "is duplicated by", outward: "duplicates" },
  relates: { id: "10003", name: "Relates", inward: "relates to", outward: "relates to" },
  depends: { id: "10100", name: "Depends on", inward: "is a dependency of", outward: "depends on" },
};

const custom = (id: string, name: string, type: string, customType: string, items?: string) => ({
  id, key: id, name, custom: true, orderable: true, navigable: true, searchable: true,
  clauseNames: [`cf[${id.replace("customfield_", "")}]`, name],
  schema: { type, ...(items ? { items } : {}), custom: customType, customId: Number(id.replace("customfield_", "")) },
});
const system = (id: string, name: string, type: string, items?: string) => ({
  id, key: id, name, custom: false, orderable: true, navigable: true, searchable: true, clauseNames: [id],
  schema: { type, ...(items ? { items } : {}), system: id },
});
const FIELDS = [
  system("summary", "Summary", "string"),
  system("description", "Description", "string"),
  system("issuetype", "Issue Type", "issuetype"),
  system("project", "Project", "project"),
  system("status", "Status", "status"),
  system("assignee", "Assignee", "user"),
  system("parent", "Parent", "issuelink"),
  system("labels", "Labels", "array", "string"),
  system("components", "Components", "array", "component"),
  system("fixVersions", "Fix versions", "array", "version"),
  system("issuelinks", "Linked Issues", "array", "issuelinks"),
  system("updated", "Updated", "datetime"),
  system("created", "Created", "datetime"),
  custom("customfield_10001", "Team", "team", "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team"),
  custom("customfield_10011", "Epic Name", "string", "com.pyxis.greenhopper.jira:gh-epic-label"),
  custom("customfield_10014", "Epic Link", "any", "com.pyxis.greenhopper.jira:gh-epic-link"),
  custom("customfield_10015", "Start date", "date", "com.atlassian.jira.plugin.system.customfieldtypes:datepicker"),
  custom("customfield_10016", "Story point estimate", "number", "com.pyxis.greenhopper.jira:jsw-story-points"),
  custom("customfield_10020", "Sprint", "array", "com.pyxis.greenhopper.jira:gh-sprint", "json"),
  custom("customfield_10026", "Story Points", "number", "com.atlassian.jira.plugin.system.customfieldtypes:float"),
  custom("customfield_10201", "Delivery team", "option", "com.atlassian.jira.plugin.system.customfieldtypes:select"),
  custom("customfield_10300", "Acceptance criteria", "string", "com.atlassian.jira.plugin.system.customfieldtypes:textarea"),
  custom("customfield_10400", "Stream stage", "option", "com.atlassian.jira.plugin.system.customfieldtypes:select"),
];

const TEAM_OPT: Record<string, string> = {
  Product: "10500", Design: "10501", "App engineering": "10502", Platform: "10503", QA: "10504", "Release management": "10505", Support: "10506",
};
const COMP: Record<string, string> = { "Web editor": "10600", Pipeline: "10601", "Flow metrics": "10602", Release: "10603", "Support tooling": "10604" };
const VER: Record<string, { id: string; released: boolean }> = {
  "2026.09": { id: "10700", released: true }, "2026.10": { id: "10701", released: false },
  "2026.11": { id: "10702", released: false }, "2026.12": { id: "10703", released: false },
};
const SPRINT = {
  s41: { id: 141, name: "NOTE Sprint 41", state: "closed", boardId: 7, startDate: "2026-09-21T09:00:00.000Z", endDate: "2026-10-05T17:00:00.000Z" },
  s42: { id: 142, name: "NOTE Sprint 42", state: "active", boardId: 7, startDate: "2026-10-05T09:00:00.000Z", endDate: "2026-10-19T17:00:00.000Z" },
  s43: { id: 143, name: "NOTE Sprint 43", state: "future", boardId: 7 },
};
const ROLE: Record<string, string> = {
  pm: "Product lead", pdev: "Platform engineer 1", pdev2: "Platform engineer 2", app: "App engineer 1", qa: "Test engineer 1", rel: "Release manager", sup: "Support lead",
};

const adf = (text: string) => ({ type: "doc", version: 1, content: text.split("\n").map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) });

interface Spec {
  key: string; type: keyof typeof T; summary: string; status: keyof typeof S; parent?: string;
  team?: string; atlTeam?: string; assignee?: keyof typeof ROLE; labels?: string[]; components?: string[]; versions?: string[];
  sprints?: (keyof typeof SPRINT)[]; points?: number; estimate?: number; acceptance?: string; description?: string; stage?: string;
  dependsOn?: string[]; blocks?: string[]; relates?: string[];
}

const ISSUES: Spec[] = [
  // the hierarchy above the units
  { key: "NOTE-1", type: "initiative", summary: "Shorten the delivery stream", status: "inProgress", assignee: "pm", team: "Product",
    description: "Cut the time from an accepted idea to a change in production, and keep it down." },
  { key: "NOTE-2", type: "epic", summary: "See the delivery stream", status: "inProgress", parent: "NOTE-1", team: "Product", assignee: "pm" },
  { key: "NOTE-3", type: "epic", summary: "Shorten the stream", status: "todo", parent: "NOTE-1", team: "Product", assignee: "pm" },
  { key: "NOTE-4", type: "epic", summary: "Keep the stream short", status: "backlog", parent: "NOTE-1", team: "Product" },

  // See the stream
  { key: "NOTE-10", type: "story", summary: "Name an owner for every step", status: "done", parent: "NOTE-2", team: "Product", assignee: "pm",
    labels: ["de-unit:U-01", "stream"], sprints: ["s41"], points: 2, versions: ["2026.09"],
    acceptance: "The stream map lists one owning team per step.\nEach team lead has confirmed their steps.", blocks: ["NOTE-12"] },
  { key: "NOTE-11", type: "story", summary: "Record the wait at each step", status: "done", parent: "NOTE-2", team: "Platform", assignee: "pdev",
    labels: ["de-unit:U-02", "stream"], components: ["Flow metrics"], sprints: ["s41"], points: 3, versions: ["2026.09"], dependsOn: ["NOTE-10"] },
  { key: "NOTE-12", type: "story", summary: "WIP limits on every queue", status: "inProgress", parent: "NOTE-2", team: "Product", assignee: "pm",
    labels: ["de-unit:U-03", "stream"], sprints: ["s41", "s42"], points: 2, versions: ["2026.10"], dependsOn: ["NOTE-10"] },
  { key: "NOTE-13", type: "story", summary: "Add stream stage labels to tracker tickets", status: "done", parent: "NOTE-2", team: "App engineering", atlTeam: "Web squad",
    assignee: "app", components: ["Web editor"], sprints: ["s41"], points: 3, versions: ["2026.09"], dependsOn: ["NOTE-10"], stage: "Delivery" },
  { key: "NOTE-14", type: "task", summary: "Walk one change end to end", status: "inProgress", parent: "NOTE-2", team: "Product", assignee: "pm",
    labels: ["de-unit:U-05"], sprints: ["s42"], points: 5, versions: ["2026.10"], dependsOn: ["NOTE-11"] },
  { key: "NOTE-15", type: "story", summary: "Export stage timestamps to flow metrics", status: "inReview", parent: "NOTE-2", team: "Platform", atlTeam: "Platform squad",
    assignee: "pdev2", components: ["Flow metrics", "Pipeline"], sprints: ["s42"], points: 5, versions: ["2026.10"], dependsOn: ["NOTE-13"],
    acceptance: "Lead time per change on the flow metrics page matches the sheet for the last ten changes." },
  { key: "NOTE-16", type: "story", summary: "Agree on the lead time target", status: "todo", parent: "NOTE-2", team: "Product", sprints: ["s43"], points: 1, versions: ["2026.10"] },
  { key: "NOTE-17", type: "task", summary: "Archive stale tracker dashboards", status: "done", parent: "NOTE-2", team: "Platform", assignee: "pdev", sprints: ["s41"], points: 1,
    labels: ["tech-debt"] },

  // Shorten it
  { key: "NOTE-19", type: "story", summary: "Track hours from PR opened to first review", status: "todo", parent: "NOTE-3", team: "App engineering",
    components: ["Flow metrics"], points: 3, versions: ["2026.11"], dependsOn: ["NOTE-15"] },
  { key: "NOTE-20", type: "story", summary: "Automate the release checklist", status: "selected", parent: "NOTE-3", team: "QA", assignee: "qa",
    labels: ["de-unit:U-08"], components: ["Pipeline"], sprints: ["s42"], points: 8, versions: ["2026.11"], dependsOn: ["NOTE-12"],
    acceptance: "Every manual checklist item has an automated test.\nThe suite runs on each build in under 20 minutes." },
  { key: "NOTE-21", type: "story", summary: "Gate deployments on the automated regression suite", status: "todo", parent: "NOTE-3", team: "Platform",
    components: ["Pipeline"], points: 5, versions: ["2026.11"] },
  { key: "NOTE-22", type: "story", summary: "Preview environments for pull requests", status: "backlog", parent: "NOTE-3", team: "App engineering",
    components: ["Pipeline"], points: 8 },
  { key: "NOTE-23", type: "spike", summary: "Try trunk-based development for a sprint", status: "backlog", parent: "NOTE-3", team: "App engineering" },
  { key: "NOTE-29", type: "task", summary: "Retire the weekly release meeting", status: "todo", parent: "NOTE-3", team: "Release management", assignee: "rel",
    labels: ["de-unit:U-99"], versions: ["2026.12"] },

  // Keep it short (and one issue filed under the wrong epic)
  { key: "NOTE-24", type: "story", summary: "Release notes drafted from merged changes", status: "readyForRelease", parent: "NOTE-4", team: "Release management", assignee: "rel",
    labels: ["de-unit:U-15"], components: ["Release"], sprints: ["s42"], points: 3, versions: ["2026.11"] },
  { key: "NOTE-25", type: "story", summary: "Put lead time on the team dashboard", status: "todo", parent: "NOTE-4", team: "Platform",
    labels: ["de-unit:U-16"], components: ["Flow metrics"], points: 3, versions: ["2026.12"], dependsOn: ["NOTE-15"] },
  { key: "NOTE-28", type: "story", summary: "Route support tickets to the idea inbox", status: "todo", parent: "NOTE-4", team: "Support", assignee: "sup",
    labels: ["de-unit:U-19"], components: ["Support tooling"], points: 5, versions: ["2026.12"], dependsOn: ["NOTE-13"] },

  // outside the mapped epics: not part of the plan, so not reported
  { key: "NOTE-26", type: "bug", summary: "Editor loses the cursor position on paste", status: "inProgress", team: "App engineering", assignee: "app",
    labels: ["customer-request"], components: ["Web editor"], sprints: ["s42"], points: 2, versions: ["2026.10"] },
  { key: "NOTE-27", type: "subtask", summary: "Regression test for the export menu", status: "todo", parent: "NOTE-20", team: "QA", assignee: "qa" },
  { key: "NOTE-30", type: "story", summary: "Duplicate of the dashboard request", status: "wontDo", team: "Platform", relates: ["NOTE-25"] },
  { key: "HELP-1", type: "helpTask", summary: "Customer cannot export a notebook to PDF", status: "waiting", assignee: "sup", estimate: 1 },
  { key: "HELP-2", type: "helpTask", summary: "Idea: tags on notes", status: "open", estimate: 2 },
  { key: "HELP-3", type: "helpTask", summary: "Sync conflict after reinstall", status: "resolved", assignee: "sup", estimate: 1 },
];

// Status history: the statuses an issue passed through, oldest first, each with the days it stayed (the last one is
// the status it is in now). Built backwards from the issue's updated time, so the history ends where the issue is.
const HISTORY: Record<string, [keyof typeof S, number?][]> = {
  "NOTE-10": [["todo", 3], ["selected", 1.5], ["inProgress", 2.5], ["inReview", 3], ["readyForTest", 4], ["inTest", 1], ["readyForRelease", 6], ["done"]],
  "NOTE-11": [["todo", 2], ["selected", 2], ["inProgress", 3.5], ["inReview", 2.5], ["readyForTest", 5], ["inTest", 1.5], ["readyForRelease", 5], ["done"]],
  "NOTE-13": [["backlog", 4], ["selected", 1], ["inProgress", 4], ["inReview", 3.5], ["readyForTest", 3], ["inTest", 0.5], ["readyForRelease", 4.5], ["done"]],
  "NOTE-17": [["todo", 1], ["selected", 0.5], ["inProgress", 1], ["inReview", 1.5], ["readyForTest", 2], ["inTest", 0.5], ["readyForRelease", 3.5], ["done"]],
  "NOTE-12": [["todo", 2], ["selected", 2], ["inProgress"]],
  "NOTE-14": [["todo", 1], ["selected", 1], ["inProgress"]],
  "NOTE-15": [["todo", 2], ["selected", 1.5], ["inProgress", 4.5], ["inReview"]],
  "NOTE-20": [["todo", 4], ["selected"]],
  "NOTE-24": [["backlog", 1], ["selected", 1], ["inProgress", 2], ["inReview", 2], ["readyForTest", 3.5], ["inTest", 1], ["readyForRelease"]],
  "NOTE-26": [["todo", 0.5], ["selected", 0.5], ["inProgress"]],
};
const HOUR = 3_600_000, DAYMS = 24 * HOUR;
const jiraTime = (ms: number) => new Date(ms).toISOString().replace("Z", "+0000");
/** created and the changelog of one issue, ending two hours before its updated time. */
function history(key: string, updated: string, status: keyof typeof S) {
  const h = HISTORY[key];
  if (!h) return { created: jiraTime(Date.parse(updated.replace("+0000", "Z")) - 30 * DAYMS), changelog: { startAt: 0, maxResults: 0, total: 0, histories: [] } };
  if (h[h.length - 1][0] !== status) throw new Error(`${key}: history ends in ${h[h.length - 1][0]}, the issue is ${status}`);
  let t = Date.parse(updated.replace("+0000", "Z")) - 2 * HOUR;
  const at: number[] = [];
  for (let k = h.length - 1; k >= 1; k--) { at.unshift(t); t -= (h[k - 1][1] ?? 0) * DAYMS; }
  const created = t;
  const histories = at.map((ms, k) => ({
    id: `${idOf(key)}${k}`, author: { accountId: "acct-board", displayName: "Board automation", active: true }, created: jiraTime(ms),
    items: [{ field: "status", fieldtype: "jira", fieldId: "status", from: S[h[k][0]].id, fromString: S[h[k][0]].name, to: S[h[k + 1][0]].id, toString: S[h[k + 1][0]].name }],
  }));
  return { created: jiraTime(created), changelog: { startAt: 0, maxResults: histories.length, total: histories.length, histories } };
}

const byKey = new Map(ISSUES.map((i) => [i.key, i]));
let linkId = 20000;
const linksOf = new Map<string, any[]>();
const ref = (key: string) => {
  const s = byKey.get(key)!;
  return { id: idOf(key), key, self: `${BASE}/rest/api/3/issue/${idOf(key)}`, fields: { summary: s.summary, status: S[s.status], issuetype: T[s.type] } };
};
function idOf(key: string) { const [p, n] = key.split("-"); return String((p === "HELP" ? 30000 : 20000) + Number(n)); }
function link(type: (typeof L)[keyof typeof L], from: string, to: string) {
  // from <outward> to, e.g. NOTE-11 depends on NOTE-10. Jira returns the link on both issues.
  const id = String(linkId++);
  (linksOf.get(from) ?? linksOf.set(from, []).get(from)!).push({ id, self: `${BASE}/rest/api/3/issueLink/${id}`, type: { ...type, self: `${BASE}/rest/api/3/issueLinkType/${type.id}` }, outwardIssue: ref(to) });
  (linksOf.get(to) ?? linksOf.set(to, []).get(to)!).push({ id, self: `${BASE}/rest/api/3/issueLink/${id}`, type: { ...type, self: `${BASE}/rest/api/3/issueLinkType/${type.id}` }, inwardIssue: ref(from) });
}
for (const s of ISSUES) {
  for (const t of s.dependsOn ?? []) link(L.depends, s.key, t);
  for (const t of s.blocks ?? []) link(L.blocks, s.key, t);
  for (const t of s.relates ?? []) link(L.relates, s.key, t);
}

function issue(s: Spec, i: number) {
  const project = s.key.startsWith("HELP") ? HELP : NOTE;
  const parent = s.parent ? byKey.get(s.parent)! : undefined;
  const f: Record<string, unknown> = {
    summary: s.summary,
    issuetype: { self: `${BASE}/rest/api/3/issuetype/${T[s.type].id}`, ...T[s.type] },
    project: { self: `${BASE}/rest/api/3/project/${project.id}`, ...project, projectTypeKey: project === HELP ? "service_desk" : "software", simplified: project === HELP },
    status: { self: `${BASE}/rest/api/3/status/${S[s.status].id}`, ...S[s.status] },
    assignee: s.assignee ? { accountId: `acct-${s.assignee}`, displayName: ROLE[s.assignee], active: true, accountType: "atlassian" } : null,
    labels: s.labels ?? [],
    components: (s.components ?? []).map((c) => ({ self: `${BASE}/rest/api/3/component/${COMP[c]}`, id: COMP[c], name: c })),
    fixVersions: (s.versions ?? []).map((v) => ({ self: `${BASE}/rest/api/3/version/${VER[v].id}`, id: VER[v].id, name: v, archived: false, released: VER[v].released })),
    issuelinks: linksOf.get(s.key) ?? [],
    description: s.description ? adf(s.description) : null,
    updated: `2026-10-${String(1 + (i % 19)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00.000+0000`,
    customfield_10001: s.atlTeam ? { id: `team-${s.atlTeam.toLowerCase().replace(/\W+/g, "-")}`, name: s.atlTeam, title: s.atlTeam, isShared: true } : null,
    customfield_10011: null,
    customfield_10014: null,
    customfield_10015: null,
    customfield_10016: s.estimate ?? null,
    customfield_10020: s.sprints ? s.sprints.map((k) => SPRINT[k]) : null,
    customfield_10026: s.points ?? null,
    customfield_10201: s.team ? { self: `${BASE}/rest/api/3/customFieldOption/${TEAM_OPT[s.team]}`, value: s.team, id: TEAM_OPT[s.team] } : null,
    customfield_10300: s.acceptance ? adf(s.acceptance) : null,
    customfield_10400: s.stage ? { value: s.stage, id: "10800" } : null,
  };
  const hist = history(s.key, String(f.updated), s.status);
  f.created = hist.created;
  if (parent) f.parent = { id: idOf(parent.key), key: parent.key, self: `${BASE}/rest/api/3/issue/${idOf(parent.key)}`, fields: { summary: parent.summary, status: S[parent.status], issuetype: T[parent.type] } };
  return { expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations", id: idOf(s.key), self: `${BASE}/rest/api/3/issue/${idOf(s.key)}`, key: s.key, fields: f, changelog: hist.changelog };
}

const all = ISSUES.map(issue);
const half = Math.ceil(all.length / 2);
const write = (name: string, v: unknown) => Bun.write(join(OUT, name), JSON.stringify(v, null, 2) + "\n");

mkdirSync(OUT, { recursive: true });
await write("serverInfo.json", { baseUrl: BASE, displayUrl: BASE, version: "1001.0.0-SNAPSHOT", versionNumbers: [1001, 0, 0], deploymentType: "Cloud", buildNumber: 100270, serverTitle: "Jira" });
await write("project.json", {
  self: `${BASE}/rest/api/3/project/search?maxResults=50&startAt=0`, maxResults: 50, startAt: 0, total: 2, isLast: true,
  values: [
    { expand: "description,lead,issueTypes,url,projectKeys,permissions,insight", self: `${BASE}/rest/api/3/project/${NOTE.id}`, ...NOTE, projectTypeKey: "software", simplified: false, style: "classic", isPrivate: false },
    { expand: "description,lead,issueTypes,url,projectKeys,permissions,insight", self: `${BASE}/rest/api/3/project/${HELP.id}`, ...HELP, projectTypeKey: "service_desk", simplified: true, style: "next-gen", isPrivate: false },
  ],
});
await write("issuetype.json", Object.values(T).map((t) => ({ self: `${BASE}/rest/api/3/issuetype/${t.id}`, description: "", iconUrl: `${BASE}/images/icons/issuetypes/${t.name.toLowerCase()}.svg`, untranslatedName: t.name, avatarId: 10300, ...t })));
await write("field.json", FIELDS);
await write("issueLinkType.json", { issueLinkTypes: Object.values(L).map((l) => ({ ...l, self: `${BASE}/rest/api/3/issueLinkType/${l.id}` })) });
await write("status.json", Object.values(S).map((s) => ({ self: `${BASE}/rest/api/3/status/${s.id}`, description: "", iconUrl: `${BASE}/images/icons/statuses/generic.png`, untranslatedName: s.name, ...s, statusCategory: { self: `${BASE}/rest/api/3/statuscategory/${s.statusCategory.id}`, ...s.statusCategory } })));
await write("search-1.json", { issues: all.slice(0, half), nextPageToken: "page-2", isLast: false });
await write("search-2.json", { issues: all.slice(half), isLast: true });
console.log(`wrote ${all.length} issues and 7 metadata responses to ${OUT}`);
