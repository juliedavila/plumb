// Status: red, amber or green per milestone from declared criteria, each with its reasons in words; the path to green
// derived from the plan, the owners and the findings; the leadership challenges; and each load-bearing untested
// premise written as a bet. Small plans built in code exercise one criterion at a time; the two instances check the
// whole thing.
import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { analyzePlan } from "../src/core/plan";
import { teamFacts } from "../src/core/teams";
import { allPremiseImpacts } from "../src/core/premise";
import { planStatus, statusCriteria, clause, dayText } from "../src/core/status";
import { overrideText, statusBlock, ragHtml } from "../src/site/status";
import { buildBundle } from "../src/core/bundle";
import { renderSite } from "../src/site/render";
import type { Bundle, Claim, Finding, InstanceConfig, Phase, Unit } from "../src/types";
import { lint } from "../src/site/prose";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const BUILT = "2026-10-21T10:00:00.000Z";

/** A bundle from a small plan: two teams, two milestones, units as given; analysis, owners and premises computed. */
function bundle(units: Unit[], o: { phases?: Phase[]; claims?: Claim[]; findings?: Finding[]; config?: Partial<InstanceConfig>; tracker?: Bundle["tracker"]; elements?: Bundle["model"]["elements"] } = {}): Bundle {
  const model = { teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], systems: [], zones: [], elements: o.elements ?? [], relationships: [], contracts: [], views: [], ...(o.claims ? { claims: o.claims } : {}) };
  const plan = { phases: o.phases ?? [{ id: "M1", name: "First value", exit_test: "x", order: 1 }, { id: "M2", name: "Second value", exit_test: "y", order: 2 }], units };
  const config = { name: "t", title: "T", packs: [], ...(o.config ?? {}) } as InstanceConfig;
  const analysis = analyzePlan(plan);
  const b = {
    engine: { version: "0", built: BUILT, hash: "h" }, instance: { name: "t", title: "T", packs: [{ name: "plan", title: "Plan", description: "", rules: [{ id: "cycle", title: "No dependency cycles", why: "", severity: "error" as const }] }], ladder: [] },
    model, plan, findings: o.findings ?? [], analysis, patches: [], layouts: [],
    teams: teamFacts(model, plan, config, analysis), ...(o.claims ? { premises: allPremiseImpacts(model, plan) } : {}), ...(o.tracker ? { tracker: o.tracker } : {}) } as Bundle;
  return b;
}
const U = (id: string, phase: string, x: Partial<Unit> = {}): Unit => ({ id, title: `Work ${id}`, kind: "code", phase, check: "done", owner: "a", ...x });
const run = (b: Bundle, config: Partial<InstanceConfig> = {}) => planStatus(b, { name: "t", title: "T", packs: [], ...config } as InstanceConfig).status;
const ms = (b: Bundle, id: string, config?: Partial<InstanceConfig>) => run(b, config).milestones.find((m) => m.phase === id)!;

describe("status criteria", () => {
  test("the defaults, and engine.yaml moving or dropping a criterion; an unknown name is a problem", () => {
    expect(statusCriteria({ name: "t", title: "T", packs: [] })).toEqual({ red: ["no-provider", "unowned-blocker", "error-finding", "slipped"], amber: ["unowned", "untested-premise", "tracker-disagrees", "idle-ready", "earlier-milestone"], problems: [] });
    const c = statusCriteria({ name: "t", title: "T", packs: [], status: { red: ["slipped", "unowned"], amber: ["unowned", "bogus"] } });
    expect(c.red).toEqual(["slipped", "unowned"]);
    expect(c.amber).toEqual([]); // unowned is red already
    expect(c.problems).toEqual([`engine.yaml status.amber: "bogus" is not a criterion (no-provider, unowned-blocker, error-finding, slipped, unowned, untested-premise, tracker-disagrees, idle-ready, earlier-milestone)`]);
  });
  test("green when nothing stands in the way; a milestone whose work is all done is reached", () => {
    const b = bundle([U("U-1", "M1", { status: "done", provides: ["c1"] }), U("U-2", "M2", { requires: ["c1"], status: "doing" })]);
    const s = run(b);
    expect(s.milestones.map((m) => [m.phase, m.status, m.reached, m.current])).toEqual([["M1", "green", true, false], ["M2", "green", false, true]]);
    expect(s.overall).toEqual({ status: "green", computed: "green", text: "Every remaining milestone is green; the current one is “Second value”.", lead: { phase: "M2", text: "Overall green: every milestone still ahead is on course." } });
  });
  test("slipped: work on the path past its due date is red, and the path finishes it first, naming its team and what waits", () => {
    const b = bundle([U("U-1", "M1", { due: "2026-10-09", provides: ["c1"], status: "doing" }), U("U-2", "M1", { requires: ["c1"], owner: "b", title: "Agree the target" })]);
    const m = ms(b, "M1");
    expect(m.status).toBe("red");
    expect(m.reasons[0]).toMatchObject({ criterion: "slipped", level: "red", text: "“Work U-1” was due 9 Oct 2026 and is not done." });
    expect(m.path[0]).toEqual({ criterion: "slipped", level: "red", text: "Finish “Work U-1”, due 9 Oct 2026.", work: { kind: "unit", id: "U-1" }, teams: ["a"], unblocks: ["U-2"] });
    // due today or later is not a slip
    expect(ms(bundle([U("U-1", "M1", { due: "2026-10-21", status: "doing" })]), "M1").reasons.some((r) => r.criterion === "slipped")).toBe(false);
  });
  test("no provider: work waiting on something no planned work provides is red", () => {
    const b = bundle([U("U-1", "M1", { requires: ["c.nobody"], status: "todo" }), U("U-2", "M1", { status: "doing" })]);
    const m = ms(b, "M1");
    expect(m.reasons[0]).toMatchObject({ criterion: "no-provider", level: "red", text: "“Work U-1” waits on something no planned work provides." });
    expect(m.path[0]).toMatchObject({ text: "Plan the work “Work U-1” is missing.", teams: ["a"], unblocks: ["U-1"] });
  });
  test("unowned: work nobody owns that other work waits on is red; unowned work nothing waits on is amber", () => {
    const b = bundle([U("U-1", "M1", { owner: undefined, provides: ["c1"] }), U("U-2", "M1", { requires: ["c1"] }), U("U-3", "M1", { owner: undefined, status: "doing" })]);
    const m = ms(b, "M1");
    expect(m.reasons.filter((r) => r.criterion.startsWith("unowned")).map((r) => [r.criterion, r.level, r.text])).toEqual([
      ["unowned-blocker", "red", "Nobody owns “Work U-1”, and “Work U-2” waits on it."],
      ["unowned", "amber", "Nobody owns “Work U-3”."],
    ]);
    expect(m.path.map((a) => [a.text, a.teams, a.unblocks])).toEqual([
      ["Name an owner team for “Work U-1”.", [], ["U-2"]], // an empty team list reads "needs an owner"
      ["Name an owner team for “Work U-3”.", [], []],
    ]);
  });
  test("an error finding on the milestone's work is red; a warning is not", () => {
    const f = (sev: "error" | "warning"): Finding => ({ pack: "plan", rule: "cycle", severity: sev, at: "U-1", atKind: "unit", message: "m" });
    expect(ms(bundle([U("U-1", "M1", { status: "doing" })], { findings: [f("error")] }), "M1").reasons[0]).toMatchObject({ criterion: "error-finding", level: "red", text: "The check “No dependency cycles” fails on “Work U-1”." });
    expect(ms(bundle([U("U-1", "M1", { status: "doing" })], { findings: [f("warning")] }), "M1").status).toBe("green");
  });
  test("an untested load-bearing premise behind the milestone is amber; the bet names what is in question and how it is tested", () => {
    const claims: Claim[] = [{ id: "PR-1", statement: "The suite catches what the manual test catches.", kind: "premise", grade: "untested" }, { id: "PR-2", statement: "Teams hold limits.", kind: "premise", grade: "untested", attrs: { tested_by: ["U-3"] } }];
    const lb = (id: string): Finding => ({ pack: "premises", rule: "load-bearing-untested", severity: "warning", at: id, atKind: "claim", message: "m" });
    const b = bundle([U("U-1", "M1", { status: "doing", provides: ["c1"] }), U("U-2", "M2", { requires: ["c1"], rests_on: ["PR-1"] }), U("U-3", "M2", { requires: ["c1"], rests_on: ["PR-2"], owner: "b", title: "Measure the limits" })], { claims, findings: [lb("PR-1"), lb("PR-2")] });
    const s = run(b);
    const m2 = s.milestones.find((m) => m.phase === "M2")!;
    expect(m2.status).toBe("amber");
    expect(m2.reasons.find((r) => r.criterion === "untested-premise")!.text).toMatch(/^It rests on untested beliefs, the heaviest that /);
    expect(s.risks.map((r) => r.text)).toEqual([
      "We are betting that the suite catches what the manual test catches. If it is wrong, reaching “Second value” is in question. Nothing tests it yet: it needs a test and an owner.",
      "We are betting that teams hold limits. If it is wrong, reaching “Second value” is in question. We are testing it by “Measure the limits” (Beta).",
    ]);
    // the path asks for a test of the belief nothing tests before running the tests of one that has them
    expect(m2.path.filter((a) => a.criterion === "untested-premise").map((a) => [a.text, a.teams])).toEqual([
      ["Plan a test of the belief that the suite catches what the manual test catches.", []],
      ["Test the belief that teams hold limits, through “Measure the limits”.", ["b"]],
    ]);
  });
  test("the tracker disagreeing about the milestone's work is amber, with the settling action owned by the unit's team", () => {
    const tracker = { adapter: "jira", reconcile: { adapter: "jira", counts: { linked: 1, proposed: 0, unitsWithoutIssue: 0, issuesWithoutUnit: 0, statusDisagreements: 1, dependencyOneSided: 0, phaseDisagreements: 0 }, linked: [], proposed: [], unitsWithoutIssue: [], issuesWithoutUnit: [], statusDisagreements: [{ unit: "U-1", issue: "N-1", unitStatus: "done" as const, trackerStatus: "In Progress", mapped: "doing" as const }], dependencyOneSided: [], phaseDisagreements: [], state: {}, problems: [] } } as Bundle["tracker"];
    const m = ms(bundle([U("U-1", "M1", { status: "done" }), U("U-2", "M1", { status: "doing" })], { tracker }), "M1");
    expect(m.reasons[0]).toMatchObject({ criterion: "tracker-disagrees", level: "amber", text: "Jira has “Work U-1” as In Progress; the plan has it done." });
    expect(m.path[0]).toMatchObject({ text: "Settle where “Work U-1” really stands: the plan says done, Jira says In Progress.", teams: ["a"] });
  });
  test("ready work with nothing in progress is amber, for the current milestone only", () => {
    const b = bundle([U("U-1", "M1"), U("U-2", "M2")]);
    const s = run(b);
    expect(s.milestones[0].reasons.map((r) => r.criterion)).toEqual(["idle-ready"]);
    expect(s.milestones[0].path[0]).toMatchObject({ text: "Start “Work U-1”.", teams: ["a"] });
    expect(s.milestones[1].reasons.map((r) => r.criterion)).not.toContain("idle-ready");
    expect(ms(bundle([U("U-1", "M1"), U("U-3", "M1", { status: "doing" })]), "M1").status).toBe("green");
  });
  test("a later milestone whose work waits on an earlier one that is not green is amber, and its path points back", () => {
    const b = bundle([U("U-1", "M1", { due: "2026-10-01", provides: ["c1"], status: "doing" }), U("U-2", "M2", { requires: ["c1"] })]);
    const s = run(b);
    expect(s.milestones.map((m) => m.status)).toEqual(["red", "amber"]);
    expect(s.milestones[1].reasons.map((r) => r.text)).toEqual(["Its work waits on “First value”, which is red."]);
    expect(s.milestones[1].path).toEqual([{ criterion: "earlier-milestone", level: "amber", text: "Bring “First value” to green first, by its own path.", work: { kind: "phase", id: "M1" }, teams: ["a"], unblocks: [] }]);
    // the earlier milestone's slipped work is not counted again in the later one's own path
    expect(s.milestones[1].reasons.some((r) => r.criterion === "slipped")).toBe(false);
  });
  test("engine.yaml can make a criterion red, or drop it", () => {
    const b = bundle([U("U-1", "M1", { owner: undefined, status: "doing" })]);
    expect(ms(b, "M1").status).toBe("amber");
    expect(ms(b, "M1", { status: { red: ["unowned"] } }).status).toBe("red");
    expect(ms(b, "M1", { status: { amber: [] } }).status).toBe("green");
  });
  test("a person's override is what shows, the computed status stays beside it, and the text says when they differ", () => {
    const phases: Phase[] = [{ id: "M1", name: "First value", exit_test: "x", order: 1, override: { status: "green", reason: "On course.", date: "2026-10-20", by: "the delivery lead" } }];
    const m = ms(bundle([U("U-1", "M1", { due: "2026-10-01", status: "doing" })], { phases }), "M1");
    expect([m.status, m.computed]).toEqual(["green", "red"]);
    expect(m.path.length).toBeGreaterThan(0); // the path stays: the computed status is not green
    expect(overrideText(m.override!, m.computed)).toBe("Set to green by the delivery lead on 20 Oct 2026: On course. Computed from the plan: red.");
  });
  test("the path to green: red actions before amber, the work that unblocks the most first", () => {
    const b = bundle([
      U("U-1", "M1", { owner: undefined, status: "doing" }),
      U("U-2", "M1", { due: "2026-10-01", provides: ["c2"], status: "doing" }), U("U-3", "M1", { requires: ["c2"], status: "doing" }),
      U("U-4", "M1", { due: "2026-10-02", provides: ["c4"], status: "doing" }), U("U-5", "M1", { requires: ["c4"], provides: ["c5"] }), U("U-6", "M1", { requires: ["c5"] }),
    ]);
    expect(ms(b, "M1").path.map((a) => `${a.level} ${a.work?.id}`)).toEqual(["red U-4", "red U-2", "amber U-1"]);
  });
});

describe("dates and clauses", () => {
  test("a due date reads as the calendar date, whatever the time zone", () => {
    expect(dayText("2026-10-09")).toBe("9 Oct 2026");
    expect(dayText("2026-01-31T23:30:00Z")).toBe("31 Jan 2026");
  });
  test("a statement becomes a clause after “that”: first letter lowered, full stop dropped, acronyms kept", () => {
    expect(clause("The suite catches it.")).toBe("the suite catches it");
    expect(clause("A security stage will not slow delivery.")).toBe("a security stage will not slow delivery");
    expect(clause("LLM agents find defects.")).toBe("LLM agents find defects");
    expect(clause("Jira is the record.")).toBe("Jira is the record");
  });
});

const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;

describe("the instances", () => {
  test("the delivery stream: the slipped export turns the current milestone red; the person's green on the next shows as an override", () => {
    const s = ds.status!;
    expect(s.milestones.map((m) => [m.phase, m.status, m.computed])).toEqual([["SEE", "red", "red"], ["SHORTEN", "green", "amber"], ["KEEP", "amber", "amber"]]);
    expect(s.milestones[0].path[0]).toMatchObject({ text: "Finish “Export stage timestamps to flow metrics”, due 9 Oct 2026.", teams: ["platform"] });
    expect(s.overall.text).toBe("“See the stream” is red: “Export stage timestamps to flow metrics” was due 9 Oct 2026 and is not done (Jira says In Review; settle first); “Keep it short” is amber.");
  });
  test("every non-green milestone has a path to green, and every action names a team or says it needs one", () => {
    for (const b of [ds]) for (const m of b.status!.milestones) {
      if (m.computed !== "green") expect(m.path.length).toBeGreaterThan(0);
      for (const a of m.path) for (const t of a.teams) expect(b.model.teams.some((x) => x.id === t)).toBe(true);
    }
  });
  test("challenges: three to five, red first, each saying what, why it matters and who owns it", () => {
    for (const b of [ds]) {
      const c = b.status!.challenges;
      expect(c.length).toBeGreaterThanOrEqual(3);
      expect(c.length).toBeLessThanOrEqual(5);
      expect(c.map((x) => x.level)).toEqual([...c.map((x) => x.level)].sort((x, y) => (x === "red" ? 0 : 1) - (y === "red" ? 0 : 1)));
      for (const x of c) {
        expect(x.text).not.toMatch(/\b(U|PR|CL|PH|N|P)-\d+\b/); // no ids
        expect(x.text).toMatch(/owns|own it|own the|needs an owner|need an owner|nobody owns|tests it|test it|Whoever owns/i);
      }
    }
    expect(ds.status!.challenges[0].text).toBe("“Export stage timestamps to flow metrics” was due 9 Oct 2026 and is not done, and “Put lead time on the team dashboard” and “Measure review time per pull request” wait on it. Platform owns it.");
  });
  test("every status sentence passes the prose lint, and none carries an id", () => {
    for (const b of [ds]) {
      const texts = [b.status!.overall.text, ...b.status!.milestones.flatMap((m) => [...m.reasons.map((r) => r.text), ...m.path.map((a) => a.text)]), ...b.status!.challenges.map((c) => c.text), ...b.status!.risks.map((r) => r.text)];
      for (const t of texts) { expect(lint(t)).toEqual([]); expect(t).not.toMatch(/\b(U|PR|CL|PH)-\d+\b/); }
    }
  });
});

describe("on the page", () => {
  test("the status is an icon and a word, never colour alone", () => {
    expect(ragHtml("red")).toBe('<span class="st rag-red"><svg class="icon" aria-hidden="true" focusable="false"><use href="#i-rag-red"/></svg><span class="w">Red</span></span>');
  });
  test("each milestone panel carries its status, marker, reasons and path to green; the road and the Plan say it too", () => {
    const html = renderSite(ds);
    const see = statusBlock(ds, "SEE");
    expect(see).toContain('data-status="red"');
    expect(see).toContain(">Held up</span>");
    expect(see).toContain("Path to green");
    expect(see).toContain('data-ref="team:platform"');
    expect(statusBlock(ds, "SHORTEN")).toContain("Set to green by the delivery lead on 20 Oct 2026");
    expect(statusBlock(ds, "SHORTEN")).toContain("Computed from the plan: amber.");
    expect(html).toContain('<p class="status-line"><span class="st rag-red">');
    expect(html).toMatch(/<li class="current rag-red"/);
    for (const id of ["i-rag-red", "i-rag-amber", "i-rag-green"]) expect(html).toContain(`<symbol id="${id}"`);
  });
});
