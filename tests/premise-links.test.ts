import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Claim, Model, Plan, PremiseLink } from "../src/types.ts";
import { premiseHash, readPremiseLinks, validatePremiseLinks } from "../src/core/premise-links.ts";
import { allPremiseImpacts, exposure, premiseImpact } from "../src/core/premise.ts";
import { premisesCommand as commandWithDiagnostics } from "../src/core/premises-command.ts";
import { buildBundle } from "../src/core/bundle.ts";
import { buildRoot } from "../src/core/root-build.ts";
import { composeDesign } from "../src/core/compose.ts";
import { runPortfolio } from "../src/core/portfolio.ts";
import { renderSite } from "../src/site/render.ts";
import { call } from "../src/mcp/tools.ts";
import { reconciliationSection, exposureLine } from "../src/site/strategy.ts";
import { renderPortfolio } from "../src/site/portfolio.ts";
import { portfolioPages } from "../src/site/portfolio-build.ts";
import { buildDeck } from "../src/core/deck.ts";

const capturedDiagnostics: string[] = [];
async function premisesCommand(scope: string, json = false) {
  const write = process.stderr.write;
  process.stderr.write = ((chunk: any) => { capturedDiagnostics.push(String(chunk)); return true; }) as typeof write;
  try { return await commandWithDiagnostics(scope,json); } finally { process.stderr.write = write; }
}

const claim = (id: string): Claim => ({ id, statement: `Premise ${id} holds.`, kind: "premise", grade: "untested", fallback: "Retain manual review.", attrs: { falsifier: "A sample fails the check.", load: "Automated approval relies on this." } });
const model = (): Model => ({ teams: [], systems: [], zones: [], elements: [{ id: "a:part", name: "Approval", kind: "part", rests_on: ["a:A"] }], relationships: [], contracts: [], views: [], claims: [claim("a:A"), claim("b:B"), claim("c:C")] });
const plan = (): Plan => ({ phases: [{ id: "a:P", name: "Approve", order: 1 }], units: [{ id: "a:U", title: "Approve changes", kind: "code", phase: "a:P", status: "todo", elements: [{ id: "a:part", from: "none", to: "built" }] }, { id: "a:T", title: "Settle the premise", kind: "code", phase: "a:P", status: "done" }] });
const found = { by: "agent:premise-reconciler", at: "2026-11-02", reasoning: 'The falsifier "A sample fails the check." moves "Retain manual review."', sources: ["plumb premises fixture --json"] };
function link(id = "PL-001", from = "a:A", to = "b:B", confirmed = false) {
  return { id, from, to, type: "depends-on", found: structuredClone(found), ...(confirmed ? { confirmed: { by: "the review lead", at: "2026-11-03", falsifier_clause: "sample fails", moved_clause: "manual review", pins: { from: premiseHash(claim(from)), to: premiseHash(claim(to)) } } } : {}) };
}
const run = { id: "RUN-001", by: "agent:premise-reconciler", at: "2026-11-02", designs: ["a", "b", "c"], pairs_considered: 3, pairs_skipped: 0, rule: "every cross-design pair", proposed: ["PL-001"] };
const validate = (links: unknown[], runs: unknown[] = [run], extra = {}) => validatePremiseLinks({ links, runs, ...extra }, model(), ["a", "b", "c"]);
const roots: string[] = [];
const temp = () => { const dir = mkdtempSync(join(import.meta.dir, ".premise-links-")); roots.push(dir); return dir; };
afterAll(() => { for (const dir of roots) rmSync(dir, { recursive: true, force: true }); });

describe("premise reconciliation evidence", () => {
  test("hash is SHA-256 of separately normalized statement and falsifier", () => {
    const c = { statement: "  A\n statement\t", attrs: { falsifier: " Wrong\r\n if   this. " } };
    const hash = new Bun.CryptoHasher("sha256").update("A statement\nWrong if this.").digest("hex").slice(0, 12);
    expect(premiseHash(c)).toBe(hash);
    expect(premiseHash({ ...c, attrs: { falsifier: "Wrong if this." } })).toBe(hash);
    expect(premiseHash({ ...c, statement: "Another statement" })).not.toBe(hash);
    expect(premiseHash({ ...c, attrs: { falsifier: "Another falsifier" } })).not.toBe(hash);
    expect(premiseHash(claim("a:A"))).toMatch(/^[0-9a-f]{12}$/);
  });
  test("found, current confirmed and each stale side are computed without modifying input", () => {
    const current = link("PL-002", "a:A", "c:C", true);
    const staleFrom = link("PL-003", "b:B", "c:C", true); staleFrom.confirmed!.pins.from = "000000000000";
    const staleTo = link("PL-004", "c:C", "a:A", true); staleTo.confirmed!.pins.to = "000000000000";
    const raw = [link(), current, staleFrom, staleTo], copy = structuredClone(raw);
    const { data, findings } = validate(raw);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(data.links.map((l) => l.status)).toEqual(["found", "confirmed", "stale", "stale"]);
    expect(data.links.map((l) => l.changed)).toEqual([[], [], ["from"], ["to"]]);
    expect(data.links[1].hashes.from).toBe(premiseHash(claim("a:A")));
    expect(data.debt).toEqual({ declared: 0, found: 1, stale: 2, flags: 0, last_run: run });
    expect(raw).toEqual(copy);
  });
  const invalid: [string, (x: any) => void, string][] = [
    ["id syntax", (x) => x.id = "L-1", "PL-<digits>"],
    ["missing id", (x) => delete x.id, "PL-<digits>"],
    ["unknown type", (x) => x.type = "supports", "unknown link type"],
    ["unqualified from", (x) => x.from = "A", "qualified premise"],
    ["missing to", (x) => delete x.to, "qualified premise"],
    ["unresolved from", (x) => x.from = "a:missing", "does not resolve"],
    ["unresolved to", (x) => x.to = "b:missing", "does not resolve"],
    ["self", (x) => x.to = x.from, "different premises"],
    ...["by", "at", "reasoning", "sources"].map((field): [string, (x: any) => void, string] => [`found ${field}`, (x) => delete x.found[field], "found needs"]),
    ["empty sources", (x) => x.found.sources = [], "found needs"],
    ["missing confirmation", (x) => x.confirmed = null, "confirmed needs"],
    ...["by", "at", "falsifier_clause", "moved_clause", "pins"].map((field): [string, (x: any) => void, string] => [`confirmed ${field}`, (x) => delete x.confirmed[field], "confirmed needs"]),
    ...["from", "to"].map((side): [string, (x: any) => void, string] => [`pin ${side}`, (x) => delete x.confirmed.pins[side], "12 hex pins"]),
    ["invalid pin", (x) => x.confirmed.pins.from = "bad", "12 hex pins"],
    ["agent confirmation", (x) => x.confirmed.by = "agent:reconciler", "never an agent"],
    ["falsifier clause", (x) => x.confirmed.falsifier_clause = "Sample fails", "exact substring"],
    ["moved clause", (x) => x.confirmed.moved_clause = "Manual review", "exact substring"],
    ["empty clause", (x) => x.confirmed.moved_clause = "", "confirmed needs"],
  ];
  for (const [name, change, message] of invalid) test(`reports invalid ${name}`, () => {
    const x = link("PL-001", "a:A", "b:B", true); change(x);
    const result = validate([x]);
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes(message))).toBe(true);
    const confirmationError = invalid.findIndex(([label]) => label === name) >= invalid.findIndex(([label]) => label === "missing confirmation");
    if (confirmationError) {
      expect(result.data.links).toHaveLength(1);
      expect(result.data.links[0]).toMatchObject({ status: "found", found });
      const impact = premiseImpact("b:B", model(), plan(), undefined, result.data.links);
      expect(impact.counts.total).toBe(0);
      expect(impact.preview!.dependents.map((d) => d.id)).toEqual(["a:A", "a:part"]);
    } else expect(result.data.links).toEqual([]);
  });
  test("clauses can come from load or if_it_flips and pins ignore those fields", () => {
    const m = model(), x = link("PL-001", "a:A", "b:B", true);
    x.confirmed!.moved_clause = "Automated approval";
    expect(validatePremiseLinks({ links: [x] }, m, ["a", "b", "c"]).data.links[0].status).toBe("confirmed");
    m.claims![0].attrs!.if_it_flips = "Use a second reviewer.";
    x.confirmed!.moved_clause = "second reviewer";
    expect(validatePremiseLinks({ links: [x] }, m, ["a", "b", "c"]).data.links[0].status).toBe("confirmed");
    x.confirmed!.falsifier_clause = "sample  fails";
    expect(validatePremiseLinks({ links: [x] }, m, ["a", "b", "c"]).findings[0].message).toContain("exact substring");
  });
  test("edited text invalidating old clauses retains discovery as found with errors", () => {
    const m = model(), x = link("PL-001", "a:A", "b:B", true);
    m.claims![0].statement = "A changed premise.";
    m.claims![1].attrs!.falsifier = "A different check now fails.";
    const result = validatePremiseLinks({ links: [x] }, m, ["a", "b", "c"]);
    expect(result.data.links[0]).toMatchObject({ status: "found", found, changed: ["from", "to"] });
    expect(result.findings.some((f) => f.severity === "error" && f.message.includes("exact substring"))).toBe(true);
    expect(premiseImpact("b:B", m, plan(), undefined, result.data.links).counts.total).toBe(0);
    expect(premiseImpact("b:B", m, plan(), undefined, result.data.links).preview!.dependents.map((d) => d.id)).toContain("a:A");
  });
  test("duplicate ids, malformed collections, mappings, and non-premise endpoints are errors", () => {
    expect(validate([link(), link()]).findings.some((f) => f.message.includes("duplicate link id"))).toBe(true);
    expect(validate([link(), link()]).data.links).toEqual([]);
    expect(validate([null]).findings[0].severity).toBe("error");
    for (const raw of [null, [], "bad", { links: {} }, { runs: {} }]) expect(validatePremiseLinks(raw, model(), ["a", "b", "c"]).findings[0].severity).toBe("error");
    const m = model(); m.claims![1].kind = "assumption";
    expect(validatePremiseLinks({ links: [link()] }, m, ["a", "b"]).findings[0].message).toContain("does not resolve to a premise");
  });
  test("absent designs warn and skip, unknown top-level keys warn", () => {
    const { data, findings } = validate([link("PL-001", "a:A", "absent:B")], [], { typo: true });
    expect(data.links).toEqual([]);
    expect(findings.map((f) => f.severity)).toEqual(["warning", "warning"]);
    expect(findings[1].message).toContain("absent:B");
    expect(findings[1].message).toContain("absent:B names a design absent from scope");
    expect(validatePremiseLinks({ links: [link("PL-001", "outside:A", "elsewhere:B")] }, model(), ["a"]).findings).toEqual([]);
  });
  for (const field of ["id", "by", "at", "designs", "pairs_considered", "pairs_skipped", "rule", "proposed"]) test(`run requires ${field}`, () => {
    const x: any = structuredClone(run); delete x[field];
    expect(validate([], [x]).findings[0].message).toContain("run records need");
  });
  for (const number of [-1, 1.5, "2", null]) test(`run rejects count ${JSON.stringify(number)}`, () => {
    for (const field of ["pairs_considered", "pairs_skipped"]) expect(validate([], [{ ...run, [field]: number }]).findings[0].severity).toBe("error");
  });
  test("duplicate runs error, skipped pairs warn with source, final valid run is last_run", () => {
    expect(validate([], [run, run]).findings[0].message).toContain("duplicate run");
    const last = { ...run, id: "RUN-002", pairs_skipped: 1, rule: "Only active work, evidence in skipped-pairs.yaml" };
    const result = validate([], [run, last]);
    expect(result.findings[0]).toMatchObject({ severity: "warning", at: "RUN-002" });
    expect(result.findings[0].message).toContain("skipped-pairs.yaml");
    expect(result.findings[0].message).toContain("1 skipped pair.");
    expect(result.data.debt.last_run).toEqual(last);
    expect(validate([], []).data.debt.last_run).toBeNull();
  });
  test("missing file is empty, malformed YAML is a finding, engine never writes", () => {
    const dir = temp(), file = join(dir, "premise-links.yaml");
    expect(readPremiseLinks(dir, model(), []).data.links).toEqual([]);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, "links: [\n");
    expect(readPremiseLinks(dir, model(), []).findings[0].severity).toBe("error");
    expect(readFileSync(file, "utf8")).toBe("links: [\n");
  });
});

describe("one impact walk", () => {
  test("foreign settlement never ranks unrelated orders and exposes only the premise's own open work", () => {
    const m = model(), p = plan(), c = m.claims![0];
    p.phases.push({ id: "a:later", name: "Later local work", order: 99 }, { id: "b:P", name: "Foreign test", order: -100 });
    p.units.push({ id: "a:L", title: "Later work", kind: "code", phase: "a:later", rests_on: [c.id] }, { id: "b:T", title: "Foreign test", kind: "code", phase: "b:P", status: "todo", rests_on: [c.id] });
    for (const tests of [["b:T"], ["b:T", "a:T"]]) for (const order of [-100, 1, 1000]) {
      c.attrs!.tested_by = tests;
      p.phases[2].order = order;
      const ex = exposure(premiseImpact(c.id, m, p), c, p);
      expect(ex).toMatchObject({ tests, outsidePlanOrder: ["b"], before: 2, beforeByPhase: [{ phase: "a:P", open: 1 }, { phase: "a:later", open: 1 }] });
      expect(ex.firstTest).toBeUndefined();
    }
    c.attrs!.tested_by = ["a:T"];
    const local = exposure(premiseImpact(c.id, m, p), c, p);
    expect(local.outsidePlanOrder).toBeUndefined();
    expect(local.firstTest).toEqual({ phase: "a:P", units: ["a:T"] });
    expect(local.before).toBe(0);
  });
  test("confirmed links cascade through a premise, its records and settling work", () => {
    const m = model(), p = plan(); m.claims![0].attrs!.tested_by = ["a:T"];
    const links = validate([link("PL-001", "a:A", "b:B", true)]).data.links;
    const im = premiseImpact("b:B", m, p, undefined, links);
    expect(im.dependents.map((d) => d.id)).toEqual(["a:A", "a:T", "a:part"]);
    expect(im.counts.total).toBe(3);
    expect(im.units[0].units).toEqual(["a:T", "a:U"]);
    expect(im.openUnits).toBe(1);
    for (const d of im.dependents) expect(d).toMatchObject({ status: "confirmed", links: [{ id: "PL-001", status: "confirmed" }] });
    expect(im.preview!.dependents).toEqual([]);
  });
  test("found and stale links have only tagged additional reach in preview", () => {
    for (const stale of [false, true]) {
      const x = link("PL-001", "a:A", "b:B", stale);
      if (stale) x.confirmed!.pins.from = "000000000000";
      const links = validate([x]).data.links;
      const im = premiseImpact("b:B", model(), plan(), undefined, links);
      expect(im.counts.total).toBe(0); expect(im.openUnits).toBe(0); expect(im.units).toEqual([]);
      expect(im.preview!.dependents.map((d) => d.id)).toEqual(["a:A", "a:part"]);
      expect(im.preview!.dependents.every((d) => d.status === "found" && d.links?.[0].status === "found")).toBe(true);
      expect(im.preview!.units[0].units).toEqual(["a:U"]);
      expect(im.preview!.openUnits).toBe(1);
    }
  });
  test("mixed paths retain every step and a later confirmed route wins", () => {
    const links = validate([link("PL-001", "a:A", "b:B", true), link("PL-002", "b:B", "c:C")]).data.links;
    const im = premiseImpact("c:C", model(), plan(), undefined, links);
    expect(im.preview!.dependents.find((d) => d.id === "a:A")!.links).toEqual([{ id: "PL-002", status: "found" }, { id: "PL-001", status: "confirmed" }]);
    links.push(...validate([link("PL-003", "a:A", "c:C", true)]).data.links);
    const both = premiseImpact("c:C", model(), plan(), undefined, links);
    expect(both.dependents.some((d) => d.id === "a:A")).toBe(true);
    expect(both.preview!.dependents.some((d) => d.id === "a:A" || d.id === "a:part")).toBe(false);
    expect(both.preview!.units).toEqual([]);
  });
  for (const type of ["contradicts", "duplicates"] as const) test(`${type} never cascades even confirmed`, () => {
    for (const status of ["found", "confirmed", "stale"]) {
      const x = { ...link("PL-001", "a:A", "b:B", status !== "found"), type };
      if (status === "stale") x.confirmed!.pins.from = "000000000000";
      const { data, findings } = validate([x]);
      expect(findings[0]).toMatchObject({ severity: "warning" });
      expect(findings[0].message).toContain("review flag"); expect(findings[0].message).toContain("a:A and b:B");
      expect(data.debt).toMatchObject({ found: 0, stale: 0, flags: 1 });
      const im = premiseImpact("b:B", model(), plan(), undefined, data.links);
      expect(im.counts.total).toBe(0); expect(im.preview!.dependents).toEqual([]);
    }
  });
  test("cycles warn with their path and seen sets bound both traversal states", () => {
    const { data, findings } = validate([link(), link("PL-002", "b:B", "a:A", true)]);
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("a:A -> b:B -> a:A"))).toBe(true);
    const im = premiseImpact("b:B", model(), plan(), undefined, data.links);
    expect(im.preview!.dependents.filter((d) => d.kind === "claim").map((d) => d.id)).toEqual(["a:A"]);
    const confirmed = validate([link("PL-001", "a:A", "b:B", true), link("PL-002", "b:B", "a:A", true)]).data.links;
    const current = premiseImpact("b:B", model(), plan(), undefined, confirmed);
    expect(current.dependents.filter((d) => d.kind === "claim").map((d) => d.id)).toEqual(["a:A"]);
    expect(current.preview!.dependents).toEqual([]);
  });
  test("ordinary rests_on still shares the same walk and exposure omits unknown settlers", () => {
    const m = model(), p = plan(); m.claims![0].rests_on = ["b:B"];
    m.claims![1].attrs!.tested_by = ["elsewhere:missing", "a:T"];
    const impacts = allPremiseImpacts(m, p);
    expect(impacts["b:B"].dependents.map((d) => d.id)).toEqual(["a:A", "a:part"]);
    expect(exposure(impacts["b:B"], m.claims![1], p).tests).toEqual(["a:T"]);
  });
});

function fixture() {
  const dir = temp(); cpSync(join(import.meta.dir, "fixtures/portfolio/base"), dir, { recursive: true });
  const yaml = (path: string, change: (x: any) => void) => { const x = Bun.YAML.parse(readFileSync(path, "utf8")); change(x); writeFileSync(path, JSON.stringify(x)); };
  yaml(join(dir, "designs/alpha/model.yaml"), (x) => x.claims = [{ ...claim("A"), attrs: { ...claim("A").attrs, tested_by: ["beta:BU-1", "alpha:AU-3"] } }]);
  yaml(join(dir, "designs/beta/model.yaml"), (x) => { x.claims = [claim("B")]; x.elements[0].rests_on = ["B"]; });
  yaml(join(dir, "shared/seams.yaml"), (x) => x.claims = [claim("SH")]);
  yaml(join(dir, "shared/engine.yaml"), (x) => x.shared_from.sha256 = new Bun.CryptoHasher("sha256").update(readFileSync(join(dir, "shared/seams.yaml"))).digest("hex"));
  return { dir, yaml };
}
describe("builds, projections and pages", () => {
  test("reconciliation visibility follows file existence, including an empty file", async () => {
    const { dir } = fixture(), path = join(dir, "designs/alpha");
    const before = await buildBundle(path);
    expect(before.bundle.premiseLinks).toBeUndefined();
    expect(renderSite(before.bundle)).not.toContain('id="h-reconciliation"');
    const absentPortfolio = await portfolioPages(join(dir, "portfolio"));
    expect(absentPortfolio.data.premiseLinks).toBeUndefined();
    expect(renderPortfolio(absentPortfolio.data)).not.toContain("Reconciliation:");
    expect((await buildRoot(join(dir, "shared"))).bundle.premiseLinks).toBeUndefined();
    writeFileSync(join(dir, "shared/premise-links.yaml"), "");
    const after = await buildBundle(path);
    expect(after.bundle.premiseLinks!.links).toEqual([]);
    expect(renderSite(after.bundle)).toContain('id="h-reconciliation"');
    expect((await buildRoot(join(dir, "shared"))).bundle.premiseLinks!.links).toEqual([]);
    const presentPortfolio = await portfolioPages(join(dir, "portfolio"));
    expect(presentPortfolio.data.premiseLinks!.links).toEqual([]);
    expect(renderPortfolio(presentPortfolio.data)).toContain("Reconciliation: 0 declared links, 0 found links await a person, 0 stale links and 0 review flags.");
    presentPortfolio.data.premiseLinks!.debt = { declared: 0, found: 1, stale: 1, flags: 1, last_run: null };
    expect(renderPortfolio(presentPortfolio.data)).toContain("Reconciliation: 0 declared links, 1 found link awaits a person, 1 stale link and 1 review flag.");
  });
  test("review flags occur only in their own group and all debt counts use proper English", async () => {
    const { bundle } = await buildBundle(join(fixture().dir, "designs/alpha"));
    const dependency = link(), stale = link("PL-002", "b:B", "c:C", true);
    stale.confirmed!.pins.from = "000000000000";
    const flag = { ...link("PL-003"), type: "contradicts" };
    const staleFlag = { ...link("PL-004", "a:A", "c:C", true), type: "duplicates" };
    staleFlag.confirmed!.pins.to = "000000000000";
    bundle.premiseLinks = validate([dependency, stale, flag, staleFlag]).data;
    const html = reconciliationSection(bundle);
    expect(html).toContain("1 found link awaits a person. 1 stale link needs review. 2 review flags.");
    const foundGroup = html.split("<h3>Found links awaiting a person</h3>")[1].split("<h3>Stale links</h3>")[0];
    const staleGroup = html.split("<h3>Stale links</h3>")[1].split("<h3>Review flags</h3>")[0];
    expect(foundGroup.match(/<li>/g)).toHaveLength(1);
    expect(staleGroup.match(/<li>/g)).toHaveLength(1);
    expect(foundGroup + staleGroup).not.toMatch(/contradicts|duplicates/);
    expect(html.split("<h3>Review flags</h3>")[1].match(/<li>/g)).toHaveLength(2);
    bundle.premiseLinks = validate([flag]).data;
    expect(reconciliationSection(bundle)).toContain("1 review flag.");
  });
  test("page, detail and deck describe foreign settlement outside local plan order", async () => {
    const { dir, yaml } = fixture();
    yaml(join(dir, "designs/alpha/model.yaml"), (m) => m.elements[0].rests_on = ["A"]);
    yaml(join(dir, "designs/alpha/plan.yaml"), (p) => p.units[2].rests_on = ["A"]);
    yaml(join(dir, "designs/alpha/engine.yaml"), (c) => c.premises = { load_bearing: 1 });
    const run = await runPortfolio(join(dir, "portfolio"));
    const b = run.designs.find((d) => d.namespace === "alpha")!.bundle!;
    expect(b.premises!.A.exposure).toMatchObject({ outsidePlanOrder: ["beta"], before: 1 });
    const wording = "settled in beta, outside this design's plan order";
    expect(exposureLine(b, b.model.claims![0]).long).toContain(wording);
    const html = renderSite(b), start = html.indexOf('<script type="application/json" id="de-bundle">'), end = html.indexOf('</script>', start), js = html.indexOf('<script>', end);
    const client = new Function(html.slice(js + 8, html.indexOf('</script>', js)) + '\nreturn DE;')();
    expect(client.claimDetail(client.buildIndex(b), "A").replace(/&#39;/g, "'")).toContain(wording);
    expect(html.replace(/&#39;/g, "'")).toContain(wording);
    expect(JSON.stringify(buildDeck(b, { slides: [{ template: "risks" }] }).deck)).toContain(wording);
  });
  test("lone foreign settles stays external, own namespace is local, portfolio and root composition resolve status", async () => {
    const { dir } = fixture(), path = join(dir, "designs/alpha");
    const { bundle } = await buildBundle(path);
    expect(bundle.findings.filter((f) => f.message.includes("beta:BU-1"))).toEqual([]);
    expect(bundle.model.claims![0].attrs!.tested_by).toEqual(["beta:BU-1", "AU-3"]);
    expect(bundle.premises!.A.exposure!.tests).toEqual(["AU-3"]);
    expect(bundle.premises!.A.exposure!.settling).toContainEqual({ id: "beta:BU-1", design: "beta" });
    const composed = await runPortfolio(join(dir, "portfolio"));
    const alpha = composed.designs.find((d) => d.namespace === "alpha")!.bundle!;
    expect(alpha.premises!.A.exposure!.tests).toEqual(["beta:BU-1", "AU-3"]);
    expect(alpha.premises!.A.exposure!.settling).toContainEqual({ id: "beta:BU-1", design: "beta", status: "todo" });
    const { bundle: root } = await buildRoot(join(dir, "shared"), { compose: [composeDesign(path), composeDesign(join(dir, "designs/beta"))] });
    expect(root.premises!["alpha:A"].exposure!.tests).toContain("beta:BU-1");
    const html = renderSite(bundle), open = html.indexOf('<script type="application/json" id="de-bundle">'), end = html.indexOf('</script>', open), js = html.indexOf('<script>', end);
    const client = new Function(html.slice(js + 8, html.indexOf('</script>', js)) + '\nreturn DE;')();
    const detail = client.claimDetail(client.buildIndex(bundle), "A");
    expect(detail.replace(/<[^>]+>/g, "")).toContain("Settled in beta by beta:BU-1"); expect(detail).toContain("not in this workspace");
    expect(html).not.toMatch(/fetch\s*\(|new WebSocket|new EventSource/);
  });
  test("unknown namespace warns in portfolio, missing unit in known design errors", async () => {
    const { dir, yaml } = fixture();
    yaml(join(dir, "designs/alpha/model.yaml"), (x) => x.claims[0].attrs.tested_by = ["missing:U-1", "beta:absent"]);
    const run = await runPortfolio(join(dir, "portfolio"));
    expect(run.data.findings.some((f) => f.severity === "warning" && f.message.includes("missing:U-1"))).toBe(true);
    expect(run.data.findings.some((f) => f.severity === "error" && f.message.includes("beta:absent"))).toBe(true);
  });
  test("load-bearing checks count current confirmed cascades and exclude proposed and stale reach", async () => {
    const { dir, yaml } = fixture(), path = join(dir, "designs/alpha"), file = join(dir, "shared/premise-links.yaml");
    yaml(join(path, "engine.yaml"), (x) => x.premises = { load_bearing: 2 });
    const projection = JSON.parse(await premisesCommand(join(dir, "portfolio"), true));
    const x = link("PL-001", "beta:B", "alpha:A", true);
    x.confirmed!.pins = { from: projection.premises.find((c: any) => c.id === "beta:B").hash, to: projection.premises.find((c: any) => c.id === "alpha:A").hash };
    const build = async () => (await runPortfolio(join(dir, "portfolio"))).designs.find((d) => d.namespace === "alpha")!.bundle!;
    writeFileSync(file, JSON.stringify({ links: [{ ...x, confirmed: undefined }] }));
    const proposed = await build();
    expect(proposed.findings.some((f) => f.rule === "load-bearing-untested" && f.at === "A")).toBe(false);
    expect(proposed.premises!.A.counts.total).toBe(0);
    expect(proposed.premises!.A.preview!.dependents.length).toBeGreaterThan(0);
    writeFileSync(file, JSON.stringify({ links: [x] }));
    const current = await build();
    expect(current.findings.some((f) => f.rule === "load-bearing-untested" && f.at === "A")).toBe(true);
    expect(current.premises!.A.counts.total).toBeGreaterThan(0);
    x.confirmed!.pins.to = "000000000000";
    writeFileSync(file, JSON.stringify({ links: [x] }));
    const stale = await build();
    expect(stale.findings.some((f) => f.rule === "load-bearing-untested" && f.at === "A")).toBe(false);
    expect(stale.premises!.A.counts.total).toBe(0);
  });
  test("read-only text and JSON include qualified fields, hashes, status, shared register and touching links", async () => {
    const { dir } = fixture(), file = join(dir, "shared/premise-links.yaml");
    const raw = { links: [{ ...link("PL-001", "alpha:A", "beta:B"), found }], runs: [{ ...run, designs: ["alpha", "beta"] }] };
    writeFileSync(file, JSON.stringify(raw)); const before = readFileSync(file, "utf8");
    const json = JSON.parse(await premisesCommand(join(dir, "portfolio"), true));
    expect(Object.keys(json)).toEqual(["designs", "premises", "links", "runs", "debt"]);
    expect(json.designs).toEqual(["alpha", "beta"]);
    expect(json.premises.find((p: any) => p.id === "alpha:A")).toMatchObject({ design: "alpha", statement: "Premise A holds.", grade: "untested", falsifier: "A sample fails the check.", load: "Automated approval relies on this.", fallback: "Retain manual review.", rests_on: [], settling_units: [{ id: "beta:BU-1", status: "todo" }, { id: "alpha:AU-3", status: "todo" }], links: [{ id: "PL-001", status: "found" }] });
    expect(json.premises.some((p: any) => p.id.startsWith("shared:"))).toBe(true);
    expect(json.premises.find((p: any) => p.id === "beta:B").preview).toMatchObject({ dependents: ["alpha:A", "alpha:AU-3", "beta:BU-1"].map((id) => ({ id, status: "found", links: [{ id: "PL-001", status: "found" }] })), units: [{ phase: "alpha:A2", units: ["alpha:AU-3"] }], openUnits: 1 });
    expect(json.premises.find((p: any) => p.id === "alpha:A").preview).toEqual({ dependents: [], units: [], openUnits: 0 });
    expect(await premisesCommand(join(dir, "portfolio"))).toContain("PL-001 alpha:A depends-on beta:B (found)");
    expect(await premisesCommand(join(dir, "designs/alpha"))).toContain("beta:BU-1 (not in this workspace)");
    const rootJson = JSON.parse(await premisesCommand(join(dir, "shared"), true));
    expect(rootJson.premises.every((p: any) => p.id.startsWith("shared:"))).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(dir, "portfolio/portfolio.lock"))).toBe(false);
    expect(existsSync(join(dir, "designs/alpha/build"))).toBe(false);
    const cli = Bun.spawn(["bun", "plumb.ts", "premises", join(dir, "portfolio"), "--json"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    expect(JSON.parse(await new Response(cli.stdout).text()).premises.length).toBe(json.premises.length);
    expect(await cli.exited).toBe(0);
    const textCli = Bun.spawn(["bun", "plumb.ts", "premises", join(dir, "portfolio")], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    expect(await new Response(textCli.stdout).text()).toContain("# alpha"); expect(await textCli.exited).toBe(0);
  });
  test("command fails only on unloadable scope and still projects despite validation errors", async () => {
    await expect(premisesCommand(join(temp(), "missing"))).rejects.toThrow();
    const { dir } = fixture(); writeFileSync(join(dir, "shared/premise-links.yaml"), "links: [bad]");
    expect(JSON.parse(await premisesCommand(join(dir, "portfolio"), true)).premises.length).toBeGreaterThan(0);
  });
  test("text and JSON commands print validation findings on stderr for every scope", async () => {
    const { dir } = fixture();
    writeFileSync(join(dir, "shared/premise-links.yaml"), "links: [bad]");
    for (const scope of ["portfolio", "shared", "designs/alpha"]) for (const json of [false, true]) {
      const cli = Bun.spawn(["bun", "plumb.ts", "premises", join(dir, scope), ...(json ? ["--json"] : [])], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited]);
      expect(code).toBe(0);
      expect(stderr).toContain("[error] premises/links-valid at premise-links.yaml: premise-links.yaml: a link must be a mapping");
      if (json) expect(JSON.parse(stdout).premises.length).toBeGreaterThan(0);
      else expect(stdout).toContain("# ");
      expect(stdout).not.toContain("[error]");
    }
  });
  test("an invalid confirmation remains found in CLI output with its explanation on stderr", async () => {
    const { dir } = fixture(), x = link("PL-001", "alpha:A", "beta:B", true);
    delete (x.confirmed as any).pins;
    writeFileSync(join(dir, "shared/premise-links.yaml"), JSON.stringify({ links: [x] }));
    const cli = Bun.spawn(["bun", "plumb.ts", "premises", join(dir, "portfolio"), "--json"], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(cli.stdout).text(), new Response(cli.stderr).text(), cli.exited]);
    const json = JSON.parse(stdout);
    expect(code).toBe(0);
    expect(json.links).toHaveLength(1);
    expect(json.links[0]).toMatchObject({ status: "found", found });
    expect(json.premises.find((p: any) => p.id === "beta:B").preview.dependents[0]).toMatchObject({ id: "alpha:A", status: "found" });
    expect(stderr).toContain("confirmed needs by, at, both clauses and both 12 hex pins");
  });
  test("workflow names both preview commands, run evidence and quoted pins, and changelog records compatibility changes", () => {
    const workflow = readFileSync(join(import.meta.dir, "../skill/plumb/workflows/reconcile-premises.md"), "utf8");
    expect(workflow).toContain("plumb premises <scope> --json");
    expect(workflow).toContain("each premise's `preview`");
    expect(workflow).toContain("plumb premise <design> <claim-id>");
    expect(workflow).toContain("reconcile-runs/RUN-003-skipped.md");
    expect(workflow).toContain("The run's `rule` states how pairs were chosen and names that file.");
    expect(workflow).not.toContain("Record these findings directly in the run's `rule`");
    expect(workflow).toContain('"0123abcd4567"');
    expect(workflow).toContain("Quote all-digit hashes too");
    const pins = workflow.match(/pins: (\{ from: "[0-9a-f]+", to: "[0-9a-f]+" \})/)!;
    expect(Bun.YAML.parse(pins[1])).toEqual({ from: "0123abcd4567", to: "012345678901" });
    const changelog = readFileSync(join(import.meta.dir, "../CHANGELOG.md"), "utf8").split("## 0.5.2")[0];
    expect(changelog).toContain("A design's own unresolved tested_by unit is now an error.");
    expect(changelog).toContain("every rooted design's content hash changes once.");
  });
  test("example has all statuses, debt, immutable evidence, detail clauses, MCP links and preview", async () => {
    const dir = join(import.meta.dir, "../examples"), file = join(dir, "shared/premise-links.yaml"), before = readFileSync(file, "utf8");
    const run = await runPortfolio(join(dir, "portfolio"));
    expect(run.data.premiseLinks!.links.map((l) => l.status)).toEqual(["declared", "confirmed", "found", "stale", "found"]);
    expect(run.data.premiseLinks!.debt).toMatchObject({ found: 1, stale: 1, flags: 1 });
    const b = run.designs.find((d) => d.namespace === "intake")!.bundle!, html = renderSite(b);
    expect(html).toContain("The last run considered 17 pairs across intake, premerge, inventory, shared and skipped 0: every cross-design pair including the shared register.");
    expect(html).toContain("Reconciliation");
    const start = html.indexOf('<script type="application/json" id="de-bundle">'), end = html.indexOf('</script>', start), js = html.indexOf('<script>', end);
    const client = new Function(html.slice(js + 8, html.indexOf('</script>', js)) + '\nreturn DE;')();
    const detail = client.claimDetail(client.buildIndex(b), "IN-4");
    expect(detail).toContain("Falsifier clause:"); expect(detail).toContain("Moved clause:"); expect(detail).toContain("confirmed");
    expect(html).toContain("Changed: the premise at risk");
    expect(call(b, "premise", { id: "IN-1" }).text).toContain("Would cascade if confirmed");
    expect(call(b, "premise", { id: "IN-4" }).text).toContain("PL-001");
    const listing = call(b, "premise", {}).text;
    expect(listing).toContain("Reconciliation: 1 found link awaits a person, 1 stale link and 1 review flag.");
    expect(listing).toContain("- PL-001: intake:IN-4 depends-on inventory:IV-1 (confirmed).");
    expect(listing).not.toContain('"links"');
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
