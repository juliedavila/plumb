// Generates examples/shared/tracker/export/: a fictional Jira Cloud export for the example root's BAU measurement
//, shaped like the raw responses of the Jira REST API v3 an agent saves:
//   serverInfo.json, project.json, issuetype.json, field.json, issueLinkType.json, status.json
//   search-1.json, search-2.json   POST /rest/api/3/search/jql with fields=*all and expand=changelog, two pages
//
// The organization is fictional: six teams named by what they do, four projects (SEC security engineering, INC
// incidents, GRC governance and risk, PLAT platform), assignees as role handles. 121 issues, each with its status
// history (the changelog), an "Owning team" select field (customfield_10201) on all but five, and labels,
// components, issue types, a "Work category" select (customfield_10410) and epic parents chosen so that every bucket
// of examples/shared/tracker/mapping.yaml is reached:
//   design work   labelled de-unit:<namespace>:<unit>; one issue also carries vuln-triage (design work wins), and one
//                 carries a bare de-unit:U-04, a lone instance's label, which is not design work here
//   vuln-triage   label vuln-triage                       pentest-coordination   issue type "Pen test"
//   incident-oncall  project INC (one INC issue also has the component Customer assurance: the first match wins)
//   questionnaires   component Customer assurance         audit-evidence   parent epic GRC-1
//   scanner-rule-upkeep  Work category "Scanner rules"    unclassified   about a tenth of each team's time
//
// Every status change happens at 00:00 UTC, so days in a status are whole. The measure window is the 90 days
// ending at the export date, 2026-08-03T00:00Z to 2026-11-01T00:00Z. Three issues started before it (their days
// are clipped), and issues still in progress at the export date count their days up to its end. Each team's days in
// doing statuses (In Progress, In Review) are sized so the activities' shares come out exact:
//   Vulnerability management 400 days: vuln-triage 152 (0.38), design 208, unclassified 40
//   AppSec platform 200: pentest-coordination 24 (0.12), scanner-rule-upkeep 40 (0.20), design 116, unclassified 20
//   Detection and response 200: incident-oncall 104 (0.52), design 76, unclassified 20
//   Governance and risk 150: audit-evidence 36 (0.24), questionnaires 42 (0.28), design 57, unclassified 15
//   Developer platform 80: design 68, unclassified 12        Product engineering 60: design 51, unclassified 9
//
// Run: bun tests/fixtures/portfolio/make-jira-export.ts [out-dir]   (the same bytes every time; tests/examples.test.ts
// writes to a temporary folder and compares)
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dir, "../../../examples/shared/tracker/export");
const BASE = "https://tracker.example.test";
const DAY = 86_400_000;
const W0 = Date.parse("2026-08-03T00:00:00Z"); // window start
const W1 = Date.parse("2026-11-01T00:00:00Z"); // window end: the export date

const PROJECTS = {
  SEC: { id: "10010", key: "SEC", name: "Security engineering" },
  INC: { id: "10011", key: "INC", name: "Incidents" },
  GRC: { id: "10012", key: "GRC", name: "Governance and risk" },
  PLAT: { id: "10013", key: "PLAT", name: "Platform" },
};
type ProjectKey = keyof typeof PROJECTS;

const T = {
  epic: { id: "10100", name: "Epic", subtask: false, hierarchyLevel: 1 },
  story: { id: "10101", name: "Story", subtask: false, hierarchyLevel: 0 },
  task: { id: "10102", name: "Task", subtask: false, hierarchyLevel: 0 },
  pentest: { id: "10103", name: "Pen test", subtask: false, hierarchyLevel: 0 },
  incident: { id: "10104", name: "Incident", subtask: false, hierarchyLevel: 0 },
};
type TypeKey = keyof typeof T;

const CAT = {
  new: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
  indeterminate: { id: 4, key: "indeterminate", name: "In Progress", colorName: "yellow" },
  done: { id: 3, key: "done", name: "Done", colorName: "green" },
};
const S = {
  backlog: { id: "10200", name: "Backlog", statusCategory: CAT.new },
  todo: { id: "10201", name: "To Do", statusCategory: CAT.new },
  inProgress: { id: "3", name: "In Progress", statusCategory: CAT.indeterminate },
  inReview: { id: "10202", name: "In Review", statusCategory: CAT.indeterminate },
  done: { id: "10203", name: "Done", statusCategory: CAT.done },
};
type StatusKey = keyof typeof S;

const L = {
  blocks: { id: "10300", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  relates: { id: "10301", name: "Relates", inward: "relates to", outward: "relates to" },
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
  system("issuetype", "Issue Type", "issuetype"),
  system("project", "Project", "project"),
  system("status", "Status", "status"),
  system("assignee", "Assignee", "user"),
  system("parent", "Parent", "issuelink"),
  system("labels", "Labels", "array", "string"),
  system("components", "Components", "array", "component"),
  system("issuelinks", "Linked Issues", "array", "issuelinks"),
  system("updated", "Updated", "datetime"),
  system("created", "Created", "datetime"),
  custom("customfield_10201", "Owning team", "option", "com.atlassian.jira.plugin.system.customfieldtypes:select"),
  custom("customfield_10410", "Work category", "option", "com.atlassian.jira.plugin.system.customfieldtypes:select"),
];

/** The organization's team ids and the values its Owning team field holds for them. */
const TEAM: Record<string, string> = {
  "appsec-platform": "AppSec Platform", "vuln-mgmt": "Vulnerability Management", "detection-response": "Detection and Response",
  "product-eng": "Product Engineering", "dev-platform": "Developer Platform", "governance-risk": "Governance and Risk",
};
const TEAM_OPT: Record<string, string> = Object.fromEntries(Object.values(TEAM).map((v, i) => [v, String(10500 + i)]));
const CATEGORY_OPT: Record<string, string> = { "Scanner rules": "10600", Tooling: "10601", Reporting: "10602" };
const COMP: Record<string, string> = {
  "SEC/Scanners": "10700", "SEC/Triage": "10701", "SEC/Agents": "10702", "GRC/Customer assurance": "10703", "GRC/Audit": "10704",
  "INC/Customer assurance": "10705", "INC/Paging": "10706", "PLAT/Merge path": "10707", "PLAT/Inventory": "10708",
};
const ROLE: Record<string, string> = {
  vm: "Vulnerability analyst 1", vm2: "Vulnerability analyst 2", ap: "AppSec engineer 1", dr: "Responder on call",
  gr: "Governance analyst 1", dp: "Platform engineer 1", pe: "Product engineer 1",
};

/**
 * One issue. `doing` is its days in doing statuses inside the window (In Progress, then In Review when it has two
 * days or more); `start` is the day its work began, as days after the window start (negative: before the window);
 * `open` leaves it in progress at the export date, so its days run to the window's end. An issue with no doing days
 * waits in `wait` (To Do by default).
 */
interface Spec {
  key: string; type: TypeKey; summary: string; team?: string; assignee?: string;
  labels?: string[]; components?: string[]; category?: string; parent?: string;
  doing: number; start?: number; open?: boolean; wait?: StatusKey;
}

const ISSUES: Spec[] = [];
let seq: Record<ProjectKey, number> = { SEC: 1, INC: 1, GRC: 1, PLAT: 1 };
const next = (p: ProjectKey) => `${p}-${seq[p]++}`;
/** Spread `n` issues' starts over the window so each finishes inside it; `i` is the issue's place in its group. */
const spread = (i: number, n: number, days: number) => Math.max(1, Math.floor(((i + 0.5) * (88 - days)) / n));

// GRC-1 first: the epic the audit evidence work sits under. It carries no team value, so the measure leaves it out
// and counts it.
ISSUES.push({ key: next("GRC"), type: "epic", summary: "Audit evidence for the annual audit", doing: 0, wait: "todo" });
const AUDIT_EPIC = "GRC-1";

function group(p: ProjectKey, team: string, n: number, days: number[], base: Omit<Spec, "key" | "doing" | "summary" | "team">, summaries: string[], opts: { open?: number[]; clipped?: number[] } = {}) {
  if (days.length !== n || summaries.length !== n) throw new Error(`group ${summaries[0]}: ${n} issues, ${days.length} day counts, ${summaries.length} summaries`);
  days.forEach((d, i) => {
    const open = opts.open?.includes(i), clipped = opts.clipped?.includes(i);
    ISSUES.push({
      ...base, key: next(p), team, summary: summaries[i], doing: d,
      ...(d > 0 ? { start: clipped ? -4 : open ? 90 - d : spread(i, n, d) } : {}),
      ...(open ? { open: true } : {}),
    });
  });
}

// ── Vulnerability management: 400 days ──
group("SEC", "vuln-mgmt", 19, [10, 8, 6, 11, 8, 5, 9, 8, 6, 8, 9, 8, 6, 8, 5, 9, 8, 6, 14],
  { type: "task", assignee: "vm", labels: ["vuln-triage"], components: ["Triage"] },
  ["Validate the dependency findings on the billing service", "Triage the container scan of the web front end", "Confirm the secrets finding in the build scripts", "Validate the pen-test findings on the partner portal", "Triage the weekly code scan of the mobile backend", "Recheck a disputed severity on the search service", "Validate the image scan of the job runner", "Triage new findings from the dependency scanner", "Confirm a fixed finding is closed in the reports service", "Validate the code scan of the account service", "Triage the backlog of medium findings in the gateway", "Confirm the false positives from the new scanner rules", "Validate the dependency findings on the data exporter", "Triage the container scan of the queue workers", "Recheck the severity of an exposed debug endpoint", "Validate the code scan of the identity service", "Triage the findings from the partner portal retest", "Confirm duplicates across two scanners on the web app", "Triage the October scan of every internet-facing service"],
  { open: [17, 18], clipped: [0] });
ISSUES.push(
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm", summary: "Stand up the finding queue", labels: ["de-unit:intake:U-04"], doing: 45, start: 20 },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm2", summary: "Split the queue by owning team", labels: ["de-unit:intake:U-04"], doing: 32, start: 58, open: true },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm", summary: "Move open findings from the old trackers", labels: ["de-unit:intake:U-05"], doing: 30, start: 35 },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm2", summary: "Move first-seen dates with each finding", labels: ["de-unit:intake:U-05"], doing: 14, start: 76, open: true },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm", summary: "Draft the severity rules", labels: ["de-unit:intake:U-06"], doing: 40, start: 10 },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm2", summary: "Sample triaged findings against the draft severity rules", labels: ["de-unit:intake:U-06", "vuln-triage"], doing: 28, start: 62, open: true },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", summary: "A queue view for each team", labels: ["de-unit:intake:U-07"], doing: 0, wait: "todo" },
  { key: next("SEC"), type: "story", team: "vuln-mgmt", assignee: "vm", summary: "Accept the normalized record format", labels: ["de-unit:intake:U-01"], doing: 19, start: 40 },
);
group("SEC", "vuln-mgmt", 5, [8, 6, 10, 7, 9], { type: "task", assignee: "vm2" },
  ["Answer an auditor's question about finding age", "Clean up the triage team's saved searches", "Queue migration notes from the old tracker", "Onboard a new analyst to the scanners", "Write the triage handbook's escalation page"]);
ISSUES[ISSUES.length - 3].labels = ["de-unit:U-04"]; // a bare unit label: a lone instance's label, not design work here

// ── AppSec platform: 200 days ──
group("SEC", "appsec-platform", 4, [7, 5, 6, 6], { type: "pentest", assignee: "ap" },
  ["Scope the partner portal pen test", "Coordinate the mobile backend pen test", "Schedule the retest of the gateway findings", "Brief the testers on the identity service"]);
group("SEC", "appsec-platform", 6, [8, 6, 7, 5, 9, 5], { type: "task", assignee: "ap", category: "Scanner rules", components: ["Scanners"] },
  ["Tune the code scanner's injection rules", "Silence a noisy dependency rule", "Add a rule for the new template engine", "Update rule severities after the vendor release", "Rewrite the secrets rules for the new key format", "Retire three rules nobody triggers"], { clipped: [0] });
ISSUES.push(
  { key: next("SEC"), type: "story", team: "appsec-platform", assignee: "ap", summary: "Normalize the code scanners' output", labels: ["de-unit:intake:U-01"], doing: 30, start: 8 },
  { key: next("SEC"), type: "story", team: "appsec-platform", assignee: "ap", summary: "Map each scanner's severities", labels: ["de-unit:intake:U-01"], doing: 22, start: 45 },
  { key: next("SEC"), type: "story", team: "appsec-platform", assignee: "ap", summary: "Read pen-test reports into findings", labels: ["de-unit:intake:U-02"], doing: 24, start: 66, open: true },
  { key: next("SEC"), type: "story", team: "appsec-platform", assignee: "ap", summary: "Parse the pen testers' report template", labels: ["de-unit:intake:U-02"], doing: 15, start: 50 },
  { key: next("SEC"), type: "story", team: "appsec-platform", summary: "Fold repeats across scanners", labels: ["de-unit:intake:U-03"], doing: 0, wait: "todo" },
  { key: next("SEC"), type: "story", team: "appsec-platform", summary: "Catalog the starter checks per repository", labels: ["de-unit:premerge:U-03"], doing: 0, wait: "todo" },
  { key: next("SEC"), type: "story", team: "appsec-platform", summary: "Drop the per-scanner severity rules", labels: ["de-unit:intake:U-10"], doing: 0, wait: "backlog" },
  { key: next("SEC"), type: "task", team: "appsec-platform", assignee: "ap", summary: "Draft the check catalog's schema", labels: ["de-unit:premerge:U-03"], doing: 13, start: 30 },
  { key: next("SEC"), type: "task", team: "appsec-platform", assignee: "ap", summary: "Prototype folding repeats in one scanner", labels: ["de-unit:intake:U-03"], doing: 12, start: 15 },
);
group("SEC", "appsec-platform", 3, [8, 7, 5], { type: "task", assignee: "ap" },
  ["Renew the scanners' license keys", "Answer the developer survey on scan noise", "Move the scanner dashboards to the new host"]);

// ── Detection and response: 200 days ──
group("INC", "detection-response", 18, [6, 4, 7, 5, 8, 3, 6, 5, 4, 6, 7, 5, 4, 6, 5, 8, 4, 6], { type: "incident", assignee: "dr", components: ["Paging"] },
  ["Credential stuffing against the login page", "Unusual outbound traffic from a build agent", "Phishing report from the support team", "Expired certificate on a partner endpoint", "Malware alert on a contractor laptop", "Public bucket found by an outside researcher", "Leaked token in a public repository", "Denial of service on the status page", "Suspicious admin login at night", "Ransom note sent to a shared inbox", "Bot traffic on the signup form", "Exposed debug endpoint reported by a customer", "Impossible travel on a service account", "Vulnerable library exploited in a test environment", "Spike in failed logins on the API", "Data export by a departing employee", "Alert storm from a misconfigured rule", "Suspicious process on a database host"],
  { open: [17] });
ISSUES.push({ key: next("INC"), type: "incident", team: "detection-response", assignee: "dr", summary: "Customer reports a session that stayed logged in", components: ["Customer assurance"], doing: 5, start: 70 });
ISSUES.push(
  { key: next("PLAT"), type: "story", team: "detection-response", assignee: "dr", summary: "Read owners from the asset list into alerts", labels: ["de-unit:inventory:U-10"], doing: 11, start: 79, open: true },
  { key: next("PLAT"), type: "story", team: "detection-response", assignee: "dr", summary: "Design the alert owner field", labels: ["de-unit:inventory:U-10"], doing: 25, start: 30 },
  { key: next("PLAT"), type: "story", team: "detection-response", assignee: "dr", summary: "Page the owning team first", labels: ["de-unit:inventory:U-11"], doing: 8, start: 82, open: true },
  { key: next("PLAT"), type: "story", team: "detection-response", assignee: "dr", summary: "Map on-call rotations to teams", labels: ["de-unit:inventory:U-11"], doing: 14, start: 50 },
  { key: next("PLAT"), type: "task", team: "detection-response", assignee: "dr", summary: "Test owner lookups against last month's alerts", labels: ["de-unit:inventory:U-10"], doing: 18, start: 55 },
);
// unclassified, so outside project INC (every INC issue is incident on-call)
group("SEC", "detection-response", 2, [12, 8], { type: "task", assignee: "dr" },
  ["Rewrite the on-call runbook index", "Clean up stale detection rules"]);

// ── Governance and risk: 150 days ──
group("GRC", "governance-risk", 5, [9, 6, 8, 7, 6], { type: "task", assignee: "gr", parent: AUDIT_EPIC, components: ["Audit"] },
  ["Gather access review evidence", "Collect change approval samples", "Export the asset ownership evidence", "Screenshot the backup settings", "Collect the incident response test record"], { clipped: [0] });
group("GRC", "governance-risk", 6, [8, 7, 6, 9, 5, 7], { type: "task", assignee: "gr", components: ["Customer assurance"] },
  ["Answer a customer's security questionnaire on hosting", "Answer a prospect's questionnaire on encryption", "Update the standard answers on data retention", "Answer a customer's follow-up on subprocessors", "Fill in a short vendor form for a partner", "Answer a customer's questionnaire on incident handling"]);
ISSUES.push(
  { key: next("GRC"), type: "story", team: "governance-risk", assignee: "gr", summary: "List every cloud account with its tags", labels: ["de-unit:inventory:U-02"], doing: 15, start: 40 },
  { key: next("GRC"), type: "story", team: "governance-risk", assignee: "gr", summary: "Write the audit export from the list", labels: ["de-unit:inventory:U-03"], doing: 14, start: 60 },
  { key: next("GRC"), type: "story", team: "governance-risk", assignee: "gr", summary: "Reconcile owners into one list", labels: ["de-unit:inventory:U-04"], doing: 12, start: 78, open: true },
  { key: next("GRC"), type: "story", team: "governance-risk", assignee: "gr", summary: "Match accounts to teams by their tags", labels: ["de-unit:inventory:U-04"], doing: 10, start: 66 },
  { key: next("GRC"), type: "task", team: "governance-risk", assignee: "gr", summary: "Ask stewards to confirm a first sample of owners", labels: ["de-unit:inventory:U-04"], doing: 6, start: 72 },
);
group("GRC", "governance-risk", 2, [9, 6], { type: "task", assignee: "gr" },
  ["Refresh the risk register's owners", "Prepare the quarterly risk review deck"]);

// ── Developer platform: 80 days ──
ISSUES.push(
  { key: next("PLAT"), type: "story", team: "dev-platform", assignee: "dp", summary: "Hook merge requests in the pilot repositories", labels: ["de-unit:premerge:U-01"], doing: 20, start: 30 },
  { key: next("PLAT"), type: "story", team: "dev-platform", assignee: "dp", summary: "Hook merge requests in the next five repositories", labels: ["de-unit:premerge:U-01"], doing: 12, start: 55 },
  { key: next("PLAT"), type: "story", team: "dev-platform", assignee: "dp", summary: "Run the starter checks on every change", labels: ["de-unit:premerge:U-02"], doing: 18, start: 72, open: true },
  { key: next("PLAT"), type: "task", team: "dev-platform", assignee: "dp", summary: "Pick the starter checks", labels: ["de-unit:premerge:U-02"], doing: 6, start: 60 },
  { key: next("PLAT"), type: "story", team: "dev-platform", assignee: "dp", summary: "Crawl every repository's settings", labels: ["de-unit:inventory:U-01"], doing: 12, start: 25 },
  { key: next("PLAT"), type: "story", team: "dev-platform", summary: "Serve asset owners to intake", labels: ["de-unit:inventory:U-05"], doing: 0, wait: "todo" },
  { key: next("PLAT"), type: "story", team: "dev-platform", summary: "Switch off the nightly scan scripts", labels: ["de-unit:inventory:U-07"], doing: 0, wait: "backlog" },
);
group("PLAT", "dev-platform", 3, [5, 4, 3], { type: "task", assignee: "dp" },
  ["Upgrade the CI runners", "Rotate the build cache keys", "Fix a flaky deploy step"]);

// ── Product engineering: 60 days ──
ISSUES.push(
  { key: next("PLAT"), type: "story", team: "product-eng", assignee: "pe", summary: "Fix agent proposes a fix on the merge request", labels: ["de-unit:premerge:U-04"], doing: 14, start: 76, open: true },
  { key: next("PLAT"), type: "task", team: "product-eng", assignee: "pe", summary: "Choose the classes the fix agent starts with", labels: ["de-unit:premerge:U-04"], doing: 9, start: 50 },
  { key: next("PLAT"), type: "story", team: "product-eng", assignee: "pe", summary: "Agent retests its fix before review", labels: ["de-unit:premerge:U-05"], doing: 6, start: 84, open: true },
  { key: next("PLAT"), type: "story", team: "product-eng", assignee: "pe", summary: "Require an approval bound to the fix's commit", labels: ["de-unit:premerge:U-06"], doing: 7, start: 83, open: true },
  { key: next("PLAT"), type: "task", team: "product-eng", assignee: "pe", summary: "Trial the fix agent on three classes", labels: ["de-unit:premerge:U-04"], doing: 15, start: 20 },
  { key: next("PLAT"), type: "task", team: "product-eng", summary: "Review the fix agent's prompts with security", labels: ["de-unit:premerge:U-04"], doing: 0, wait: "todo" },
);
group("PLAT", "product-eng", 2, [5, 4], { type: "task", assignee: "pe" },
  ["Pair with the platform team on the merge hook", "Write up the fix agent trial"]);

// ── No team value: left out of every share and counted ──
ISSUES.push(
  { key: next("SEC"), type: "task", summary: "Rotate the shared demo credentials", doing: 3, start: 44 },
  { key: next("INC"), type: "incident", summary: "Unassigned alert from a retired service", doing: 2, start: 61 },
  { key: next("GRC"), type: "task", summary: "Badge reader logs request", doing: 4, start: 12 },
  { key: next("PLAT"), type: "task", summary: "Tidy the platform wiki", doing: 0, wait: "backlog" },
);

// ── Build the responses ──
const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "+0000");
const idOf = (key: string) => { const [p, n] = key.split("-"); return String(20000 + Object.keys(PROJECTS).indexOf(p) * 1000 + Number(n)); };
const byKey = new Map(ISSUES.map((s) => [s.key, s]));

/** The issue's status changes, oldest first, and when it was created. */
function timeline(s: Spec): { created: number; steps: [StatusKey, number][]; status: StatusKey } {
  if (!s.doing) { const created = W0 + 30 * DAY; return { created, steps: [], status: s.wait ?? "todo" }; }
  const start = W0 + (s.start ?? 0) * DAY;
  const created = start - 2 * DAY;
  if (s.open) {
    const days = (W1 - Math.max(start, W0)) / DAY;
    if (days !== s.doing) throw new Error(`${s.key}: open from day ${s.start}, so ${days} days in the window, not ${s.doing}`);
    const review = s.doing >= 12 ? start + Math.ceil(s.doing / 2) * DAY : 0; // recent work is still In Progress
    return review ? { created, steps: [["inProgress", start], ["inReview", review]], status: "inReview" } : { created, steps: [["inProgress", start]], status: "inProgress" };
  }
  // a finished issue: its window days are s.doing; a clipped one started before the window and keeps 4 more days
  const total = s.doing + (start < W0 ? (W0 - start) / DAY : 0);
  const end = start + total * DAY;
  if (end > W1) throw new Error(`${s.key}: finishes after the export date`);
  const steps: [StatusKey, number][] = [["inProgress", start]];
  if (total >= 2) steps.push(["inReview", start + Math.floor(total / 2) * DAY]);
  steps.push(["done", end]);
  return { created, steps, status: "done" };
}

function issue(s: Spec) {
  const project = PROJECTS[s.key.split("-")[0] as ProjectKey];
  const t = timeline(s);
  let prev: StatusKey = "todo";
  const histories = t.steps.map(([to, at], k) => {
    const h = { id: `${idOf(s.key)}${k}`, author: { accountId: "acct-board", displayName: "Board automation", active: true }, created: iso(at),
      items: [{ field: "status", fieldtype: "jira", fieldId: "status", from: S[prev].id, fromString: S[prev].name, to: S[to].id, toString: S[to].name }] };
    prev = to;
    return h;
  });
  const updated = t.steps.length ? t.steps[t.steps.length - 1][1] : t.created;
  const parent = s.parent ? byKey.get(s.parent)! : undefined;
  const fields: Record<string, unknown> = {
    summary: s.summary,
    issuetype: { self: `${BASE}/rest/api/3/issuetype/${T[s.type].id}`, ...T[s.type] },
    project: { self: `${BASE}/rest/api/3/project/${project.id}`, ...project, projectTypeKey: "software", simplified: false },
    status: { self: `${BASE}/rest/api/3/status/${S[t.status].id}`, ...S[t.status] },
    assignee: s.assignee ? { accountId: `acct-${s.assignee}`, displayName: ROLE[s.assignee], active: true, accountType: "atlassian" } : null,
    labels: s.labels ?? [],
    components: (s.components ?? []).map((c) => { const id = COMP[`${project.key}/${c}`]; if (!id) throw new Error(`${s.key}: no component ${c} in ${project.key}`); return { self: `${BASE}/rest/api/3/component/${id}`, id, name: c }; }),
    issuelinks: [],
    created: iso(t.created),
    updated: iso(updated),
    customfield_10201: s.team ? { self: `${BASE}/rest/api/3/customFieldOption/${TEAM_OPT[TEAM[s.team]]}`, value: TEAM[s.team], id: TEAM_OPT[TEAM[s.team]] } : null,
    customfield_10410: s.category ? { self: `${BASE}/rest/api/3/customFieldOption/${CATEGORY_OPT[s.category]}`, value: s.category, id: CATEGORY_OPT[s.category] } : null,
  };
  if (parent) fields.parent = { id: idOf(parent.key), key: parent.key, self: `${BASE}/rest/api/3/issue/${idOf(parent.key)}`, fields: { summary: parent.summary, status: S[timeline(parent).status], issuetype: T[parent.type] } };
  return { expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations", id: idOf(s.key), self: `${BASE}/rest/api/3/issue/${idOf(s.key)}`, key: s.key, fields,
    changelog: { startAt: 0, maxResults: histories.length, total: histories.length, histories } };
}

const all = ISSUES.map(issue);
const half = Math.ceil(all.length / 2);
const write = (name: string, v: unknown) => Bun.write(join(OUT, name), JSON.stringify(v, null, 2) + "\n");

mkdirSync(OUT, { recursive: true });
await write("serverInfo.json", { baseUrl: BASE, displayUrl: BASE, version: "1001.0.0-SNAPSHOT", versionNumbers: [1001, 0, 0], deploymentType: "Cloud", buildNumber: 100270, serverTime: iso(W1), serverTitle: "Jira" });
await write("project.json", {
  self: `${BASE}/rest/api/3/project/search?maxResults=50&startAt=0`, maxResults: 50, startAt: 0, total: 4, isLast: true,
  values: Object.values(PROJECTS).map((p) => ({ expand: "description,lead,issueTypes,url,projectKeys,permissions,insight", self: `${BASE}/rest/api/3/project/${p.id}`, ...p, projectTypeKey: "software", simplified: false, style: "classic", isPrivate: false })),
});
await write("issuetype.json", Object.values(T).map((t) => ({ self: `${BASE}/rest/api/3/issuetype/${t.id}`, description: "", iconUrl: `${BASE}/images/icons/issuetypes/${t.name.toLowerCase().replace(/\s+/g, "-")}.svg`, untranslatedName: t.name, avatarId: 10300, ...t })));
await write("field.json", FIELDS);
await write("issueLinkType.json", { issueLinkTypes: Object.values(L).map((l) => ({ ...l, self: `${BASE}/rest/api/3/issueLinkType/${l.id}` })) });
await write("status.json", Object.values(S).map((s) => ({ self: `${BASE}/rest/api/3/status/${s.id}`, description: "", iconUrl: `${BASE}/images/icons/statuses/generic.png`, untranslatedName: s.name, ...s, statusCategory: { self: `${BASE}/rest/api/3/statuscategory/${s.statusCategory.id}`, ...s.statusCategory } })));
await write("search-1.json", { issues: all.slice(0, half), nextPageToken: "page-2", isLast: false });
await write("search-2.json", { issues: all.slice(half), isLast: true });
console.log(`wrote ${all.length} issues and 6 metadata responses to ${OUT}`);
