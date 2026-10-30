// The security pack's rules fail and pass on tiny inline models, and find nothing on a model without security marks.
import { describe, expect, test } from "bun:test";
import { pack } from "../packs/security/index.ts";
import { buildContext } from "../src/core/rules.ts";
import type { Contract, Element, Model, Relationship } from "../src/types.ts";
import { composeGraph } from "../src/core/portfolio.ts";

const el = (id: string, kind: string, attrs: Record<string, unknown> = {}, extra: Partial<Element> = {}): Element => ({ id, name: id, kind, attrs, ...extra });
const rel = (id: string, from: string, to: string, kind: string, carries: string[] = [], extra: Partial<Relationship> = {}): Relationship => ({ id, from, to, kind, carries, ...extra });
const model = (elements: Element[], relationships: Relationship[], contracts: Contract[] = []): Model =>
  ({ teams: [], systems: [], zones: [], elements, relationships, contracts, views: [] });
const config = (extra: Record<string, unknown> = {}) => ({ name: "t", title: "t", packs: ["security"], ...extra });
function run(ruleId: string, m: Model, cfg = config()) {
  const rule = pack.rules.find((r) => r.id === ruleId)!;
  expect(rule).toBeDefined();
  return rule.check(buildContext(cfg as any, m, { phases: [], units: [] }));
}

describe("trifecta", () => {
  // outsider text reaches the producer, it holds non-public data, and it calls the model
  const base = (edge: Partial<Relationship> = {}, to = "gateway") => model(
    [
      el("outside", "external-system"),
      el("producer", "service", { role_class: "producer", holds_nonpublic: true }),
      el("gateway", "gateway", {}, { system: "M" }),
      el("gate", "gateway", { model_boundary: true, load_bearing: true }, { system: "M", parent: "gateway" }),
      el("runner", "runner", {}, { zone: "execution" }),
    ],
    [rel("u", "outside", "producer", "data", [], { attrs: { content: "untrusted" } }), rel("out", "producer", to, "inference", [], edge)],
  );
  test("passes when the outbound edge is required and goes through the load-bearing gate", () => {
    expect(run("trifecta", base())).toEqual([]);
  });
  test("fails when the outbound edge is optional", () => {
    expect(run("trifecta", base({ optional: true })).length).toBe(1);
  });
  test("fails when the producer reaches execution directly", () => {
    expect(run("trifecta", base({}, "runner")).some((f) => f.message.includes("execution"))).toBe(true);
  });
  test("passes when the untrusted text is cleared to structured before the producer", () => {
    const m = base({ optional: true });
    m.elements.push(el("reader", "service"));
    m.relationships[0] = rel("u", "outside", "reader", "data", [], { attrs: { content: "untrusted" } });
    m.relationships.push(rel("s", "reader", "producer", "data", [], { attrs: { content: "structured" } }));
    expect(run("trifecta", m)).toEqual([]);
  });
});

describe("evidence-partitioned", () => {
  const contracts: Contract[] = [{ name: "RepairReceipt", attrs: {evidence_content:true}, produced_by: ["runner"], consumed_by: ["store"] }];
  test("passes when the evidence lands in a store with partition keys", () => {
    const m = model([el("runner", "runner"), el("store", "store", { partitioned_by: ["region"] })], [rel("r", "runner", "store", "evidence", ["RepairReceipt"])], contracts);
    expect(run("evidence-partitioned", m)).toEqual([]);
  });
  test("fails when the only store it reaches has no partition keys", () => {
    const m = model([el("runner", "runner"), el("store", "store", { unpartitioned: "logs only" })], [rel("r", "runner", "store", "evidence", ["RepairReceipt"])], contracts);
    expect(run("evidence-partitioned", m).map((f) => f.at)).toEqual(["RepairReceipt"]);
  });
  test("counts a contract marked evidence_content", () => {
    const m = model([el("a", "service"), el("b", "store")], [rel("r", "a", "b", "data", ["Custom"])], [{ name: "Custom", produced_by: ["a"], attrs: { evidence_content: true } }]);
    expect(run("evidence-partitioned", m).map((f) => f.at)).toEqual(["Custom"]);
  });
});

describe("store-reason-by-reference", () => {
  const els = [el("a", "service"), el("ledger", "store", { unpartitioned: "holds only costs" })];
  const contracts: Contract[] = [{ name: "RepairGuide", attrs: {evidence_content:true}, produced_by: ["a"], consumed_by: ["ledger"] }];
  test("fails when evidence content goes into a store that says it holds none", () => {
    expect(run("store-reason-by-reference", model(els, [rel("r", "a", "ledger", "data", ["RepairGuide"])], contracts)).map((f) => f.at)).toEqual(["r"]);
  });
  test("passes when the relationship marks it by reference", () => {
    expect(run("store-reason-by-reference", model(els, [rel("r", "a", "ledger", "data", ["RepairGuide"], { attrs: { by_reference: ["RepairGuide"] } })], contracts))).toEqual([]);
  });
});

describe("controller-feedback", () => {
  const els = [el("approver", "person", { role_class: "human" }), el("svc", "service")];
  const contracts: Contract[] = [{ name: "Outcome", attrs: { measures: "catch rate with interval" } }, { name: "Note" }];
  test("fails when a person who authorizes hears nothing back", () => {
    expect(run("controller-feedback", model(els, [rel("a", "approver", "svc", "authorization")], contracts)).map((f) => f.at)).toEqual(["approver"]);
  });
  test("fails when the feedback carries no measured contract, or is optional", () => {
    expect(run("controller-feedback", model(els, [rel("a", "approver", "svc", "control"), rel("f", "svc", "approver", "feedback", ["Note"])], contracts)).length).toBe(1);
    expect(run("controller-feedback", model(els, [rel("a", "approver", "svc", "control"), rel("f", "svc", "approver", "feedback", ["Outcome"], { optional: true })], contracts)).length).toBe(1);
  });
  test("passes with required feedback carrying a contract that names its measure", () => {
    expect(run("controller-feedback", model(els, [rel("a", "approver", "svc", "control"), rel("f", "svc", "approver", "feedback", ["Outcome"])], contracts))).toEqual([]);
  });
});

describe("store-partitioning and agent-reach", () => {
  test("a store with both marks or neither fails once the model uses the marks", () => {
    const m = model([el("s1", "store", { partitioned_by: ["k"], unpartitioned: "x" }), el("s2", "registry"), el("s3", "store", { partitioned_by: ["k"] })], []);
    expect(run("store-partitioning", m).map((f) => f.at)).toEqual(["s1", "s2"]);
  });
  test("an agent-reachable part may not receive proof conditions or outsider text", () => {
    const m = model([el("oracle", "store"), el("agent", "service", { agent_reachable: true }), el("web", "external-system")],
      [rel("o", "oracle", "agent", "data", ["RepairCriteria"]), rel("w", "web", "agent", "data", [], { attrs: { content: "untrusted" } })], [{name:"RepairCriteria",attrs:{proof_condition:true}}]);
    expect(run("agent-reach", m).length).toBe(2);
  });
});

test("every rule finds nothing on a model without security marks", () => {
  const m = model(
    [el("a", "person"), el("q", "queue"), el("s", "store"), el("svc", "service")],
    [rel("1", "a", "q", "handoff", ["Thing"]), rel("2", "q", "svc", "control"), rel("3", "svc", "s", "evidence")],
    [{ name: "Thing", produced_by: ["a"], consumed_by: ["q"] }],
  );
  for (const r of pack.rules) expect(r.check(buildContext(config() as any, m, { phases: [], units: [] }))).toEqual([]);
});

test("each rule has a one-sentence why", () => {
  for (const r of pack.rules) {
    expect(r.why.length).toBeGreaterThan(20);
    expect(r.why.trim().split(/(?<=\.)\s+/).length).toBe(1);
  }
});

test("contract names have no built-in classification; designs declare evidence and proof vocabulary",()=>{
  const m=model([el("source","service"),el("store","store",{unpartitioned:"metadata only"}),el("agent","service",{agent_reachable:true})],
    [rel("receipt","source","store","data",["RepairReceipt"]),rel("criteria","source","agent","data",["RepairCriteria"])],
    [{name:"RepairReceipt",produced_by:["source"]},{name:"RepairCriteria"}]);
  expect(run("evidence-partitioned",m)).toEqual([]);expect(run("agent-reach",m)).toEqual([]);
  const declared=config({security:{evidence_contracts:["RepairReceipt"],proof_contracts:["RepairCriteria"]}});
  expect(run("evidence-partitioned",m,declared).map(f=>f.at)).toEqual(["RepairReceipt"]);
  expect(run("agent-reach",m,declared).map(f=>f.at)).toEqual(["agent"]);
  const graph=composeGraph(undefined,[{d:{namespace:"repairs",title:"Repairs",dir:"",pins:[],model:m,plan:{phases:[],units:[]}},config:declared as any}],"repair-portfolio","Repair services");
  expect((graph.config.security as any).evidence_contracts).toEqual(["repairs:RepairReceipt"]);
  expect(run("agent-reach",graph.model,graph.config as any).map(f=>f.at)).toEqual(["repairs:agent"]);
});

test("declared nonpublic context participates in inference-boundary checks",()=>{
  const m=model([el("web","external-system"),el("context","store"),el("producer","service",{role_class:"producer"}),el("model","external-system")],
    [rel("text","web","producer","data",[],{attrs:{content:"untrusted"}}),rel("private","context","producer","data",["RepairContext"]),rel("out","producer","model","inference",[],{optional:true})],
    [{name:"RepairContext"}]);
  expect(run("trifecta",m)).toEqual([]);
  expect(run("trifecta",m,config({security:{context_contracts:["RepairContext"]}})).length).toBeGreaterThan(0);
  m.contracts[0].attrs={nonpublic_context:true};
  expect(run("trifecta",m).length).toBeGreaterThan(0);
});
