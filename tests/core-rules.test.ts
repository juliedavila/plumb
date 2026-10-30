import { describe, expect, test } from "bun:test";
import { buildContext, loadPacks, runRules } from "../src/core/rules.ts";
import { E, PH, R, T, U, config, model, pack, plan, run } from "./core-helpers.ts";

const base = () => model({
  teams: [T("t1"), T("t2")],
  elements: [E("a"), E("b")] as any,
  relationships: [R("r1", "a", "b", { carries: ["k"] })] as any,
  contracts: [{ name: "k", produced_by: ["a"], consumed_by: ["b"] }],
  views: [{ id: "v1", title: "V", elements: ["a", "b"] }],
});

describe("packs load by name", () => {
  test("generic, plan and flow load; a missing pack is reported, not thrown", async () => {
    const { packs, errors } = await loadPacks(["generic", "plan", "flow", "no-such-pack"]);
    expect(packs.map((p) => p.name)).toEqual(["generic", "plan", "flow"]);
    expect(errors.map((e) => e.name)).toEqual(["no-such-pack"]);
  });

  test("every rule has a why sentence for a newcomer", async () => {
    for (const n of ["generic", "plan", "flow"]) for (const r of (await pack(n)).rules) {
      expect(r.why.length).toBeGreaterThan(40);
      expect(r.why.trim().endsWith(".")).toBe(true);
    }
  });

  test("a clean model passes every generic rule", async () => {
    const { packs } = await loadPacks(["generic"]);
    expect(runRules(packs, buildContext(config(), base(), plan()))).toEqual([]);
  });

  test("a crashing rule becomes an error finding", () => {
    const boom = { name: "x", title: "X", description: "", rules: [{ id: "boom", title: "", why: "", severity: "warning" as const, check: () => { throw new Error("bad"); } }] };
    const f = runRules([boom], buildContext(config(), base(), plan()));
    expect(f).toEqual([{ pack: "x", rule: "boom", severity: "error", at: "t", atKind: "instance", message: "rule crashed: bad" }]);
  });
});

describe("generic", () => {
  test("unique-ids", async () => {
    expect(await run("generic", "unique-ids", base())).toEqual([]);
    const m = base(); m.elements.push(E("a") as any);
    expect((await run("generic", "unique-ids", m)).map((f) => f.at)).toEqual(["a"]);
  });

  test("references-resolve", async () => {
    expect(await run("generic", "references-resolve", base())).toEqual([]);
    const m = base();
    m.elements.push(E("c", { owner: "ghost-team", system: "s9", zone: "z9", parent: "p9" }) as any);
    m.relationships.push(R("r2", "a", "nowhere", { carries: ["nope"] }) as any);
    m.contracts.push({ name: "k2", produced_by: ["zz"] });
    const f = await run("generic", "references-resolve", m, plan({ units: [U("u1", { phase: "ph9", elements: [{ id: "q", from: "none", to: "built" }] })] as any }));
    expect(f.map((x) => x.at)).toEqual(["c", "c", "c", "c", "r2", "r2", "k2", "u1", "u1"]);
  });

  test("element-has-owner", async () => {
    expect(await run("generic", "element-has-owner", base())).toEqual([]);
    const m = base(); m.elements.push({ id: "c", name: "C", kind: "service" });
    expect((await run("generic", "element-has-owner", m)).map((f) => f.at)).toEqual(["c"]);
  });

  test("contract-has-producer-and-consumer", async () => {
    expect(await run("generic", "contract-has-producer-and-consumer", base())).toEqual([]);
    const m = base(); m.contracts.push({ name: "lonely" });
    expect((await run("generic", "contract-has-producer-and-consumer", m)).map((f) => f.message)).toEqual(["contract lonely has no producer", "contract lonely has no consumer"]);
  });

  test("carried-contract-direction", async () => {
    expect(await run("generic", "carried-contract-direction", base())).toEqual([]);
    // b is a listed reader, so it may relay k onward; a is not a reader, so the far end is still wrong.
    const m = base(); m.relationships = [R("r1", "b", "a", { carries: ["k"] })] as any;
    expect((await run("generic", "carried-contract-direction", m)).map((f) => f.message)).toEqual(["relationship r1 carries k to a, which is not a consumer of it"]);
    // c neither produces nor reads k, so it cannot send it.
    const n = base(); n.elements.push(E("c") as any); n.relationships = [R("r1", "c", "b", { carries: ["k"] })] as any;
    expect((await run("generic", "carried-contract-direction", n)).map((f) => f.message)).toEqual(["relationship r1 carries k from c, which neither produces it nor is a listed reader relaying it"]);
  });

  test("view-ids-exist", async () => {
    expect(await run("generic", "view-ids-exist", base())).toEqual([]);
    const m = base(); m.views.push({ id: "v2", title: "V2", elements: ["a", "ghost"], relationships: ["r1", "r9"] });
    expect((await run("generic", "view-ids-exist", m)).map((f) => f.message)).toEqual([
      'view v2 shows element "ghost", which does not exist',
      "view v2 lists relationship r1, but not both of its ends",
      'view v2 lists relationship "r9", which does not exist',
    ]);
  });
});

describe("plan", () => {
  const good = () => plan({
    phases: [PH("ph1", 1), PH("ph2", 2)] as any,
    units: [U("u1", { provides: ["x"], owner: "t1", elements: [{ id: "a", from: "none", to: "stand-in" }] }), U("u2", { requires: ["x"], phase: "ph2" })] as any,
  });

  test("a sound plan passes every plan rule", async () => {
    for (const r of (await pack("plan")).rules) expect(await run("plan", r.id, base(), good())).toEqual([]);
  });

  test("requires-provided", async () => {
    const p = good(); p.units.push(U("u3", { requires: ["ghost"] }) as any);
    expect((await run("plan", "requires-provided", base(), p)).map((f) => f.at)).toEqual(["u3"]);
  });

  test("no-dependency-cycles", async () => {
    const p = good(); p.units.push(U("u3", { requires: ["y"], provides: ["z"] }) as any, U("u4", { requires: ["z"], provides: ["y"] }) as any);
    const f = await run("plan", "no-dependency-cycles", base(), p);
    expect(f).toEqual([{ at: "u3", atKind: "unit", message: "units u3, u4 depend on each other in a cycle" }]);
  });

  test("phase-has-exit-test", async () => {
    const p = good(); p.phases.push(PH("ph3", 3, { exit_test: "  " }) as any);
    expect((await run("plan", "phase-has-exit-test", base(), p)).map((f) => f.at)).toEqual(["ph3"]);
  });

  test("fidelity-moves-up", async () => {
    const p = good();
    p.units.push(U("u3", { elements: [{ id: "a", from: "built", to: "stand-in" }, { id: "b", from: "none", to: "gold" }] }) as any);
    const f = await run("plan", "fidelity-moves-up", base(), p);
    expect(f.map((x) => x.message)).toEqual([
      "unit u3 moves a down the ladder, from built to stand-in",
      'unit u3 moves b to "gold", which is not on the ladder (none < stand-in < existing-tool < built)',
    ]);
    // an equal move (extend the part at the same level) is valid
    expect(await run("plan", "fidelity-moves-up", base(), plan({ units: [U("u1", { elements: [{ id: "a", from: "stand-in", to: "stand-in" }] })] as any }))).toEqual([]);
    // a custom ladder from engine.yaml is honoured
    expect(await run("plan", "fidelity-moves-up", base(), plan({ units: [U("u1", { elements: [{ id: "a", from: "sketch", to: "gold" }] })] as any }), config({ ladder: ["sketch", "gold"] }))).toEqual([]);
  });

  test("unit-owner-exists", async () => {
    const p = good(); p.units.push(U("u3", { owner: "nobody" }) as any);
    expect((await run("plan", "unit-owner-exists", base(), p)).map((f) => f.at)).toEqual(["u3"]);
  });

  test("no-earlier-depends-on-later", async () => {
    const p = good(); p.units.push(U("u3", { requires: ["late"] }) as any, U("u4", { provides: ["late"], phase: "ph2" }) as any);
    expect((await run("plan", "no-earlier-depends-on-later", base(), p)).map((f) => f.at)).toEqual(["u3"]);
  });
});

describe("flow", () => {
  const stream = (n: number) => {
    // a chain of person steps alternating between two teams, joined by handoffs
    const els = Array.from({ length: n }, (_, i) => E(`s${i + 1}`, { kind: "person", owner: i % 2 ? "t2" : "t1", attrs: { wait_days: 1, flow_source: "measured", flow_as_of: "2026-10-01" } }));
    const rels = Array.from({ length: n - 1 }, (_, i) => R(`h${i + 1}`, `s${i + 1}`, `s${i + 2}`, { kind: "handoff" }));
    return model({ teams: [T("t1"), T("t2")], elements: els as any, relationships: rels as any });
  };

  test("a short, well-annotated stream passes every flow rule", async () => {
    for (const r of (await pack("flow")).rules) expect(await run("flow", r.id, stream(3))).toEqual([]);
  });

  test("handoff-crosses-teams", async () => {
    const m = stream(3); m.elements[1].owner = "t1";
    expect((await run("flow", "handoff-crosses-teams", m)).map((f) => f.at)).toEqual(["h1", "h2"]);
  });

  test("cross-team-steps-are-handoffs", async () => {
    const m = stream(3); m.relationships[0].kind = "data";
    expect((await run("flow", "cross-team-steps-are-handoffs", m)).map((f) => f.at)).toEqual(["h1"]);
  });

  test("path-handoff-limit (default 4, configurable)", async () => {
    expect(await run("flow", "path-handoff-limit", stream(5))).toEqual([]); // 4 handoffs
    const f = await run("flow", "path-handoff-limit", stream(6)); // 5 handoffs
    expect(f).toEqual([{ at: "s1", atKind: "element", message: "the path s1 → s2 → s3 → s4 → s5 → s6 crosses 5 team handoffs (limit 4): t1 to t2, t2 to t1, t1 to t2, t2 to t1, t1 to t2" }]);
    expect((await run("flow", "path-handoff-limit", stream(3), plan(), config({ flow: { max_handoffs: 1 } }))).length).toBe(1);
    // feedback loops are not part of the forward path
    const m = stream(5); m.relationships.push(R("fb", "s5", "s1", { kind: "feedback" }) as any);
    expect(await run("flow", "path-handoff-limit", m)).toEqual([]);
  });

  test("queue-has-wip-limit", async () => {
    const m = stream(2); m.elements.push(E("q1", { kind: "queue" }) as any, E("q2", { kind: "queue", attrs: { wip_limit: 3 } }) as any);
    expect((await run("flow", "queue-has-wip-limit", m)).map((f) => f.at)).toEqual(["q1"]);
  });

  test("person-step-has-wait", async () => {
    const m = stream(2); m.elements.push(E("p1", { kind: "person" }) as any);
    expect((await run("flow", "person-step-has-wait", m)).map((f) => f.at)).toEqual(["p1"]);
  });
});
