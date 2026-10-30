// Regression coverage: impact attribution, MCP tools and server, patch loading,
// plan rules, and the site's Gone group. Temp instances live under the OS temp dir.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { applyPatch, compile } from "../src/core/compile.ts";
import { computeImpact } from "../src/core/impact.ts";
import { loadInstance } from "../src/core/load.ts";
import { analyzePlan } from "../src/core/plan.ts";
import { impactMd, planMd } from "../src/core/report.ts";
import { loadPacks } from "../src/core/rules.ts";
import { call, unblockRanking } from "../src/mcp/tools.ts";
import { renderSite } from "../src/site/render.ts";
import type { Patch } from "../src/types.ts";
import { E, MINI, PH, R, T, U, model, plan, run } from "./core-helpers.ts";
import { DS_DIR, HAVE_MCP_SERVER } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const delivery = await buildBundle(DS_DIR, { built: "test" });
const mini = await buildBundle(MINI, { built: "test" });
// A fictional unowned part's warning disappears with the removed record; it is not resolved.
const goneDir = mkdtempSync(join(tmpdir(), "plumb-gone-"));
cpSync(MINI, goneDir, { recursive: true });
const goneModelPath = join(goneDir, "model.yaml");
const goneModel = Bun.YAML.parse(readFileSync(goneModelPath,"utf8")) as any;
goneModel.elements.push({id:"ext.outside-text",name:"Public repair instructions",kind:"external-system"});
writeFileSync(goneModelPath,Bun.YAML.stringify(goneModel,null,2));
writeFileSync(join(goneDir, "patches", "P-900-drop-outside-text.yaml"), "id: P-900\ntitle: Drop the outside text\nstatus: proposed\nwhy: A test patch.\nops:\n  - { op: remove, kind: element, id: ext.outside-text }\n");
const gone = await buildBundle(goneDir, { built: "test" });

/** A copy of the mini instance in a temp dir, with extra patch files written into it. */
function miniWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "plumb-fix-"));
  cpSync(MINI, dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, "patches", name), text);
  return dir;
}

describe("1. findings gone with a removed record", () => {
  const p9 = gone.bundle.patches.find((p) => p.id === "P-900")!;
  test("a removed part's warning is gone with it, not resolved", () => {
    expect(p9.impact.findingsResolved).toEqual([]);
    expect(p9.impact.findingsGone!.map((f) => f.at)).toEqual(["ext.outside-text"]);
  });
  test("delivery P-001's handoff finding is resolved, not gone (its record stays)", () => {
    const p = delivery.bundle.patches.find((x) => x.id === "P-001")!;
    expect(p.impact.findingsResolved.map((f) => f.rule)).toEqual(["path-handoff-limit"]);
    expect(p.impact.findingsGone).toEqual([]);
  });
  test("CLI, MCP and site report the gone findings separately", () => {
    const md = impactMd(p9.impact);
    expect(md).toContain("## Gone with the removed record");
    expect(md.split("## Findings resolved")[1].split("##")[0]).toContain("None.");
    const mcp = call(gone.bundle, "impact", { patch: "P-900" }).text;
    expect(mcp).toContain("## Findings resolved (0)");
    expect(mcp).toContain("## Gone with the removed record (1)");
    const site = renderSite(gone.bundle);
    const p3html = site.slice(site.indexOf('data-patch="P-900"'));
    expect(p3html).toContain("No longer applies · 1");
    expect(p3html).toContain("Their disappearance is not a fix.");
    expect(p3html).toContain("Fixed · 0");
  });
});

describe("2. MCP tools", () => {
  const b = mini.bundle;
  test("what_can_start: an unknown phase is an error listing the phases", () => {
    const out = call(b, "what_can_start", { phase: "nope" });
    expect(out.isError).toBe(true);
    for (const ph of b.plan.phases) expect(out.text).toContain(ph.id);
  });
  test("what_can_start accepts a phase name or its order number", () => {
    const byId = call(b, "what_can_start", { phase: "ph2" }).text;
    expect(call(b, "what_can_start", { phase: "2" }).text).toBe(byId);
    expect(call(b, "what_can_start", { phase: "run the WORKSHOP" }).text).toBe(byId);
    expect(byId).toContain("u2");
  });
  test("most_unblocking ranks open units by everything downstream, then direct", () => {
    const rank = unblockRanking(b);
    expect(rank[0]).toEqual({ id: "u2", direct: 2, total: 2 });
    const out = call(b, "most_unblocking", { limit: 1 });
    expect(out.isError ?? false).toBe(false);
    expect(out.text).toContain("1. u2 (ph2, can start now)");
    expect(out.text).toContain("Unblocks 2 directly, 2 in all.");
    expect(call(b, "most_unblocking", { phase: "ph1" }).text).toContain("No open units");
    expect(call(b, "most_unblocking", { can_start: true }).text).not.toContain("u3");
    expect(call(b, "most_unblocking", { phase: "zz" }).isError).toBe(true);
  });
  test("arguments that are not an object are an error", () => {
    for (const a of [null, 42, "x", [1]]) expect(call(b, "overview", a).isError).toBe(true);
    expect(call(b, "overview", undefined).isError ?? false).toBe(false);
  });
  test("## Unblocks says none when nothing depends on the unit", () => {
    expect(call(b, "unit", { id: "u3" }).text).toContain("## Unblocks\n- none");
  });
});

async function serve(lines: string[]) {
  const path = join(mkdtempSync(join(tmpdir(), "plumb-mcp-")), "bundle.json");
  await Bun.write(path, JSON.stringify(mini.bundle));
  const s = Bun.spawn(["bun", join(ROOT, "src/mcp/server.ts"), path], { stdin: "pipe", stdout: "pipe" });
  s.stdin.write(lines.join("\n") + "\n");
  s.stdin.end();
  return (await new Response(s.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
}

describe.skipIf(!HAVE_MCP_SERVER)("2-3. MCP server", () => {
  test("initialize answers our version when the client's is unknown, and echoes a supported one", async () => {
    const r = await serve([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}',
      '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}',
      '{"jsonrpc":"2.0","id":3,"method":"initialize","params":{}}',
    ]);
    expect(r.map((x) => x.result.protocolVersion)).toEqual(["2024-11-05", "2025-06-18", "2024-11-05"]);
  });
  test("a non-object request line is an Invalid Request and the server keeps running", async () => {
    const r = await serve(["null", "42", '"x"', "[]", '{"jsonrpc":"2.0","id":9,"method":"ping"}']);
    expect(r.slice(0, 4).map((x) => [x.id, x.error.code])).toEqual([[null, -32600], [null, -32600], [null, -32600], [null, -32600]]);
    expect(r[4]).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  });
});

describe("4. patch loading and modify", () => {
  const patch = (ops: unknown[]): Patch => ({ id: "px", title: "px", status: "accepted", why: "t", ops: ops as Patch["ops"] });
  test("modify with a non-object or missing set is an error and changes nothing", () => {
    for (const op of [{ op: "modify", kind: "element", id: "a", set: "oops" }, { op: "modify", kind: "element", id: "a" }, { op: "modify", kind: "element", id: "a", set: [1] }]) {
      const s = { model: model({ elements: [E("a") as any] }), plan: plan() };
      const before = JSON.stringify(s);
      const r = applyPatch(s, patch([op]));
      expect(r.errors.length).toBe(1);
      expect(r.errors[0]).toContain("modify needs `set`");
      expect(r.modified).toEqual([]);
      expect(JSON.stringify(s)).toBe(before);
    }
  });
  test("an op that is not a mapping is an error", () => {
    const r = applyPatch({ model: model(), plan: plan() }, patch(["remove customer"]));
    expect(r.errors[0]).toContain("an op must be a mapping");
  });
  test("status is case-insensitive; an unknown status is an error and the patch is not applied", () => {
    const dir = miniWith({
      "s1.yaml": "id: s1\ntitle: caps\nstatus: Accepted\nwhy: x\nops:\n  - { op: add, kind: team, value: { id: t9, name: T9 } }\n",
      "s2.yaml": "id: s2\ntitle: odd\nstatus: finished\nwhy: x\nops:\n  - { op: add, kind: team, value: { id: t8, name: T8 } }\n" });
    const inst = loadInstance(dir);
    expect(inst.patches.find((p) => p.id === "s1")!.status).toBe("accepted");
    expect(inst.patches.find((p) => p.id === "s2")!.status).toBe("proposed");
    expect(inst.loadFindings!.map((f) => `${f.rule}@${f.at}`)).toEqual(["patch-loads@patches/s2.yaml"]);
    const c = compile(inst);
    expect(c.model.teams.map((t) => t.id)).toContain("t9");
    expect(c.model.teams.map((t) => t.id)).not.toContain("t8");
  });
  test("ops that is not a list, and a file that is not a mapping, are errors", () => {
    const dir = miniWith({
      "o.yaml": "id: o1\ntitle: no list\nstatus: accepted\nops: { op: remove, kind: element, id: intake }\n",
      "l.yaml": "- just\n- a list\n" });
    const inst = loadInstance(dir);
    const at = inst.loadFindings!.map((f) => f.at).sort();
    expect(at).toEqual(["patches/l.yaml", "patches/o.yaml"]);
    expect(inst.patches.find((p) => p.id === "o1")!.ops).toEqual([]);
    expect(compile(inst).model.elements.some((e) => e.id === "intake")).toBe(true);
  });
  test("duplicate patch ids are an error and each file keeps its own impact", async () => {
    const dir = miniWith({
      "x.yaml": "id: d1\ntitle: rejected one\nstatus: rejected\nwhy: x\nops:\n  - { op: remove, kind: element, id: pickup }\n",
      "y.yaml": "id: d1\ntitle: accepted one\nstatus: accepted\nwhy: x\nops:\n  - { op: add, kind: team, value: { id: t2, name: T2 } }\n" });
    const { bundle } = await buildBundle(dir, { built: "test" });
    expect(bundle.findings.some((f) => f.rule === "patch-ids-unique" && f.at === "d1" && f.severity === "error")).toBe(true);
    const byFile = Object.fromEntries(bundle.patches.filter((p) => p.id === "d1").map((p) => [p.file, p.impact]));
    expect(byFile["patches/x.yaml"].removed).toEqual([{ kind: "element", id: "pickup" }]);
    expect(byFile["patches/x.yaml"].added).toEqual([]);
    expect(byFile["patches/y.yaml"].added).toEqual([{ kind: "team", id: "t2" }]);
    expect(byFile["patches/y.yaml"].removed).toEqual([]);
  });
  test("a YAML parse error in one patch is a finding at that file and the build still writes outputs", async () => {
    const dir = miniWith({ "bad.yaml": "id: P-1\ntitle: bad\nstatus: proposed\nops: [ { op: add\n" });
    const { bundle } = await buildBundle(dir, { built: "test" });
    const f = bundle.findings.find((x) => x.rule === "patch-loads")!;
    expect(f.at).toBe("patches/bad.yaml");
    expect(f.message).toContain("YAML parse error");
    expect(bundle.patches.length).toBe(5); // the five good patches still load
    const out = mkdtempSync(join(tmpdir(), "plumb-out-"));
    const p = Bun.spawnSync(["bun", join(ROOT, "plumb.ts"), "build", dir, "--out", out]);
    expect(p.exitCode).toBe(1);
    expect(existsSync(join(out, "bundle.json")) && existsSync(join(out, "index.html"))).toBe(true);
  });
});

describe("5. plan", () => {
  const ph = [PH("ph1", 1), PH("ph2", 2)];
  test("a unit requiring a capability only it provides is reported, and the plan text says so", async () => {
    const p = plan({ phases: ph, units: [U("s", { requires: ["selfcap"], provides: ["selfcap"] }) as any] });
    const fs = await run("plan", "requires-provided", model({ teams: [T("t1")] }), p);
    expect(fs.map((f) => f.message)).toEqual(['unit s requires "selfcap", which only it provides, so it can never start']);
    const md = planMd(p, analyzePlan(p));
    expect(md).toContain("only this unit provides `selfcap`");
    expect(md).not.toContain("no unit provides it");
  });
  test("a done unit whose dependency is not done is an error", async () => {
    const p = plan({ phases: ph, units: [U("d", { requires: ["z"], provides: ["w"], status: "done" }), U("z1", { phase: "ph2", provides: ["z"] }), U("ok", { requires: ["w"], status: "done" })] as any });
    const fs = await run("plan", "done-unit-dependencies-done", model(), p);
    expect(fs.map((f) => f.at)).toEqual(["d"]);
    expect(fs[0].message).toContain("z1 is todo");
  });
  test("duplicate unit ids: the first by file order wins, never both frontier and blocked", () => {
    const p = plan({ phases: ph, units: [U("a", { requires: ["y"], provides: ["x"] }), U("b", { requires: ["x"], provides: ["y"] }), U("a", { title: "duplicate" })] as any });
    const a = analyzePlan(p);
    expect(a.frontier).not.toContain("a");
    expect(Object.keys(a.blocked)).toContain("a");
    expect(a.deps.a).toEqual(["b"]);
    expect(planMd(p, a)).not.toContain("duplicate");
  });
});

describe("6. cascade and units affected", () => {
  const imp = delivery.bundle.patches.find((x) => x.id === "P-001")!.impact;
  test("delivery P-001 lists the units around the release steps", () => {
    expect(imp.unitsAffected).toEqual(["U-06", "U-15"]); // deploy-service (U-06) and release-notes (U-15) sit on the added edges
  });
  test("units on either end of an added relationship are affected", async () => {
    const dir = miniWith({ "rel.yaml": "id: rel\ntitle: link\nstatus: proposed\nwhy: x\nops:\n  - { op: add, kind: relationship, value: { id: r99, from: intake, to: pickup, kind: data } }\n" });
    const inst = loadInstance(dir);
    const { packs } = await loadPacks(inst.config.packs);
    expect(computeImpact(inst, "rel", packs).unitsAffected).toEqual(["u1"]); // u1 moves intake
  });
});

describe("7-8. site and paths", () => {
  test("visually hidden text cannot widen the page", () => {
    const html = renderSite(mini.bundle);
    expect(html).toMatch(/\.sr-only \{[^}]*clip-path: inset\(50%\)/);
    expect(html).toMatch(/\.table-wrap \{ position: relative;/);
    expect(html).toMatch(/body \{[^}]*overflow-x: hidden/);
    expect(html).toContain("function canvasHeight(");
  });
});
