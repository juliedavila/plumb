// The flow inputs are trustworthy before anything draws them. The schema and provenance
// of wait_days, work_days and wip_limit (the flow-values rule), waits and lead time measured from the tracker's status
// history, each stream view's totals, a patch's lead-time effect, and a done unit the model contradicts.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildBundle, modelHash } from "../src/core/bundle.ts";
import { loadInstance } from "../src/core/load.ts";
import { buildContext, loadPacks, runRules } from "../src/core/rules.ts";
import { fmtDays, readFlowValue, rankHops, hopText, valueText } from "../src/core/flow.ts";
import { measureFlow, median, staysOf } from "../src/tracker/flow.ts";
import type { Element, InstanceConfig, Model, Plan, TrackerIssue, TrackerMapping } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const BUILT = "2026-10-22T12:00:00Z";
const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;
const SETTINGS = { maxAgeDays: 90 };
const el = (attrs: Record<string, unknown>, kind = "person"): Element => ({ id: "x", name: "X", kind, attrs });

describe("flow values: schema and provenance", () => {
  test("a whole value carries its number, source and date, and its age against the build", () => {
    const r = readFlowValue(el({ wait_days: 4, flow_source: "estimated", flow_as_of: "2026-10-01" }), "wait_days", "2026-10-22", SETTINGS);
    expect(r.problems).toEqual([]);
    expect(r.value).toEqual({ value: 4, source: "estimated", asOf: "2026-10-01", ageDays: 21 });
    expect(valueText(r.value!, "2026-10-22")).toBe("4 days, estimated, as of 1 Oct");
  });
  test("malformed: not a number, below zero, a WIP limit that is not whole", () => {
    const p = (attrs: Record<string, unknown>, key = "wait_days") => readFlowValue(el({ flow_source: "measured", flow_as_of: "2026-10-01", ...attrs }), key, "2026-10-22", SETTINGS).problems;
    expect(p({ wait_days: "four" })).toEqual(['wait_days is "four", not a number']);
    expect(p({ wait_days: -1 })).toEqual(["wait_days is -1, below zero"]);
    expect(p({ wip_limit: 2.5 }, "wip_limit")).toEqual(["wip_limit is 2.5, not a whole number"]);
    expect(p({ work_days: 0 }, "work_days")).toEqual([]);
  });
  test("provenance: a source word that is not one of the three, no source, no date, a date that is not one", () => {
    const p = (attrs: Record<string, unknown>) => readFlowValue(el({ wait_days: 2, ...attrs }), "wait_days", "2026-10-22", SETTINGS).problems;
    expect(p({ flow_source: "guess", flow_as_of: "2026-10-01" })).toEqual(['flow_source is "guess"; use measured, estimated or declared']);
    expect(p({ flow_as_of: "2026-10-01" })).toEqual(["wait_days has no flow_source (measured, estimated or declared)"]);
    expect(p({ flow_source: "estimated" })).toEqual(["wait_days has no flow_as_of date"]);
    expect(p({ flow_source: "estimated", flow_as_of: "last spring" })).toEqual(['flow_as_of is "last spring", not a date']);
  });
  test("age: older than flow.max_age_days is stale, and the value says so", () => {
    const r = readFlowValue(el({ wait_days: 1, flow_source: "estimated", flow_as_of: "2026-03-02" }), "wait_days", "2026-10-22", SETTINGS);
    expect(r.value!.stale).toBe(true);
    expect(r.problems[0]).toMatch(/^wait_days is 234 days old \(as of 2026-03-02\), older than the 90 days allowed/);
  });
  test("the instance's engine.yaml flow.source and flow.as_of stand in for a part that gives none", () => {
    const r = readFlowValue(el({ wait_days: 1 }), "wait_days", "2026-10-22", { maxAgeDays: 90, source: "declared", asOf: "2026-10-10" });
    expect(r.problems).toEqual([]);
    expect(r.value).toMatchObject({ source: "declared", asOf: "2026-10-10" });
  });

  const run = async (model: Model, config: Partial<InstanceConfig> = {}) => {
    const { packs } = await loadPacks(["flow"]);
    const ctx = buildContext({ name: "t", title: "t", packs: ["flow"], ...config } as InstanceConfig, model, { phases: [], units: [] } as Plan);
    ctx.today = "2026-10-22";
    return runRules(packs, ctx).filter((f) => f.rule === "flow-values");
  };
  const M = (elements: Element[], views: Model["views"] = []): Model => ({ teams: [], systems: [], zones: [], elements, relationships: [], contracts: [], views });
  test("the flow-values rule reports each problem at its part, and a process step in a stream view with no wait", async () => {
    const f = await run(M([
      { id: "a", name: "A", kind: "person", attrs: { wait_days: 3, flow_source: "measured", flow_as_of: "2026-10-01" } },
      { id: "b", name: "B", kind: "person", attrs: { wait_days: -2, flow_source: "measured", flow_as_of: "2026-10-01" } },
      { id: "c", name: "C", kind: "process" },
    ], [{ id: "s", title: "S", elements: ["a", "b", "c"] }]), { flow: { streams: ["s"] } });
    expect(f.map((x) => [x.at, x.message])).toEqual([
      ["b", "part b (B): wait_days is -2, below zero"],
      ["c", "step c (C) is in stream view s but declares no wait_days"],
    ]);
  });
  test("on the delivery stream: the stale support desk wait, read in words", () => {
    const f = ds.findings.filter((x) => x.rule === "flow-values");
    expect(f.map((x) => x.at)).toEqual(["support-desk"]);
    expect(f[0].text).toBe("part Support desk: wait in days is 234 days old (as of 2026-03-02), older than the 90 days allowed");
  });
  test("a milestone's flow target is status, not structure: it leaves the model hash alone", () => {
    const inst = loadInstance(DS_DIR);
    const h = modelHash(inst);
    inst.plan.phases.forEach((p) => delete p.flow_target);
    expect(modelHash(inst)).toBe(h);
    expect(ds.plan.phases.find((p) => p.id === "SHORTEN")!.flow_target).toEqual({ lead_days: 15, handoffs: 5 });
  });
});

describe("measured from the tracker's status history", () => {
  const issue = (key: string, created: string, steps: [string, string][], from = "To Do"): TrackerIssue => ({
    key, project: "N", type: "Story", level: 0, summary: key, status: steps[steps.length - 1][1], statusCategory: "doing", components: [], labels: [], fixVersions: [], links: [],
    created, transitions: steps.map(([at, to], i) => ({ at, from: i ? steps[i - 1][1] : from, to })) });
  const mapping = { flow: { statuses: { Ready: { step: "s", as: "wait" }, Doing: { step: "s", as: "work" } }, done: ["Done"] } } as unknown as TrackerMapping;
  const model = { elements: [{ id: "s", name: "S", kind: "person" }] } as unknown as Model;

  test("stays run from each transition to the next, the first from the created time", () => {
    const st = staysOf(issue("N-1", "2026-10-01T00:00:00.000+0000", [["2026-10-02T00:00:00.000+0000", "Ready"], ["2026-10-04T12:00:00.000+0000", "Doing"]]));
    expect(st.map((s) => [s.status, s.end === undefined ? "open" : (s.end - s.start) / 86400000])).toEqual([["To Do", 1], ["Ready", 2.5], ["Doing", "open"]]);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test("medians over completed stays, open stays counted apart, lead time from the first mapped status to done", () => {
    const m = measureFlow([
      issue("N-1", "2026-10-01T00:00:00Z", [["2026-10-02T00:00:00Z", "Ready"], ["2026-10-03T00:00:00Z", "Doing"], ["2026-10-06T00:00:00Z", "Done"]]),
      issue("N-2", "2026-10-01T00:00:00Z", [["2026-10-02T00:00:00Z", "Ready"], ["2026-10-05T00:00:00Z", "Doing"], ["2026-10-06T00:00:00Z", "Done"]]),
      issue("N-3", "2026-10-01T00:00:00Z", [["2026-10-02T00:00:00Z", "Ready"]]),
    ], mapping, model);
    expect(m.available).toBe(true);
    expect(m.steps.s.wait).toMatchObject({ days: 2, n: 2, open: 1, issues: ["N-1", "N-2"] });
    expect(m.steps.s.work).toMatchObject({ days: 2, n: 2 });
    expect(m.lead).toMatchObject({ days: 4, n: 2, open: 1 });
  });
  test("an export without status history, or a mapping without flow, says so instead of measuring", () => {
    const flat = issue("N-1", "2026-10-01T00:00:00Z", [["2026-10-02T00:00:00Z", "Ready"]]); delete flat.transitions;
    expect(measureFlow([flat], mapping, model)).toMatchObject({ available: false, reason: expect.stringContaining("no status history") });
    expect(measureFlow([flat], {} as TrackerMapping, model)).toMatchObject({ available: false, reason: expect.stringContaining("names no status for a stream step") });
  });
  test("the sample Jira export: four changes finished the workflow; the medians the delivery stream shows", () => {
    const m = ds.flow!.measured!;
    expect(m).toMatchObject({ available: true, issues: 10, transitions: 44, from: "2026-09-14", to: "2026-10-19" });
    expect(m.lead).toMatchObject({ days: 17.25, n: 4, open: 6 });
    const d = (step: string, k: "wait" | "work") => m.steps[step]?.[k]?.days;
    expect([d("build-change", "wait"), d("build-change", "work"), d("code-review", "wait"), d("manual-test", "wait"), d("manual-test", "work"), d("release-approval", "wait")]).toEqual([1, 3, 2.5, 3.5, 1, 4.75]);
    expect(m.steps["design-exploration"]).toBeUndefined(); // nothing on the board stands for the steps before the sprint
  });
});

describe("stream totals", () => {
  const s = ds.flow!.streams[0];
  test("only the stream views engine.yaml names; the path runs start to end in stream order", () => {
    expect(ds.flow!.streams.map((x) => x.view)).toEqual(["stream"]);
    expect(s.path[0]).toBe("customers");
    expect(s.path[s.path.length - 1]).toBe("production");
    expect(s.path).toHaveLength(15);
  });
  test("wait and work by source, lead time and flow efficiency, handoffs against the limit", () => {
    expect(s.wait).toMatchObject({ days: 21, bySource: { estimated: 15, measured: 6 }, missing: [] });
    expect(s.work).toMatchObject({ days: 9.5, bySource: { estimated: 5, measured: 4.5 } });
    expect(s.lead).toBe(30.5);
    expect(Math.round(s.efficiency! * 100)).toBe(31);
    expect([s.handoffs, s.limit, s.oldest, s.sources]).toEqual([7, 6, "2026-09-30", ["measured", "estimated"]]);
  });
  test("the path's cross-team hops are named, and the handoff finding names the same hops", () => {
    const names = s.hops.map((h) => hopText(ds.model, h));
    expect(names).toEqual(["Product to Design", "Design to Product", "Product to Engineering", "Engineering to Platform", "Platform to Quality", "Quality to Release", "Release to Platform"]);
    const f = ds.findings.find((x) => x.rule === "path-handoff-limit")!;
    expect(f.message.endsWith(`(limit 6): ${names.join(", ")}`)).toBe(true);
  });
  test("handoffs ranked by the wait behind them, the tracker's measure first where it has one", () => {
    const r = rankHops(s.hops).map((h) => [h.relationship, h.behind ?? null, h.measuredBehind?.days ?? h.waitBehind?.value ?? null]);
    expect(r).toEqual([["h13", "release-approval", 4.75], ["h04", "design-exploration", 4], ["h11", "manual-test", 3.5], ["h05", "write-change-request", 2], ["h06", "build-change", 1], ["h09", null, null], ["h14", null, null]]);
  });
  test("the tracker's lead time sits beside the declared wait and work of the same steps", () => {
    expect(s.measured).toEqual({ lead: ds.flow!.measured!.lead, covered: ["build-change", "code-review", "manual-test", "release-approval"], declared: 15 });
  });
  test("team handoffs: every handoff relationship between two owner teams, both teams named", () => {
    expect(ds.flow!.teamHandoffs.map((h) => `${h.from}>${h.to}:${h.relationships.join(",")}`)).toContain("quality>release:h13");
    expect(ds.flow!.teamHandoffs).toHaveLength(7);
  });
  test("fmtDays reads as a reader says it", () => {
    expect([fmtDays(1), fmtDays(4), fmtDays(4.75), fmtDays(0.5)]).toEqual(["1 day", "4 days", "4.8 days", "0.5 days"]);
  });
});

describe("a patch's lead-time effect", () => {
  const fx = ds.patches.find((p) => p.id === "P-001")!.impact.flow!;
  test("days of wait removed by source, lead time before and after, handoffs 7 to 6 at the limit, the new and gone hops", () => {
    expect(fx).toHaveLength(1);
    const e = fx[0];
    expect(e.wait).toEqual({ before: 21, after: 17, removed: { estimated: 4 }, added: {} });
    expect(e.lead).toEqual({ before: 30.5, after: 26 });
    expect(e.handoffs).toEqual({ before: 7, after: 6, limit: 6 });
    expect(e.hopsAdded.map((h) => hopText(ds.model, h))).toEqual(["Quality to Platform"]);
    expect(e.stepsRemoved).toEqual(["release-approval"]);
    expect(e.text).toBe("Removes 4 days of estimated wait and 0.5 days of work (lead time 30.5 to 26 days, from the same values); team handoffs 7 to 6, at the limit of 6. New handoff: Quality to Platform. Gone: Quality to Release, Release to Platform. The tracker measured 4.8 days of waiting before Release approval (median of 4 changes).");
  });
});

describe("a done unit the model contradicts", () => {
  test("U-03 says every queue has a WIP limit and is done, while the roadmap backlog has none: a finding, in names", () => {
    const f = ds.findings.filter((x) => x.rule === "done-unit-holds");
    expect(f.map((x) => x.at)).toEqual(["U-03"]);
    expect(f[0].message).toBe("unit U-03 is done, but the model contradicts it: queue roadmap-backlog has no wip_limit");
    expect(f[0].text).toBe("unit “Set a WIP limit on every queue” is done, but the model contradicts it: queue Roadmap backlog has no WIP limit");
  });
  test("a done unit whose assertion holds (U-02: every person step has a wait) is not reported; giving the backlog a limit clears U-03", async () => {
    const inst = loadInstance(DS_DIR);
    inst.model.elements.find((e) => e.id === "roadmap-backlog")!.attrs = { wip_limit: 20, flow_source: "declared", flow_as_of: "2026-10-20" };
    const b = (await buildBundle(inst, { built: BUILT })).bundle;
    expect(b.findings.filter((x) => x.rule === "done-unit-holds")).toEqual([]);
  });
});

