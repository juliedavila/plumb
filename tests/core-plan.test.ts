import { describe, expect, test } from "bun:test";
import { analyzePlan } from "../src/core/plan.ts";
import { PH, U, plan } from "./core-helpers.ts";

describe("plan analysis", () => {
  // a(done) -> b -> d ; a -> c -> d ; c -> e ; f needs something nobody provides
  const p = plan({
    phases: [PH("ph2", 2), PH("ph1", 1)] as any,
    units: [
      U("a", { provides: ["A"], status: "done" }),
      U("b", { requires: ["A"], provides: ["B"] }),
      U("c", { requires: ["A"], provides: ["C"], status: "doing" }),
      U("d", { requires: ["B", "C"], provides: ["D"], phase: "ph2" }),
      U("e", { requires: ["C"], phase: "ph2" }),
      U("f", { requires: ["ghost"], phase: "ph2" }),
    ] as any,
  });
  const a = analyzePlan(p);

  test("deps and unblocks", () => {
    expect(a.deps).toEqual({ a: [], b: ["a"], c: ["a"], d: ["b", "c"], e: ["c"], f: [] });
    expect(a.unblocks.a).toEqual(["b", "c"]);
    expect(a.unblocks.c).toEqual(["d", "e"]);
  });

  test("frontier: open units whose required capabilities are provided by done units", () => {
    expect(a.frontier).toEqual(["b", "c"]);
  });

  test("blocked: missing capabilities and the units that would provide them", () => {
    expect(a.blocked).toEqual({
      d: { missing: ["B", "C"], waitingOn: ["b", "c"] },
      e: { missing: ["C"], waitingOn: ["c"] },
      f: { missing: ["ghost"], waitingOn: [] },
    });
    expect(a.unprovided).toEqual(["ghost"]);
  });

  test("layers over open units", () => {
    expect(a.layers).toEqual([["b", "c", "f"], ["d", "e"]]);
  });

  test("critical path: longest chain, ties by natural id", () => {
    expect(a.critical_path).toEqual(["b", "d"]);
  });

  test("phase progress in phase order", () => {
    expect(a.phases).toEqual([
      { id: "ph1", total: 3, done: 1, complete: false },
      { id: "ph2", total: 3, done: 0, complete: false },
    ]);
  });

  test("a longer chain wins the critical path", () => {
    const q = plan({
      units: [U("u1", { provides: ["x"] }), U("u2", { requires: ["x"], provides: ["y"] }), U("u10", { requires: ["y"] }), U("u3", { provides: ["z"] }), U("u4", { requires: ["z"] })] as any,
    });
    expect(analyzePlan(q).critical_path).toEqual(["u1", "u2", "u10"]);
  });

  test("cycles do not hang and are broken deterministically", () => {
    const q = plan({
      units: [U("x", { requires: ["Y"], provides: ["X"] }), U("y", { requires: ["X"], provides: ["Y"] }), U("z", { requires: ["X"] })] as any,
    });
    const r = analyzePlan(q);
    expect(r.deps).toEqual({ x: ["y"], y: ["x"], z: ["x"] });
    expect(r.frontier).toEqual([]);
    expect(Object.keys(r.blocked)).toEqual(["x", "y", "z"]);
    expect(r.layers.flat().sort()).toEqual(["x", "y", "z"]);
    expect(r.critical_path).toEqual(["x", "y"]);
    expect(analyzePlan(q)).toEqual(r);
  });

  test("everything done: empty frontier and critical path, phases complete", () => {
    const q = plan({ phases: [PH("ph1", 1)] as any, units: [U("a", { status: "done" })] as any });
    const r = analyzePlan(q);
    expect(r.frontier).toEqual([]);
    expect(r.critical_path).toEqual([]);
    expect(r.layers).toEqual([]);
    expect(r.phases).toEqual([{ id: "ph1", total: 1, done: 1, complete: true }]);
  });
});
