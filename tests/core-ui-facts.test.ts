// Model facts core computes for the interface: transitive unblock counts, view groups, the zone summary, zone bands
// and stable layer order, record snapshots and field changes, the unbacked-claim check, the before-and-after drawing,
// patch provenance, the model hash, and the tour's target check.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle, modelHash } from "../src/core/bundle.ts";
import { computeImpact, mentions } from "../src/core/impact.ts";
import { layoutView } from "../src/core/layout.ts";
import { loadInstance, normPatch } from "../src/core/load.ts";
import { analyzePlan } from "../src/core/plan.ts";
import { loadPacks } from "../src/core/rules.ts";
import { modelSummary, viewGroups } from "../src/core/summary.ts";
import { checkTour, loadTour, normTarget } from "../src/core/tour.ts";
import { unblockRanking } from "../src/mcp/tools.ts";
import type { Model } from "../src/types.ts";
import { E, MINI, PH, R, U, model, plan } from "./core-helpers.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = new URL("..", import.meta.url).pathname;

describe("transitive unblocks", () => {
  test("counts every open unit downstream, once, through chains and diamonds", () => {
    const p = plan({
      phases: [PH("ph1", 1)],
      units: [
        U("a", { provides: ["x"] }),
        U("b", { requires: ["x"], provides: ["y"] }),
        U("c", { requires: ["x"], provides: ["z"] }),
        U("d", { requires: ["y", "z"] }),
        U("e", { requires: ["x"], status: "done" }),
      ] as any });
    const a = analyzePlan(p);
    expect(a.unblocksTransitive).toEqual({ a: 3, b: 1, c: 1, d: 0 }); // e is done: neither counted nor ranked
  });
});

describe("view groups and the summary", () => {
  test("named groups keep first-appearance order; the rest go to one group", () => {
    const vs = [{ id: "a", title: "A", elements: [], group: "G2" }, { id: "b", title: "B", elements: [] }, { id: "c", title: "C", elements: [], group: "G1" }, { id: "d", title: "D", elements: [], group: "G2" }];
    expect(viewGroups(vs)).toEqual([{ name: "G2", views: ["a", "d"] }, { name: "G1", views: ["c"] }, { name: "Other views", views: ["b"] }]);
    expect(viewGroups([vs[1]])).toEqual([{ name: "Views", views: ["b"] }]);
  });
  test("one box per zone with counts, edges by kind, and a layout of the boxes", () => {
    const m: Model = model({
      zones: [{ id: "z1", name: "One" }, { id: "z2", name: "Two" }],
      elements: [E("a", { zone: "z1" }), E("b", { zone: "z1", kind: "store" }), E("c", { zone: "z2" }), E("d")] as any,
      relationships: [R("r1", "a", "c"), R("r2", "b", "c", { kind: "control" }), R("r3", "a", "b"), R("r4", "c", "d")] as any,
      views: [{ id: "v", title: "V", elements: ["a", "b"] }] });
    const s = modelSummary(m)!;
    expect(s.by).toBe("zone");
    expect(s.groups.map((g) => [g.id, g.elements.length, g.view ?? null])).toEqual([["z1", 2, "v"], ["z2", 1, null], ["", 1, null]]);
    expect(s.groups[0].kinds).toEqual({ service: 1, store: 1 });
    const e = s.edges.find((x) => x.from === "z1" && x.to === "z2")!;
    expect(e.count).toBe(2);
    expect(e.kinds).toEqual({ data: 1, control: 1 });
    expect(s.edges.find((x) => x.from === "z1" && x.to === "z1")!.count).toBe(1); // the matrix diagonal
    expect(s.layout.nodes.map((n) => n.id).sort()).toEqual(["__none", "z1", "z2"]);
    expect(s.layout.edges.every((x) => x.from !== x.to)).toBe(true);
    expect(modelSummary(model({ elements: [E("a")] as any }))).toBeUndefined();
  });
});

describe("layout", () => {
  const m: Model = model({
    zones: [{ id: "top", name: "Top" }, { id: "bottom", name: "Bottom" }],
    elements: [E("a", { zone: "bottom" }), E("b", { zone: "top" }), E("c", { zone: "bottom" }), E("d", { zone: "top" })] as any,
    relationships: [R("r1", "a", "b"), R("r2", "a", "c"), R("r3", "b", "d"), R("r4", "c", "d")] as any });
  const v = { id: "v", title: "V", elements: ["a", "b", "c", "d"] };
  test("two zones give two bands in the model's zone order, and each node sits inside its own band", () => {
    const L = layoutView(m, v);
    expect(L.bands!.map((b) => b.zone)).toEqual(["top", "bottom"]);
    const band = (z: string) => L.bands!.find((b) => b.zone === z)!;
    for (const n of L.nodes) {
      const z = m.elements.find((e) => e.id === n.id)!.zone!;
      expect(n.y).toBeGreaterThanOrEqual(band(z).y);
      expect(n.y + n.h).toBeLessThanOrEqual(band(z).y + band(z).h);
    }
    expect(L.order!.flat().sort()).toEqual(["a", "b", "c", "d"]);
  });
  test("one zone: no bands", () => {
    expect(layoutView(model({ elements: [E("a"), E("b")] as any, relationships: [R("r", "a", "b")] as any }), { id: "v", title: "V", elements: ["a", "b"] }).bands).toBeUndefined();
  });
  test("a seed order is kept when it is as good, so a rebuild does not reshuffle", () => {
    const m2: Model = model({ elements: [E("s"), E("x"), E("y")] as any, relationships: [R("r1", "s", "x"), R("r2", "s", "y")] as any });
    const v2 = { id: "v", title: "V", elements: ["s", "x", "y"] };
    const plain = layoutView(m2, v2);
    expect(plain.order).toEqual([["s"], ["x", "y"]]);
    const seeded = layoutView(m2, v2, { seed: [["s"], ["y", "x"]] });
    expect(seeded.order).toEqual([["s"], ["y", "x"]]);
  });
  test("the transpose pass removes a crossing the sweeps leave", () => {
    const m3: Model = model({ elements: [E("a1"), E("a2"), E("b1"), E("b2")] as any, relationships: [R("r1", "a1", "b2"), R("r2", "a2", "b1")] as any });
    const L = layoutView(m3, { id: "v", title: "V", elements: ["a1", "a2", "b1", "b2"] });
    const y = (id: string) => L.nodes.find((n) => n.id === id)!.y;
    expect(Math.sign(y("a1") - y("a2"))).toBe(Math.sign(y("b2") - y("b1")));
  });
});

describe("impact additions", () => {
  test("a relationship a proposed patch adds is named from the patch, not reported missing", async () => {
    const { bundle } = await buildBundle(DS_DIR, { built: "t" });
    const p = bundle.patches.find((x) => x.id === "P-001")!;
    const h16 = p.impact.records!["relationship:h16"];
    expect(h16).toEqual({ kind: "relationship", id: "h16", name: "Passing test report", from: "manual-test", to: "deploy-service", relKind: "handoff", label: "Passing test report" });
    expect(bundle.model.relationships.some((r) => r.id === "h16")).toBe(false); // proposed: not in the compiled model
    expect(p.impact.records!["element:release-approval"].name).toBeTruthy(); // removed, still named
    const fc = p.impact.fieldChanges!.find((f) => f.id === "TestReport")!;
    expect(fc).toEqual({ kind: "contract", id: "TestReport", field: "consumed_by", before: "manual-test, release-approval", after: "manual-test, deploy-service" });
  });
  test("mention matching strips punctuation and skips words that are not ids", () => {
    const m = model({ elements: [E("s3.audit")] as any, relationships: [R("r042", "s3.audit", "s3.audit")] as any });
    const out = mentions("Drop s3.audit. Edges (r042, r9) and the audit stay.", [{ model: m, plan: plan() }]);
    expect(out).toEqual([{ kind: "element", id: "s3.audit" }, { kind: "relationship", id: "r042" }]);
  });
  test("the drawing shares positions: one layout of the union, with before and after sets", async () => {
    const inst = loadInstance(MINI);
    const { packs } = await loadPacks(inst.config.packs);
    const imp = computeImpact(inst, "p3", packs);
    const d = imp.drawing!;
    expect(d.view).toBe("v1");
    expect(d.removed).toEqual(["intake"]);
    expect(d.before.elements).toContain("intake");
    expect(d.after.elements).not.toContain("intake");
    expect(d.layout.nodes.map((n) => n.id)).toContain("intake");
    expect(d.others).toEqual(["v2"]);
  });
});

describe("provenance and the model hash", () => {
  test("provenance and decision are read when well formed and dropped otherwise", () => {
    const p = normPatch({ id: "p", title: "t", status: "accepted", why: "w", ops: [],
      provenance: { author: "agent", agent: { tool: "Claude Code", model: "m" }, requested_by: "the delivery lead", created: "2026-10-21", based_on: "abc" },
      decision: { by: "the delivery lead", at: "2026-10-21", reason: "ok" } });
    expect(p.provenance).toEqual({ author: "agent", agent: { tool: "Claude Code", model: "m" }, requested_by: "the delivery lead", created: "2026-10-21", based_on: "abc" });
    expect(p.decision).toEqual({ by: "the delivery lead", at: "2026-10-21", reason: "ok" });
    expect(normPatch({ id: "q", provenance: "someone", decision: { by: "x" } }).provenance).toBeUndefined();
  });
  test("the model hash ignores patches, so a patch can name the model it was written against", () => {
    const a = loadInstance(MINI);
    const b = loadInstance(MINI);
    b.patches = [];
    expect(modelHash(a)).toBe(modelHash(b));
    b.model.elements[0].name = "Other";
    expect(modelHash(a)).not.toBe(modelHash(b));
  });
});

describe("tour", () => {
  test("targets: pages, records, focus depth; bad ones are problems", () => {
    expect(normTarget("overview")).toBe("overview");
    expect(normTarget({ unit: "U-05" })).toEqual({ unit: "U-05" });
    expect(normTarget({ focus: "x", depth: 2 })).toEqual({ focus: "x", depth: 2 });
    expect(typeof normTarget("nowhere")).toBe("string");
    expect(typeof normTarget({ colour: "red" })).toBe("string");
  });
  test("a step whose target is gone is kept, marked, and warned about, naming the patch that removed it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-tour-"));
    cpSync(MINI, dir, { recursive: true });
    writeFileSync(join(dir, "tour.yaml"), `title: Shop tour
steps:
  - target: overview
    title: The shop
    say: Five steps from customer to pickup.
  - target: { element: bell }
    title: The bell
    say: Added by an accepted patch.
  - target: { element: front-desk }
    title: Gone
    say: Never existed.
  - target: { view: v1 }
    highlight: [customer, ghost]
    title: Whole shop
    say: Highlights one missing element.
  - target: 42
    title: Not a target
    say: skipped
`);
    const { bundle, warnings } = await buildBundle(dir, { built: "t" });
    expect(bundle.tour!.steps.length).toBe(4);
    expect(bundle.tour!.steps[0].missing).toBeUndefined();
    expect(bundle.tour!.steps[1].missing).toBeUndefined();
    expect(bundle.tour!.steps[2].missing).toContain("element front-desk is not in the model");
    expect(bundle.tour!.steps[3].missing).toContain("ghost");
    expect(warnings.some((w) => w.includes("step 3") && w.includes("front-desk"))).toBe(true);
    expect(warnings.some((w) => w.includes("tour.yaml step 5"))).toBe(true);
  });
  test("a target removed by an accepted patch names that patch", async () => {
    const { bundle } = await buildBundle(MINI, { built: "t" });
    const tour = { title: "t", steps: [{ target: { element: "nowhere" } as any, title: "x", say: "" }] };
    bundle.patches[0].impact.removed.push({ kind: "element", id: "nowhere" });
    bundle.patches[0].status = "accepted";
    checkTour(tour, bundle);
    expect(tour.steps[0].missing).toContain(`removed by ${bundle.patches[0].id}`);
  });
});
