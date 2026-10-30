import { EX_DIR } from "./example-dirs.ts";
// BAU measured from the tracker. The org mapping (kind: org)
// and its checks against the inventory, where each issue lands (design work, an activity, unclassified), days in doing
// clipped to the window, the count fallback, coverage and confidence, Little's law and its floors, the measure snapshots,
// the drafted refresh (proposed, named, changing nothing until accepted), the tracker pack on a root, namespaced unit
// labels, and what the root's bundle carries. Acceptance: examples/README.md's "Measured from the tracker" and P-005,
// which a measure of the example export reproduces. Every test that writes works on a temporary copy.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRaw } from "../src/tracker/raw.ts";
import { discoverJira } from "../src/tracker/jira/discover.ts";
import { readJiraState } from "../src/tracker/jira/state.ts";
import { adapter as jira } from "../src/tracker/jira/index.ts";
import { normalizeMapping } from "../src/tracker/mapping.ts";
import { validateOrgMapping } from "../src/tracker/validate.ts";
import { COUNT_LABEL, confidenceOf, designLabel, measureBau, type BauInput } from "../src/tracker/bau.ts";
import { attachMeasured, gapOf, loadMeasures, readCalibration, snapshotText, writeMeasure } from "../src/tracker/measures.ts";
import { draftRefresh, nextPatchId } from "../src/tracker/refresh.ts";
import { loadTracker } from "../src/tracker/load.ts";
import { reconcile } from "../src/tracker/reconcile.ts";
import { bundleTracker } from "../src/tracker/bundle.ts";
import { loadRoot } from "../src/core/root.ts";
import { readOrgView } from "../src/core/org.ts";
import { buildRoot, checkRoot } from "../src/core/root-build.ts";
import { loadInstance } from "../src/core/load.ts";
import { compile } from "../src/core/compile.ts";
import { buildContext } from "../src/core/rules.ts";
import { pack as trackerPack } from "../packs/tracker/index.ts";
import type { Finding, MeasureSnapshot, TrackerIssue, TrackerMapping } from "../src/types.ts";

const DE = join(import.meta.dir, "..");
const EX = EX_DIR;
const HAVE_EX = existsSync(join(EX, "shared/tracker/mapping.yaml"));
const testEx = test.skipIf(!HAVE_EX);
const DAY = 86_400_000;

const tmp = (tag: string) => mkdtempSync(join(tmpdir(), `plumb-meas04-${tag}-`));
const edit = (path: string, f: (s: string) => string) => writeFileSync(path, f(readFileSync(path, "utf8")));
/** A copy of the example portfolio (root and designs). */
function examples(): string { const d = tmp("ex"); cpSync(EX, d, { recursive: true }); return d; }
const run = (args: string[]) => { const r = Bun.spawnSync(["bun", join(DE, "plumb.ts"), ...args], { cwd: DE, stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };

// ── a small fictional Jira export, written the way an agent saves one ─────────────────────────────────────────────

const END = Date.parse("2026-03-01T00:00:00Z");
/** An ISO time `n` days after the window's start, for a window of `w` days ending at END. */
const at = (n: number, w = 30) => new Date(END - w * DAY + n * DAY).toISOString();
const CAT = { "Backlog": "new", "To Do": "new", "In Progress": "indeterminate", "In Review": "indeterminate", "Done": "done" } as const;
const TYPES = { Story: { id: "1", level: 0 }, Task: { id: "2", level: 0 }, Epic: { id: "3", level: 1 }, "Sub-task": { id: "4", level: -1, subtask: true } } as const;
interface Syn { key: string; type?: keyof typeof TYPES; team?: string; labels?: string[]; components?: string[]; parent?: string; created: string; status: keyof typeof CAT; steps?: [keyof typeof CAT, string][] }

function writeExport(dir: string, issues: Syn[], opts: { serverTime?: string; changelog?: boolean } = {}) {
  mkdirSync(dir, { recursive: true });
  const st = (n: keyof typeof CAT) => ({ name: n, id: n, statusCategory: { key: CAT[n], name: CAT[n] === "new" ? "To Do" : CAT[n] === "done" ? "Done" : "In Progress" } });
  const w = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v, null, 1));
  if (opts.serverTime) w("serverInfo.json", { baseUrl: "https://tracker.example.test", version: "1001.0.0", versionNumbers: [1001, 0, 0], deploymentType: "Cloud", serverTime: opts.serverTime });
  w("status.json", (Object.keys(CAT) as (keyof typeof CAT)[]).map(st));
  w("issuetype.json", Object.entries(TYPES).map(([name, t]) => ({ id: t.id, name, subtask: "subtask" in t, hierarchyLevel: t.level })));
  w("field.json", [{ id: "customfield_1", key: "customfield_1", name: "Owning team", custom: true, navigable: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select" } }, { id: "parent", name: "Parent", custom: false, schema: { type: "issuelink", system: "parent" } }]);
  w("project.json", { values: [{ id: "100", key: "OPS", name: "Operations", projectTypeKey: "software", simplified: false, style: "classic" }] });
  w("search-1.json", {
    isLast: true,
    issues: issues.map((s, i) => {
      const t = TYPES[s.type ?? "Task"];
      let prev: keyof typeof CAT = "To Do";
      const histories = (s.steps ?? []).map(([to, when], k) => { const h = { id: `${i}${k}`, created: when, items: [{ field: "status", fromString: prev, toString: to }] }; prev = to; return h; });
      return {
        id: String(1000 + i), key: s.key,
        fields: {
          summary: `Issue ${s.key}`, issuetype: { id: t.id, name: s.type ?? "Task", subtask: "subtask" in t, hierarchyLevel: t.level },
          project: { id: "100", key: "OPS", name: "Operations" }, status: st(s.status),
          labels: s.labels ?? [], components: (s.components ?? []).map((c) => ({ name: c })),
          customfield_1: s.team ? { value: s.team, id: s.team } : null,
          ...(s.parent ? { parent: { key: s.parent } } : {}),
          created: s.created, updated: s.steps?.length ? s.steps[s.steps.length - 1][1] : s.created,
        },
        ...(opts.changelog === false ? {} : { changelog: { histories } }),
      };
    }),
  });
}

const MAP = (extra = "") => normalizeMapping(Bun.YAML.parse(`adapter: jira
kind: org
team: { as: custom-field, field: customfield_1, match: { ta: Team A, tb: Team B } }
status: { by: name, map: { Backlog: todo, "To Do": todo, "In Progress": doing, "In Review": doing, Done: done } }
window_days: 30
activities:
  - { activity: chores, match: { labels: [chore] } }
  - { activity: upkeep, match: { components: [Upkeep] } }
  - { activity: b-support, match: { labels: [support] } }
flow_items: { Task: risk, Story: feature }
${extra}`));
const TEAMS = [{ id: "ta", name: "Team A" }, { id: "tb", name: "Team B" }];
const ACTS = [{ id: "chores", name: "Chores", team: "ta" }, { id: "upkeep", name: "Upkeep", team: "ta" }, { id: "b-support", name: "Support", team: "tb" }];

/** Measure a synthetic export. */
function measureSyn(issues: Syn[], o: { changelog?: boolean; serverTime?: string; mapping?: TrackerMapping; end?: string; designs?: BauInput["designs"] } = {}): MeasureSnapshot {
  const dir = tmp("syn");
  writeExport(dir, issues, { ...(o.changelog === false ? { changelog: false } : {}), serverTime: o.serverTime ?? new Date(END).toISOString() });
  const raw = readRaw(dir), inv = discoverJira(raw);
  const { mapping, problems } = o.mapping ? { mapping: o.mapping, problems: [] } : MAP();
  expect(problems).toEqual([]);
  return measureBau({
    issues: readJiraState(raw, inv), inventory: inv, mapping: mapping!, teams: TEAMS, activities: ACTS,
    end: { at: o.end ?? jira.exportedAt!(raw)!, from: "export" }, measured: "2026-03-02", source: { dir: "x", files: [] }, mappingSha256: "x",
    ...(o.designs ? { designs: o.designs } : {}),
  });
}
const team = (s: MeasureSnapshot, id: string) => s.teams.find((t) => t.team === id)!;
const row = (s: MeasureSnapshot, key: string) => s.issues.find((i) => i.key === key);

// ── the org mapping ────────────────────────────────────────────────────────────────────────────────────────────────

describe("the org mapping (kind: org)", () => {
  test("reads team into owner_team, defaults the window and the design prefix, and keeps the rules in order", () => {
    const { mapping, problems } = normalizeMapping({ kind: "org", team: { as: "custom-field", field: "cf", match: { a: "A" } }, status: { by: "name", map: { Doing: "doing" } }, activities: [{ activity: "x", match: { project: "P", labels: ["l"] } }, { activity: "y", match: { field: { cf2: "v" }, parent: "E-1" } }], flow_items: { Bug: "defect" } });
    expect(problems).toEqual([]);
    expect(mapping!.kind).toBe("org");
    expect(mapping!.owner_team).toEqual({ as: "custom-field", field: "cf", match: { a: "A" } });
    expect(mapping!.org).toEqual({ window_days: 90, designs: { label_prefix: "de-unit:" }, activities: [{ activity: "x", match: { project: ["P"], labels: ["l"] } }, { activity: "y", match: { field: { cf2: ["v"] }, parent: ["E-1"] } }], flow_items: { Bug: "defect" } });
  });

  test("shape problems are said in words", () => {
    const { problems } = normalizeMapping({ kind: "org", phase: { as: "epic" }, team: { as: "custom-field", match: {} }, window_days: 0, activities: [{ match: { labels: ["x"] } }, { activity: "a", match: { colour: "red" } }, { activity: "b" }], flow_items: { Bug: "bug" } });
    expect(problems).toEqual([
      "phase belongs to a design's own mapping; an org mapping (kind: org) measures the teams' standing work and has no phase",
      "team.field is missing: name the custom field that holds the team",
      "team.match is empty: map each org team id to the value the tracker holds for it",
      "window_days is 0; give a whole number of days of at least 1 (default 90)",
      "activities[1] names no activity (activity: <org activity id>)",
      "activities[2] (a): match.colour is not something a rule matches on; use project, type, labels, components, parent, field",
      "activities[2] (a) matches on nothing, so no issue lands in it",
      "activities[3] (b) has no match: give at least one of project, type, labels, components, parent, field",
      'flow_items."Bug" is "bug"; give each issue type one of feature, defect, risk, debt',
    ]);
  });

  test("a design's own mapping reads exactly as before: no kind, no org section, its problems in their old order", () => {
    const { mapping, problems } = normalizeMapping({ phase: { as: "sprint" }, status: { by: "colour" } });
    expect(problems).toEqual(['phase.as is "sprint"; choose one of epic, initiative, fix-version, label', "unit.issue_type is missing: name the issue type a unit becomes", 'status.by is "colour"; choose category or name']);
    expect("kind" in mapping! || "org" in mapping!).toBe(false);
  });
});

// ── the mapping against the inventory ──────────────────────────────────────────────────────────────────────────────

describe("mapping names checked against the inventory", () => {
  testEx("the example's org mapping names only what the export and the org layer hold (README: mapping-matches-inventory reports nothing)", () => {
    const t = loadTracker(join(EX, "shared"))!;
    const v = readOrgView(loadRoot(join(EX, "shared")), { today: "2026-11-16" })!;
    expect(validateOrgMapping(t.mapping!, t.inventory!, { teams: v.teams, activities: v.activities.map((a) => ({ ...a, team: a.team.slice(4) })) })).toEqual([]);
  });

  testEx("every kind of name the mapping can get wrong is one problem", () => {
    const t = loadTracker(join(EX, "shared"))!;
    const v = readOrgView(loadRoot(join(EX, "shared")), { today: "2026-11-16" })!;
    const text = readFileSync(join(EX, "shared/tracker/mapping.yaml"), "utf8")
      .replace("customfield_10201", "customfield_99").replace("map: { Backlog: todo,", "map: { Parked: todo, Backlog: todo,")
      .replace("labels: [vuln-triage]", "labels: [vuln-triag]").replace(`type: ["Pen test"]`, `type: ["Pentest"]`).replace("project: INC", "project: INCI")
      .replace(`components: ["Customer assurance"]`, `components: ["Customer assurances"]`).replace("parent: GRC-1", "parent: GRC-9")
      .replace("customfield_10410: Scanner rules", "customfield_10410: Scanner rulez").replace(`"Pen test": risk`, `"Pentest": risk`)
      + "\n# an activity the org layer does not hold, and a team field value no issue carries\n";
    const m = normalizeMapping(Bun.YAML.parse(text.replace("  - { activity: vuln-triage", "  - { activity: patching, match: { labels: [vuln-triage] } }\n  - { activity: vuln-triage"))).mapping!;
    const got = validateOrgMapping(m, t.inventory!, { teams: v.teams, activities: v.activities.map((a) => ({ ...a, team: a.team.slice(4) })) });
    expect(got.filter((p) => p.kind === "missing").map((p) => p.message.replace(/ \((projects|types|components|values): .*\)$/, ""))).toEqual([
      "team.field customfield_99 is not a field in the inventory",
      'status.map names status "Parked", which is not in the inventory',
      "activities[1] (patching) names the activity patching, which the org layer does not hold",
      'activities[2] (vuln-triage) matches label "vuln-triag", which no issue carries',
      'activities[3] (pentest-coordination) matches issue type "Pentest", which is not in the inventory',
      "activities[4] (incident-oncall) matches project INCI, which is not in the inventory",
      'activities[5] (questionnaires) matches component "Customer assurances", which no issue carries',
      "activities[6] (audit-evidence) matches parent GRC-9, which is not an epic or above in the export",
      'activities[7] (scanner-rule-upkeep) matches Work category (customfield_10410) "Scanner rulez", which no issue carries',
      'flow_items names issue type "Pentest", which is not in the inventory',
    ]);
  });

  testEx("the root's own build runs the tracker pack: clean on the example, an error for a wrong name, a warning for a team the mapping leaves out", async () => {
    const d = examples();
    const tr = (fs: Finding[]) => fs.filter((f) => f.pack === "tracker").map((f) => `${f.rule} ${f.severity}: ${f.message}`);
    expect(tr((await checkRoot(join(d, "shared"), { built: "2026-11-16T10:00:00Z" })).findings)).toEqual([]);
    edit(join(d, "shared/tracker/mapping.yaml"), (s) => s.replace("labels: [vuln-triage]", "labels: [vuln-triag]").replace("    governance-risk: Governance and Risk\n", ""));
    expect(tr((await checkRoot(join(d, "shared"), { built: "2026-11-16T10:00:00Z" })).findings).sort()).toEqual([
      "mapping-covers warning: team governance-risk (Governance and risk) has no value in team.match, so its issues count for no team",
      'mapping-matches-inventory error: activities[1] (vuln-triage) matches label "vuln-triag", which no issue carries',
    ]);
  });

  testEx("a design's own mapping put in a root is an error, and never reconciled", async () => {
    const d = examples();
    cpSync(join(DE, "examples/delivery-stream/tracker/mapping.yaml"), join(d, "shared/tracker/mapping.yaml"));
    const fs = (await checkRoot(join(d, "shared"), { built: "2026-11-16T10:00:00Z" })).findings.filter((f) => f.pack === "tracker");
    expect(fs.map((f) => f.rule)).toEqual(["mapping-matches-inventory"]);
    expect(fs[0].message).toStartWith("a shared root's tracker/mapping.yaml says kind: org");
  });
});

// ── where each issue lands, and the shares ─────────────────────────────────────────────────────────────────────────

/** The example measured as examples/README.md says: the 90 days to the export's date, 2026-11-01. */
function measureExample(dir = join(EX, "shared")): MeasureSnapshot {
  const root = loadRoot(dir);
  const v = readOrgView(root, { today: "2026-11-02" })!;
  const t = loadTracker(dir)!;
  return measureBau({
    issues: t.issues!, inventory: t.inventory!, mapping: t.mapping!, teams: v.teams.map((x) => ({ id: x.id, name: x.name })),
    activities: v.activities.map((a) => ({ id: a.id, name: a.name, team: a.team.slice(4) })),
    end: { at: t.exportedAt!, from: "export" }, measured: "2026-11-02", source: { dir: "tracker/export", files: [] }, mappingSha256: "x",
  });
}

describe("classification and shares on the example export", () => {
  testEx("README's table: days in doing, each activity's share, unclassified time, coverage, issues and confidence per team", () => {
    const s = measureExample();
    expect(s.window).toEqual({ from: "2026-08-03T00:00:00Z", to: "2026-11-01T00:00:00Z", days: 90 });
    expect(s.export.at_from).toBe("export");
    expect(s.mode).toBe("time");
    expect(s.totals).toEqual({ issues: 121, counted: 116, left_out: { no_team: 5, other_team: 0, container: 0, subtask: 0, before_window: 0, after_window: 0 } });
    const table = s.teams.map((t) => [t.name, t.days, t.activities.map((a) => `${a.activity} ${a.share}`).join(", ") || "none", t.unclassified.days, t.coverage, t.issues, t.confidence]);
    expect(table).toEqual([
      ["AppSec platform", 200, "pentest-coordination 0.12, scanner-rule-upkeep 0.2", 20, 0.9, 22, "medium"],
      ["Vulnerability management", 400, "vuln-triage 0.38", 40, 0.9, 32, "high"],
      ["Detection and response", 200, "incident-oncall 0.52", 20, 0.9, 26, "medium"],
      ["Product engineering", 60, "none", 9, 0.85, 8, "low"],
      ["Developer platform", 80, "none", 12, 0.85, 10, "medium"],
      ["Governance and risk", 150, "audit-evidence 0.24, questionnaires 0.28", 15, 0.9, 18, "medium"],
    ]);
    // every team's buckets add up to its days
    for (const t of s.teams) expect(t.design.days + t.activities.reduce((n, a) => n + a.days, 0) + t.unclassified.days).toBeCloseTo(t.days, 6);
    expect(team(s, "vuln-mgmt").design).toEqual({ issues: 8, days: 208, share: 0.52, by: { intake: 208 } });
  });

  testEx("bucket precedence: design work first, a bare unit label is not design work, and the first matching rule wins", () => {
    const s = measureExample();
    expect(row(s, "SEC-25")).toMatchObject({ bucket: "design", of: "intake:U-06", via: "label" }); // also labelled vuln-triage
    expect(row(s, "SEC-30")).toMatchObject({ bucket: "unclassified" });                            // de-unit:U-04, bare
    expect(row(s, "INC-19")).toMatchObject({ bucket: "activity", of: "incident-oncall" });         // INC with Customer assurance
    expect(s.issues.filter((i) => i.bucket === "design").every((i) => /^[a-z]+:U-\d+$/.test(i.of!))).toBe(true);
  });

  test("an activity rule takes only its own team's issues; another team's matching issue stays unclassified, with a note", () => {
    const s = measureSyn([
      { key: "OPS-1", team: "Team A", labels: ["chore"], created: at(1), status: "Done", steps: [["In Progress", at(2)], ["Done", at(6)]] },
      { key: "OPS-2", team: "Team B", labels: ["chore"], created: at(1), status: "Done", steps: [["In Progress", at(2)], ["Done", at(5)]] },
      { key: "OPS-3", team: "Team B", labels: ["support"], created: at(1), status: "Done", steps: [["In Progress", at(2)], ["Done", at(3)]] },
    ]);
    expect([row(s, "OPS-1")!.of, row(s, "OPS-2")!.bucket, row(s, "OPS-3")!.of]).toEqual(["chores", "unclassified", "b-support"]);
    expect(team(s, "tb").activities).toEqual([{ activity: "b-support", name: "Support", issues: 1, days: 1, share: 0.25 }]);
    expect(team(s, "tb").notes).toEqual(["1 of its unclassified issues (3 days) matches the rule for Chores, an activity of Team A; it counts as Team B's own. If this is Team B's standing work, give it an activity of its own."]);
    expect(team(s, "ta").notes).toEqual([]); // upkeep has a rule, so both of Team A's activities are measured
  });

  testEx("--portfolio reads each composed design's tracker/links.yaml: a linked issue is design work, and the measure says whose links it read", () => {
    const d = examples();
    mkdirSync(join(d, "designs/intake/tracker"), { recursive: true });
    writeFileSync(join(d, "designs/intake/tracker/links.yaml"), "U-07:\n  issue: SEC-28\n  confirmed_by: the vulnerability management lead\n  confirmed_at: \"2026-10-20\"\n");
    rmSync(join(d, "shared/tracker/measures"), { recursive: true });
    const r = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02", "--portfolio", join(d, "portfolio/portfolio.yaml")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("design work: labels de-unit:<namespace>:<unit>, and the tracker/links.yaml of intake");
    const s = JSON.parse(readFileSync(join(d, "shared/tracker/measures/2026-11-01.json"), "utf8")) as MeasureSnapshot;
    expect(s.designs).toEqual({ label_prefix: "de-unit:", links: ["intake"], portfolio: "../portfolio/portfolio.yaml" });
    expect(row(s, "SEC-28")).toMatchObject({ bucket: "design", of: "intake:U-07", via: "links", days: 8 });
    expect([team(s, "vuln-mgmt").unclassified.days, team(s, "vuln-mgmt").coverage]).toEqual([32, 0.92]);
  });

  test("design work: a namespaced label, or an issue listed in a composed design's links.yaml; a label naming the shared or org layer is not", () => {
    expect([designLabel("de-unit:intake:U-04", "de-unit:"), designLabel("de-unit:U-04", "de-unit:"), designLabel("de-unit:shared:x", "de-unit:"), designLabel("de-unit:Intake:U-1", "de-unit:"), designLabel("de-unit:intake:unit/U-04", "de-unit:")])
      .toEqual(["intake:U-04", undefined, undefined, undefined, "intake:U-04"]);
    const s = measureSyn([
      { key: "OPS-1", team: "Team A", labels: ["de-unit:alpha:AU-1"], created: at(1), status: "In Progress", steps: [["In Progress", at(28)]] },
      { key: "OPS-2", team: "Team A", labels: ["chore"], created: at(1), status: "In Progress", steps: [["In Progress", at(29)]] },
    ], { designs: [{ namespace: "beta", links: [{ unit: "BU-2", issue: "OPS-2" }] }] });
    expect([row(s, "OPS-1"), row(s, "OPS-2")].map((r) => [r!.bucket, r!.of, r!.via])).toEqual([["design", "alpha:AU-1", "label"], ["design", "beta:BU-2", "links"]]);
    expect(team(s, "ta").design.by).toEqual({ alpha: 2, beta: 1 });
  });
});

// ── days in the window ─────────────────────────────────────────────────────────────────────────────────────────────

describe("days clipped to the window", () => {
  const issues: Syn[] = [
    { key: "OPS-1", team: "Team A", created: at(-20), status: "Done", steps: [["In Progress", at(-10)], ["Done", at(5)]] },                     // 5 of its 15 days inside
    { key: "OPS-2", team: "Team A", created: at(20), status: "In Progress", steps: [["In Progress", at(27)]] },                                // open: to the window's end
    { key: "OPS-3", team: "Team A", created: at(-40), status: "Done", steps: [["In Progress", at(-30)], ["Done", at(-20)]] },                 // done before the window
    { key: "OPS-4", team: "Team A", created: at(31), status: "To Do" },                                                                          // created after it
    { key: "OPS-5", team: "Team A", type: "Epic", created: at(1), status: "In Progress", steps: [["In Progress", at(1)]] },                  // a container
    { key: "OPS-6", team: "Team A", type: "Sub-task", parent: "OPS-2", created: at(1), status: "In Progress", steps: [["In Progress", at(1)]] },
    { key: "OPS-7", team: "Legal", created: at(1), status: "In Progress", steps: [["In Progress", at(1)]] },                               // a team the mapping does not map
    { key: "OPS-8", created: at(1), status: "In Progress", steps: [["In Progress", at(1)]] },                                                 // no team
    { key: "OPS-9", team: "Team A", created: at(5), status: "To Do" },                                                                           // counted, no days
    { key: "OPS-10", team: "Team A", created: at(10), status: "Done", steps: [["In Progress", at(10)], ["In Review", at(15)], ["Done", at(20)], ["In Progress", at(22)], ["Done", at(25)]] }, // reopened
  ];

  test("a stay before the window is clipped, an open one runs to its end, and what does not belong is left out and counted", () => {
    const s = measureSyn(issues);
    expect(s.totals.left_out).toEqual({ no_team: 1, other_team: 1, container: 1, subtask: 1, before_window: 1, after_window: 1 });
    expect(s.totals.counted).toBe(4);
    expect(["OPS-1", "OPS-2", "OPS-9", "OPS-10"].map((k) => [k, row(s, k)!.days, row(s, k)!.finished ?? false, row(s, k)!.cycle ?? null])).toEqual([
      ["OPS-1", 5, true, 15], ["OPS-2", 3, false, null], ["OPS-9", 0, false, null], ["OPS-10", 13, true, 13],
    ]);
    const a = team(s, "ta");
    expect([a.days, a.issues, a.inDoing, a.calibration?.finished, a.calibration?.historyDays]).toEqual([21, 4, 1, 2, 40]);
  });

  test("an issue with no recorded change has held its current status since it was created", () => {
    const s = measureSyn([
      { key: "OPS-1", team: "Team A", created: at(26), status: "In Progress" },
      { key: "OPS-2", team: "Team A", created: at(1), status: "In Progress", steps: [["In Progress", at(2)]] },
    ]);
    expect([row(s, "OPS-1")!.days, row(s, "OPS-2")!.days]).toEqual([4, 28]);
  });

  test("--as-of before the export: stays clip at the earlier end, and an issue done after it is not finished yet", () => {
    const s = measureSyn([{ key: "OPS-1", team: "Team A", created: at(1), status: "Done", steps: [["In Progress", at(10)], ["Done", at(25)]] }], { end: at(20) });
    expect(s.window).toEqual({ from: new Date(END - 40 * DAY).toISOString().replace(".000Z", "Z"), to: new Date(END - 10 * DAY).toISOString().replace(".000Z", "Z"), days: 30 });
    expect(row(s, "OPS-1")).toMatchObject({ days: 10 });
    expect(row(s, "OPS-1")!.finished).toBeUndefined();
  });
});

// ── no status history ──────────────────────────────────────────────────────────────────────────────────────────────

describe("the count fallback", () => {
  const issues: Syn[] = [
    ...[1, 2, 3].map((n) => ({ key: `OPS-${n}`, team: "Team A", labels: ["chore"], created: at(1), status: "In Progress" as const })),
    { key: "OPS-4", team: "Team A", created: at(1), status: "In Review" },
    { key: "OPS-5", team: "Team A", labels: ["chore"], created: at(1), status: "Done" },
  ];

  test("without status history, shares are by count of the issues in doing now, labelled, at confidence low at most", () => {
    const s = measureSyn(issues, { changelog: false });
    expect(s.mode).toBe("count");
    expect(s.notes[0]).toContain(COUNT_LABEL);
    const a = team(s, "ta");
    expect([a.days, a.activities.map((x) => [x.activity, x.share]), a.unclassified.share, a.coverage, a.confidence, a.calibration]).toEqual([4, [["chores", 0.75], ["upkeep", 0]], 0.25, 0.75, "low", undefined]);
    expect(a.notes).toContain(`Shares ${COUNT_LABEL}.`);
  });

  test("a drafted share from a count carries the label as its note", () => {
    const s = measureSyn(issues, { changelog: false });
    const view = { teams: [{ id: "ta", name: "Team A" }], activities: [{ id: "chores", team: "org:ta", name: "Chores", type: "bau", relieved_by: [] }], slowdowns: [], exceptions: {}, declined: [], estimates: [], problems: [] } as never;
    const d = draftRefresh(s, "tracker/measures/x.json", { dir: tmp("r"), config: { kind: "root" }, problems: [], patches: [] } as never, view, { created: "2026-03-02", agent: { name: "org-scout", tool: "Claude Code" } })!;
    expect(d.ops).toEqual([{ op: "modify", kind: "activity", id: "chores", set: { share: { value: 0.75, source: "tracker", by: "tracker:activity/chores", as_of: "2026-03-01", confidence: "low", note: COUNT_LABEL } } }]);
  });
});

// ── coverage and confidence ────────────────────────────────────────────────────────────────────────────────────────

describe("coverage and confidence thresholds", () => {
  test("high needs coverage 0.8, 30 issues and time; medium needs 0.5 and 10; otherwise low; a count is low", () => {
    expect([
      confidenceOf(0.8, 30, "time"), confidenceOf(0.8, 29, "time"), confidenceOf(0.79, 30, "time"), confidenceOf(0.5, 10, "time"),
      confidenceOf(0.49, 10, "time"), confidenceOf(0.5, 9, "time"), confidenceOf(1, 100, "count"), confidenceOf(undefined, 100, "time"),
    ]).toEqual(["high", "medium", "medium", "medium", "low", "low", "low", "low"]);
  });

  test("coverage is one less the unclassified share, measured", () => {
    // 30 issues: 26 chores (20 of 1 day, 6 of 2) and 4 unclassified of 2 days, so 8 of 40 days unclassified: coverage 0.8, high
    const s = measureSyn(Array.from({ length: 30 }, (_, i) => ({ key: `OPS-${i + 1}`, team: "Team A", labels: i < 26 ? ["chore"] : [], created: at(0), status: "Done" as const, steps: [["In Progress", at(1)], ["Done", at(i < 20 ? 2 : 3)]] as [keyof typeof CAT, string][] })));
    const a = team(s, "ta");
    expect([a.days, a.unclassified.days, a.coverage, a.confidence]).toEqual([40, 8, 0.8, "high"]);
  });
});

// ── Little's law ───────────────────────────────────────────────────────────────────────────────────────────────────

/** 20 issues, each 6 days in doing, one starting every 2 days from `first` days before the window's end (90 days). */
const flowIssues = (first: number, n = 20): Syn[] => Array.from({ length: n }, (_, i) => ({ key: `OPS-${i + 1}`, team: "Team A", created: at(90 - first + 2 * i - 1, 90), status: "Done" as const, steps: [["In Progress", at(90 - first + 2 * i, 90)], ["Done", at(90 - first + 2 * i + 6, 90)]] as [keyof typeof CAT, string][] }));
const MAP90 = () => normalizeMapping({ kind: "org", team: { as: "custom-field", field: "customfield_1", match: { ta: "Team A", tb: "Team B" } }, status: { by: "name", map: { "To Do": "todo", "In Progress": "doing", "In Review": "doing", Done: "done" } }, window_days: 90 }).mapping!;

describe("observed WIP, throughput and cycle time", () => {
  testEx("the example, by hand: Vulnerability management 400 days over 90, 26 finished, 11.9 days each; Detection and response 200, 23, 7.6", () => {
    const s = measureExample();
    expect(team(s, "vuln-mgmt").calibration).toEqual({ status: "calibrated", finished: 26, historyDays: 94, needs: { finished: 20, days: 56 }, wip: 4.444, throughput: 0.2889, cycle: 11.92, littles: 3.444, holds: false, wipStart: 1, wipEnd: 5 });
    expect(team(s, "detection-response").calibration).toEqual({ status: "calibrated", finished: 23, historyDays: 88, needs: { finished: 20, days: 56 }, wip: 2.222, throughput: 0.2556, cycle: 7.61, littles: 1.944, holds: true, wipStart: 0, wipEnd: 3 });
    expect(["appsec-platform", "governance-risk", "dev-platform", "product-eng"].map((t) => [t, team(s, t).calibration!.status, team(s, t).calibration!.finished])).toEqual([
      ["appsec-platform", "too-little", 18], ["governance-risk", "too-little", 17], ["dev-platform", "too-little", 7], ["product-eng", "too-little", 4],
    ]);
  });

  test("a steady team: L = λ × W exactly", () => {
    // 20 items × 6 days = 120 days in doing over 90: L 1.333; λ 20/90; W 6
    const s = measureSyn(flowIssues(60), { mapping: MAP90() });
    expect(team(s, "ta").calibration).toEqual({ status: "calibrated", finished: 20, historyDays: 60, needs: { finished: 20, days: 56 }, wip: 1.333, throughput: 0.2222, cycle: 6, littles: 1.333, holds: true, wipStart: 0, wipEnd: 0 });
  });

  test("the floors: 19 finished, or 55 days of history, is too little; 20 and 56 calibrate", () => {
    const cal = (first: number, n: number) => team(measureSyn(flowIssues(first, n), { mapping: MAP90() }), "ta").calibration!;
    expect([cal(60, 19).status, cal(55, 20).status, cal(56, 20).status]).toEqual(["too-little", "too-little", "calibrated"]);
    expect(readCalibration(cal(55, 20), { team: "Team A", windowDays: 90, asOf: "2026-03-01" }).text).toBe("Flow calibration needs at least 20 finished items and 56 days of status history; Team A has 20 finished over 55 days.");
  });

  test("the suggestion beside the limit, in words; the limit is only read, never changed", () => {
    const base = { status: "calibrated" as const, finished: 26, historyDays: 94, needs: { finished: 20, days: 56 }, throughput: 0.2889, cycle: 11.92, wipStart: 1, wipEnd: 5 };
    const say = (wip: number, holds: boolean, limit?: number) => readCalibration({ ...base, wip, littles: 0.2889 * 11.92, holds }, { team: "T", ...(limit !== undefined ? { limit } : {}), windowDays: 90, asOf: "2026-11-01" });
    expect(say(4.444, false, 3).text).toBe("Observed: 4.4 items in progress on average over the 90 days to 1 November 2026, but 0.29 finished a day × 11.9 days each gives 3.4: work in progress went from 1 to 5 over the window, so the average describes a changing load. The limit is 3. Either the limit is not being held, or it sits below what the team carries.");
    expect(say(3.444, true, 3)).toMatchObject({ verdict: "holds", proposed: 3, text: "Observed: 3.4 items in progress on average over the 90 days to 1 November 2026 (0.29 finished a day × 11.9 days each gives 3.4, close to it). The limit is 3, and the team holds it." });
    expect(say(2.222, true, 4)).toMatchObject({ verdict: "under", proposed: 2 });
    expect(say(2.222, true)).toMatchObject({ verdict: "no-limit", text: expect.stringContaining("No limit is stated; 2 would match what the team carries.") });
  });
});

// ── snapshots ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe("the snapshot file", () => {
  testEx("tracker/measures/<as_of>.json, one line per issue; the same measure again writes nothing; a changed one gets -2, read in run order", () => {
    const d = tmp("snap");
    const s = measureExample();
    expect(writeMeasure(d, s)).toEqual({ file: "tracker/measures/2026-11-01.json", written: true });
    const text = readFileSync(join(d, "tracker/measures/2026-11-01.json"), "utf8");
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(s)));
    expect(text.split("\n").filter((l) => l.startsWith('  {"key":')).length).toBe(116);
    expect(writeMeasure(d, { ...s, measured: "2026-11-09" })).toEqual({ file: "tracker/measures/2026-11-01.json", written: false });
    expect(writeMeasure(d, { ...s, notes: ["a tuned mapping"] })).toEqual({ file: "tracker/measures/2026-11-01-2.json", written: true });
    expect(loadMeasures(d).map((m) => m.file)).toEqual(["tracker/measures/2026-11-01.json", "tracker/measures/2026-11-01-2.json"]);
  });

  testEx("the example root keeps the measure of its export: what bun plumb.ts tracker measure writes, as of 2 November", () => {
    const committed = join(EX, "shared/tracker/measures/2026-11-01.json");
    if (!existsSync(committed)) return; // a package ships no measures (src/dev/package.ts); the README regenerates it
    const d = examples();
    rmSync(join(d, "shared/tracker/measures"), { recursive: true });
    const r = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(d, "shared/tracker/measures/2026-11-01.json"), "utf8")).toBe(readFileSync(committed, "utf8"));
  });
});

// ── the drafted refresh ────────────────────────────────────────────────────────────────────────────────────────────

describe("the drafted refresh", () => {
  testEx("one proposed patch with every measured change, naming its agent: exactly P-005's ops", () => {
    const d = examples();
    rmSync(join(d, "shared/patches/P-005-tracker-refresh-nov.yaml"));
    const r = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02", "--draft-patch", "--agent", "org-scout", "--requested-by", "the program lead"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Drafted P-005, proposed: patches/P-005-tracker-refresh-2026-11-01.yaml.");
    const mine = Bun.YAML.parse(readFileSync(join(d, "shared/patches/P-005-tracker-refresh-2026-11-01.yaml"), "utf8")) as any;
    const theirs = Bun.YAML.parse(readFileSync(join(EX, "shared/patches/P-005-tracker-refresh-nov.yaml"), "utf8")) as any;
    expect(mine.ops).toEqual(theirs.ops);
    expect(mine.status).toBe("proposed");
    expect(mine.provenance).toEqual({ ...theirs.provenance, based_on: loadRoot(join(d, "shared")).modelHash!.slice(0, 12) });
    expect(mine.why).toStartWith("Measured from the tracker over the 90 days to 1 November 2026 (tracker/measures/2026-11-01.json): 121 issues, 116 of them counted.");
  });

  testEx("it changes nothing until accepted; accepted, it is the value in force with its history; measured again, nothing is left to propose", () => {
    const d = examples();
    rmSync(join(d, "shared/patches/P-005-tracker-refresh-nov.yaml"));
    const share = (id: string) => { const v = readOrgView(loadRoot(join(d, "shared")), { today: "2026-11-16" })!; return [v.activities.find((a) => a.id === id)!.share!.value, v.estimates.find((e) => e.record === `org:${id}` && e.field === "share")!.pending.map((p) => p.patch)]; };
    expect(share("vuln-triage")).toEqual([0.34, []]);
    expect(run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02", "--draft-patch", "--agent", "org-scout"]).code).toBe(0);
    expect(share("vuln-triage")).toEqual([0.34, ["P-005"]]);
    // drafting the same refresh again writes no second patch
    const again = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-03", "--draft-patch", "--agent", "org-scout"]);
    expect(again.out).toContain("This refresh is already proposed as P-005");
    expect(readdirSync(join(d, "shared/patches")).filter((f) => f.startsWith("P-005"))).toEqual(["P-005-tracker-refresh-2026-11-01.yaml"]);
    edit(join(d, "shared/patches/P-005-tracker-refresh-2026-11-01.yaml"), (s) => s.replace("status: proposed", "status: accepted") + `decision: { by: the program lead, at: "2026-11-05", reason: The refresh. }\n`);
    expect(share("vuln-triage")).toEqual([0.38, []]);
    const h = readOrgView(loadRoot(join(d, "shared")), { today: "2026-11-16" })!.estimates.find((e) => e.record === "org:vuln-triage" && e.field === "share")!.history;
    expect(h.map((p) => [p.value, p.patch ?? null, p.provenance?.agent?.name ?? null])).toEqual([[0.25, null, null], [0.34, "P-004", "org-scout"], [0.38, "P-005", "org-scout"]]);
    expect(run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-06", "--draft-patch", "--agent", "org-scout"]).out).toContain("Nothing to propose: every value this run measured is already in force.");
  });

  testEx("--limits proposes calibrated teams' WIP limits in the same patch; without it, no limit is proposed", () => {
    const d = examples();
    rmSync(join(d, "shared/patches/P-005-tracker-refresh-nov.yaml"));
    expect(run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02", "--draft-patch", "--agent", "org-scout", "--limits"]).code).toBe(0);
    const p = Bun.YAML.parse(readFileSync(join(d, "shared/patches/P-005-tracker-refresh-2026-11-01.yaml"), "utf8")) as any;
    const caps = p.ops.filter((o: any) => o.kind === "team").map((o: any) => [o.id, o.set.capacity.value, o.set.capacity.confidence, o.set.capacity.stated?.value]);
    expect(caps).toEqual([["vuln-mgmt", 4, "low", 3], ["detection-response", 2, "medium", 4]]);
    expect(p.ops.filter((o: any) => o.kind === "activity").length).toBe(6);
    expect(nextPatchId(loadRoot(join(d, "shared")))).toBe("P-006");
  });

  testEx("the command says who drafts the refresh, and refuses what a root cannot do", () => {
    const d = examples();
    expect(run(["tracker", "measure", join(d, "shared"), "--draft-patch"])).toMatchObject({ code: 2, err: expect.stringContaining("--draft-patch needs who drafts the refresh") });
    expect(run(["tracker", "measure", join(d, "shared"), "--limits"]).code).toBe(2);
    expect(run(["tracker", "reconcile", join(d, "shared")])).toMatchObject({ code: 2, err: expect.stringContaining("is a shared root") });
    expect(run(["tracker", "measure", join(d, "designs/intake")])).toMatchObject({ code: 2, err: expect.stringContaining("not a shared root") });
    edit(join(d, "shared/tracker/mapping.yaml"), (s) => s.replace("labels: [vuln-triage]", "labels: [vuln-triag]"));
    const bad = run(["tracker", "measure", join(d, "shared")]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('matches label "vuln-triag", which no issue carries');
    expect(existsSync(join(d, "shared/tracker/measures/2026-11-02.json"))).toBe(false);
  });
});

// ── the org mapping's draft ───────────────────────────────────────────────────────────────────────────────────────

describe("draft-mapping on a root", () => {
  testEx("drafts the team field, a status map by name, and a rule for each activity something in the export resembles", () => {
    const d = examples();
    const r = run(["tracker", "draft-mapping", join(d, "shared")]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("mapping.draft.yaml");
    const text = readFileSync(join(d, "shared/tracker/mapping.draft.yaml"), "utf8");
    const { mapping, problems } = normalizeMapping(Bun.YAML.parse(text));
    expect(problems).toEqual([]);
    expect(mapping!.owner_team).toEqual(loadTracker(join(EX, "shared"))!.mapping!.owner_team);
    expect(mapping!.status).toEqual({ by: "name", map: { "To Do": "todo", Backlog: "todo", "In Review": "doing", "In Progress": "doing", Done: "done" } });
    expect(mapping!.org!.activities.map((a) => [a.activity, Object.keys(a.match)[0]])).toEqual([
      ["vuln-triage", "labels"], ["pentest-coordination", "type"], ["incident-oncall", "type"], ["audit-evidence", "parent"], ["scanner-rule-upkeep", "field"], ["questionnaires", "components"],
    ]);
    const t = loadTracker(join(EX, "shared"))!, v = readOrgView(loadRoot(join(EX, "shared")), { today: "2026-11-16" })!;
    expect(validateOrgMapping(mapping!, t.inventory!, { teams: v.teams, activities: v.activities.map((a) => ({ ...a, team: a.team.slice(4) })) })).toEqual([]);
  });
});

// ── the tracker pack, and namespaced unit labels in a design's own tracker ─────────────────────────────────────────

describe("an org mapping lines up no units", () => {
  test("the tracker pack's unit and milestone rules skip an org mapping, and the bundle carries no reconciliation", () => {
    const DS = join(DE, "examples/delivery-stream");
    const inst = loadInstance(DS);
    const c = compile(inst);
    const org = normalizeMapping({ kind: "org", team: { as: "component", match: { platform: "Platform" } }, status: { by: "category", map: {} }, activities: [] }).mapping!;
    const ctx = buildContext(inst.config, c.model, c.plan);
    ctx.tracker = { ...inst.tracker!, mapping: org };
    const fired = trackerPack.rules.filter((r) => r.check(ctx).length).map((r) => r.id);
    expect(fired.filter((r) => !["mapping-matches-inventory", "mapping-covers", "tracker-wired", "tracker-files-load"].includes(r))).toEqual([]);
    expect(bundleTracker({ ...inst.tracker!, mapping: org }, c.model, c.plan).reconcile).toBeUndefined();
    // and the instance's own mapping still reconciles as before
    expect(trackerPack.rules.filter((r) => r.check({ ...buildContext(inst.config, c.model, c.plan), tracker: inst.tracker }).length).map((r) => r.id)).toContain("unit-has-issue");
  });

  test("in a design with a namespace, de-unit:<namespace>:<unit> links its own unit, another design's label is that design's, and a bare one still links", () => {
    const DS = join(DE, "examples/delivery-stream");
    const inst = loadInstance(DS), c = compile(inst);
    const t = inst.tracker!;
    const [u1, u2] = c.plan.units.slice(0, 2).map((u) => u.id);
    const issues: TrackerIssue[] = [
      { ...t.issues![0], key: "X-1", labels: [`de-unit:delivery:${u1}`] },
      { ...t.issues![0], key: "X-2", labels: [`de-unit:other:${u2}`], summary: c.plan.units[1].title },
      { ...t.issues![0], key: "X-3", labels: [`de-unit:${u2}`] },
    ];
    const r = reconcile({ model: c.model, plan: c.plan, mapping: t.mapping!, issues, links: [], namespace: "delivery" });
    expect(r.linked.map((l) => [l.unit, l.issue])).toEqual([[u1, "X-1"], [u2, "X-3"]]);
    expect(r.problems.filter((p) => p.includes("X-2"))).toEqual([]);
    expect(r.proposed.filter((p) => p.issue === "X-2")).toEqual([]);
    // a lone instance reads a namespaced label as it always did: a unit id it does not have
    const lone = reconcile({ model: c.model, plan: c.plan, mapping: t.mapping!, issues: issues.slice(0, 1), links: [] });
    expect(lone.problems).toEqual([`X-1 carries the label de-unit:delivery:${u1}, but there is no unit delivery:${u1}`]);
  });
});

// ── what the root's bundle carries ─────────────────────────────────────────────────────────────────────────────────

describe("the root's bundle: the measured series, the gap, the latest measure", () => {
  testEx("each estimate gets its measured series and its gap from the stated figure; each team its unclassified band and the limit's suggestion", async () => {
    const { bundle } = await buildRoot(join(examples(), "shared"), { built: "2026-11-16T10:00:00Z" });
    const m = (rec: string, field: string) => bundle.org!.estimates.find((e) => e.record === rec && e.field === field)!.measured;
    expect(m("org:vuln-triage", "share")).toMatchObject({ series: [{ as_of: "2026-11-01", value: 0.38, confidence: "high", window_days: 90, issues: 32, coverage: 0.9 }], gap: { stated: 0.25, measured: 0.38, over: true, text: "Stated 25%, measured 38%: 13 points apart." } });
    expect(m("org:pentest-coordination", "share")!.gap).toMatchObject({ over: false, text: "Stated 10%, measured 12%: 2 points apart." });
    expect(m("org:vuln-mgmt", "capacity")!.gap).toMatchObject({ stated: 3, measured: 4.444, over: true, text: "Limit 3, observed 4.4 in progress on average: 1.4 apart." });
    expect(m("org:appsec-platform", "capacity")).toBeUndefined(); // too little to calibrate: no observed WIP
    expect(bundle.tracker!.measures).toEqual([{ file: "tracker/measures/2026-11-01.json", as_of: "2026-11-01", mode: "time" }]);
    const latest = bundle.tracker!.latest!;
    expect(latest.teams.map((t) => [t.team, t.unclassified.share, t.calibration?.verdict ?? t.calibration?.status])).toEqual([
      ["appsec-platform", 0.1, "too-little"], ["vuln-mgmt", 0.1, "over"], ["detection-response", 0.1, "under"], ["product-eng", 0.15, "too-little"], ["dev-platform", 0.15, "too-little"], ["governance-risk", 0.1, "too-little"],
    ]);
    expect("issues" in latest).toBe(false);
  });

  testEx("with no measure kept, an accepted refresh's value still shows its gap from the figure a person stated", async () => {
    const d = examples();
    rmSync(join(d, "shared/tracker/measures"), { recursive: true, force: true });
    const { bundle } = await buildRoot(join(d, "shared"), { built: "2026-11-16T10:00:00Z" });
    expect(bundle.org!.estimates.find((e) => e.record === "org:vuln-triage" && e.field === "share")!.measured).toEqual({ series: [], gap: { stated: 0.25, by: "the vulnerability management lead", measured: 0.34, apart: 0.09, over: true, text: "Stated 25%, measured 34%: 9 points apart." } });
    expect(bundle.org!.estimates.find((e) => e.record === "org:pentest-coordination" && e.field === "share")!.measured).toBeUndefined();
    expect(bundle.tracker).toEqual({ adapter: "jira", measures: [] });
  });

  test("a gap within estimates.gap is said, and not flagged", () => {
    expect(gapOf("share", { value: 0.25 }, 0.29, 0.05)).toEqual({ stated: 0.25, measured: 0.29, apart: 0.04, over: false, text: "Stated 25%, measured 29%: 4 points apart." });
    expect(gapOf("capacity", { value: 4, by: "x" }, 5, 1).over).toBe(false);
  });

  test("attachMeasured keeps one point per date, the later run's", () => {
    const view = { estimates: [{ record: "org:a", kind: "activity", field: "share", value: { value: 0.1, source: "person", by: "p", as_of: "2026-01-01", confidence: "medium" }, problems: [], stale: false, history: [], pending: [] }] } as never as Parameters<typeof attachMeasured>[0];
    const snap = (file: string, share: number) => ({ file, as_of: "2026-03-01", mode: "time", window: { days: 30 }, teams: [{ team: "t", days: 10, issues: 4, confidence: "medium", activities: [{ activity: "a", share }] }] }) as never;
    attachMeasured(view, [snap("tracker/measures/2026-03-01.json", 0.2), snap("tracker/measures/2026-03-01-2.json", 0.3)], { share: 0.05, capacity: 1 });
    expect(view.estimates[0].measured!.series.map((p) => [p.file, p.value])).toEqual([["tracker/measures/2026-03-01-2.json", 0.3]]);
  });
});

// ── the export's date ──────────────────────────────────────────────────────────────────────────────────────────────

describe("the window's end", () => {
  test("the export's own date (Jira serverInfo), else the newest update in it, else --as-of", () => {
    const d = tmp("end");
    writeExport(join(d, "a"), [{ key: "OPS-1", team: "Team A", created: at(1), status: "To Do" }], { serverTime: "2026-03-01T09:30:00.000+0000" });
    expect(jira.exportedAt!(readRaw(join(d, "a")))).toBe("2026-03-01T09:30:00Z");
    writeExport(join(d, "b"), [{ key: "OPS-1", team: "Team A", created: at(1), status: "To Do" }]);
    expect(jira.exportedAt!(readRaw(join(d, "b")))).toBeUndefined();
  });

  testEx("without the export's date the measure says where its end came from", () => {
    const d = examples();
    rmSync(join(d, "shared/tracker/export/serverInfo.json"));
    const r = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("(the newest issue update in the export (the export does not say when it was taken))");
    const file = /wrote (tracker\/measures\/[0-9-]+\.json)/.exec(r.out)![1];
    const s = JSON.parse(readFileSync(join(d, "shared", file), "utf8"));
    expect(s.export.at_from).toBe("latest-update");
    expect(s.export.at <= "2026-11-01T00:00:00Z").toBe(true);
    const asOf = run(["tracker", "measure", join(d, "shared"), "--today", "2026-11-02", "--as-of", "2026-10-15"]);
    expect(asOf.out).toContain("ending 2026-10-15T00:00:00Z (--as-of)");
  });
});

/** snapshotText round-trips: what a measure writes is what it measured. */
test("a snapshot's text parses back to the snapshot", () => {
  const s = measureSyn([{ key: "OPS-1", team: "Team A", labels: ["chore"], created: at(1), status: "In Progress", steps: [["In Progress", at(2)]] }]);
  expect(JSON.parse(snapshotText(s))).toEqual(JSON.parse(JSON.stringify(s)));
  expect(JSON.parse(snapshotText({ ...s, issues: [] })).issues).toEqual([]);
});
