import { EX_DIR } from "./example-dirs.ts";
// Load by team across designs. Allowance, doing and ready;
// portfolio/team-over-capacity (an error on a next milestone's path, else a warning); portfolio/unit-has-flow-item;
// flow items set in progress.yaml over the plan's; reliefs and slowdowns over time; the most contended team; the
// distribution; root-patch verdicts that read the load. The example portfolio is the acceptance: its README's
// capacity table, ranking, reliefs, slowdown bet and P-005's verdict. The base fixture (tests/fixtures/portfolio/base)
// carries the edge cases, each test on a temporary copy.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadFacts, PortfolioData, PortfolioFinding, TeamLoad } from "../src/types.ts";
import { portfolioImpact, runPortfolio } from "../src/core/portfolio.ts";
import { loadInstance } from "../src/core/load.ts";
import { buildBundle, modelHash } from "../src/core/bundle.ts";
import { compile } from "../src/core/compile.ts";
import { toYaml } from "./seam04-helpers.ts";
import { } from "./instance-dirs.ts";

const DE = join(import.meta.dir, "..");
const EX = EX_DIR;
const FX = join(import.meta.dir, "fixtures/portfolio");
const BUILT = "2026-11-16T10:00:00Z";
const HAVE_EX = existsSync(join(EX, "portfolio/portfolio.yaml"));
const Y = (p: string): any => Bun.YAML.parse(readFileSync(p, "utf8"));
const yaml = (p: string, v: unknown) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, toYaml(v).trimStart() + "\n"); };
const edit = (p: string, f: (x: any) => void) => { const v = Y(p); f(v); yaml(p, v); };

/** A temporary copy of the base portfolio fixture. */
function fixture(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-load04-"));
  cpSync(join(FX, "base"), d, { recursive: true });
  return d;
}
function example(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-load04-ex-"));
  cpSync(EX, d, { recursive: true });
  return d;
}
async function check(d: string, opts: Parameters<typeof runPortfolio>[1] = {}): Promise<PortfolioData> {
  return (await runPortfolio(join(d, "portfolio"), { built: BUILT, ...opts })).data;
}
const loadOf = (data: PortfolioData): LoadFacts => { expect(data.load).toBeDefined(); return data.load!; };
const team = (L: LoadFacts, id: string): TeamLoad => L.teams.find((t) => t.team === `org:${id}`)!;
const of = (fs: PortfolioFinding[], rule: string) => fs.filter((f) => `${f.pack}/${f.rule}` === rule);
const brief = (f: PortfolioFinding) => `${f.pack}/${f.rule} ${f.severity} ${f.subject}`;
const est = (value: number, extra: Record<string, unknown> = {}) => ({ value, source: "person", by: "the team A lead", as_of: "2026-11-02", confidence: "medium", ...extra });
/** A team for the base's org.yaml. */
const orgTeam = (id: string, name: string, cap?: number) => ({ id, name, lead: `the ${name} lead`, row_owner: `the ${name} lead`, ...(cap !== undefined ? { capacity: est(cap, { by: `the ${name} lead` }) } : {}) });
/** Set alpha's or beta's progress.yaml. */
const progress = (d: string, design: string, units: Record<string, unknown>) => yaml(join(d, `designs/${design}/progress.yaml`), { units });
const doing = (date = "2026-11-09") => ({ status: "doing", date, by: "a lead" });
const done = (date = "2026-11-09") => ({ status: "done", date, by: "a lead" });

// ── the example portfolio: the example README is the acceptance ──────────────────────────────────────────────────────

describe.skipIf(!HAVE_EX)("load by team on the example portfolio (the README's expectations)", () => {
  let data: PortfolioData;
  const get = async () => (data ??= await check(example()));

  test("the capacity table: capacity in force, allowance, doing, and the open units on the next milestones' paths", async () => {
    const L = loadOf(await get());
    const row = (id: string) => { const t = team(L, id); return [t.capacity, t.allowance, t.doing, t.onPath]; };
    expect(row("appsec-platform")).toEqual([5, 3.65, ["intake:U-02"], ["intake:U-02", "intake:U-03", "premerge:U-03"]]);
    expect(row("vuln-mgmt")).toEqual([3, 2.7, ["intake:U-04", "intake:U-05", "intake:U-06"], ["intake:U-04", "intake:U-05", "intake:U-06", "intake:U-07"]]);
    expect(row("detection-response")).toEqual([4, 2.4, ["inventory:U-10", "inventory:U-11"], []]);
    expect(row("product-eng")).toEqual([2, 2, ["premerge:U-04", "premerge:U-05", "premerge:U-06"], []]);
    expect(row("dev-platform")).toEqual([3, 3, ["premerge:U-02"], ["premerge:U-02", "inventory:U-05", "inventory:U-07"]]);
    expect(row("governance-risk")).toEqual([4, 2.8, ["inventory:U-04"], ["inventory:U-04", "inventory:U-06", "inventory:U-08"]]);
    // the paths: each design's current milestone, and none reaches another design here
    expect(L.paths.map((p) => [p.design, p.milestone, p.units.length])).toEqual([["intake", "intake:M1", 6], ["premerge", "premerge:M1", 2], ["inventory", "inventory:M2", 5]]);
    expect(L.paths.find((p) => p.design === "inventory")!.reached).toEqual(["inventory:M1"]);
    // the two units Detection and response carries are transition work
    expect(team(L, "detection-response").doingBy).toEqual([{ design: "inventory", units: 2, transition: 2, discovered: 0 }]);
    // shares in force today: the slowdown holds triage at 0.10; inventory's M1 has brought audit evidence to 0.10
    expect(team(L, "vuln-mgmt").shares.map((s) => [s.activity, s.share, s.slots])).toEqual([["org:vuln-triage", 0.1, 0.3]]);
    expect(team(L, "governance-risk").shares.map((s) => [s.activity, s.share])).toEqual([["org:audit-evidence", 0.1], ["org:questionnaires", 0.2]]);
    expect(team(L, "governance-risk").standing).toBe(0.3);
    // the latest measure's unclassified time is shown apart and never counted in the allowance
    expect(team(L, "vuln-mgmt").unclassified).toMatchObject({ share: 0.1, slots: 0.3, as_of: "2026-11-01" });
    expect(team(L, "vuln-mgmt").calibration?.verdict).toBe("over");
    expect(L.counts).toEqual({ teams: 6, stated: 6, over: 2, overOnPath: 1, slowdownsRunning: 1 });
  });

  test("over capacity: Vulnerability management is an error on intake's path, Product engineering a warning, and no other team", async () => {
    const d = await get();
    const fs = of(d.findings, "portfolio/team-over-capacity");
    expect(fs.map(brief)).toEqual(["portfolio/team-over-capacity error org:vuln-mgmt", "portfolio/team-over-capacity warning org:product-eng"]);
    const [vm, pe] = fs;
    expect(vm.atKind).toBe("team");
    expect(vm.message).toStartWith("Vulnerability management (org:vuln-mgmt) has 3 units in doing against an allowance of 2.7: a limit of 3, less 0.3 for keeping the lights on and other streams.");
    expect(vm.message).toContain("It owns open work on the path to a next milestone: 4 units toward Findings intake's “Every scanner reports into intake”");
    expect(pe.message).toContain("against an allowance of 2: a limit of 2, with nothing taken for keeping the lights on or other streams");
    expect(pe.message).toContain("None of its open work is on the path to a design's next milestone");
    // no progress.yaml problem: intake U-10's entry only sets its flow item
    expect(of(d.findings, "core/progress-valid")).toEqual([]);
    expect(of(d.findings, "portfolio/unit-has-flow-item")).toEqual([]);
  });

  test("the most contended team is computed: Vulnerability management at 1.48, then Governance and risk at 1.07 and Developer platform at 1.00", async () => {
    const L = loadOf(await get());
    expect(L.contended).toMatchObject({ team: "org:vuln-mgmt", open: 4, allowance: 2.7, basis: "allowance" });
    expect(L.contended!.ratio).toBeCloseTo(1.48, 2);
    expect(L.contended!.next.map((t) => [t.team, Math.round(t.ratio! * 100) / 100])).toEqual([["org:governance-risk", 1.07], ["org:dev-platform", 1], ["org:appsec-platform", 0.82]]);
    expect(L.contended!.units.map((u) => [u.unit, u.milestoneName])).toEqual(["U-04", "U-05", "U-06", "U-07"].map((u) => [`intake:${u}`, "Every scanner reports into intake"]));
    expect(L.contended!.text).toBe("Vulnerability management is the most contended: 4 open units on the paths to the next milestones, against an allowance of 2.7 after keeping the lights on and other streams.");
    // load by team lists the most contended first; teams with nothing on a path come last
    expect(L.teams.map((t) => t.team)).toEqual(["org:vuln-mgmt", "org:governance-risk", "org:dev-platform", "org:appsec-platform", "org:detection-response", "org:product-eng"]);
    expect(L.teams.map((t) => t.contention.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(L.rule).toContain("divided by its allowance");
  });

  test("capacity returns: triage to 0.12 when intake's M2 lands, then to none with U-14 in M3; scanner rules to 0.08 with U-10, if on target", async () => {
    const L = loadOf(await get());
    const steps = (id: string) => team(L, id).timeline.steps.map((s) => [s.from, s.standing, s.allowance]);
    // the slowdown holds triage at 0.10 until M2, when U-09's relief (0.12) lands and the slowdown ends together
    expect(steps("vuln-mgmt")).toEqual([["2026-11-16", 0.1, 2.7], ["2027-01-29", 0.12, 2.64], ["2027-04-30", 0, 3]]);
    const m2 = team(L, "vuln-mgmt").timeline.steps[1].events;
    expect(m2.map((e) => [e.kind, e.from, e.to, e.ifOnTarget])).toEqual([["relief", 0.1, 0.12, true], ["slowdown-end", 0.1, 0.12, true]]);
    expect(m2[0].text).toBe("“Manual vulnerability triage and validation” falls to 12% when Findings intake's “Triage agent drafts severity and owner” is done, with “Findings flow into one queue” (target 29 Jan 2027), if on target.");
    expect(steps("appsec-platform")).toEqual([["2026-11-16", 0.27, 3.65], ["2027-01-29", 0.18, 4.1]]);
    // month by month to the horizon (12 months from November), and nothing that cannot be dated
    const months = team(L, "vuln-mgmt").timeline.months;
    expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10"]);
    expect(months.map((m) => m.standing)).toEqual([0.1, 0.1, 0.12, 0.12, 0.12, 0, 0, 0, 0, 0, 0, 0]);
    expect(L.teams.flatMap((t) => t.timeline.undated)).toEqual([]);
    expect(L.horizon).toEqual({ months: 12, to: "2027-10-31" });
  });

  test("the slowdown bet: triage at 0.10 instead of 0.34 frees 0.72 of a slot while medium and low findings wait", async () => {
    const L = loadOf(await get());
    expect(L.slowdowns).toHaveLength(1);
    const b = L.slowdowns[0];
    expect(b).toMatchObject({ id: "org:SD-1", state: "running", share: 0.34, during: 0.1, frees: 0.72, untilName: "Findings flow into one queue", untilTarget: "2027-01-29", flags: [] });
    expect(b.text).toContain("We are slowing “Manual vulnerability triage and validation” from 15 Nov 2026 until Findings intake's “Findings flow into one queue” (target 29 Jan 2027)");
    expect(b.text).toContain("That frees 0.72 of a slot for Vulnerability management");
    expect(b.text).toContain("Meanwhile, medium and low findings wait about 30 days for triage instead of about 5.");
    expect(b.text).toContain("Accepted by the security risk owner and the business risk owner on 10 Nov 2026; review by 15 Jan 2027.");
  });

  test("relief by a milestone already reached: the projected 10% beside the measured 24%, so the payoff has not landed", async () => {
    const L = loadOf(await get());
    const a = L.activities.find((x) => x.activity === "org:audit-evidence")!;
    expect([a.share, a.now, a.measured?.value]).toEqual([0.25, 0.1, 0.24]);
    expect(a.reliefs).toEqual([expect.objectContaining({ at: "inventory:M1", kind: "milestone", effect: "reduce", to: 0.1, landed: true, reachedOn: "2026-10-28" })]);
    expect(a.payoff).toMatchObject({ projected: 0.1, measured: 0.24, landed: false });
    expect(a.payoff!.text).toBe("Projected 10% after Asset inventory cleanup's “Know what we have” (reached 28 Oct 2026); measured 24%: the payoff has not landed.");
    // a relief that has not landed has no payoff to show yet
    expect(L.activities.find((x) => x.activity === "org:vuln-triage")!.payoff).toBeUndefined();
  });

  test("manual-work links: units relieving each kind, linked or not, each resting on a graded premise", async () => {
    const L = loadOf(await get());
    const kind = (k: string) => L.manualWork.find((m) => m.kind === `shared:${k}`)!;
    expect(kind("finding-triage").activities).toEqual(["org:vuln-triage"]);
    expect(kind("finding-triage").units.map((u) => [u.unit, u.linked, u.rests_on])).toEqual([["intake:U-09", true, "intake:IN-2"], ["intake:U-14", true, "intake:IN-4"], ["premerge:U-11", false, "premerge:PM-2"]]);
    expect(kind("retest-after-fix")).toMatchObject({ activities: [], units: [{ unit: "premerge:U-05", linked: false, rests_on: "premerge:PM-1" }] });
    expect(kind("evidence-gathering").units.map((u) => [u.unit, u.linked, u.rests_on])).toEqual([["inventory:U-03", true, "inventory:IV-2"]]); // linked through its milestone, M1
    expect(kind("rule-tuning").units.map((u) => [u.unit, u.linked, u.rests_on])).toEqual([["intake:U-10", true, "intake:IN-3"]]);
    expect(L.manualWork.flatMap((m) => m.units).every((u) => !!u.grade)).toBe(true);
  });

  test("flow items: intake U-10 set here over the plan's debt; open units by flow item per design; activities beside them", async () => {
    const L = loadOf(await get());
    expect(L.units["intake:U-10"].flow).toEqual({ item: "risk", source: "set", plan: "debt" });
    expect(L.units["intake:U-09"].flow).toEqual({ item: "feature", source: "plan" });
    const by = (ns: string) => { const x = L.distribution.designs.find((d) => d.design === ns)!; return Object.fromEntries(Object.entries(x.by).filter(([, n]) => n)); };
    expect(by("intake")).toEqual({ feature: 7, risk: 6 });
    expect(by("premerge")).toEqual({ feature: 1, risk: 7, debt: 2 });
    expect(by("inventory")).toEqual({ feature: 4, debt: 4 });
    expect(L.distribution.totals).toMatchObject({ open: 31, defaults: 0, set: 1, missing: 0, activities: { feature: 1, defect: 1, risk: 3, debt: 1 } });
    expect(L.distribution.text).toBe("31 open units: 12 feature, 13 risk and 6 debt. None still carries an edition's default. 1 value is set here, over the plan's.");
  });

  test("P-005 is a caution: Detection and response goes over capacity, AppSec platform and Governance and risk stay within", async () => {
    const im = await portfolioImpact(join(example(), "portfolio"), "P-005", { built: BUILT });
    expect(im.verdict.level).toBe("caution");
    expect(im.introduced.map(brief)).toEqual(["portfolio/team-over-capacity warning org:detection-response"]);
    expect(im.teams!.map((t) => [t.team, t.before.allowance, t.after.allowance, t.after.over])).toEqual([
      ["org:detection-response", 2.4, 1.92, true], ["org:appsec-platform", 3.65, 3.4, false], ["org:governance-risk", 2.8, 2.48, false],
    ]);
    expect(im.effect).toBe("Accepting P-005 adds one finding (portfolio/team-over-capacity on org:detection-response). Detection and response's allowance falls from 2.4 to 1.92, under its 2 units in doing; it goes over capacity. AppSec platform's free slots fall from 2.65 to 2.4; it stays within capacity. Governance and risk's free slots fall from 1.8 to 1.48; it stays within capacity.");
  });

  test("presenting composes premerge 1.0.0 with today's progress: the same teams in doing and over", async () => {
    const L = loadOf(await check(example(), { mode: "presenting" }));
    expect(L.teams.filter((t) => t.over).map((t) => [t.team, t.severity])).toEqual([["org:vuln-mgmt", "error"], ["org:product-eng", "warning"]]);
    expect(team(L, "product-eng").doing).toEqual(["premerge:U-04", "premerge:U-05", "premerge:U-06"]);
  });
});

// ── allowance, doing and the path ───────────────────────────────────────────────────────────────────────────────

describe("allowance, doing, ready and the path, on the base fixture", () => {
  test("allowance is capacity × (1 − the shares in force); the base is within capacity and reports nothing", async () => {
    const d = fixture();
    let data = await check(d);
    expect(data.findings).toEqual([]);
    let L = loadOf(data);
    expect([team(L, "team-a").standing, team(L, "team-a").allowance, team(L, "team-a").free]).toEqual([0.25, 3, 2]);
    expect([team(L, "team-b").standing, team(L, "team-b").allowance, team(L, "team-b").free]).toEqual([0, 4, 4]);
    // another stream for team B: 0.3 of 4 slots
    edit(join(d, "shared/org.yaml"), (o) => o.activities.push({ id: "reviews", team: "team-b", name: "Design reviews", type: "stream", flow_item: "feature", share: est(0.3, { by: "the team B lead" }) }));
    L = loadOf(await check(d));
    expect([team(L, "team-b").standing, team(L, "team-b").allowance]).toEqual([0.3, 2.8]);
    expect(team(L, "team-b").shares).toEqual([{ activity: "org:reviews", name: "Design reviews", type: "stream", share: 0.3, slots: 1.2, why: [] }]);
    // a team with no capacity stated is not judged, whatever it carries
    edit(join(d, "shared/org.yaml"), (o) => { delete o.teams[0].capacity; });
    data = await check(d);
    L = loadOf(data);
    expect(team(L, "team-a")).toMatchObject({ over: false, doing: ["alpha:AU-2"] });
    expect(team(L, "team-a").allowance).toBeUndefined();
    expect(team(L, "team-a").text).toBe("Team A's capacity is not stated, so its load cannot be weighed; it has 1 unit in doing.");
    expect(of(data.findings, "portfolio/team-over-capacity")).toEqual([]);
  });

  test("shares at 1 or more leave no allowance, and the finding says the standing work takes all of the team's capacity", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => {
      o.activities[0].share = est(0.6);
      o.activities.push({ id: "on-call", team: "team-a", name: "On-call", type: "bau", flow_item: "defect", share: est(0.4) });
    });
    const data = await check(d);
    const t = team(loadOf(data), "team-a");
    expect([t.standing, t.allTaken, t.allowance, t.free, t.over, t.severity]).toEqual([1, true, 0, -1, true, "error"]);
    const f = of(data.findings, "portfolio/team-over-capacity");
    expect(f.map(brief)).toEqual(["portfolio/team-over-capacity error org:team-a"]);
    expect(f[0].message).toStartWith("Team A (org:team-a) has 1 unit in doing, and its activities take all of its capacity: keeping the lights on and other streams leave none of its 4 slots for design work.");
    expect(of(data.findings, "org/shares-exceed-capacity").map((x) => x.at)).toEqual(["org:team-a"]);
    expect(t.text).toStartWith("Team A: keeping the lights on and other streams take all 4 slots of its limit, which leaves none for design work.");
  });

  test("a unit with two owner teams takes a slot on each", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => o.teams.push(orgTeam("team-c", "Team C", 2)));
    edit(join(d, "designs/alpha/model.yaml"), (m) => { m.elements.find((e: any) => e.id === "a-vault").owner = "team-c"; });
    edit(join(d, "designs/alpha/plan.yaml"), (p) => { p.units.find((u: any) => u.id === "AU-2").elements.push({ id: "a-vault", from: "none", to: "stand-in" }); });
    const L = loadOf(await check(d));
    expect(L.units["alpha:AU-2"].owners).toEqual(["org:team-a", "org:team-c"]);
    expect(team(L, "team-a").doing).toEqual(["alpha:AU-2"]);
    expect(team(L, "team-c").doing).toEqual(["alpha:AU-2"]);
    expect(team(L, "team-c").onPath).toEqual(["alpha:AU-2"]);
  });

  test("over capacity is a warning when none of the team's open work is on a next milestone's path, and an error when some is", async () => {
    const d = fixture();
    // team C owns alpha's vault, worked in A2, after the current milestone A1: in doing, over its allowance of 0.5
    edit(join(d, "shared/org.yaml"), (o) => {
      o.teams.push(orgTeam("team-c", "Team C", 1));
      o.activities.push({ id: "c-chores", team: "team-c", name: "Team C chores", type: "bau", flow_item: "debt", share: est(0.5, { by: "the Team C lead" }) });
    });
    edit(join(d, "designs/alpha/model.yaml"), (m) => { m.elements.find((e: any) => e.id === "a-vault").owner = "team-c"; });
    progress(d, "alpha", { "AU-1": done("2026-11-02"), "AU-2": doing(), "AU-3": doing() });
    let data = await check(d);
    let t = team(loadOf(data), "team-c");
    expect([t.allowance, t.doing, t.onPath, t.over, t.severity]).toEqual([0.5, ["alpha:AU-3"], [], true, "warning"]);
    expect(of(data.findings, "portfolio/team-over-capacity").map(brief)).toEqual(["portfolio/team-over-capacity warning org:team-c"]);
    expect(of(data.findings, "portfolio/team-over-capacity")[0].message).toContain("so the overrun slows later work rather than the next milestones");
    // once A1 is reached, A2 is alpha's current milestone and the vault work is on its path: an error
    progress(d, "alpha", { "AU-1": done("2026-11-02"), "AU-2": done(), "AU-3": doing() });
    data = await check(d);
    t = team(loadOf(data), "team-c");
    expect([t.onPath, t.severity]).toEqual([["alpha:AU-3"], "error"]);
    expect(of(data.findings, "portfolio/team-over-capacity")[0].message).toContain("1 unit toward Alpha's “Alpha keeps its secret”, so the overrun holds that milestone back");
  });

  test("the path runs across designs: beta's current milestone waits on alpha's unit through a shared capability; ready work is the queue", async () => {
    const d = fixture();
    let L = loadOf(await check(d));
    expect(L.paths.map((p) => [p.design, p.milestone, p.units])).toEqual([["alpha", "alpha:A1", ["alpha:AU-2"]], ["beta", "beta:B1", ["beta:BU-1", "alpha:AU-2"]]]);
    expect(team(L, "team-b").onPath).toEqual(["beta:BU-1"]);
    expect(team(L, "team-a").ready).toEqual(["alpha:AU-3"]); // AU-3 needs only AU-1's capability, which is done
    expect(team(L, "team-b").ready).toEqual([]);          // BU-1 waits on alpha's spec
    progress(d, "alpha", { "AU-1": done("2026-11-02"), "AU-2": done() });
    L = loadOf(await check(d));
    expect(team(L, "team-b").ready).toEqual(["beta:BU-1"]);
  });
});

// ── reliefs and slowdowns over time ─────────────────────────────────────────────────────────────────────────────

describe("reliefs and slowdowns over time", () => {
  test("relief by a unit: retire lands when the unit is done; until then on its milestone's target, if on target", async () => {
    const d = fixture();
    let L = loadOf(await check(d));
    let a = L.activities[0];
    expect(a.reliefs).toEqual([expect.objectContaining({ at: "alpha:AU-3", kind: "unit", effect: "retire", to: 0, landed: false, date: "2027-03-15", milestone: "alpha:A2" })]);
    expect(team(L, "team-a").timeline.steps.map((s) => [s.from, s.standing, s.allowance])).toEqual([["2026-11-16", 0.25, 3], ["2027-03-15", 0, 4]]);
    expect(team(L, "team-a").timeline.steps[1].events[0].text).toBe("“Chores” ends when Alpha's “Keep the secret in the vault” is done, with “Alpha keeps its secret” (target 15 Mar 2027), if on target.");
    progress(d, "alpha", { "AU-1": done("2026-11-02"), "AU-2": doing(), "AU-3": done("2026-11-12") });
    L = loadOf(await check(d));
    a = L.activities[0];
    expect([a.now, a.reliefs[0].landed, a.reliefs[0].reachedOn, team(L, "team-a").allowance]).toEqual([0, true, "2026-11-12", 4]);
    expect(a.why).toEqual(["Alpha's “Keep the secret in the vault” is done"]);
    expect(a.payoff?.text).toBe("Projected 0% after Alpha's “Keep the secret in the vault” (done 12 Nov 2026); not measured yet, so whether the payoff has landed is not known.");
  });

  test("relief by a milestone: reduce lands when it is reached, and a later relief never raises a share", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => { o.activities[0].relieved_by = [{ at: "alpha:A2", effect: "retire" }, { at: "alpha:A1", effect: "reduce", to: est(0.1) }]; });
    let L = loadOf(await check(d));
    // A1 lands on 15 Dec (0.10), A2 on 15 Mar (none)
    expect(team(L, "team-a").timeline.steps.map((s) => [s.from, s.standing])).toEqual([["2026-11-16", 0.25], ["2026-12-15", 0.1], ["2027-03-15", 0]]);
    progress(d, "alpha", { "AU-1": done("2026-11-02"), "AU-2": done("2026-11-10"), "AU-3": done("2026-11-14") });
    L = loadOf(await check(d));
    // both landed: retire wins whatever order they are listed in
    expect([L.activities[0].now, team(L, "team-a").allowance]).toEqual([0, 4]);
    expect(L.activities[0].reliefs.map((r) => [r.at, r.landed, r.reachedOn])).toEqual([["alpha:A2", true, "2026-11-14"], ["alpha:A1", true, "2026-11-10"]]);
  });

  test("a milestone with no target, or one past its target and not reached, goes to the No date column", async () => {
    const d = fixture();
    edit(join(d, "designs/alpha/plan.yaml"), (p) => { delete p.phases.find((x: any) => x.id === "A2").target; });
    let L = loadOf(await check(d));
    let t = team(L, "team-a");
    expect(t.timeline.steps.map((s) => s.from)).toEqual(["2026-11-16"]);
    expect(t.timeline.months.every((m) => m.standing === 0.25)).toBe(true);
    expect(t.timeline.undated.map((e) => [e.kind, e.at, e.from, e.to])).toEqual([["relief", "alpha:AU-3", 0.25, 0]]);
    expect(t.timeline.undated[0].text).toBe("“Chores” ends when Alpha's “Keep the secret in the vault” is done, with “Alpha keeps its secret”, which cannot be dated: “Alpha keeps its secret” has no target date.");
    // past its target: A1 was due on 1 Nov, and AU-2 is still in doing
    edit(join(d, "shared/org.yaml"), (o) => { o.activities[0].relieved_by = [{ at: "alpha:A1", effect: "reduce", to: est(0.1) }]; });
    edit(join(d, "designs/alpha/plan.yaml"), (p) => { p.phases.find((x: any) => x.id === "A1").target = "2026-11-01"; });
    L = loadOf(await check(d));
    t = team(L, "team-a");
    expect(L.activities[0].reliefs[0]).toMatchObject({ landed: false, undated: "“Alpha takes in and sends” was due 1 Nov 2026 and is not reached" });
    expect(t.timeline.undated.map((e) => e.to)).toEqual([0.1]);
  });

  test("slowdown windows: not started, running and ended; each ends on its milestone's target, the day after its date, or at max_until", async () => {
    const d = fixture();
    const sd = (id: string, from: string, until: string, during: number, extra: Record<string, unknown> = {}) => ({
      id, activity: "chores", what: "Do only the chores that cannot wait.", share_during: est(during), from, until,
      risk: { rises: "Small chores pile up for a while." }, accepted_by: ["the risk owner"], accepted_at: "2026-11-01", ...extra });
    edit(join(d, "shared/org.yaml"), (o) => { o.slowdowns = [sd("SD-1", "2026-12-01", "alpha:A2", 0.1), sd("SD-2", "2026-10-01", "2026-11-01", 0.05)]; });
    let L = loadOf(await check(d));
    expect(L.slowdowns.map((b) => [b.id, b.state, b.share, b.during, b.frees])).toEqual([["org:SD-1", "not started", 0.25, 0.1, 0.6], ["org:SD-2", "ended", 0.25, 0.05, 0.8]]);
    expect(L.slowdowns[0].text).toStartWith("We will slow “Chores” from 1 Dec 2026 until Alpha's “Alpha keeps its secret” (target 15 Mar 2027): do only the chores that cannot wait.");
    expect(L.slowdowns[1].text).toContain("That freed 0.8 of a slot for Team A");
    // SD-1 dips the band from 1 Dec until A2's target, when AU-3's relief also lands
    expect(team(L, "team-a").timeline.steps.map((s) => [s.from, s.standing, s.events.map((e) => e.kind)])).toEqual([
      ["2026-11-16", 0.25, []], ["2026-12-01", 0.1, ["slowdown-start"]], ["2027-03-15", 0, ["relief", "slowdown-end"]],
    ]);
    expect(team(L, "team-a").timeline.months.slice(0, 2).map((m) => m.standing)).toEqual([0.25, 0.1]);
    // running now with a date: in force through its date, ended the day after; max_until caps a milestone end
    edit(join(d, "shared/org.yaml"), (o) => { o.slowdowns = [sd("SD-3", "2026-11-10", "2026-12-31", 0.1), sd("SD-4", "2026-11-10", "alpha:A2", 0.2, { max_until: "2027-01-31" })]; });
    L = loadOf(await check(d));
    expect(L.slowdowns.map((b) => b.state)).toEqual(["running", "running"]);
    expect(L.counts.slowdownsRunning).toBe(2);
    expect(team(L, "team-a").timeline.steps.map((s) => [s.from, s.standing])).toEqual([["2026-11-16", 0.1], ["2027-01-01", 0.2], ["2027-02-01", 0.25], ["2027-03-15", 0]]);
    expect(team(L, "team-a").shares[0].why).toEqual(["the slowdown from 10 Nov 2026 holds it at 10%"]); // named by when it started, never by its id
  });

  test("a slowdown that is not whole is not applied and frees nothing", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => { o.slowdowns = [{ id: "SD-1", activity: "chores", what: "Fewer chores.", share_during: est(0.1), from: "2026-11-01", until: "alpha:A2", risk: { rises: "Chores pile up." }, accepted_at: "2026-11-01" }]; });
    const data = await check(d);
    const L = loadOf(data);
    expect([L.slowdowns[0].state, team(L, "team-a").standing]).toEqual(["not applied", 0.25]);
    expect(L.slowdowns[0].flags[0]).toContain("names no one who accepted it");
    expect(of(data.findings, "org/slowdown-valid").map((f) => f.at)).toEqual(["org:SD-1"]);
  });
});

// ── the most contended team ─────────────────────────────────────────────────────────────────────────────────────

describe("the most contended team and its tie rules", () => {
  test("open units on the paths divided by the allowance: Team A at 1 in 3 before Team B at 1 in 4", async () => {
    const L = loadOf(await check(fixture()));
    expect(L.teams.map((t) => [t.team, t.contention.open, t.contention.ratio, t.contention.basis])).toEqual([["org:team-a", 1, 0.3333, "allowance"], ["org:team-b", 1, 0.25, "allowance"]]);
    expect(L.contended).toMatchObject({ team: "org:team-a", basis: "allowance" });
  });

  test("a team with no allowance left ranks first, whatever the others' ratios", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => o.activities.push({ id: "b-run", team: "team-b", name: "Run the old beta", type: "bau", flow_item: "defect", share: est(1, { by: "the team B lead" }) }));
    const L = loadOf(await check(d));
    expect(L.contended).toMatchObject({ team: "org:team-b", basis: "no allowance", allowance: 0, open: 1 });
    expect(L.contended!.ratio).toBeUndefined();
    expect(L.contended!.text).toBe("Team B is the most contended: 1 open unit on the paths to the next milestones, and keeping the lights on and other streams take all of its capacity.");
  });

  test("ties go to the most open units, then the name", async () => {
    const d = fixture();
    // Team B: 2 open units on beta's path against 6 slots, the same 1 in 3 as Team A
    edit(join(d, "shared/org.yaml"), (o) => { o.teams[1].capacity = est(6, { by: "the team B lead" }); });
    edit(join(d, "designs/beta/plan.yaml"), (p) => p.units.push({ id: "BU-3", title: "Check the spec", kind: "code", phase: "B1", elements: [{ id: "b-out", from: "none", to: "stand-in" }], requires: ["cap.b"], check: "The spec is checked.", flow_item: "risk" }));
    let L = loadOf(await check(d));
    expect(L.teams.slice(0, 2).map((t) => [t.team, t.contention.open, t.contention.ratio])).toEqual([["org:team-b", 2, 0.3333], ["org:team-a", 1, 0.3333]]);
    // equal ratios and equal open units: by name
    edit(join(d, "designs/beta/plan.yaml"), (p) => { p.units = p.units.filter((u: any) => u.id !== "BU-3"); });
    edit(join(d, "shared/org.yaml"), (o) => { o.teams[1].capacity = est(3, { by: "the team B lead" }); });
    L = loadOf(await check(d));
    expect(L.teams.map((t) => [t.team, t.contention.ratio])).toEqual([["org:team-a", 0.3333], ["org:team-b", 0.3333]]);
  });

  test("a team with no capacity stated ranks by its open units alone, and says so; with nothing on any path there is none", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (o) => { delete o.teams[1].capacity; });
    let L = loadOf(await check(d));
    expect(L.contended).toMatchObject({ team: "org:team-b", basis: "work alone", open: 1 });
    expect(L.contended!.text).toBe("Team B is the most contended by its work alone: 1 open unit on the paths to the next milestones; its capacity is not stated.");
    // every milestone reached: nothing on any path
    progress(d, "alpha", { "AU-1": done(), "AU-2": done(), "AU-3": done() });
    progress(d, "beta", { "BU-1": done(), "BU-2": done() });
    L = loadOf(await check(d));
    expect(L.contended).toBeUndefined();
    expect(L.paths.every((p) => !p.milestone && !p.units.length)).toBe(true);
  });
});

// ── flow items ──────────────────────────────────────────────────────────────────────────────────────────────────

describe("flow items: defaults, set here, and the rule", () => {
  test("progress.yaml sets a flow item over the plan's with no date or by; a value that is not one of the four is an error and is not applied", async () => {
    const d = fixture();
    progress(d, "beta", { "BU-2": { flow_item: "debt" } });
    let data = await check(d);
    expect(data.findings).toEqual([]);
    let L = loadOf(data);
    expect(L.units["beta:BU-2"].flow).toEqual({ item: "debt", source: "set", plan: "feature" });
    expect(L.distribution.designs.find((x) => x.design === "beta")).toMatchObject({ by: { feature: 1, debt: 1, risk: 0, defect: 0 }, set: 1, defaults: 0 });
    // with a status beside it, the status is checked as before and the flow item still applies
    progress(d, "beta", { "BU-2": { flow_item: "risk", status: "doing" } });
    data = await check(d);
    expect(of(data.findings, "core/progress-valid").map((f) => [f.subject, f.message])).toEqual([["beta:BU-2", "progress.yaml: the status of BU-2 gives no date (date: YYYY-MM-DD), does not say who set it (by); it is not applied"]]);
    expect(loadOf(data).units["beta:BU-2"].flow?.item).toBe("risk");
    // a value that is not feature, defect, risk or debt
    progress(d, "beta", { "BU-2": { flow_item: "chore" } });
    data = await check(d);
    expect(of(data.findings, "core/progress-valid").map((f) => f.message)).toEqual(['progress.yaml: the flow item of BU-2 is "chore", which is not feature, defect, risk or debt; it is not applied']);
    L = loadOf(data);
    expect(L.units["beta:BU-2"].flow).toEqual({ item: "feature", source: "plan" });
  });

  test("a lone instance reads progress.yaml as before: a flow item is not read, and an entry with nothing else is an incomplete status", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-load04-lone-"));
    cpSync(join(import.meta.dir, "fixtures/mini"), d, { recursive: true });
    const before = modelHash(loadInstance(d));
    writeFileSync(join(d, "progress.yaml"), "units:\n  u2: { flow_item: risk }\n  u3: { status: doing, date: \"2026-11-02\", by: the shop lead, flow_item: risk }\n");
    const inst = loadInstance(d);
    expect(inst.loadFindings?.filter((f) => f.rule === "progress-valid").map((f) => f.at)).toEqual(["u2"]);
    const c = compile(inst);
    expect(c.plan.units.find((u) => u.id === "u3")!.status).toBe("doing");
    expect(c.plan.units.some((u) => u.attrs?.flow_item_set !== undefined)).toBe(false);
    rmSync(join(d, "progress.yaml"));
    expect(modelHash(loadInstance(d))).toBe(before);
  });

  test("an imported design's plan values are its edition's defaults, counted apart; one set here is no longer a default", async () => {
    const d = fixture();
    writeFileSync(join(d, "designs/beta/engine.yaml"), readFileSync(join(d, "designs/beta/engine.yaml"), "utf8") + "importer: { tool: fixture, version: \"1\" }\n");
    progress(d, "beta", { "BU-1": { flow_item: "risk" } });
    const L = loadOf(await check(d));
    expect([L.units["beta:BU-1"].flow, L.units["beta:BU-2"].flow]).toEqual([{ item: "risk", source: "set", plan: "feature" }, { item: "feature", source: "default" }]);
    expect(L.units["alpha:AU-2"].flow).toEqual({ item: "feature", source: "plan" });
    expect(L.distribution.designs.map((x) => [x.design, x.defaults, x.set])).toEqual([["alpha", 0, 0], ["beta", 1, 1]]);
    expect(L.distribution.text).toBe("4 open units: 2 feature and 2 risk. 1 of them still carries an edition's default. 1 value is set here, over the plan's.");
  });

  test("unit-has-flow-item runs only where the root has an org layer: in the design's own build, and once in the portfolio", async () => {
    const d = fixture();
    edit(join(d, "designs/beta/plan.yaml"), (p) => { delete p.units.find((u: any) => u.id === "BU-2").flow_item; p.units.find((u: any) => u.id === "BU-1").flow_item = "chore"; });
    const run = await runPortfolio(join(d, "portfolio"), { built: BUILT });
    const fs = of(run.data.findings, "portfolio/unit-has-flow-item");
    expect(fs.map((f) => [f.severity, f.subject, f.alsoIn])).toEqual([["warning", "beta:BU-1", ["beta"]], ["warning", "beta:BU-2", ["beta"]]]);
    expect(fs[0].message).toBe('Unit beta:BU-1 (“Take the spec in”) has the flow item "chore", which is not feature, defect, risk or debt');
    expect(run.designs.find((x) => x.namespace === "beta")!.findings.filter((f) => f.rule === "unit-has-flow-item").map((f) => f.at)).toEqual(["BU-1", "BU-2"]);
    // with no org layer in the root, no unit is held to a flow item and no load is computed
    rmSync(join(d, "shared/org.yaml"));
    const data = await check(d);
    expect(of(data.findings, "portfolio/unit-has-flow-item")).toEqual([]);
    expect(of(data.findings, "portfolio/team-over-capacity")).toEqual([]);
    expect(data.load).toBeUndefined();
    const { bundle } = await buildBundle(join(d, "designs/beta"), { built: BUILT });
    expect(bundle.findings.filter((f) => f.rule === "unit-has-flow-item")).toEqual([]);
  });
});

// ── root-patch verdicts ─────────────────────────────────────────────────────────────────────────────────────────

describe("root-patch verdicts read the load", () => {
  function withPatch(d: string, id: string, ops: unknown[], status = "proposed") {
    yaml(join(d, `shared/patches/${id}.yaml`), { id, title: `Patch ${id}`, status, why: "A change of numbers.", provenance: { author: "person", requested_by: "the team A lead", created: "2026-11-10" }, ops });
  }

  test("a patch that puts a team with work on a next milestone's path over capacity fails, and says what moves", async () => {
    const d = fixture();
    withPatch(d, "P-001", [{ op: "modify", kind: "team", id: "team-a", set: { capacity: est(1) } }]);
    const im = await portfolioImpact(join(d, "portfolio"), "P-001", { built: BUILT });
    expect(im.verdict.level).toBe("fail");
    expect(im.introduced.map(brief)).toEqual(["portfolio/team-over-capacity error org:team-a"]);
    expect(im.teams!.map((t) => [t.team, t.before, t.after])).toEqual([["org:team-a", { allowance: 3, doing: 1, free: 2, over: false }, { allowance: 0.75, doing: 1, free: -0.25, over: true }]]);
    expect(im.effect).toBe("Accepting P-001 adds one finding (portfolio/team-over-capacity on org:team-a). Team A's allowance falls from 3 to 0.75, under its 1 unit in doing; it goes over capacity.");
  });

  test("a patch that only frees slots passes, and its effect says what moves; a slowdown patch that ends an overrun resolves it", async () => {
    const d = fixture();
    withPatch(d, "P-001", [{ op: "modify", kind: "team", id: "team-b", set: { capacity: est(5, { by: "the team B lead" }) } }]);
    let im = await portfolioImpact(join(d, "portfolio"), "P-001", { built: BUILT });
    expect([im.verdict.level, im.introduced, im.resolved]).toEqual(["pass", [], []]);
    expect(im.effect).toBe("Accepting P-001 changes no finding of the portfolio. Team B's free slots rise from 4 to 5; it stays within capacity.");
    // Team A over (a limit of 1); a proposed slowdown of its chores brings it back within capacity
    edit(join(d, "shared/org.yaml"), (o) => { o.teams[0].capacity = est(1); });
    withPatch(d, "P-002", [{ op: "add", kind: "slowdown", value: { id: "SD-1", activity: "chores", what: "Only urgent chores.", share_during: est(0), from: "2026-11-15", until: "alpha:A1", risk: { rises: "Chores wait." }, accepted_by: ["the risk owner"], accepted_at: "2026-11-15" } }]);
    im = await portfolioImpact(join(d, "portfolio"), "P-002", { built: BUILT });
    expect(im.verdict.level).toBe("pass");
    expect(im.resolved.map(brief)).toEqual(["portfolio/team-over-capacity error org:team-a"]);
    expect(im.teams!.map((t) => t.text)).toEqual(["Team A's allowance rises from 0.75 to 1, enough for its 1 unit in doing; it comes back within capacity."]);
  });
});

describe("a lone instance behaves as today", () => {
});
