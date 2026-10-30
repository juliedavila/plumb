// Premises: claims, what rests on them, "if this is false", the premises pack, the CLI report, the MCP tool, and the
// Generic premises on synthetic records and the fictional delivery stream.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { compile } from "../src/core/compile.ts";
import { normClaim } from "../src/core/load.ts";
import { premiseImpact, rankClaims, restsOnIndex, weight } from "../src/core/premise.ts";
import { premiseMd } from "../src/core/report.ts";
import { call } from "../src/mcp/tools.ts";
import { E, model, plan, PH, R, run, U, config } from "./core-helpers.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const C = (id: string, extra: Record<string, unknown> = {}) => normClaim({ id, statement: `${id} holds`, ...extra });

describe("claims load", () => {
  test("defaults: kind premise, grade untested; unknown keys go to attrs", () => {
    const c = normClaim({ id: "X", statement: "s", tested_by: ["U-1"] });
    expect(c.kind).toBe("premise");
    expect(c.grade).toBe("untested");
    expect(c.attrs?.tested_by).toEqual(["U-1"]);
  });
  test("grade and kind are case-insensitive; rests_on becomes a list", () => {
    const c = normClaim({ id: "X", statement: "s", kind: "Assumption", grade: "EVIDENCE", rests_on: "Y" });
    expect([c.kind, c.grade]).toEqual(["assumption", "evidence"]);
    expect(c.rests_on).toEqual(["Y"]);
  });
});

describe("if this is false", () => {
  const m = model({
    elements: [E("a", { rests_on: ["P1"] }), E("b"), E("c", { rests_on: ["P2"] })],
    relationships: [R("r1", "a", "b", { rests_on: ["P1"] })],
    claims: [C("P1"), C("P2", { kind: "claim", rests_on: ["P1"] }), C("P3")] });
  const p = plan({
    phases: [PH("ph1", 1), PH("ph2", 2, { rests_on: ["P2"] })],
    units: [U("U-1", { elements: [{ id: "a", from: "none", to: "built" }] }), U("U-2", { phase: "ph2" }), U("U-3", { rests_on: ["P1"], status: "done" }), U("U-4")] });
  const im = premiseImpact("P1", m, p);
  test("direct dependents are the records whose rests_on names it", () => {
    expect(im.direct.map((d) => `${d.kind}:${d.id}`).sort()).toEqual(["claim:P2", "element:a", "relationship:r1", "unit:U-3"]);
  });
  test("transitive dependents keep the chain of claims that reaches them", () => {
    const c = im.dependents.find((d) => d.id === "c")!;
    expect(c.via).toEqual(["P1", "P2"]);
    expect(im.dependents.find((d) => d.id === "ph2")!.via).toEqual(["P1", "P2"]);
    expect(im.counts).toEqual({ elements: 2, relationships: 1, units: 1, phases: 1, claims: 1, total: 6 });
  });
  test("the plan slice: direct units, units moving a resting part, units in a resting gate; by gate order", () => {
    expect(im.units).toEqual([{ phase: "ph1", units: ["U-1", "U-3"] }, { phase: "ph2", units: ["U-2"] }]);
    expect(im.openUnits).toBe(2);
  });
  test("a claim nothing rests on has an empty impact; ranking puts the heaviest first", () => {
    expect(premiseImpact("P3", m, p).counts.total).toBe(0);
    const idx = restsOnIndex(m, p);
    const ims = Object.fromEntries(m.claims!.map((c) => [c.id, premiseImpact(c.id, m, p, idx)]));
    expect(rankClaims(m.claims!, ims).map((c) => c.id)).toEqual(["P1", "P2", "P3"]);
    expect(weight(ims.P1)).toBe(8); // 6 dependents, less 1 unit, plus 3 slice units
  });
  test("a cycle between claims terminates", () => {
    const mc = model({ claims: [C("A", { rests_on: ["B"] }), C("B", { rests_on: ["A"] })] });
    expect(premiseImpact("A", mc, plan()).dependents.map((d) => d.id)).toEqual(["B"]);
  });
});

describe("premises pack", () => {
  test("rests_on naming an undeclared claim is an error", async () => {
    const f = await run("premises", "rests-on-resolves", model({ elements: [E("a", { rests_on: ["NOPE"] })], claims: [C("P1")] }));
    expect(f).toHaveLength(1);
    expect(f[0].message).toContain("NOPE");
  });
  test("a claim with no statement or an unknown grade is an error", async () => {
    const f = await run("premises", "claim-well-formed", model({ claims: [normClaim({ id: "X", statement: "", grade: "vibes" })] }));
    expect(f.map((x) => x.message).join(" ")).toContain("no statement");
    expect(f.map((x) => x.message).join(" ")).toContain('grade "vibes"');
  });
  test("a cycle of claims is an error", async () => {
    const f = await run("premises", "claims-acyclic", model({ claims: [C("A", { rests_on: ["B"] }), C("B", { rests_on: ["A"] })] }));
    expect(f).toHaveLength(1);
  });
  test("load-bearing and untested: warns at the threshold, not below it, and never for a graded one", async () => {
    const els = ["a", "b", "c", "d", "e"].map((id) => E(id, { rests_on: ["P1"] }));
    expect(await run("premises", "load-bearing-untested", model({ elements: els, claims: [C("P1")] }))).toHaveLength(1);
    expect(await run("premises", "load-bearing-untested", model({ elements: els.slice(0, 4), claims: [C("P1")] }))).toHaveLength(0);
    expect(await run("premises", "load-bearing-untested", model({ elements: els, claims: [C("P1", { grade: "evidence" })] }))).toHaveLength(0);
    expect(await run("premises", "load-bearing-untested", model({ elements: els.slice(0, 2), claims: [C("P1")] }), plan(), config({ premises: { load_bearing: 2 } }))).toHaveLength(1);
  });
  test("the engine runs the pack whenever the model declares claims", async () => {
    const { bundle } = await buildBundle(DS_DIR);
    expect(bundle.instance.packs.map((p) => p.name)).toContain("premises");
    expect(bundle.findings.filter((f) => f.rule === "load-bearing-untested").map((f) => f.at)).toEqual(["PR-2"]);
  });
  test("a patch that removes a claim things rest on introduces an error", async () => {
    const { loadInstance, packNames } = await import("../src/core/load.ts");
    const inst = loadInstance(DS_DIR);
    inst.patches = [{ id: "P-X", title: "drop PR-1", status: "proposed", why: "", ops: [{ op: "remove", kind: "claim", id: "PR-1" }] }];
    const { computeImpact } = await import("../src/core/impact.ts");
    const { loadPacks } = await import("../src/core/rules.ts");
    const im = computeImpact(inst, "P-X", (await loadPacks(packNames(inst))).packs);
    expect(im.removed).toEqual([{ kind: "claim", id: "PR-1" }]);
    expect(im.findingsIntroduced.some((f) => f.rule === "rests-on-resolves")).toBe(true);
    expect(compile(inst, { with: "P-X" }).model.claims!.some((c) => c.id === "PR-1")).toBe(false);
  });
});

describe("delivery stream premises", async () => {
  const { bundle } = await buildBundle(DS_DIR);
  test("six claims of three kinds and three grades, each with a source", () => {
    const cs = bundle.model.claims!;
    expect(cs).toHaveLength(6);
    expect(new Set(cs.map((c) => c.grade))).toEqual(new Set(["inference", "judgment", "untested"]));
    expect(new Set(cs.map((c) => c.kind))).toEqual(new Set(["premise", "claim", "assumption"]));
    expect(cs.every((c) => c.source)).toBe(true);
  });
  test("PR-1 reaches the Shorten gate through PR-6", () => {
    const im = bundle.premises!["PR-1"];
    expect(im.dependents.find((d) => d.kind === "phase" && d.id === "SHORTEN")!.via).toEqual(["PR-1", "PR-6"]);
  });
  test("the CLI report and the MCP tool agree", () => {
    const md = premiseMd(bundle, "PR-1");
    expect(md).toContain("# If PR-1 is false");
    expect(md).toContain("The plan slice is");
    const out = call(bundle, "premise", { id: "PR-1" });
    expect(out.isError ?? false).toBe(false);
    expect(out.text).toBe(md);
    expect(call(bundle, "premise", {}).text.split("\n")[1]).toContain("PR-1");
    expect(call(bundle, "premise", { id: "nope" }).isError).toBe(true);
  });
});

