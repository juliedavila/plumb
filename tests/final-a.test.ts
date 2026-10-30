// Status honesty and blockers: the status logic for later milestones,
// overrides with a review-by date and their flags, a red that may be a stale tracker record, the after side of a patch
// drawing, the tracker kept out of the model hash, the build printing the model hash, importer versions in snapshots
// and the churn they explain, deduplicated report snapshots, the reports-over-time strip, captions and decisions
// checked against computed verdicts, and the tour scrolling to a rule.
import { test, expect, describe } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePlan } from "../src/core/plan";
import { teamFacts } from "../src/core/teams";
import { planStatus } from "../src/core/status";
import { buildBundle, modelHash, ENGINE_VERSION } from "../src/core/bundle";
import { loadInstance } from "../src/core/load";
import { buildSummaryMd } from "../src/core/report";
import { makeSnapshot, saveSnapshot, statusHistory, uniqueReports } from "../src/core/snapshot";
import { sinceLine, reportCli } from "../src/core/report-cli";
import { DIGEST } from "../src/core/digest";
import { verdictConflict, statusConflicts } from "../src/core/text-checks";
import { buildDeck } from "../src/core/deck";
import { checkTour } from "../src/core/tour";
import { renderSite } from "../src/site/render";
import { statusBlock, overrideText, historyStrip } from "../src/site/status";
import type { Bundle, InstanceConfig, Phase, ReportSnapshot, Unit } from "../src/types";
import { DS_DIR } from "./instance-dirs.ts";

const BUILT = "2026-10-21T10:00:00.000Z";
const ROOT = new URL("..", import.meta.url).pathname;

function bundle(units: Unit[], o: { phases?: Phase[]; tracker?: Bundle["tracker"] } = {}): Bundle {
  const model = { teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], systems: [], zones: [], elements: [], relationships: [], contracts: [], views: [] };
  const plan = { phases: o.phases ?? [{ id: "M1", name: "First value", exit_test: "x", order: 1 }, { id: "M2", name: "Second value", exit_test: "y", order: 2 }], units };
  const config = { name: "t", title: "T", packs: [] } as InstanceConfig;
  const analysis = analyzePlan(plan);
  return {
    engine: { version: "0", built: BUILT, hash: "h" }, instance: { name: "t", title: "T", packs: [], ladder: [] },
    model, plan, findings: [], analysis, patches: [], layouts: [], teams: teamFacts(model, plan, config, analysis), ...(o.tracker ? { tracker: o.tracker } : {}) } as Bundle;
}
const U = (id: string, phase: string, x: Partial<Unit> = {}): Unit => ({ id, title: `Work ${id}`, kind: "code", phase, check: "done", owner: "a", ...x });
const run = (b: Bundle, reports?: (ReportSnapshot & { file: string })[]) => planStatus(b, { name: "t", title: "T", packs: [] } as InstanceConfig, reports ? { reports } : undefined).status;

describe("a later milestone is never greener than an earlier one it cannot pass", () => {
  test("an unreached earlier milestone that is not green keeps a later one amber, even with no dependency between them", () => {
    // M1's work could start and nothing is in progress (amber); M2's own work is in progress and waits on nothing
    const s = run(bundle([U("U-1", "M1"), U("U-2", "M2", { status: "doing" })]));
    expect(s.milestones.map((m) => [m.phase, m.computed])).toEqual([["M1", "amber"], ["M2", "amber"]]);
    const r = s.milestones[1].reasons.find((x) => x.criterion === "earlier-milestone")!;
    expect(r.text).toBe("It can be reached only after “First value”, which is amber.");
    expect(s.milestones[1].path.map((a) => a.text)).toEqual(["Bring “First value” to green first, by its own path."]);
  });
  test("the computed status counts, never the override: a person's green upstream does not clear the milestone after it", () => {
    const phases: Phase[] = [
      { id: "M1", name: "First value", exit_test: "x", order: 1, override: { status: "green", reason: "On course.", date: "2026-10-20", by: "the lead" } },
      { id: "M2", name: "Second value", exit_test: "y", order: 2 },
    ];
    const s = run(bundle([U("U-1", "M1", { due: "2026-10-01", provides: ["c1"], status: "doing" }), U("U-2", "M2", { requires: ["c1"] })], { phases }));
    expect(s.milestones.map((m) => [m.status, m.computed])).toEqual([["green", "red"], ["amber", "amber"]]);
    expect(s.milestones[1].reasons.map((r) => r.text)).toEqual(["Its work waits on “First value”, which is red."]);
  });
});

describe("overrides: a review-by date, flags on the card, the road and the slide, the move said as an override", () => {
  const phases = (o: Partial<Phase["override"] & object> = {}): Phase[] => [
    { id: "M1", name: "First value", exit_test: "x", order: 1 },
    { id: "M2", name: "Second value", exit_test: "y", order: 2, accountable: "the program lead", override: { status: "green", reason: "On course. Platform has committed to finish the export first.", date: "2026-10-20", by: "the delivery lead", ...o } },
  ];
  const units = [U("U-1", "M1", { due: "2026-10-01", provides: ["c1"], status: "doing" }), U("U-2", "M2", { requires: ["c1"] }), U("U-3", "M2", { owner: undefined })];
  test("a green override while an earlier milestone it waits on is red is flagged", () => {
    const m = run(bundle(units, { phases: phases() })).milestones[1];
    expect(m.flags?.map((f) => [f.kind, f.text])).toEqual([["upstream-red", "Set to green while “First value”, which it waits on, is red."]]);
  });
  test("a review-by date in the past is flagged; one still ahead is said beside the override", () => {
    const due = run(bundle(units, { phases: phases({ review_by: "2026-10-15" }) })).milestones[1];
    expect(due.flags?.map((f) => f.kind)).toEqual(["upstream-red", "review-due"]);
    expect(due.flags?.[1].text).toBe("Its review was due 15 Oct 2026.");
    const ahead = run(bundle(units, { phases: phases({ review_by: "2026-11-03" }) })).milestones[1];
    expect(ahead.flags?.map((f) => f.kind)).toEqual(["upstream-red"]);
    expect(overrideText(ahead.override!, ahead.computed)).toContain("review by 3 Nov 2026");
  });
  test("an override after which the computed status worsened is flagged, from the snapshot saved by the override's date", () => {
    const snap = { v: 1, saved: "2026-10-19T09:00:00Z", built: "x", hash: "old", digest: { v: 1, built: "x", hash: "old", r: {} }, phases: [], findings: { errors: 0, warnings: 0, byRule: {} },
      status: { overall: "amber", milestones: [{ id: "M2", status: "amber", computed: "amber" }] }, file: "reports/a.json" } as unknown as ReportSnapshot & { file: string };
    const m = run(bundle([U("U-1", "M1", { status: "done" }), U("U-2", "M2", { due: "2026-10-02" })], { phases: phases() }), [snap]).milestones[1];
    expect(m.computed).toBe("red");
    expect(m.flags?.map((f) => [f.kind, f.text])).toEqual([["worsened", "Its computed status went from amber to red after the override was set on 20 Oct 2026."]]);
  });
  test("accountable is on the milestone's status and the card names it in a needs-an-owner step; the card says how to set a status by hand", () => {
    const b = bundle(units, { phases: phases() });
    b.status = run(b);
    expect(b.status.milestones[1].accountable).toBe("the program lead");
    const html = statusBlock(b, "M2");
    expect(html).toContain("Accountable: the program lead");
    expect(html).toContain("Needs an owner: the program lead names one");
    expect(html).toContain("Set to green while “First value”, which it waits on, is red.");
    expect(html).toContain("<summary>Set a status by hand</summary>");
    expect(html).toContain("milestones.yaml");
  });
  test("the move is said as an override: amber to green by override, computed still amber", () => {
    const a = { v: 1, built: "", hash: "", r: {}, s: { o: "amber", m: { M2: "amber" }, c: { M2: "amber" } } };
    const b2 = { v: 1, built: "", hash: "", r: {}, s: { o: "green", m: { M2: "green" }, c: { M2: "amber" } } };
    const d = DIGEST.compare(a, b2, { "phase:M2": "Second value", __phases: ["M2"] });
    expect(d.status.moves[0]).toMatchObject({ from: "amber", to: "green", override: true, computed: "amber" });
    expect(DIGEST.moveText(d.status.moves[0])).toBe("“Second value” went amber to green by override; computed still amber");
  });
  test("the delivery stream: the override's full reason on the slide, and the flag on the card, the road and the slide", async () => {
    const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;
    const sh = ds.status!.milestones.find((m) => m.phase === "SHORTEN")!;
    expect(sh.flags?.[0].kind).toBe("upstream-red");
    const road = ds.deck!.slides.find((s) => s.template === "status")!.milestones!.find((m) => m.phase === "SHORTEN")!;
    expect(road.reason).toContain("Platform has committed to finish the timestamp export in the first week of November");
    expect(road.flags?.[0]).toBe("Set to green while “See the stream”, which it waits on, is red.");
    const html = renderSite(ds);
    expect(html).toContain("which it waits on, is red");
    expect(html).toContain('class="small ovr-flag" data-flag="upstream-red"');
  });
});

describe("a red that may be a stale record says so", () => {
  test("the delivery stream's status sentence: the slipped export is In Review in Jira, settle first", async () => {
    const ds = (await buildBundle(DS_DIR, { built: BUILT })).bundle;
    expect(ds.status!.overall.lead!.text).toBe("Overall red. “See the stream” is blocked: “Export stage timestamps to flow metrics” has slipped past its due date (Jira says In Review; settle first).");
    const r = ds.status!.milestones[0].reasons.find((x) => x.criterion === "slipped")!;
    expect(r.text).toContain("(Jira says In Review; settle first)");
  });
});

describe("the model hash: tracker settings left out; the build prints it", () => {
  test("engine.yaml's tracker and importer keys do not move the model hash", () => {
    const inst = loadInstance(join(ROOT, "examples/delivery-stream"));
    const h = modelHash(inst);
    inst.config.tracker = { export: "somewhere/else" };
    inst.config.importer = { tool: "x", version: "9" };
    expect(modelHash(inst)).toBe(h);
  });
  test("the build summary prints model: and the first twelve characters of the model hash", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    expect(buildSummaryMd(b, "/out", "site")).toContain(`- model: ${b.engine.modelHash!.slice(0, 12)} (a new patch's provenance.based_on)`);
  });
});

describe("history honesty: importer versions, churn said as churn, counts apart, snapshots deduplicated", () => {
  test("a change to titles and owners only is reworded, not changed; the comparison says the design did not change", () => {
    const base = bundle([U("U-1", "M1", { status: "doing" }), U("U-2", "M1")]);
    const next = structuredClone(base);
    next.plan.units[0].title = "A better title"; next.plan.units[1].owner = "b";
    const d = DIGEST.compare(DIGEST.digest(base), DIGEST.digest(next), DIGEST.names(next));
    expect(d.changed).toEqual([]);
    expect(d.reworded!.map((x) => x.id)).toEqual(["U-1", "U-2"]);
    expect(d.counts.unit).toEqual({ added: 0, removed: 0, changed: 0, reworded: 2 });
    expect(DIGEST.churnText(d, { from: { version: "1" }, to: { version: "2" } })).toBe("Titles and owners were re-derived by the importer (version 1 to 2); the design did not change.");
    // a structural change is still a change
    next.plan.units[1].requires = ["c9"];
    expect(DIGEST.compare(DIGEST.digest(base), DIGEST.digest(next), DIGEST.names(next)).changed.map((x) => x.id)).toEqual(["U-2"]);
  });
  test("the CLI's since line counts added, removed and changed apart", () => {
    const b = { sinceReport: { basis: "saved", against: { saved: "2026-10-20T09:00:00Z" }, diff: { findings: { added: [], gone: [] }, units: { ready: [], done: [] }, added: [{}], removed: [], changed: [{}, {}], reworded: [{}, {}, {}], notes: { added: [], answered: [], resolved: [] }, patches: { added: [], decided: [] }, claims: { regraded: [] },
      counts: { element: { added: 1, removed: 0, changed: 2, reworded: 3 } } } } } as unknown as Bundle;
    expect(sinceLine(b as never)).toBe("Since the report saved 2026-10-20T09:00:00Z (none was marked as presented): 1 record added, 2 changed and 3 reworded (titles or owners only).");
  });
  test("the changes slide says itself when the earlier report recorded no status", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    delete b.sinceReport!.diff.status;
    const d = buildDeck(b, { slides: [{ template: "changes" }] }).deck;
    expect(d.slides[0].lead).toMatch(/That report recorded no status, so no milestone's move can be shown/);
  });
  test("plumb report saves nothing new for a build it already saved, and --presented marks that one", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-final-a-"));
    cpSync(DS_DIR, d, { recursive: true });
    rmSync(join(d, "reports"), { recursive: true, force: true }); // a temporary copy: start with no snapshot
    const before = 0;
    const log: string[] = [], orig = console.log; console.log = (m: string) => log.push(m);
    try { await reportCli(d, []); await reportCli(d, []); await reportCli(d, ["--presented"]); } finally { console.log = orig; }
    const files = readdirSync(join(d, "reports"));
    expect(files.length).toBe(before + 1);
    expect(log.some((l) => /already saved/.test(l))).toBe(true);
    const newest = files.sort().at(-1)!;
    expect(JSON.parse(readFileSync(join(d, "reports", newest), "utf8")).presented).toBeTruthy();
  });
  test("uniqueReports keeps one snapshot per build hash, the presented one first", () => {
    const r = (file: string, hash: string, presented?: string) => ({ file, saved: file, hash, ...(presented ? { presented } : {}) }) as unknown as ReportSnapshot & { file: string };
    expect(uniqueReports([r("1", "a"), r("2", "a", "2"), r("3", "b"), r("4", "b")]).map((x) => x.file)).toEqual(["2", "4"]);
  });
});

describe("status over time", () => {
  test("a column per distinct report and one for now; a report with no status says so", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    const old = { file: "reports/old.json", saved: "2026-10-01T09:00:00Z", hash: "zz", built: "x", digest: { r: {} }, phases: [{ id: "SEE", name: "See", order: 1, total: 6, done: 2, doing: 0, ready: 1 }], findings: { errors: 0, warnings: 0, byRule: {} } } as unknown as ReportSnapshot & { file: string };
    const h = statusHistory(b, [old]);
    expect(h.columns.map((c) => [c.now ?? false, c.recorded])).toEqual([[false, false], [true, true]]);
    expect(h.columns[0].milestones.SEE).toEqual({ done: 2, total: 6 });
    expect(h.columns[1].milestones.SEE.status).toBe("red");
    expect(typeof h.columns[1].untested).toBe("number");
    const html = historyStrip(b, h);
    expect(html).toContain("Status over time");
    expect(html).toContain("Status not recorded");
    expect(html).toContain("2 of 6 done");
  });
  test("the Plan page carries the strip", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    expect(b.history?.columns.length).toBeGreaterThan(0);
    expect(renderSite(b)).toContain('id="status-history"');
  });
});

describe("captions and decisions are checked against what the build computed", () => {
  test("a claim of passing against a verdict that is not pass, and of breaking against one that passes", () => {
    expect(verdictConflict("It passes every check and removes one hand-off.", "caution")).toBe("says it passes every check, but its verdict is caution (passes, needs review)");
    expect(verdictConflict("It breaks no check, but needs review: it names work that is not done.", "caution")).toBeUndefined();
    expect(verdictConflict("Retiring the store passes every check.", "fail")).toMatch(/verdict is fail/);
    expect(verdictConflict("The patch that gets caught: it breaks a check.", "pass")).toMatch(/says it breaks a check/);
    expect(verdictConflict("Retiring the store breaks one check.", "fail")).toBeUndefined();
  });
  test("a status named for a milestone the build shows otherwise", () => {
    const b = bundle([U("U-1", "M1", { due: "2026-10-01", status: "doing" }), U("U-2", "M2", { status: "doing" })]);
    b.status = run(b);
    expect(statusConflicts("“First value” is green and on course.", b)).toEqual(["says “First value” is green; the build shows red"]);
    expect(statusConflicts("The current milestone is amber.", b)).toEqual(["says the current milestone is amber; the build shows red"]);
    expect(statusConflicts("“First value” is red.", b)).toEqual([]);
  });
  test("the decisions slide shows each named patch's verdict beside it, and the build warns on a contradiction", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    const { deck, warnings } = buildDeck(b, { slides: [{ template: "decisions", items: [{ decision: "Accept the fold", why: "It passes every check.", refs: ["P-001"] }] }, { template: "status", notes: "The current milestone is green." }] });
    expect(deck.slides[0].items![0].verdict).toEqual({ level: "caution", text: "Passes the checks; needs review" });
    expect(warnings.some((w) => /decisions\): item 1 says it passes every check, but its verdict is caution/.test(w))).toBe(true);
    expect(warnings.some((w) => /slide 2 \(status\) notes: says the current milestone is green; the build shows red/.test(w))).toBe(true);
  });
  test("a tour caption that claims a verdict is checked against the patch it shows", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    const tour = { title: "t", steps: [{ target: { patch: "P-001" }, title: "The patch that passes", say: "It passes every check." }] };
    expect(checkTour(tour as never, b)).toEqual(['tour step 1 ("The patch that passes"): says it passes every check, but its verdict is caution (passes, needs review)']);
  });
});

describe("the patch drawing's after side", () => {
  test("a patch that changes a wait carries both sides' flow values and findings for the drawing", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-final-a7-"));
    cpSync(DS_DIR, d, { recursive: true });
    writeFileSync(join(d, "patches/P-009-shorter-review.yaml"), "id: P-009\ntitle: Shorten the review wait\nstatus: proposed\nwhy: Review starts within a day.\nops:\n  - { op: modify, kind: element, id: code-review, set: { attrs: { wait_days: 1, flow_source: estimated, flow_as_of: \"2026-10-20\" } } }\n");
    const { bundle: b } = await buildBundle(d, { built: BUILT });
    const im = b.patches.find((p) => p.id === "P-009")!.impact;
    const sides = im.drawing!.change!.sides!;
    expect(sides.after.flow!["code-review"].wait!.value).toBe(1);
    expect(sides.before.flow!["code-review"].wait!.value).not.toBe(1);
  });
});

describe("the tour scrolls a rule or finding target into view", () => {
  test("tourAnchor names the rule block the Checks page renders", async () => {
    const { bundle: b } = await buildBundle(DS_DIR, { built: BUILT });
    const doc = renderSite(b);
    const i = doc.indexOf("</script>", doc.indexOf('id="de-bundle"')), o = doc.indexOf("<script>", i);
    const DE = new Function(doc.slice(o + 8, doc.indexOf("</script>", o)) + "\n;return DE;")();
    const a = DE.tourAnchor({ rule: "flow/queue-has-wip-limit" });
    expect(a).toBe("rule-flow-queue-has-wip-limit");
    expect(doc).toContain(`id="${a}"`);
    expect(DE.tourAnchor({ finding: "flow/queue-has-wip-limit@roadmap-backlog" })).toBe("rule-flow-queue-has-wip-limit");
    expect(DE.tourAnchor("checks")).toBeNull();
  });
});
