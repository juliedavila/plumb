// Tracker integration: Jira discovery, state, draft mapping, mapping validation, reconciliation categories,
// CSV export, links.yaml round trip, and the bundle, site and MCP views of it. Uses the fictional Jira export
// in tests/fixtures/jira-delivery/ and the delivery-stream instance wired to it.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adapter as jira } from "../src/tracker/jira/index.ts";
import { readRaw } from "../src/tracker/raw.ts";
import { discoverJira, fieldRole } from "../src/tracker/jira/discover.ts";
import { readJiraState } from "../src/tracker/jira/state.ts";
import { csvCell, exportJiraCsv } from "../src/tracker/jira/export.ts";
import { formatLinks, parseLinks } from "../src/tracker/links.ts";
import { mapStatus, normalizeMapping } from "../src/tracker/mapping.ts";
import { validateMapping } from "../src/tracker/validate.ts";
import { reconcile } from "../src/tracker/reconcile.ts";
import { similarity } from "../src/tracker/text.ts";
import { loadTracker } from "../src/tracker/load.ts";
import { compile } from "../src/core/compile.ts";
import { loadInstance } from "../src/core/load.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { buildContext } from "../src/core/rules.ts";
import { pack as trackerPack } from "../packs/tracker/index.ts";
import { renderSite } from "../src/site/render.ts";
import { call } from "../src/mcp/tools.ts";
import type { TrackerMapping } from "../src/types.ts";

const ROOT = join(import.meta.dir, "..");
const FIX = join(import.meta.dir, "fixtures/jira-delivery");
const DS = join(ROOT, "examples/delivery-stream");
const raw = readRaw(FIX);
const inv = discoverJira(raw);
const issues = readJiraState(raw, inv);
const inst = loadInstance(DS);
const compiled = compile(inst);
const mapping = inst.tracker!.mapping!;
const rec = reconcile({ model: compiled.model, plan: compiled.plan, mapping, issues, links: inst.tracker!.links });

describe("discovery", () => {
  test("reads the export by shape: Cloud, two projects, one team-managed", () => {
    expect(inv.adapter).toBe("jira");
    expect(inv.flavor).toBe("cloud");
    expect(inv.issues).toBe(27);
    expect(inv.projects).toEqual([
      { key: "HELP", name: "Help desk", style: "team-managed", issues: 3 },
      { key: "NOTE", name: "Notebook app", style: "company-managed", issues: 24 },
    ]);
    expect(inv.notes.some((n) => n.startsWith("HELP is a team-managed project"))).toBe(true);
  });
  test("the customized hierarchy: Initiative above Epic, with usage counts", () => {
    expect(inv.hierarchy.map((h) => [h.level, h.types, h.count])).toEqual([
      [2, ["Initiative"], 1], [1, ["Epic"], 3], [0, ["Bug", "Spike", "Story", "Task"], 22], [-1, ["Sub-task"], 1],
    ]);
    expect(inv.issueTypes.find((t) => t.name === "Task" && t.project === "HELP")?.count).toBe(3);
    expect(inv.issueTypes.find((t) => t.name === "Epic" && t.project === "HELP")?.count).toBe(0);
    expect(inv.containers.map((c) => [c.key, c.level, c.children])).toEqual([["NOTE-1", 2, 3], ["NOTE-2", 1, 8], ["NOTE-3", 1, 6], ["NOTE-4", 1, 3]]);
  });
  test("fields that matter, by role: two team fields, the unused legacy Epic Link, both estimate fields", () => {
    const f = (id: string) => inv.fields.find((x) => x.id === id)!;
    expect(f("customfield_10201")).toMatchObject({ name: "Delivery team", role: "team", count: 24 });
    expect(f("customfield_10201").values?.find((v) => v.name === "Platform")?.count).toBe(6);
    expect(f("customfield_10001")).toMatchObject({ role: "team", count: 2 });
    expect(f("customfield_10014")).toMatchObject({ role: "epic-link", count: 0 });
    expect(f("parent")).toMatchObject({ role: "parent", count: 21 });
    expect(f("customfield_10026").role).toBe("story-points");
    expect(f("customfield_10016").role).toBe("story-points");
    expect(f("customfield_10300").role).toBe("acceptance");
    expect(f("customfield_10020").role).toBe("sprint");
    expect(inv.fields.some((x) => x.id === "customfield_10015")).toBe(true); // a role, even unused
    expect(inv.notes.some((n) => n.includes("Epic Link (customfield_10014) is defined but no issue uses it"))).toBe(true);
    expect(inv.notes.some((n) => n.includes("2 fields look like a team"))).toBe(true);
  });
  test("link types with inward and outward names, each link counted once", () => {
    expect(inv.linkTypes[0]).toEqual({ id: "10100", name: "Depends on", inward: "is a dependency of", outward: "depends on", count: 9 });
    expect(inv.linkTypes.find((l) => l.name === "Blocks")?.count).toBe(1);
    expect(inv.linkTypes.find((l) => l.name === "Duplicate")?.count).toBe(0);
  });
  test("statuses with categories, components, labels and fix versions with counts", () => {
    expect(inv.statuses.find((s) => s.name === "Ready for Release")).toMatchObject({ category: "done", categoryName: "Done", count: 1 });
    expect(inv.statuses.find((s) => s.name === "In Review")).toMatchObject({ category: "doing", count: 1 });
    expect(inv.notes.some((n) => n.includes('"Ready for Release" is in the Done category'))).toBe(true);
    expect(inv.components.find((c) => c.name === "Pipeline")).toEqual({ name: "Pipeline", count: 4, project: "NOTE" });
    expect(inv.labels.find((l) => l.name === "stream")?.count).toBe(3);
    expect(inv.labels.filter((l) => l.name.startsWith("de-unit:")).length).toBe(9);
    expect(inv.fixVersions.find((v) => v.name === "2026.09")).toEqual({ name: "2026.09", count: 3, released: true });
  });
  test("file names do not matter, and unknown files are noted", () => {
    const renamed = { dir: raw.dir, files: [...raw.files].reverse().map((f, i) => ({ name: `r${i}.json`, json: f.json })).concat([{ name: "junk.json", json: { hello: 1 } }]) };
    const inv2 = discoverJira(renamed);
    expect(inv2.issues).toBe(27);
    expect(inv2.linkTypes.length).toBe(inv.linkTypes.length);
    expect(inv2.notes.some((n) => n.includes("junk.json"))).toBe(true);
  });
  test("a Data Center export: no hierarchyLevel, Epic Link in use, plain-text rich text, startAt paging, sprint strings", () => {
    const dc = { dir: "/dc", files: [
      { name: "a.json", json: { deploymentType: "Server", baseUrl: "http://dc.example.test", versionNumbers: [9, 12, 0] } },
      { name: "b.json", json: [{ id: "1", name: "Epic", subtask: false }, { id: "2", name: "Story", subtask: false }, { id: "3", name: "Sub-task", subtask: true }] },
      { name: "c.json", json: [{ id: "customfield_10100", name: "Epic Link", custom: true, navigable: true, schema: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-epic-link" } },
        { id: "customfield_10101", name: "Sprint", custom: true, navigable: true, schema: { type: "array", custom: "com.pyxis.greenhopper.jira:gh-sprint" } }] },
      { name: "d.json", json: { startAt: 0, maxResults: 50, total: 2, issues: [
        { key: "DC-1", fields: { summary: "An epic", issuetype: { id: "1", name: "Epic" }, project: { key: "DC", name: "DC" }, status: { name: "Open", statusCategory: { key: "new", name: "To Do" } } } },
        { key: "DC-2", fields: { summary: "A story", description: "Plain text\non two lines", issuetype: { id: "2", name: "Story" }, project: { key: "DC", name: "DC" },
          status: { name: "In Progress", statusCategory: { key: "indeterminate", name: "In Progress" } }, customfield_10100: "DC-1",
          customfield_10101: ["com.atlassian.greenhopper.service.sprint.Sprint@1[id=4,rapidViewId=2,state=ACTIVE,name=DC Sprint 4,goal=]"] } },
      ] } },
    ] };
    const i = discoverJira(dc);
    expect(i.flavor).toBe("data-center");
    expect(i.hierarchy.map((h) => h.level)).toEqual([1, 0]);
    expect(i.notes.some((n) => n.includes("in use: issues reach their epic through it"))).toBe(true);
    const st = readJiraState(dc, i);
    expect(st.find((x) => x.key === "DC-2")).toMatchObject({ parent: "DC-1", sprint: "DC Sprint 4", statusCategory: "doing", level: 0 });
    expect(st.find((x) => x.key === "DC-2")!.values?.description).toBe("Plain text\non two lines");
  });
  test("field roles from the schema", () => {
    expect(fieldRole({ id: "customfield_1", name: "Squad", custom: true, schema: { custom: "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team" } })).toBe("team");
    expect(fieldRole({ id: "customfield_2", name: "Story point estimate", custom: true, schema: { custom: "com.pyxis.greenhopper.jira:jsw-story-points" } })).toBe("story-points");
    expect(fieldRole({ id: "parent", name: "Parent", custom: false, schema: { system: "parent" } })).toBe("parent");
  });
});

describe("live state", () => {
  test("status, assignee, current sprint, parent, links and field values, normalized", () => {
    const n15 = issues.find((i) => i.key === "NOTE-15")!;
    expect(n15).toMatchObject({ project: "NOTE", type: "Story", level: 0, status: "In Review", statusCategory: "doing", assignee: "Platform engineer 2", sprint: "NOTE Sprint 42", parent: "NOTE-2", points: 5 });
    expect(n15.acceptance).toBe("Lead time per change on the flow metrics page matches the sheet for the last ten changes.");
    expect(n15.values?.customfield_10201).toBe("Platform");
    expect(n15.links).toContainEqual({ type: "Depends on", direction: "outward", phrase: "depends on", key: "NOTE-13" });
    expect(n15.links).toContainEqual({ type: "Depends on", direction: "inward", phrase: "is a dependency of", key: "NOTE-25" });
    expect(issues.find((i) => i.key === "NOTE-12")!.sprint).toBe("NOTE Sprint 42"); // active over closed
    expect(issues.find((i) => i.key === "NOTE-16")!.sprint).toBe("NOTE Sprint 43"); // future when none is active
    expect(issues.find((i) => i.key === "HELP-1")).toMatchObject({ project: "HELP", points: 1, statusCategory: "doing" });
  });
});

describe("mapping", () => {
  const draftText = jira.draftMapping(inv, compiled.model, compiled.plan);
  const draft = normalizeMapping(Bun.YAML.parse(draftText));
  test("the draft explains each choice and names only what the inventory has", () => {
    expect(draft.problems).toEqual([]);
    const m = draft.mapping!;
    expect(m.project).toBe("NOTE");
    expect(m.phase).toEqual({ as: "epic", match: { SEE: "NOTE-2", SHORTEN: "NOTE-3", KEEP: "NOTE-4" } });
    expect(m.unit.issue_type).toBe("Story");
    expect(m.dependency).toEqual({ link_type: "Depends on", direction: "outward" });
    expect(m.owner_team?.as).toBe("custom-field");
    expect(m.owner_team?.field).toBe("customfield_10201");
    expect(m.owner_team?.match.engineering).toBe("App engineering");
    expect(m.owner_team?.match.quality).toBeUndefined(); // "QA" does not look like "Quality": a person adds it
    expect(m.done_condition?.field).toBe("customfield_10300");
    expect(m.status.by).toBe("category");
    expect(draftText).toContain("# Chose epic: 3 of 3 phases have an epic with a similar summary.");
    expect(draftText).toContain('# Check: "Ready for Release" is in the Done category.');
    expect(validateMapping(m, inv, compiled.model, compiled.plan).filter((p) => p.kind === "missing")).toEqual([]);
  });
  test("the instance's edited mapping is valid and maps statuses by name", () => {
    expect(inst.tracker!.problems).toEqual([]);
    expect(mapping.status.by).toBe("name");
    expect(mapStatus(mapping, "Ready for Release", "Done", "done")).toBe("doing");
    expect(mapStatus(draft.mapping!, "Ready for Release", "Done", "done")).toBe("done");
    expect(mapping.owner_team?.match.quality).toBe("QA");
    const ps = validateMapping(mapping, inv, compiled.model, compiled.plan);
    expect(ps.filter((p) => p.kind === "missing")).toEqual([]);
    expect(ps.filter((p) => p.kind === "coverage").map((p) => p.message)).toEqual(["team design (Design) has no value in owner_team.match"]);
  });
  test("validation names everything the inventory does not have", () => {
    const bad: TrackerMapping = structuredClone(mapping);
    bad.unit.issue_type = "User Story";
    bad.dependency = { link_type: "Requires", direction: "outward" };
    bad.phase.match.SEE = "NOTE-10";                          // a story, not an epic
    bad.phase.match.KEEP = "NOTE-1";                          // the initiative, not an epic
    bad.phase.match.LATER = "NOTE-3";                         // not a phase
    bad.owner_team!.match.platform = "Platform team";         // no such value
    bad.owner_team!.field = "customfield_99999";
    bad.done_condition = { field: "Definition of done" };
    bad.status.map["Blocked"] = "doing";
    bad.project = "WEB";
    const msgs = validateMapping(bad, inv, compiled.model, compiled.plan).filter((p) => p.kind === "missing").map((p) => p.message);
    for (const want of ['unit.issue_type "User Story"', 'dependency.link_type "Requires"', "phase.match.SEE is NOTE-10, which is not an issue above the standard level", "phase.match.KEEP is NOTE-1, of type Initiative (level 2), not an epic", "phase.match names phase LATER",
      "owner_team.field customfield_99999", "done_condition.field Definition of done", 'status.map names status "Blocked"', "project WEB"])
      expect(msgs.some((m) => m.includes(want))).toBe(true);
    const ctx = buildContext(inst.config, compiled.model, compiled.plan, { ...inst.tracker!, mapping: bad });
    const fs = trackerPack.rules.find((r) => r.id === "mapping-matches-inventory")!.check(ctx);
    expect(fs.length).toBe(msgs.length);
    expect(trackerPack.rules.find((r) => r.id === "mapping-matches-inventory")!.severity).toBe("error");
  });
  test("shape problems in mapping.yaml are reported", () => {
    const { problems } = normalizeMapping({ phase: { as: "sprint" }, status: { by: "colour", map: { Done: "finished" } }, owner_team: { as: "custom-field" } });
    expect(problems.length).toBe(5);
  });
});

describe("reconciliation", () => {
  test("exact matches: confirmed in links.yaml or by label", () => {
    expect(rec.linked.filter((l) => l.how === "confirmed").map((l) => [l.unit, l.issue])).toEqual([["U-04", "NOTE-13"], ["U-06", "NOTE-15"], ["U-13", "NOTE-19"]]);
    expect(rec.linked.filter((l) => l.how === "label").map((l) => l.unit)).toEqual(["U-01", "U-02", "U-03", "U-05", "U-08", "U-15", "U-16", "U-19"]);
    expect(rec.linked.find((l) => l.unit === "U-04")).toMatchObject({ confirmed_by: "delivery lead", confirmed_at: "2026-10-20" });
  });
  test("likely matches by similar title, phase and team, proposed and not linked", () => {
    expect(rec.proposed.map((p) => [p.unit, p.issue])).toEqual([["U-07", "NOTE-16"], ["U-09", "NOTE-21"], ["U-10", "NOTE-29"], ["U-12", "NOTE-22"]]);
    const p12 = rec.proposed.find((p) => p.unit === "U-12")!;
    expect(p12.reasons).toContain("team engineering, not platform");
    expect(p12.score).toBeLessThan(rec.proposed.find((p) => p.unit === "U-07")!.score);
    expect(rec.state["U-07"]).toBeUndefined();
    expect(similarity("Gate deploys on the automated suite", "Gate deployments on the automated regression suite")).toBeGreaterThan(0.8);
  });
  test("units with no issue, and issues in mapped epics with no unit (sub-tasks, bugs outside the epics and other projects left out)", () => {
    expect(rec.unitsWithoutIssue).toEqual(["U-11", "U-14", "U-17", "U-18", "U-20", "U-21"]);
    expect(rec.issuesWithoutUnit.map((i) => [i.issue, i.phase])).toEqual([["NOTE-17", "SEE"], ["NOTE-23", "SHORTEN"]]);
  });
  test("status disagreements, an issue under another phase's epic, and one-sided dependencies", () => {
    expect(rec.statusDisagreements).toEqual([
      { unit: "U-03", issue: "NOTE-12", unitStatus: "done", trackerStatus: "In Progress", mapped: "doing" },
      { unit: "U-06", issue: "NOTE-15", unitStatus: "todo", trackerStatus: "In Review", mapped: "doing" },
      { unit: "U-15", issue: "NOTE-24", unitStatus: "todo", trackerStatus: "Ready for Release", mapped: "doing" },
    ]);
    expect(rec.phaseDisagreements).toEqual([{ unit: "U-15", issue: "NOTE-24", unitPhase: "SHORTEN", issuePhase: "KEEP" }]);
    expect(rec.dependencyOneSided).toEqual([
      { unit: "U-06", dependsOn: "U-02", issue: "NOTE-15", dependsOnIssue: "NOTE-11", side: "model" },
      { unit: "U-08", dependsOn: "U-03", issue: "NOTE-20", dependsOnIssue: "NOTE-12", side: "tracker" },
    ]);
  });
  test("a label naming no unit is a problem, and the issue still gets proposed by title", () => {
    expect(rec.problems).toEqual(["NOTE-29 carries the label de-unit:U-99, but there is no unit U-99"]);
  });
  test("per-unit tracker state sits beside the unit and never overwrites it", async () => {
    expect(rec.state["U-03"]).toMatchObject({ issue: "NOTE-12", status: "In Progress", mapped: "doing", assignee: "Product lead", sprint: "NOTE Sprint 42", team: "product", parent: "NOTE-2" });
    const { bundle } = await buildBundle(DS, { built: "test" });
    expect(bundle.plan.units.find((u) => u.id === "U-03")!.status).toBe("done");
    expect(bundle.tracker!.reconcile!.counts).toEqual({ linked: 11, proposed: 4, unitsWithoutIssue: 6, issuesWithoutUnit: 2, statusDisagreements: 3, dependencyOneSided: 2, phaseDisagreements: 1 });
    expect(bundle.tracker!.inventory!.notes.length).toBe(inv.notes.length);
    expect(bundle.tracker!.mapping!.status.by).toBe("name");
  });
  test("every category is a finding of the tracker pack; none is an error", async () => {
    const { bundle } = await buildBundle(DS, { built: "test" });
    const by = (r: string) => bundle.findings.filter((f) => f.pack === "tracker" && f.rule === r);
    expect(by("unit-has-issue").length).toBe(6);
    expect(by("match-confirmed").length).toBe(4);
    expect(by("issue-has-unit").map((f) => [f.atKind, f.at])).toEqual([["phase", "SEE"], ["phase", "SHORTEN"]]);
    expect(by("status-agrees").length).toBe(3);
    expect(by("phase-agrees").length).toBe(1);
    expect(by("dependency-both-sides").length).toBe(2);
    expect(by("labels-name-units").length).toBe(1);
    expect(by("mapping-covers").length).toBe(1);
    expect(bundle.findings.filter((f) => f.pack === "tracker" && f.severity === "error")).toEqual([]);
  });
  test("links.yaml naming an unknown unit, an unknown issue or one issue twice is an error", () => {
    const links = [...inst.tracker!.links, { unit: "U-77", issue: "NOTE-10" }, { unit: "U-11", issue: "NOTE-999" }, { unit: "U-14", issue: "NOTE-13" }];
    const ctx = buildContext(inst.config, compiled.model, compiled.plan, { ...inst.tracker!, links });
    const fs = trackerPack.rules.find((r) => r.id === "links-resolve")!.check(ctx).map((f) => f.message);
    expect(fs).toEqual([
      "links.yaml links U-77 to NOTE-10, but there is no unit U-77",
      "links.yaml links U-11 to NOTE-999, but NOTE-999 is not in the tracker export",
      "links.yaml links NOTE-13 to both U-04 and U-14; one issue holds one unit",
    ]);
  });
  test("confirming a proposed match links it and compares its dependencies", () => {
    const links = [...inst.tracker!.links, { unit: "U-07", issue: "NOTE-16", confirmed_by: "test" }];
    const r = reconcile({ model: compiled.model, plan: compiled.plan, mapping, issues, links });
    expect(r.linked.find((l) => l.unit === "U-07")?.how).toBe("confirmed");
    expect(r.proposed.some((p) => p.unit === "U-07")).toBe(false);
    expect(r.dependencyOneSided.some((d) => d.unit === "U-08" && d.dependsOn === "U-07" && d.side === "model")).toBe(true);
  });
  test("without a dependency mapping nothing is compared; by blocks, direction is inward", () => {
    const m: TrackerMapping = { ...structuredClone(mapping), dependency: undefined };
    expect(reconcile({ model: compiled.model, plan: compiled.plan, mapping: m, issues, links: inst.tracker!.links }).dependencyOneSided).toEqual([]);
    m.dependency = { link_type: "Blocks", direction: "inward" };
    const r = reconcile({ model: compiled.model, plan: compiled.plan, mapping: m, issues, links: inst.tracker!.links });
    // NOTE-10 blocks NOTE-12, so U-03 depends on U-01 on both sides; every other model dependency is model-only
    expect(r.dependencyOneSided.some((d) => d.unit === "U-03" && d.dependsOn === "U-01")).toBe(false);
    expect(r.dependencyOneSided.every((d) => d.side === "model")).toBe(true);
  });
});

describe("export", () => {
  const file = exportJiraCsv(compiled.plan, mapping, inv, rec);
  const lines = file.content.trimEnd().split("\r\n");
  test("columns follow the mapping", () => {
    expect(file.name).toBe("jira-import.csv");
    expect(lines[0]).toBe("Issue Id,Issue Type,Summary,Description,Acceptance criteria,Parent,Labels,Delivery team,Outward issue link (Depends on),Outward issue link (Depends on),Outward issue link (Depends on)");
  });
  test("only units not yet linked, with proposed matches held back", () => {
    const units = file.content.match(/de-unit:U-\d+/g);
    expect(units).toEqual(["de-unit:U-11", "de-unit:U-14", "de-unit:U-17", "de-unit:U-18", "de-unit:U-20", "de-unit:U-21"]);
    expect(file.notes).toContain("held back until confirmed or rejected in links.yaml: U-07, U-09, U-10, U-12");
  });
  test("parent epic, team value, acceptance criteria and in-file dependency links", () => {
    const u21 = lines[lines.length - 1];
    expect(u21.startsWith("6,Story,Quarterly stream health review,")).toBe(true);
    expect(u21.endsWith(",NOTE-4,de-unit:U-21,Product,3,4,5")).toBe(true);
    expect(file.content).toContain('"The last five change requests were written by a designer and a product manager together, with no separate design handoff."');
    expect(file.notes.some((n) => n.startsWith("U-17 depends on U-16, already NOTE-25"))).toBe(true);
  });
  test("phases with no container get one in the file; label and fix-version phases go in their own columns", () => {
    const m: TrackerMapping = structuredClone(mapping);
    delete m.phase.match.KEEP;
    const f = exportJiraCsv(compiled.plan, m, inv, rec);
    expect(f.content.split("\r\n")[1]).toBe("7,Epic,Keep it short,,,,,,,,");
    expect(f.content).toContain(",7,de-unit:U-17,");
    expect(f.notes).toContain("phase KEEP has no epic: one is created in this file; add its key to mapping.yaml after the import");
    const lab = exportJiraCsv(compiled.plan, { ...structuredClone(mapping), phase: { as: "label", match: { SEE: "phase-see", SHORTEN: "phase-shorten", KEEP: "phase-keep" } } }, inv, rec);
    expect(lab.content.split("\r\n")[0]).toContain("Labels,Labels");
    expect(lab.content).toContain("de-unit:U-21,phase-keep");
    const ver = exportJiraCsv(compiled.plan, { ...structuredClone(mapping), phase: { as: "fix-version", match: { SEE: "2026.10", SHORTEN: "2026.11", KEEP: "2026.12" } } }, inv, rec);
    expect(ver.content.split("\r\n")[0]).toContain("Fix Version/s");
    expect(ver.content).toContain(",2026.12,de-unit:U-21");
  });
  test("CSV cells are quoted when they need to be", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});

describe("links.yaml", () => {
  test("the committed file parses to three confirmed links", () => {
    const { links, problems } = parseLinks(readFileSync(join(DS, "tracker/links.yaml"), "utf8"));
    expect(problems).toEqual([]);
    expect(links.map((l) => [l.unit, l.issue, l.confirmed_by])).toEqual([["U-04", "NOTE-13", "delivery lead"], ["U-06", "NOTE-15", "delivery lead"], ["U-13", "NOTE-19", "engineering lead"]]);
  });
  test("round trip: format then parse gives the same links, and format is stable", () => {
    const text = readFileSync(join(DS, "tracker/links.yaml"), "utf8");
    const a = parseLinks(text).links;
    const out = formatLinks(a);
    expect(out).toBe(text);
    expect(parseLinks(out).links).toEqual(a);
    const odd = [{ unit: "U-2", issue: "X-1", confirmed_by: "a: b", confirmed_at: "2026-01-02", note: "quote \" and #hash" }, { unit: "true", issue: "yes" }];
    expect(parseLinks(formatLinks(odd)).links).toEqual([...odd].sort((x, y) => (x.unit < y.unit ? -1 : 1)));
  });
  test("bad entries are problems, and an unquoted date reads as a date string", () => {
    const { links, problems } = parseLinks("U-1:\n  confirmed_by: x\nU-2: [a]\nU-3:\n  issue: A-3\n  confirmed_at: 2026-10-20\nU-4: B-4\n");
    expect(problems.length).toBe(2);
    expect(links).toEqual([{ unit: "U-3", issue: "A-3", confirmed_at: "2026-10-20" }, { unit: "U-4", issue: "B-4" }]);
  });
});

describe("files and views", () => {
  test("the inventory records its export relative to the instance, so no absolute path is committed", () => {
    const text = readFileSync(join(DS, "tracker/inventory.json"), "utf8");
    expect(JSON.parse(text).source.dir).toBe("../../tests/fixtures/jira-delivery");
    expect(text).not.toMatch(/\/Users\//);
  });
  test("loadTracker reports broken files instead of throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-tr-"));
    cpSync(DS, dir, { recursive: true, filter: (s) => !s.includes("/tracker/") || s.endsWith("/tracker") || /mapping|links/.test(s) });
    writeFileSync(join(dir, "tracker/mapping.yaml"), "phase: [unclosed\n");
    const t = loadTracker(dir)!;
    expect(t.inventory).toBeUndefined();
    expect(t.problems.some((p) => p.file === "tracker/mapping.yaml" && p.message.startsWith("does not parse"))).toBe(true);
    const ctx = buildContext(inst.config, compiled.model, compiled.plan, t);
    expect(trackerPack.rules.find((r) => r.id === "tracker-wired")!.check(ctx).length).toBe(2);
    expect(trackerPack.rules.find((r) => r.id === "tracker-files-load")!.check(ctx).length).toBe(1);
  });
  test("an instance without a tracker directory has no tracker in its bundle or site", async () => {
    const { bundle } = await buildBundle(join(import.meta.dir, "fixtures/mini"), { built: "test" });
    expect(bundle.tracker).toBeUndefined();
    expect(renderSite(bundle)).not.toContain('data-nav="tracker"');
  });
  test("the site has a Tracker tab with reconciliation groups linking to units", async () => {
    const { bundle } = await buildBundle(DS, { built: "test" });
    const html = renderSite(bundle);
    expect(html).toContain('href="#tracker" data-nav="tracker"');
    expect(html).toContain('id="tracker" data-page="tracker"');
    for (const g of ["linked", "proposed", "no-issue", "no-unit", "status", "phase", "deps"]) expect(html).toContain(`id="tracker-${g}"`);
    expect(html).toMatch(/id="tracker-status"[\s\S]*?href="#plan\/unit\/U-03"/);
    for (const s of ["discover", "map", "match"]) expect(html).toContain(`data-tr-step="${s}"`);
    expect(html).toContain("11 of 21 units matched · 4 proposed · 7 disagree"); // 3 status, 2 dependency, 1 gate, 1 owner team
    expect(html).toMatch(/id="tracker-owner"[\s\S]*?href="#plan\/unit\/U-03"[\s\S]*?model: <b>Engineering<\/b>/);
    expect(html).toContain("U-07:\n  issue: NOTE-16\n  confirmed_by: &lt;your role&gt;"); // the copyable confirm line
    expect(html).toContain("Agree on the lead time target"); // the proposed issue's own summary
    expect(html).toContain("Ready for Release");
  });
  test("the unit detail shows tracker state beside the unit", async () => {
    const { bundle } = await buildBundle(DS, { built: "test" });
    const html = renderSite(bundle);
    const i = html.indexOf("</script>", html.indexOf('id="de-bundle"'));
    const src = html.slice(html.indexOf("<script>", i) + 8, html.indexOf("</script>", html.indexOf("<script>", i)));
    const DE = new Function(src + "\n;return DE;")();
    const ix = DE.buildIndex(bundle);
    const d3 = DE.unitDetail(ix, "U-03");
    expect(d3).toContain("NOTE-12");
    expect(d3).toContain("The plan says Done; the tracker says In Progress");
    expect(d3).toContain("NOTE Sprint 42");
    expect(DE.unitDetail(ix, "U-07")).toContain('Likely <span class="id">NOTE-16</span>');
    expect(DE.unitDetail(ix, "U-11")).toContain("No issue yet.");
    expect(DE.parseRoute("#tracker").page).toBe("tracker");
    expect(DE.parseRoute("#tracker/map").sub).toBe("map");
    expect(DE.parseRoute("#tracker-status")).toMatchObject({ page: "tracker", sub: "anchor", id: "status" });
  });
  test("the MCP tracker tool: summary, one unit, and an instance without a tracker", async () => {
    const { bundle } = await buildBundle(DS, { built: "test" });
    const s = call(bundle, "tracker", {});
    expect(s.text).toContain("Linked 11; likely matches to confirm 4; units with no issue 6");
    expect(s.text).toContain("- U-08 -> U-03 (NOTE-20 -> NOTE-12): only in the tracker");
    const u = call(bundle, "tracker", { unit: "U-15" });
    expect(u.text).toContain('Tracker status: Ready for Release (maps to doing)');
    expect(u.text).toContain("Phase: the unit is in SHORTEN, NOTE-24 sits under KEEP.");
    expect(call(bundle, "tracker", { unit: "U-07" }).text).toContain("Likely match NOTE-16");
    expect(call(bundle, "tracker", { unit: "nope" }).isError).toBe(true);
    const { bundle: mini } = await buildBundle(join(import.meta.dir, "fixtures/mini"), { built: "test" });
    expect(call(mini, "tracker", {}).text).toContain("not wired to a tracker");
  });
});

describe("owner against the tracker's team", () => {
  test("a linked unit whose inherited owner differs from the team the tracker assigns is a tracker finding", async () => {
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle: b } = await buildBundle(new URL("../examples/delivery-stream", import.meta.url).pathname);
    expect(b.tracker!.reconcile!.ownerDisagreements).toEqual([{ unit: "U-03", issue: "NOTE-12", owners: ["engineering"], trackerTeam: "product" }]);
    const f = b.findings.filter((x) => x.pack === "tracker" && x.rule === "owner-agrees");
    expect(f.map((x) => x.message)).toEqual(["U-03 is owned by Engineering in the model, but NOTE-12 is assigned to Product in the tracker"]);
    // agreement elsewhere: every other linked unit's tracker team is one of its owners
    for (const [u, s] of Object.entries(b.tracker!.reconcile!.state)) if (u !== "U-03" && s.team) expect(b.teams!.units[u].owners).toContain(s.team);
  });
  test("no team mapped, no comparison", async () => {
    const { reconcile } = await import("../src/tracker/reconcile.ts");
    const { buildBundle } = await import("../src/core/bundle.ts");
    const { bundle: b, instance } = await buildBundle(new URL("../examples/delivery-stream", import.meta.url).pathname);
    const m = structuredClone(instance.tracker!.mapping!); delete m.owner_team;
    const r = reconcile({ model: b.model, plan: b.plan, mapping: m, issues: instance.tracker!.issues!, links: instance.tracker!.links });
    expect(r.ownerDisagreements).toBeUndefined();
  });
});
