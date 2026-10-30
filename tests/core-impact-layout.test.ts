import { describe, expect, test } from "bun:test";
import { buildBundle, contentHash } from "../src/core/bundle.ts";
import { computeImpact } from "../src/core/impact.ts";
import { layoutView, nodeSize, viewsOf } from "../src/core/layout.ts";
import { loadInstance } from "../src/core/load.ts";
import { loadPacks } from "../src/core/rules.ts";
import type { Model } from "../src/types.ts";
import { E, MINI, R, model } from "./core-helpers.ts";

describe("impact", () => {
  test("a proposed remove: cascade, findings introduced, units affected", async () => {
    const inst = loadInstance(MINI);
    const { packs } = await loadPacks(inst.config.packs);
    const imp = computeImpact(inst, "p3", packs);
    expect(imp.status).toBe("proposed");
    expect(imp.removed).toEqual([{ kind: "element", id: "intake" }]);
    expect(imp.cascade.filter((c) => c.kind === "relationship").map((c) => c.id)).toEqual(["r1", "r2", "r10"]);
    expect(imp.findingsIntroduced.map((f) => `${f.pack}/${f.rule}@${f.at}`)).toEqual(["core/unit-keeps-a-part@u1", "generic/contract-has-producer-and-consumer@ticket"]);
    expect(imp.findingsResolved).toEqual([]);
    expect(imp.unitsAffected).toContain("u1");
    expect(imp.errors).toEqual([]);
  });

  test("an accepted patch is compared against the compile without it", async () => {
    const inst = loadInstance(MINI);
    const { packs } = await loadPacks(inst.config.packs);
    const imp = computeImpact(inst, "p2", packs);
    expect(imp.added).toEqual([{ kind: "element", id: "bell" }, { kind: "relationship", id: "r20" }]);
    // without p2, p10 cannot apply; that is p10's problem, not part of p2's diff
    expect(imp.errors).toEqual([]);
  });

  test("op errors and a resolved finding", async () => {
    const inst = loadInstance(MINI);
    inst.model.elements.push({ id: "orphan", name: "Orphan", kind: "service" }); // no owner: a warning
    inst.patches.push({ id: "p20", title: "Own the orphan", status: "proposed", why: "t", ops: [{ op: "modify", kind: "element", id: "orphan", set: { owner: "shop" } }] });
    const { packs } = await loadPacks(inst.config.packs);
    const imp = computeImpact(inst, "p20", packs);
    expect(imp.findingsResolved.map((f) => f.rule)).toEqual(["element-has-owner"]);
    expect(imp.modified).toEqual([{ kind: "element", id: "orphan", fields: ["owner"] }]);
    const bad = computeImpact(inst, "p4", packs);
    expect(bad.errors.length).toBe(2);
    expect(bad.findingsIntroduced.map((f) => f.rule)).toEqual(["requires-provided"]);
    expect(() => computeImpact(inst, "nope", packs)).toThrow(/unknown patch/);
  });
});

describe("bundle", () => {
  test("deterministic apart from the timestamp; hash ignores it", async () => {
    const a = (await buildBundle(MINI, { built: "x" })).bundle;
    const b = (await buildBundle(MINI, { built: "y" })).bundle;
    expect(a.engine.hash).toBe(b.engine.hash);
    expect(JSON.stringify({ ...a, engine: null })).toBe(JSON.stringify({ ...b, engine: null }));
    expect(a.engine.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.patches.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p10"]);
    expect(a.layouts.map((l) => l.view)).toEqual(["v1", "v2"]);
    expect(a.findings).toEqual([]);
  });

  test("hash changes when the input changes", () => {
    const inst = loadInstance(MINI);
    const h = contentHash(inst);
    inst.model.elements[0].name = "Changed";
    expect(contentHash(inst)).not.toBe(h);
  });

  test("an accepted patch that cannot apply is a core error finding", async () => {
    const inst = loadInstance(MINI);
    inst.patches.find((p) => p.id === "p4")!.status = "accepted";
    const { bundle } = await buildBundle(inst, { built: "x" });
    const core = bundle.findings.filter((f) => f.pack === "core");
    expect(core.map((f) => f.rule)).toEqual(["patch-applies", "patch-applies"]);
    expect(bundle.instance.packs[0].name).toBe("core");
  });
});

function bigModel(n: number): Model {
  // a pseudo-random but fixed graph: chains, fan-out, long edges and a few cycles
  const els = Array.from({ length: n }, (_, i) => E(`e${i + 1}`, { name: `Element number ${i + 1}${i % 7 === 0 ? " with a much longer descriptive name" : ""}` }));
  const rels: ReturnType<typeof R>[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 1; i < n; i++) rels.push(R(`r${rels.length + 1}`, `e${Math.floor(rnd() * i) + 1}`, `e${i + 1}`));
  for (let k = 0; k < n / 4; k++) rels.push(R(`r${rels.length + 1}`, `e${Math.floor(rnd() * n) + 1}`, `e${Math.floor(rnd() * n) + 1}`));
  return model({ elements: els as any, relationships: rels as any });
}

describe("layout", () => {
  test("node size grows with the name and is clamped", () => {
    expect(nodeSize("A").w).toBe(96);
    expect(nodeSize("x".repeat(200)).w).toBe(200);
    expect(nodeSize("x".repeat(200)).h).toBeGreaterThan(nodeSize("A").h);
  });

  test("default 'all' view when a model has none", () => {
    const m = bigModel(10);
    expect(viewsOf(m).map((v) => v.id)).toEqual(["all"]);
  });

  test("deterministic, every node placed without overlap, edges start and end on box borders", () => {
    const m = bigModel(148);
    const v = viewsOf(m)[0];
    const a = layoutView(m, v), b = layoutView(structuredClone(m), { ...v, elements: [...v.elements].reverse() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.nodes.length).toBe(148);
    expect(a.edges.length).toBe(m.relationships.length);
    const box = new Map(a.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < a.nodes.length; i++) for (let j = i + 1; j < a.nodes.length; j++) {
      const p = a.nodes[i], q = a.nodes[j];
      const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      expect(overlap).toBe(false);
    }
    const onBorder = (pt: [number, number], id: string) => {
      const n = box.get(id)!;
      return (pt[0] === n.x || pt[0] === n.x + n.w) && pt[1] >= n.y && pt[1] <= n.y + n.h;
    };
    for (const e of a.edges) {
      expect(onBorder(e.points[0], e.from)).toBe(true);
      expect(onBorder(e.points[e.points.length - 1], e.to)).toBe(true);
      for (const [x, y] of e.points) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(a.width); expect(y).toBeLessThanOrEqual(a.height); }
    }
    for (const n of a.nodes) { expect(n.x + n.w).toBeLessThanOrEqual(a.width); expect(n.y + n.h).toBeLessThanOrEqual(a.height); }
  });

  test("a view with explicit relationships draws only those; self loops and cycles are handled", () => {
    const m = model({
      elements: [E("a"), E("b"), E("c")] as any,
      relationships: [R("r1", "a", "b"), R("r2", "b", "c"), R("r3", "c", "a"), R("r4", "b", "b")] as any,
    });
    const all = layoutView(m, { id: "v", title: "v", elements: ["a", "b", "c"] });
    expect(all.edges.map((e) => e.id)).toEqual(["r1", "r2", "r3", "r4"]);
    const xs = new Map(all.nodes.map((n) => [n.id, n.x]));
    expect(xs.get("a")! < xs.get("b")! && xs.get("b")! < xs.get("c")!).toBe(true); // back edge r3 ignored for layering
    const some = layoutView(m, { id: "v", title: "v", elements: ["a", "b", "c"], relationships: ["r2"] });
    expect(some.edges.map((e) => e.id)).toEqual(["r2"]);
  });
});
