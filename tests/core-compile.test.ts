import { describe, expect, test } from "bun:test";
import { applyPatch, compile } from "../src/core/compile.ts";
import { loadInstance } from "../src/core/load.ts";
import { natCompare, natSort } from "../src/core/util.ts";
import type { Patch } from "../src/types.ts";
import { E, MINI, R, U, model, plan } from "./core-helpers.ts";

const patch = (ops: Patch["ops"], id = "px"): Patch => ({ id, title: id, status: "accepted", why: "test", ops });

describe("natural order", () => {
  test("digit runs compare numerically", () => {
    expect(natSort(["p10", "p2", "p1", "a", "p1b", "p01"])).toEqual(["a", "p1", "p01", "p1b", "p2", "p10"]);
    expect(natCompare("u9", "u10")).toBeLessThan(0);
  });
});

describe("load", () => {
  test("unknown keys move into attrs and ids become strings", () => {
    const inst = loadInstance(MINI);
    const customer = inst.model.elements.find((e) => e.id === "customer")!;
    expect(customer.attrs).toEqual({ wait_days: 0, start: true });
    expect(inst.patches.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4", "p10"]);
    expect(inst.config.ladder).toEqual(["none", "stand-in", "existing-tool", "built"]);
  });
});

describe("compile", () => {
  test("applies accepted patches in natural id order (p10 after p2)", () => {
    const c = compile(loadInstance(MINI));
    expect(c.applied).toEqual(["p1", "p2", "p10"]);
    const bell = c.model.elements.find((e) => e.id === "bell")!;
    expect(bell.description).toBe("A brass bell on the counter");
    expect(c.results.p10.errors).toEqual([]);
  });

  test("add, modify (shallow merge, attrs one level), remove", () => {
    const s = { model: model({ elements: [E("a", { attrs: { x: 1, y: 2 } }) as any] }), plan: plan() };
    const r = applyPatch(s, patch([
      { op: "add", kind: "element", value: E("b") },
      { op: "modify", kind: "element", id: "a", set: { name: "Alpha", attrs: { y: 3, z: 4 } } },
      { op: "add", kind: "team", value: { id: "t1", name: "Team" } },
      { op: "remove", kind: "team", id: "t1" },
    ]));
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual([{ kind: "element", id: "b" }, { kind: "team", id: "t1" }]);
    expect(r.modified).toEqual([{ kind: "element", id: "a", fields: ["attrs.y", "attrs.z", "name"] }]);
    expect(r.removed).toEqual([{ kind: "team", id: "t1" }]);
    const a = s.model.elements.find((e) => e.id === "a")!;
    expect(a.name).toBe("Alpha");
    expect(a.attrs).toEqual({ x: 1, y: 3, z: 4 });
    expect(s.model.teams).toEqual([]);
  });

  test("unknown keys in an added value go to attrs", () => {
    const s = { model: model(), plan: plan() };
    applyPatch(s, patch([{ op: "add", kind: "element", value: { id: "q", name: "Q", kind: "queue", wip_limit: 3 } }]));
    expect(s.model.elements[0].attrs).toEqual({ wip_limit: 3 });
  });

  test("remove cascades to relationships, contracts, views and unit element lists", () => {
    const s = {
      model: model({
        elements: [E("a"), E("b"), E("c")] as any,
        relationships: [R("r1", "a", "b"), R("r2", "b", "c"), R("r3", "a", "c")] as any,
        contracts: [{ name: "k", produced_by: ["a"], consumed_by: ["b", "c"] }],
        views: [{ id: "v1", title: "V", elements: ["a", "b", "c"], relationships: ["r1", "r3"] }],
      }),
      plan: plan({ units: [U("u1", { elements: [{ id: "b", from: "none", to: "built" }, { id: "c", from: "none", to: "built" }] })] as any }),
    };
    const r = applyPatch(s, patch([{ op: "remove", kind: "element", id: "b" }]));
    expect(r.errors).toEqual([]);
    expect(r.removed).toEqual([{ kind: "element", id: "b" }]);
    expect(s.model.relationships.map((x) => x.id)).toEqual(["r3"]);
    expect(s.model.contracts[0].consumed_by).toEqual(["c"]);
    expect(s.model.views[0].elements).toEqual(["a", "c"]);
    expect(s.model.views[0].relationships).toEqual(["r3"]);
    expect(s.plan.units[0].elements).toEqual([{ id: "c", from: "none", to: "built" }]);
    const cascade = r.cascade.map((c) => `${c.kind}:${c.id}`);
    expect(cascade).toEqual(["contract:k", "relationship:r1", "relationship:r2", "unit:u1", "view:v1", "view:v1"]);
    expect(r.cascade.every((c) => c.because.includes("element b was removed") || c.because.includes("touching element b"))).toBe(true);
  });

  test("unknown ids and duplicate adds are errors, and the rest of the patch still applies", () => {
    const s = { model: model({ elements: [E("a")] as any }), plan: plan() };
    const r = applyPatch(s, patch([
      { op: "modify", kind: "element", id: "nope", set: { name: "x" } },
      { op: "remove", kind: "relationship", id: "nope" },
      { op: "add", kind: "element", value: E("a") },
      { op: "add", kind: "bogus" as any, value: {} },
      { op: "add", kind: "element", value: E("b") },
    ]));
    expect(r.errors).toHaveLength(4);
    expect(r.errors[0]).toContain('unknown element "nope"');
    expect(r.errors[1]).toContain('unknown relationship "nope"');
    expect(r.errors[2]).toContain('element "a" already exists');
    expect(r.errors[3]).toContain("unknown record kind");
    expect(s.model.elements.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("modify cannot change a record's id", () => {
    const s = { model: model({ elements: [E("a")] as any }), plan: plan() };
    const r = applyPatch(s, patch([{ op: "modify", kind: "element", id: "a", set: { id: "z" } }]));
    expect(r.errors[0]).toContain("cannot change the id");
  });

  test("compile with / without a patch", () => {
    const inst = loadInstance(MINI);
    expect(compile(inst, { with: "p3" }).model.elements.some((e) => e.id === "intake")).toBe(false);
    expect(compile(inst, { without: "p2" }).model.elements.some((e) => e.id === "bell")).toBe(false);
    // the base instance is untouched
    expect(inst.model.elements.find((e) => e.id === "intake")!.name).toBe("Intake desk");
  });
});
