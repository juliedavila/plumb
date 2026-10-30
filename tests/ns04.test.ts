// Namespaces and resolution, the shared root, pins, editions,
// schema versions, deprecated keys and migrate. The fixture (tests/fixtures/ns04) is a fictional shared root with two
// designs: alpha (findings intake) and beta (pre-merge checks). Each test works on a temporary copy.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { loadInstance } from "../src/core/load.ts";
import { compile } from "../src/core/compile.ts";
import { formatRef, isForeign, namespaceProblem, parseRef } from "../src/core/namespace.ts";
import { composeDesign } from "../src/core/compose.ts";
import { filesDigest, pinLoops, readEdition, release, verifyEdition } from "../src/core/edition.ts";
import { modelHash } from "../src/core/bundle.ts";
import { SchemaError } from "../src/core/schema.ts";
import { DIGEST } from "../src/core/digest.ts";
import { loadRoot } from "../src/core/root.ts";
import type { Bundle, Finding } from "../src/types.ts";

const FIX = join(import.meta.dir, "fixtures/ns04");
const ROOT = join(import.meta.dir, "..");
const BUILT = "2026-10-23T10:00:00.000Z";

function copy(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-ns04-"));
  cpSync(FIX, d, { recursive: true });
  return d;
}
const edit = (path: string, f: (s: string) => string) => writeFileSync(path, f(readFileSync(path, "utf8")));
const build = async (dir: string, opts: Parameters<typeof buildBundle>[1] = {}) => buildBundle(dir, { built: BUILT, ...opts });
const keys = (fs: Finding[]) => fs.map((f) => `${f.pack}/${f.rule}`);
const of = (fs: Finding[], rule: string) => fs.filter((f) => `${f.pack}/${f.rule}` === rule);
const el = (b: Bundle, id: string) => b.model.elements.find((e) => e.id === id);

describe("reference syntax", () => {
  test("bare, namespaced and kind-qualified references round-trip without claiming invalid prefixes",()=>{
    expect(parseRef("U-1")).toEqual({id:"U-1"});
    expect(parseRef("alpha:U-1")).toEqual({ns:"alpha",id:"U-1"});
    expect(parseRef("alpha:phase/PH-2")).toEqual({ns:"alpha",kind:"phase",id:"PH-2"});
    expect(parseRef("alpha:folder/x")).toEqual({ns:"alpha",id:"folder/x"});
    expect(parseRef("Alpha:x")).toEqual({id:"Alpha:x"});
    for(const ref of ["U-1","alpha:U-1","alpha:phase/PH-2","beta:manual-work/triage"])expect(formatRef(parseRef(ref))).toBe(ref);
    expect(isForeign("beta:x","alpha")).toBe(true);expect(isForeign("alpha:x","alpha")).toBe(false);
    for(const ref of ["x","shared:x","org:x"])expect(isForeign(ref,"alpha")).toBe(false);
  });
  test("design namespaces have bounded syntax and cannot claim the shared or org homes",()=>{
    expect(namespaceProblem("alpha")).toBeUndefined();expect(namespaceProblem("a".repeat(24))).toBeUndefined();
    for(const bad of ["shared","org","Alpha","1a","a".repeat(25),"a b","",7])expect(namespaceProblem(bad)).toBeDefined();
  });
});

describe("resolution: own, then shared, then org for a team; canonical form", () => {
  test("every reference field of a design comes out in canonical form", async () => {
    const d = copy();
    const { bundle: b } = await build(join(d, "alpha"));
    expect(b.findings).toEqual([]);
    expect(b.instance).toMatchObject({ schema: "0.4", namespace: "alpha", root: "../shared" });
    const intake = el(b, "intake")!, store = el(b, "rule-store")!, pub = el(b, "publisher")!;
    expect(intake).toMatchObject({ system: "A", zone: "core", owner: "org:appsec" });   // own system and zone stay bare; the team is the org's
    expect(store.zone).toBe("shared:ci");                                                  // a bare id the design lacks: the shared layer's
    expect(pub.rests_on).toEqual(["shared:SH-1"]);
    expect(b.model.relationships.find((r) => r.id === "r1")!.carries).toEqual(["Finding"]);
    expect(b.model.views[0].elements).toEqual(["intake", "publisher", "rule-store", "beta:runner", "shared:code-host"]);
    expect(b.model.claims!.find((c) => c.id === "CL-1")!.rests_on).toEqual(["beta:CL-9"]); // a claim may point across: no finding
    expect(b.model.teams.map((t) => [t.id, t.home, t.name])).toEqual([["org:appsec", "org", "AppSec platform"], ["org:devplat", "org", "Developer platform"]]);
    expect(b.model.systems.map((x) => [x.id, x.home])).toEqual([["A", undefined], ["shared:ENG", "shared"]]);
    expect(b.model.zones.map((x) => [x.id, x.home])).toEqual([["core", undefined], ["shared:ci", "shared"]]);
    expect(b.instance.packs.map((p) => p.name)).toContain("teams"); // the org layer's teams bring the teams pack
    expect(Object.fromEntries(Object.entries(b.teams!.units).map(([u, r]) => [u, r.owners]))).toEqual({ "U-1": ["org:appsec"], "U-2": ["org:devplat"] });
  });
  test("every reference field: written with the design's own namespace, bare for the shared layer, or across", async () => {
    const d = copy();
    writeFileSync(join(d, "alpha/model.yaml"), `systems:
  - { id: A, name: Intake }
zones:
  - { id: core, name: Core }
elements:
  - { id: intake, name: Intake service, kind: service, system: alpha:A, zone: alpha:core, owner: appsec, verifier: org:devplat, parent: alpha:publisher, owner_teams: [appsec], decider: appsec, not: [devplat], rests_on: [SH-1] }
  - { id: publisher, name: Rule publisher, kind: service, system: A, zone: ci, owner: devplat }
  - { id: rule-store, name: Rule store, kind: store, system: A, zone: ci, owner: appsec, partitioned_by: [tenant] }
relationships:
  - { id: r1, from: alpha:intake, to: publisher, kind: data, carries: [alpha:Finding], rests_on: [shared:SH-1], content: structured }
  - { id: r2, from: publisher, to: rule-store, kind: data, carries: [Finding] }
contracts:
  - { name: Finding, produced_by: [alpha:intake, publisher, code-host], consumed_by: [publisher, rule-store] }
views:
  - { id: main, title: Main, elements: [intake, code-host, beta:gate], relationships: [alpha:r1, x1] }
claims:
  - { id: CL-1, statement: Findings arrive in one queue., kind: premise, grade: untested, rests_on: [beta:CL-9], tested_by: [alpha:U-2] }
seams:
  - { id: core-intake, between: [core, intake-module], owner_role: the platform lead, crossings: [{ id: alpha:r1, carries: [alpha:Finding] }] }
`);
    writeFileSync(join(d, "alpha/plan.yaml"), `phases:
  - { id: M1, name: One queue, exit_test: Findings land., order: 1, rests_on: [SH-1] }
  - { id: M2, name: Rules published, exit_test: A rule reaches the checks., order: 2 }
units:
  - { id: U-1, title: Build the intake, kind: code, phase: alpha:M1, elements: [{ id: alpha:intake, from: none, to: built }], provides: [queue], check: Findings land., status: done }
  - { id: U-2, title: Publish rules, kind: code, phase: M2, elements: [{ id: publisher, from: none, to: built }], requires: [alpha:queue], provides: [shared:proven-rules], owner: appsec, verifier: devplat, rests_on: [shared:SH-1], check: A rule is published. }
`);
    const { bundle: b } = await build(join(d, "alpha"));
    expect(of(b.findings, "core/xref-resolves")).toEqual([]);
    expect(of(b.findings, "core/one-home")).toEqual([]);
    expect(el(b, "intake")).toMatchObject({ system: "A", zone: "core", owner: "org:appsec", verifier: "org:devplat", parent: "publisher", rests_on: ["shared:SH-1"], attrs: { owner_teams: ["org:appsec"], decider: "org:appsec", not: ["org:devplat"] } });
    expect(el(b, "publisher")!.zone).toBe("shared:ci");
    expect(b.model.relationships.find((r) => r.id === "r1")).toMatchObject({ from: "intake", to: "publisher", carries: ["Finding"], rests_on: ["shared:SH-1"] });
    expect(b.model.contracts.find((c) => c.name === "Finding")).toMatchObject({ produced_by: ["intake", "publisher", "shared:code-host"], consumed_by: ["publisher", "rule-store"] });
    expect(b.model.views[0]).toMatchObject({ elements: ["intake", "shared:code-host", "beta:gate"], relationships: ["r1", "shared:x1"] });
    expect(b.model.claims!.find((c) => c.id === "CL-1")).toMatchObject({ rests_on: ["beta:CL-9"], attrs: { tested_by: ["U-2"] } });
    expect(b.plan.phases.find((x) => x.id === "M1")!.rests_on).toEqual(["shared:SH-1"]);
    expect(b.plan.units.find((u) => u.id === "U-1")).toMatchObject({ phase: "M1", elements: [{ id: "intake", from: "none", to: "built" }] });
    expect(b.plan.units.find((u) => u.id === "U-2")).toMatchObject({ requires: ["queue"], provides: ["proven-rules"], owner: "org:appsec", verifier: "org:devplat", rests_on: ["shared:SH-1"] });
    expect(b.model.seams).toEqual([{ id: "core-intake", between: ["core", "intake-module"], owner_role: "the platform lead", crossings: [{ id: "r1", carries: ["Finding"] }] }]);
  });
  test("a design's own namespace written out is still its own record", async () => {
    const d = copy();
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("{ id: r2, from: publisher, to: rule-store", "{ id: r2, from: alpha:publisher, to: alpha:rule-store"));
    const { bundle: b } = await build(join(d, "alpha"));
    expect(b.model.relationships.find((r) => r.id === "r2")).toMatchObject({ from: "publisher", to: "rule-store" });
    expect(b.findings).toEqual([]);
  });
  test("a bare id with two homes resolves to the design's own record, and core/one-home says so", async () => {
    const d = copy();
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("zones:\n  - { id: core, name: Core }", "zones:\n  - { id: core, name: Core }\n  - { id: ci, name: Our own ci }"));
    const { bundle: b } = await build(join(d, "alpha"));
    expect(el(b, "rule-store")!.zone).toBe("ci");
    const f = of(b.findings, "core/one-home");
    expect(f.map((x) => [x.at, x.atKind])).toEqual([["ci", "instance"]]);
    expect(f[0].message).toMatch(/zone ci is defined both in this design and in the shared layer/);
    expect(f[0].severity).toBe("error");
  });
  test("teams: a design keeps its own without an org layer; with one, its own teams are a one-home error", async () => {
    const d = copy();
    // beta names devplat; without org.yaml the design must declare it
    rmSync(join(d, "shared/org.yaml"));
    edit(join(d, "beta/model.yaml"), (s) => `teams:\n  - { id: devplat, name: Developer platform }\n${s}`);
    let b = (await build(join(d, "beta"))).bundle;
    expect(el(b, "runner")!.owner).toBe("devplat");
    expect(b.model.teams.map((t) => t.id)).toEqual(["devplat"]);
    expect(of(b.findings, "core/one-home")).toEqual([]);
    // with an org layer, the design's own team is a second home
    writeFileSync(join(d, "shared/org.yaml"), "teams:\n  - { id: devplat, name: Developer platform }\n");
    b = (await build(join(d, "beta"))).bundle;
    expect(el(b, "runner")!.owner).toBe("devplat"); // own first
    expect(of(b.findings, "core/one-home").map((f) => [f.at, f.atKind])).toEqual([["devplat", "team"]]);
  });
  test("engine.yaml's team, system and zone settings resolve too; one that resolves nowhere is an xref-resolves error", async () => {
    const d = copy();
    edit(join(d, "alpha/engine.yaml"), (s) => `${s}teams:\n  role_teams: { evaluator: appsec, approver: nobody }\nsecurity:\n  execution_zones: [ci]\n`);
    const r = await build(join(d, "alpha"));
    const inst = r.instance;
    expect((inst.config.teams as any).role_teams).toEqual({ evaluator: "org:appsec", approver: "nobody" });
    expect((inst.config.security as any).execution_zones).toEqual(["shared:ci"]);
    expect((inst.ns!.configWritten.teams as any).role_teams.evaluator).toBe("appsec"); // the hashes read engine.yaml as written
    const f = of(r.bundle.findings, "core/xref-resolves");
    expect(f.map((x) => x.message)).toEqual(["engine.yaml names nobody in teams.role_teams.approver, which is not a record of this design, its shared layer or its org layer"]);
  });
  test("a namespaced reference into shared or org must name a record the root holds", async () => {
    const d = copy();
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("system: A, zone: core, owner: appsec }", "system: shared:NOPE, zone: core, owner: org:nobody }"));
    const { bundle: b } = await build(join(d, "alpha"));
    const f = of(b.findings, "core/xref-resolves").map((x) => x.message);
    expect(f).toEqual([
      "element intake names org:nobody in owner, which the org layer does not hold",
      "element intake names shared:NOPE in system, which the shared layer does not hold as a system",
    ]);
    expect(of(b.findings, "generic/references-resolve")).toEqual([]); // one finding per problem: core judges namespaced references
  });
  test("a design names another design only in descriptive records: views, claims' rests_on and notes", async () => {
    const d = copy();
    // allowed: a view's part, a claim's rests_on, a note's target
    writeFileSync(join(d, "alpha/notes.yaml"), "notes:\n  - { id: N-1, target: { kind: unit, id: beta:U-1 }, kind: question, text: Is the runner wired yet?, status: open, author: person, created: \"2026-10-20T09:00:00Z\", updated: \"2026-10-20T09:00:00Z\" }\n");
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("elements: [intake, publisher, rule-store, beta:runner, code-host]", "elements: [intake, publisher, rule-store, beta:runner, beta:gate, code-host]"));
    let b = (await build(join(d, "alpha"))).bundle;
    expect(b.findings).toEqual([]);
    expect(el(b, "beta:gate")).toMatchObject({ home: "beta", kind: "part" }); // shown as an outside part
    expect(b.notes!.items[0].target.id).toBe("beta:U-1");
    // not allowed: a relationship of the design's own naming another design's part
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("{ id: r2, from: publisher, to: rule-store", "{ id: r2, from: publisher, to: beta:gate"));
    b = (await build(join(d, "alpha"))).bundle;
    const f = of(b.findings, "core/xref-resolves");
    expect(f.map((x) => [x.at, x.atKind])).toEqual([["r2", "relationship"]]);
    expect(f[0].message).toMatch(/relationship r2 names beta:gate in to: a design names its own records and its root's, never another design's/);
    expect(of(b.findings, "generic/references-resolve")).toEqual([]); // core judges the reference; the direction check still runs
  });
  test("with the other design composed, a descriptive reference must name a record it holds", async () => {
    const d = copy();
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("rests_on: [beta:CL-9]", "rests_on: [beta:CL-404]"));
    expect((await build(join(d, "alpha"))).bundle.findings).toEqual([]); // alone it cannot tell
    const beta = composeDesign(join(d, "beta"));
    const f = of((await build(join(d, "alpha"), { compose: [beta] })).bundle.findings, "core/xref-resolves");
    expect(f.map((x) => x.message)).toEqual(["claim CL-1 names beta:CL-404 in rests_on, which Pre-merge checks (beta) does not hold"]);
  });
  test("the root's references into a design resolve in that design's own build (xref-resolves (c))", async () => {
    const d = copy();
    edit(join(d, "shared/seams.yaml"), (s) => s.replace("{ id: x2, from: beta:runner, to: alpha:intake", "{ id: x2, from: beta:runner, to: alpha:missing").replace("alpha: [beta:runner]", "alpha: [beta:runner]\n      beta: [alpha:nowhere]"));
    writeFileSync(join(d, "shared/org.yaml"), readFileSync(join(d, "shared/org.yaml"), "utf8") + "slowdowns:\n  - { id: SD-1, activity: triage, until: alpha:M9 }\n");
    const a = (await build(join(d, "alpha"))).bundle;
    expect(of(a.findings, "core/xref-resolves").map((x) => x.message).sort()).toEqual([
      "org slowdown SD-1 names alpha:M9, which this design (alpha) does not hold",
      "seam alpha-beta's exposure for beta names alpha:nowhere, which this design (alpha) does not hold",
      "the shared layer's crossing x2 names alpha:missing, which this design (alpha) does not hold",
    ]);
    expect(a.model.relationships.some((r) => r.id === "shared:x2")).toBe(false); // a crossing whose own end is missing is not brought in
    // beta's own build does not judge references into alpha
    expect(of((await build(join(d, "beta"))).bundle.findings, "core/xref-resolves")).toEqual([]);
  });
});

describe("outside parts", () => {
  test("the shared layer's crossings at a design's edge come in, with far ends named and marked as the shared layer declares", async () => {
    const d = copy();
    const { bundle: b } = await build(join(d, "alpha"));
    expect(el(b, "beta:runner")).toEqual({ id: "beta:runner", name: "Check runner", kind: "part", home: "beta", attrs: { agent_reachable: true } });
    expect(el(b, "shared:code-host")).toMatchObject({ name: "Code hosting", kind: "service", system: "shared:ENG", zone: "shared:ci", home: "shared", rests_on: ["shared:SH-1"] });
    expect(b.model.relationships.filter((r) => r.home).map((r) => `${r.id} ${r.from}>${r.to} ${r.carries}`)).toEqual([
      "shared:x1 rule-store>beta:runner shared:CheckRule", "shared:x2 beta:runner>intake shared:CheckYield", "shared:x3 shared:code-host>intake shared:SourceEvent",
    ]);
    expect(b.model.contracts.find((c) => c.name === "shared:SourceEvent")).toMatchObject({ produced_by: ["shared:code-host"], consumed_by: ["intake"], home: "shared" });
    expect(b.model.claims!.find((c) => c.id === "shared:SH-1")).toMatchObject({ home: "shared", grade: "judgment" });
    expect(b.instance.homes).toEqual({ beta: "Pre-merge checks", org: "the org layer", shared: "the shared layer" });
    // beta's edge: alpha's two parts, none of alpha's others
    const { bundle: bb } = await build(join(d, "beta"));
    expect(bb.model.elements.filter((e) => e.home).map((e) => `${e.id} ${e.name}`)).toEqual(["alpha:intake Intake service", "alpha:rule-store Rule store"]);
  });
  test("composed, an outside part takes its kind and marks from the design it lives in", async () => {
    const d = copy();
    const { bundle: b } = await build(join(d, "alpha"), { compose: [composeDesign(join(d, "beta"))] });
    expect(el(b, "beta:runner")).toMatchObject({ name: "Check runner", kind: "runner", home: "beta", attrs: { agent_reachable: true } });
  });
  test("a design's own build skips rules about records it does not own, but the security pack judges its edge", async () => {
    const d = copy();
    // untrusted text now reaches beta's agent-reachable runner through alpha's own chain
    edit(join(d, "alpha/model.yaml"), (s) => s.replace(", content: structured }", " }"));
    const { bundle: b } = await build(join(d, "alpha"));
    expect(of(b.findings, "security/agent-reach").map((f) => f.at)).toEqual(["beta:runner"]);
    expect(b.findings.filter((f) => f.pack !== "security" && f.at.includes(":"))).toEqual([]); // no generic finding on an outside part
    expect(b.teams!.unownedParts).toEqual([]); // outside parts are another home's to own
  });
});

describe("capabilities across a seam", () => {
  test("a shared capability another design provides is never 'no provider': the unit waits on it, outside this design", async () => {
    const d = copy();
    const { bundle: b } = await build(join(d, "beta"));
    expect(b.plan.units.find((u) => u.id === "U-1")!.requires).toEqual(["shared:proven-rules"]);
    expect(b.plan.capabilities).toEqual([{ id: "shared:proven-rules", provided_by: ["alpha"], required_by: ["beta"], home: "shared" }]);
    expect(b.analysis.outside).toEqual({ "shared:proven-rules": ["alpha"] });
    expect(b.analysis.unprovided).toEqual([]);
    expect(b.analysis.blocked["U-1"]).toEqual({ missing: ["shared:proven-rules"], waitingOn: [] });
    expect(b.analysis.frontier).toEqual(["U-2"]);
    expect(of(b.findings, "plan/requires-provided")).toEqual([]);
    expect(b.status!.milestones.flatMap((m) => m.reasons.map((r) => r.criterion))).not.toContain("no-provider");
  });
  test("a capability the shared layer says this design provides stays its own: with no provider it is a plan error", async () => {
    const d = copy();
    edit(join(d, "alpha/plan.yaml"), (s) => s.replace("provides: [proven-rules], ", "").replace("requires: [queue], ", "requires: [queue, proven-rules], "));
    const { bundle: b } = await build(join(d, "alpha"));
    expect(b.plan.units.find((u) => u.id === "U-2")!.requires).toEqual(["queue", "proven-rules"]);
    expect(b.analysis.unprovided).toEqual(["proven-rules"]);
    expect(of(b.findings, "plan/requires-provided").map((f) => f.at)).toEqual(["U-2"]);
  });
  test("a design that provides a capability the shared layer gives to another design is a one-home error", async () => {
    const d = copy();
    edit(join(d, "beta/plan.yaml"), (s) => s.replace("check: A failing check stops a merge., flow_item: risk }", "provides: [proven-rules], check: A failing check stops a merge., flow_item: risk }"));
    const { bundle: b } = await build(join(d, "beta"));
    expect(of(b.findings, "core/one-home").map((f) => [f.at, f.atKind])).toEqual([["U-2", "unit"]]);
  });
});

const releaseOf = (dir: string, label: string, opts: Parameters<typeof release>[3] = { date: "2026-10-23", build: "test" }) => { const inst = loadInstance(dir); return release(inst, label, modelHash(inst), opts); };

describe("editions: released and latest", () => {
  test("de release writes the frozen design, a copy of the shared file and edition.yaml, and refuses a label that exists", () => {
    const d = copy();
    mkdirSync(join(d, "beta/patches"));
    writeFileSync(join(d, "beta/patches/P-1.yaml"), "id: P-1\ntitle: Name the gate\nstatus: accepted\nwhy: A clearer name.\nops:\n  - { op: modify, kind: element, id: gate, set: { name: Merge gate check } }\n");
    writeFileSync(join(d, "beta/patches/P-2.yaml"), "id: P-2\ntitle: Drop the gate\nstatus: proposed\nwhy: Not needed.\nops:\n  - { op: remove, kind: element, id: gate }\n");
    writeFileSync(join(d, "beta/progress.yaml"), "units:\n  U-2: { status: doing, date: \"2026-10-21\", by: the checks lead }\n");
    const r = releaseOf(join(d, "beta"), "1.0.0");
    const files = readdirSync(r.dir).sort();
    expect(files).toEqual(["edition.yaml", "engine.yaml", "model.yaml", "patches", "plan.yaml", "seams.yaml"]);
    expect(readdirSync(join(r.dir, "patches"))).toEqual(["P-1.yaml"]); // accepted patches are the design; a proposed one is live
    const ed = readEdition(join(d, "beta"), "1.0.0");
    expect(ed.sha256).toBe(r.sha256);
    expect(ed.stamp).toMatchObject({ line: "beta", namespace: "beta", version: "1.0.0", released: true, date: "2026-10-23", build: "test", schema: { design_engine: "0.4" }, pins: [] });
    expect(ed.stamp.files.map((f) => f.path)).toEqual(["engine.yaml", "model.yaml", "patches/P-1.yaml", "plan.yaml", "seams.yaml"]);
    expect(ed.stamp.shared).toEqual({ path: "seams.yaml", sha256: loadRoot(join(d, "shared")).shared!.sha256 });
    // the digest is SHA-256 over "<sha256>  <path>\n" per file, in path order (as sha256sum prints it)
    const text = ed.stamp.files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
    expect(ed.stamp.digest).toBe(new Bun.CryptoHasher("sha256").update(text).digest("hex"));
    expect(ed.stamp.digest).toBe(filesDigest(ed.stamp.files));
    expect(verifyEdition(ed)).toEqual([]);
    expect(readFileSync(join(r.dir, "edition.yaml"), "utf8")).toMatch(/^date: "2026-10-23"$/m);
    expect(() => releaseOf(join(d, "beta"), "1.0.0")).toThrow(/the label 1.0.0 is released already/);
    expect(() => releaseOf(join(d, "beta"), "../x")).toThrow(/not a folder name/);
    // a changed file under a released version is caught
    edit(join(r.dir, "model.yaml"), (s) => s + "# changed\n");
    expect(verifyEdition(readEdition(join(d, "beta"), "1.0.0"))[0]).toMatch(/model.yaml has changed since the release/);
  });
  test("building an edition: its frozen design with the live state now; latest is the working copy", async () => {
    const d = copy();
    mkdirSync(join(d, "beta/patches"));
    writeFileSync(join(d, "beta/patches/P-1.yaml"), "id: P-1\ntitle: Name the gate\nstatus: accepted\nwhy: A clearer name.\nops:\n  - { op: modify, kind: element, id: gate, set: { name: Merge gate check } }\n");
    releaseOf(join(d, "beta"), "1.0.0");
    // after the release: a design change, a patch accepted later, a new proposal, and live progress
    edit(join(d, "beta/model.yaml"), (s) => s.replace("  - { id: gate, name: Merge gate, kind: service, system: B, zone: ci, owner: devplat }", "  - { id: gate, name: Merge gate, kind: service, system: B, zone: ci, owner: devplat }\n  - { id: cache, name: Result cache, kind: store, system: B, zone: ci, owner: devplat }"));
    writeFileSync(join(d, "beta/patches/P-2.yaml"), "id: P-2\ntitle: Rename the runner\nstatus: accepted\nwhy: Later.\nops:\n  - { op: modify, kind: element, id: runner, set: { name: Check runner two } }\n");
    writeFileSync(join(d, "beta/patches/P-3.yaml"), "id: P-3\ntitle: Drop the gate\nstatus: proposed\nwhy: A proposal.\nops:\n  - { op: remove, kind: element, id: gate }\n");
    writeFileSync(join(d, "beta/progress.yaml"), "units:\n  U-2: { status: doing, date: \"2026-10-21\", by: the checks lead }\n");
    const latest = (await build(join(d, "beta"))).bundle;
    expect(el(latest, "cache")).toBeDefined();
    expect(el(latest, "runner")!.name).toBe("Check runner two");
    expect(latest.instance.edition).toBeUndefined();
    const ed = (await build(join(d, "beta"), { edition: "1.0.0" })).bundle;
    expect(ed.instance.edition).toEqual({ version: "1.0.0", date: "2026-10-23", sha256: readEdition(join(d, "beta"), "1.0.0").sha256 });
    expect(el(ed, "cache")).toBeUndefined();                       // the frozen design
    expect(el(ed, "gate")!.name).toBe("Merge gate check");         // with its frozen accepted patch
    expect(el(ed, "runner")!.name).toBe("Check runner");           // and not the one accepted later
    expect(ed.plan.units.find((u) => u.id === "U-2")!.status).toBe("doing"); // live progress now
    expect(ed.patches.map((p) => [p.id, p.status, p.file])).toEqual([["P-1", "accepted", "editions/1.0.0/patches/P-1.yaml"], ["P-3", "proposed", "patches/P-3.yaml"]]);
    expect(ed.findings).toEqual([]);
    await expect(build(join(d, "beta"), { edition: "9.9.9" })).rejects.toThrow(/has no released edition 9.9.9.*released: 1.0.0/);
  });
});

describe("pins and the import graph", () => {
  const pinIn = (d: string, design: string, pin: string) => edit(join(d, design, "engine.yaml"), (s) => `${s}pins:\n  - ${pin}\n`);
  test("a pin is exact, names a design, and never its own namespace; a root imports nothing", async () => {
    const d = copy();
    pinIn(d, "alpha", "{ namespace: beta, version: \"1.0.0\" }");
    edit(join(d, "alpha/engine.yaml"), (s) => s + "  - { namespace: alpha, version: \"1.0.0\", sha256: 0123456789ab }\n  - { namespace: shared, version: \"1.0.0\", sha256: 0123456789ab }\n  - { namespace: beta, version: \"1.0.0\", sha256: zz }\n");
    const f = of((await build(join(d, "alpha"))).bundle.findings, "core/xref-no-cycle").map((x) => x.message);
    expect(f).toEqual([
      "the pin of beta 1.0.0 has sha256 \"zz\", which is not 12 to 64 hex characters of an edition.yaml hash",
      "the pin of beta has no sha256, so it is not exact",
      "this design pins its own namespace (alpha): alpha pins itself",
      "this design pins shared, the shared root's namespace; a design imports the root and pins only designs",
    ]);
  });
  test("one root, a root that is one, and a namespace that is one", async () => {
    const d = copy();
    edit(join(d, "shared/engine.yaml"), (s) => s + "root: ../elsewhere\n");
    expect(of((await build(join(d, "alpha"))).bundle.findings, "core/xref-no-cycle").map((x) => x.message)).toEqual(["the root ../shared declares root of its own; the root sits at the top of the import graph and imports nothing"]);
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace("root: ../shared", "root: [../shared, ../other]").replace("namespace: alpha", "namespace: org"));
    expect(of((await build(join(d, "alpha"))).bundle.findings, "core/xref-no-cycle").map((x) => x.message)).toEqual([
      "root names 2 roots (../shared, ../other); a design imports exactly one shared root",
      "the namespace \"org\" is reserved for the shared root (shared: the shared layer, org: the organization's records)",
    ]);
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace("root: [../shared, ../other]", "root: ../nowhere").replace("namespace: org", "namespace: alpha"));
    const f = of((await build(join(d, "alpha"))).bundle.findings, "core/xref-resolves");
    expect(f[0].message).toMatch(/^root \.\.\/nowhere does not resolve: there is no folder at /);
  });
  test("a pin loop through composed designs, and two designs on one namespace, are xref-no-cycle errors", async () => {
    const d = copy();
    releaseOf(join(d, "beta"), "1.0.0");
    releaseOf(join(d, "alpha"), "1.0.0");
    pinIn(d, "alpha", `{ namespace: beta, version: "1.0.0", sha256: ${readEdition(join(d, "beta"), "1.0.0").sha256} }`);
    pinIn(d, "beta", `{ namespace: alpha, version: "1.0.0", sha256: ${readEdition(join(d, "alpha"), "1.0.0").sha256} }`);
    expect(pinLoops([{ namespace: "a", pins: [{ namespace: "b", version: "1", sha256: "x" }] }, { namespace: "b", pins: [{ namespace: "c", version: "1", sha256: "x" }] }, { namespace: "c", pins: [{ namespace: "a", version: "1", sha256: "x" }] }])).toEqual([["a", "b", "c"]]);
    expect(of((await build(join(d, "alpha"))).bundle.findings, "core/xref-no-cycle")).toEqual([]); // alone, the loop cannot be seen
    const f = of((await build(join(d, "alpha"), { compose: [composeDesign(join(d, "beta"))] })).bundle.findings, "core/xref-no-cycle");
    expect(f.map((x) => x.message)).toEqual(["the pins form a loop: alpha pins beta, which pins alpha; an exact pin loop has no solution, so the design that ships first pins nothing that leads back"]);
    const twin = { ...composeDesign(join(d, "beta")), namespace: "alpha", dir: join(d, "twin") };
    const g = of((await build(join(d, "beta"), { compose: [twin] })).bundle.findings, "core/xref-no-cycle");
    expect(g.some((x) => /two designs share the namespace alpha/.test(x.message))).toBe(false); // beta is not alpha
    const h = of((await build(join(d, "alpha"), { compose: [twin] })).bundle.findings, "core/xref-no-cycle");
    expect(h.map((x) => x.message).some((m) => m.startsWith("two designs share the namespace alpha"))).toBe(true);
  });
  test("a stale pin: another edition composed, a changed file under the pinned version, a version not released", async () => {
    const d = copy();
    releaseOf(join(d, "beta"), "1.0.0");
    const sha = readEdition(join(d, "beta"), "1.0.0").sha256;
    pinIn(d, "alpha", `{ namespace: beta, version: "1.0.0", sha256: ${sha.slice(0, 12)} }`);
    const stale = async (edition?: string) => of((await build(join(d, "alpha"), { compose: [composeDesign(join(d, "beta"), edition)] })).bundle.findings, "core/xref-pin-stale").map((f) => f.message);
    expect((await build(join(d, "alpha"))).bundle.findings).toEqual([]); // the pinned design not composed: nothing to judge
    expect(await stale("1.0.0")).toEqual([]);                             // the pinned edition composed: not stale
    expect(await stale()).toEqual(["alpha pins Pre-merge checks 1.0.0, and this build composes the working copy of Pre-merge checks: the one record of Pre-merge checks the shared layer names did not change"]);
    // a reworded record is not stale; a changed or removed one is
    edit(join(d, "beta/model.yaml"), (s) => s.replace("name: Check runner, kind: runner", "name: The check runner, kind: runner"));
    expect(await stale()).toEqual(["alpha pins Pre-merge checks 1.0.0, and this build composes the working copy of Pre-merge checks: the one record of Pre-merge checks the shared layer names did not change"]);
    edit(join(d, "beta/model.yaml"), (s) => s.replace("kind: runner, system: B", "kind: service, system: B"));
    expect(await stale()).toEqual(["alpha pins Pre-merge checks 1.0.0, and this build composes the working copy of Pre-merge checks: of the one record of Pre-merge checks the shared layer names, The check runner (runner), changed"]);
    edit(join(d, "beta/model.yaml"), (s) => s.replace(/  - \{ id: runner,.*\n/, ""));
    expect((await stale())[0]).toMatch(/of the one record of Pre-merge checks the shared layer names, Check runner \(runner\), gone$/);
    // a file under the pinned version changed beside its edition.yaml, then edition.yaml itself
    edit(join(d, "beta/editions/1.0.0/plan.yaml"), (s) => s + "# edited after the release\n");
    expect((await stale("1.0.0"))[0]).toMatch(/^alpha pins Pre-merge checks 1\.0\.0, and under that version plan\.yaml has changed since the release \(sha256 [0-9a-f]{12}, listed [0-9a-f]{12}\)$/);
    edit(join(d, "beta/editions/1.0.0/edition.yaml"), (s) => s + "# edited after the release\n");
    expect((await stale("1.0.0"))[0]).toMatch(/^alpha pins Pre-merge checks 1.0.0 at sha256 [0-9a-f]{12}, and the edition under that version now has [0-9a-f]{12}: a file under a released version changed$/);
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace(`version: "1.0.0"`, `version: "2.0.0"`));
    expect((await stale())[0]).toBe("alpha pins Pre-merge checks 2.0.0, which Pre-merge checks (beta) has not released: there is no editions/2.0.0/edition.yaml in its folder");
  });
  test("a moved shared file: the edition recorded another hash, and the finding lists what this design names that changed", async () => {
    const d = copy();
    releaseOf(join(d, "alpha"), "1.0.0");
    const f = async () => of((await build(join(d, "alpha"))).bundle.findings, "core/xref-pin-stale").map((x) => x.message);
    expect(await f()).toEqual([]);
    edit(join(d, "shared/seams.yaml"), (s) => s.replace("description: A rule a check runs.", "description: A rule that a check runs."));
    expect((await f())[0]).toMatch(/^edition 1.0.0 was checked with the shared file at sha256 [0-9a-f]{12}, and the root's shipped seams.yaml is now [0-9a-f]{12}: none of the \d+ shared records this design names changed$/);
    edit(join(d, "shared/seams.yaml"), (s) => s.replace("{ id: x1, from: alpha:rule-store, to: beta:runner, kind: data", "{ id: x1, from: alpha:rule-store, to: beta:runner, kind: control"));
    expect((await f())[0]).toMatch(/: of the \d+ shared records this design names, relationship shared:x1, changed$/);
    // the edition build answers to its own record too
    expect(of((await build(join(d, "alpha"), { edition: "1.0.0" })).bundle.findings, "core/xref-pin-stale")).toHaveLength(1);
  });
});

describe("schema versions", () => {
  test("a newer schema stops the build; a value that is not a version too", async () => {
    const d = copy();
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace('schema: "0.4"', 'schema: "0.5"'));
    const e = await build(join(d, "alpha")).catch((x) => x);
    expect(e).toBeInstanceOf(SchemaError);
    expect(e.finding).toMatchObject({ pack: "core", rule: "schema-known", severity: "error" });
    expect(e.message).toBe("core/schema-known: this instance is written to schema 0.5; this engine reads up to 0.4");
    const p = Bun.spawnSync(["bun", join(ROOT, "plumb.ts"), "build", join(d, "alpha"), "--out", join(d, "out")], { stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(1);
    expect(p.stderr.toString()).toContain("core/schema-known (error): this instance is written to schema 0.5; this engine reads up to 0.4");
    expect(existsSync(join(d, "out"))).toBe(false);
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace('schema: "0.5"', "schema: next"));
    await expect(build(join(d, "alpha"))).rejects.toThrow(/declares schema "next", which is not a schema version/);
  });
  test("an older schema warns once, naming de migrate; none is silent; a 0.4 key without schema 0.4 is a warning", async () => {
    const d = copy();
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace('schema: "0.4"\nnamespace: alpha\nroot: ../shared\n', 'schema: "0.3"\n'));
    edit(join(d, "alpha/plan.yaml"), (s) => s.replace(/, flow_item: \w+/g, "")); // a unit's flow_item is a 0.4 key too: alpha as a 0.3 instance has none
    let r = await build(join(d, "alpha"));
    expect(r.warnings.filter((w) => /schema/.test(w))).toEqual([expect.stringMatching(/^warning: this instance declares schema 0\.3, older than 0\.4; run bun plumb\.ts migrate .*alpha to bring it to 0\.4$/)]);
    expect(r.bundle.instance.schema).toBeUndefined();
    edit(join(d, "alpha/engine.yaml"), (s) => s.replace('schema: "0.3"\n', ""));
    r = await build(join(d, "alpha"));
    expect(r.warnings).toEqual([]);
    expect(r.bundle.instance.schema).toBeUndefined();
    // namespace and root without a schema: read as 0.4, with a warning
    edit(join(d, "alpha/engine.yaml"), (s) => s + "namespace: alpha\nroot: ../shared\n");
    r = await build(join(d, "alpha"));
    expect(of(r.bundle.findings, "core/schema-known").map((f) => [f.severity, f.message])).toEqual([["warning", expect.stringMatching(/^this instance uses 0\.4 keys \(namespace, root\) without declaring schema 0\.4; they are read as 0\.4/)]]);
    expect(r.bundle.instance).toMatchObject({ schema: "0.4", namespace: "alpha" });
    // under a declared older schema they are not read
    edit(join(d, "alpha/engine.yaml"), (s) => `schema: "0.3"\n${s}`);
    r = await build(join(d, "alpha"));
    expect(of(r.bundle.findings, "core/schema-known")[0].message).toMatch(/uses 0\.4 keys \(namespace, root\) but declares schema 0\.3, so they are not read/);
    expect(r.bundle.instance.namespace).toBeUndefined();
    expect(r.bundle.instance.packs.find((p) => p.name === "core")!.rules.map((x) => x.id)).toContain("schema-known");
  });
});

describe("deprecated keys", () => {
  const TOUR = "title: A tour\nsteps:\n  - target: { gate: M1 }\n    title: The first milestone\n    say: It opens the gate.\n";
  test("in a 0.4 design an old key warns with its file, line, new key and removal, and is read through the new key", async () => {
    const d = copy();
    writeFileSync(join(d, "alpha/tour.yaml"), TOUR);
    writeFileSync(join(d, "alpha/deck.yaml"), "slides:\n  - template: status\n    gates: [M1]\n");
    const { bundle: b } = await build(join(d, "alpha"));
    expect(of(b.findings, "core/deprecated-key").map((f) => [f.at, f.severity, f.message])).toEqual([
      ["deck.yaml:3", "warning", "deck.yaml line 3: the key gates (slides[]) is deprecated; write milestones, which it is read as until 0.5 removes gates (bun plumb.ts migrate renames it)"],
      ["tour.yaml:3", "warning", "tour.yaml line 3: the key gate (steps[].target) is deprecated; write milestone, which it is read as until 0.5 removes gate (bun plumb.ts migrate renames it)"],
    ]);
    expect(b.tour!.steps[0].target).toEqual({ milestone: "M1" });
    expect(b.deck!.slides[0].milestones!.map((m) => m.phase)).toEqual(["M1"]);
  });
  test("a lone instance reads the old keys in silence, as it always has", async () => {
    const d = mkdtempSync(join(tmpdir(), "plumb-ns04-lone-"));
    cpSync(join(ROOT, "examples/delivery-stream"), d, { recursive: true });
    writeFileSync(join(d, "tour.yaml"), TOUR.replace("M1", "PH-1"));
    const { bundle: b } = await buildBundle(d, { built: BUILT });
    expect(keys(b.findings).filter((k) => k.startsWith("core/"))).toEqual([]);
    expect(b.tour!.steps[0].target).toEqual({ gate: "PH-1" });
  });
});

const de = (args: string[], cwd = ROOT) => { const p = Bun.spawnSync(["bun", join(ROOT, "plumb.ts"), ...args], { cwd, stdout: "pipe", stderr: "pipe" }); return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() }; };
const loneCopy = () => { const d = mkdtempSync(join(tmpdir(), "plumb-ns04-mig-")); const i = join(d, "delivery-stream"); cpSync(join(ROOT, "examples/delivery-stream"), i, { recursive: true }); return { d, i }; };
const snapshot = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (rel: string) => { for (const n of readdirSync(join(dir, rel))) { const r = rel ? `${rel}/${n}` : n; try { out[r] = readFileSync(join(dir, r), "utf8"); } catch { walk(r); } } };
  walk("");
  return out;
};

describe("de migrate", () => {
  test("0.3 to 0.4 writes schema and namespace, renames deprecated keys, keeps comments; --dry-run writes nothing; a second run changes nothing", async () => {
    const { d, i } = loneCopy();
    edit(join(i, "tour.yaml"), (s) => s.replace("steps:\n", "steps:\n  - target: { gate: PH-1 } # the first milestone\n    title: Where it starts\n    say: The first milestone.\n"));
    edit(join(i, "engine.yaml"), (s) => `# our stream\n${s}`);
    const was = (await buildBundle(i, { built: BUILT })).bundle;
    const before = snapshot(d);
    const dry = de(["migrate", i, "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("(dry run: nothing written)");
    expect(dry.out).toContain(`+ 3: schema: "0.4"`);
    expect(dry.out).toContain("+ 4: namespace: delivery-stream");
    expect(dry.out).toMatch(/- \d+:   - target: \{ gate: PH-1 \} # the first milestone/);
    expect(snapshot(d)).toEqual(before);
    const run = de(["migrate", i]);
    expect(run.code).toBe(0);
    const engine = readFileSync(join(i, "engine.yaml"), "utf8");
    expect(engine.split("\n").slice(0, 4)).toEqual(["# our stream", "name: delivery-stream", 'schema: "0.4"', "namespace: delivery-stream"]);
    expect(engine).toContain("glossary:          # what this design's words mean on the page"); // comments stay
    expect(readFileSync(join(i, "tour.yaml"), "utf8")).toContain("  - target: { milestone: PH-1 } # the first milestone");
    const after = snapshot(d);
    expect(de(["migrate", i]).out).toContain("Nothing to change: the instance is migrated.");
    expect(snapshot(d)).toEqual(after);
    // the migrated instance builds as a 0.4 design with the findings it had, and no new ones
    const now = (await buildBundle(i, { built: BUILT })).bundle;
    expect(now.instance).toMatchObject({ schema: "0.4", namespace: "delivery-stream" });
    expect(now.findings.map((f) => `${f.pack}/${f.rule}@${f.at}`)).toEqual(was.findings.map((f) => `${f.pack}/${f.rule}@${f.at}`));
  });
  test("--root writes the root, makes the folder a root if it is not one, and proposes the teams for the org layer", () => {
    const { d, i } = loneCopy();
    const r = de(["migrate", i, "--root", join(d, "shared")]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(i, "engine.yaml"), "utf8")).toMatch(/^namespace: delivery-stream\nroot: \.\.\/shared$/m);
    expect(readFileSync(join(d, "shared/engine.yaml"), "utf8")).toContain("kind: root");
    const pf = readdirSync(join(d, "shared/patches"));
    expect(pf).toEqual(["P-001-move-teams-from-delivery-stream.yaml"]);
    const patch = Bun.YAML.parse(readFileSync(join(d, "shared/patches", pf[0]), "utf8")) as any;
    const teams = (Bun.YAML.parse(readFileSync(join(i, "model.yaml"), "utf8")) as any).teams;
    expect(patch).toMatchObject({ id: "P-001", status: "proposed", provenance: { author: "agent" } });
    expect(patch.ops.map((o: any) => [o.op, o.kind, o.value.id])).toEqual(teams.map((t: any) => ["add", "team", t.id]));
    expect(r.out).toContain("are proposed for the org layer in P-001; accept it, then remove them from model.yaml");
    const after = snapshot(d);
    expect(de(["migrate", i, "--root", join(d, "shared")]).out).toContain("Nothing to change");
    expect(snapshot(d)).toEqual(after);
  });
  test("--moved rewrites moved ids in the hand-written files, once; generated files are left to their importer", () => {
    const { d, i } = loneCopy();
    writeFileSync(join(i, "progress.yaml"), "units:\n  U-05: { status: doing, date: \"2026-10-21\", by: the delivery lead }\n");
    writeFileSync(join(i, "notes.yaml"), "notes:\n  - { id: N-1, target: { kind: unit, id: U-05 }, kind: note, text: U-05 and U-050 differ; see plan/requires-provided@U-05., status: open, author: person, created: \"2026-10-20T09:00:00Z\", updated: \"2026-10-20T09:00:00Z\" }\n");
    writeFileSync(join(d, "moved.yaml"), "units:\n  U-05: other:U-5\n");
    expect(de(["migrate", i, "--moved", join(d, "moved.yaml")]).code).toBe(0);
    expect(readFileSync(join(i, "progress.yaml"), "utf8")).toContain("  other:U-5: { status: doing");
    expect(readFileSync(join(i, "notes.yaml"), "utf8")).toContain("id: other:U-5 }, kind: note, text: other:U-5 and U-050 differ; see plan/requires-provided@other:U-5.");
    const after = snapshot(d);
    expect(de(["migrate", i, "--moved", join(d, "moved.yaml")]).out).toContain("Nothing to change");
    expect(snapshot(d)).toEqual(after);
    writeFileSync(join(d, "chain.yaml"), "U-05: U-06\nU-06: U-07\n");
    expect(de(["migrate", i, "--moved", join(d, "chain.yaml")]).err).toContain("a move map must not chain");
  });
  test("migrate never goes past this engine's schema or down", () => {
    const { i } = loneCopy();
    expect(de(["migrate", i, "--to", "0.5"]).err).toContain("this engine migrates up to 0.4");
  });
});

describe("de release and de build --edition on the command line", () => {
  test("release prints the pin; a second release of one label is refused", () => {
    const d = copy();
    const r = de(["release", join(d, "beta"), "--label", "1.0.0"]);
    expect(r.code).toBe(0);
    const sha = readEdition(join(d, "beta"), "1.0.0").sha256;
    expect(r.out).toContain(`edition.yaml sha256 ${sha}`);
    expect(r.out).toContain(`A design that ships with this one pins it as: { namespace: beta, version: "1.0.0", sha256: ${sha} }`);
    const again = de(["release", join(d, "beta"), "--label", "1.0.0"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("is released already");
    const b = de(["build", join(d, "beta"), "--edition", "1.0.0", "--out", join(d, "out")]);
    expect(b.code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "out/bundle.json"), "utf8")).instance.edition.version).toBe("1.0.0");
  });
});

describe("digests cover contracts, teams, milestones, systems and zones", () => {
  test("a 0.4 bundle's digest holds them and says so; a lone bundle's is as it was", async () => {
    const d = copy();
    const b = (await build(join(d, "alpha"))).bundle;
    const g = DIGEST.digest(b);
    expect(g.k).toEqual(["element", "relationship", "unit", "claim", "finding", "patch", "note", "contract", "team", "phase", "system", "zone", "current"]); // current: current-state records
    for (const k of ["contract:Finding", "contract:shared:CheckRule", "team:org:appsec", "phase:M1", "system:A", "system:shared:ENG", "zone:core", "zone:shared:ci"]) expect(g.r[k]).toMatch(/^[0-9a-z]+~[0-9a-z]{4}$/);
    const lone = DIGEST.digest((await buildBundle(join(ROOT, "examples/delivery-stream"), { built: BUILT })).bundle);
    expect(lone.k).toBeUndefined();
    expect(Object.keys(lone.r).filter((k) => /^(contract|team|phase|system|zone):/.test(k))).toEqual([]);
    // a reader whose stored digest is a lone one sees no new kinds reported as added
    const cmp = DIGEST.compare({ ...g, r: Object.fromEntries(Object.entries(g.r).filter(([k]) => !/^(contract|team|phase|system|zone):/.test(k))), k: undefined } as any, g);
    expect(cmp.added).toEqual([]);
    expect(Object.keys(cmp.counts)).toEqual(["element", "relationship", "unit", "claim", "finding", "patch", "note"]);
    // two 0.4 digests compare the new kinds too: a renamed milestone is reworded, a moved one changed
    const b2 = structuredClone(b);
    b2.plan.phases[0].name = "Findings flow into one place";
    b2.model.contracts[0].description = "Something else entirely.";
    b2.model.zones[0].id = "core2";
    const c2 = DIGEST.compare(g, DIGEST.digest(b2));
    expect(c2.reworded.map((r) => r.id).sort()).toEqual(["Finding", "M1"]);
    expect(c2.added.map((r) => r.id)).toEqual(["core2"]);
    expect(c2.removed.map((r) => r.id)).toEqual(["core"]);
  });
  test("recordDigest: a reworded record keeps its bare hash; a changed one does not", () => {
    const a = DIGEST.recordDigest("element", { id: "x", name: "X", kind: "service", owner: "t" });
    const b = DIGEST.recordDigest("element", { id: "x", name: "Another name", kind: "service", owner: "u" });
    const c = DIGEST.recordDigest("element", { id: "x", name: "X", kind: "store", owner: "t" });
    expect(a.full).not.toBe(b.full);
    expect(a.bare).toBe(b.bare);
    expect(a.bare).not.toBe(c.bare);
    expect(DIGEST.recordDigest("phase", { id: "M1", name: "a", target: "2026-11-01", exit_test: "t" }).bare).toBe(DIGEST.recordDigest("phase", { id: "M1", name: "b", target: "2027-01-01", exit_test: "t" }).bare);
  });
});

describe("the core pack and the shared root reader", () => {
  test("a 0.4 design with a core finding lists the 0.4 core rules; a lone instance's core pack keeps its rules", async () => {
    const d = copy();
    edit(join(d, "alpha/model.yaml"), (s) => s.replace("owner: appsec }", "owner: org:nobody }"));
    const core = (await build(join(d, "alpha"))).bundle.instance.packs.find((p) => p.name === "core")!;
    expect(core.rules.map((r) => r.id)).toEqual(["pack-loads", "patch-loads", "patch-ids-unique", "patch-applies", "yaml-keys-unique", "override-valid", "unit-keeps-a-part", "schema-known", "deprecated-key", "xref-resolves", "xref-pin-stale", "xref-no-cycle", "one-home", "current-valid"]);
    for (const r of core.rules) expect(`${r.title} ${r.why}`).not.toMatch(/—|attrs\.|\.yaml|`/);
    const { i } = loneCopy();
    writeFileSync(join(i, "patches/P-009-broken.yaml"), "id: P-009\nstatus: maybe\n");
    const lone = (await buildBundle(i, { built: BUILT })).bundle.instance.packs.find((p) => p.name === "core")!;
    expect(lone.rules.map((r) => r.id)).toEqual(["pack-loads", "patch-loads", "patch-ids-unique", "patch-applies", "yaml-keys-unique", "override-valid", "unit-keeps-a-part"]);
  });
  test("a proposed patch that names another design shows the error it would introduce", async () => {
    const d = copy();
    mkdirSync(join(d, "alpha/patches"));
    writeFileSync(join(d, "alpha/patches/P-1.yaml"), "id: P-1\ntitle: Feed the runner directly\nstatus: proposed\nwhy: Skip the store.\nops:\n  - op: add\n    kind: relationship\n    value: { id: r9, from: publisher, to: beta:runner, kind: data }\n");
    const b = (await build(join(d, "alpha"))).bundle;
    expect(b.findings).toEqual([]);
    const im = b.patches[0].impact;
    expect(im.findingsIntroduced.map((f) => `${f.pack}/${f.rule}@${f.at}`)).toEqual(["core/xref-resolves@r9", "portfolio/seam-crossing-declared@r9"]); // a crossing outside the shared layer is also undeclared
    expect(im.verdict?.level).toBe("fail");
  });
});
