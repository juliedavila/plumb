// Current state. current.yaml records where each part stands today and what
// happens to it; the investigation pod's records are discovered until a person confirms them; parts that exist only
// today come into the model so a unit can retire them (the retired level); plan/retire-before-replace orders the
// retirement against the replacement; transition work is told apart; the part page shows a Today block. The
// examples (examples/expected.yaml and the broken variants) are the acceptance for every check here.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle, contentHash, modelHash } from "../src/core/bundle.ts";
import { loadInstance } from "../src/core/load.ts";
import { compile } from "../src/core/compile.ts";
import { composeDesign } from "../src/core/compose.ts";
import { release } from "../src/core/edition.ts";
import { isAgent, loadCurrent, provenanceText } from "../src/core/current.ts";
import { buildContext, loadPacks, packsFor } from "../src/core/rules.ts";
import { DIGEST } from "../src/core/digest.ts";
import { briefMd } from "../src/core/brief-cli.ts";
import { renderSite } from "../src/site/render.ts";
import type { Bundle, Finding } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const DE = join(import.meta.dir, "..");
const EX = join(DE, "examples");
// Tests that read the examples skip when those examples are absent (see tests/examples.test.ts).
const HAVE_EX = existsSync(join(EX, "designs/inventory/current.yaml"));
const exTest = test.skipIf(!HAVE_EX);
const FX = join(import.meta.dir, "fixtures/portfolio");
const BUILT = "2026-11-16T10:00:00Z";

const Y = (p: string): any => Bun.YAML.parse(readFileSync(p, "utf8"));
const edit = (path: string, f: (s: string) => string) => writeFileSync(path, f(readFileSync(path, "utf8")));
/** A temporary copy of the examples (a design's root is ../../shared, so the whole folder moves together). */
function examples(): string { const d = mkdtempSync(join(tmpdir(), "plumb-cur04-ex-")); cpSync(EX, d, { recursive: true }); return d; }
/** The base portfolio fixture with a variant laid over it. */
function variant(name?: string): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-cur04-fx-"));
  cpSync(join(FX, "base"), d, { recursive: true });
  if (name) cpSync(join(FX, "variants", name), d, { recursive: true });
  return d;
}
const build = async (dir: string, opts: Parameters<typeof buildBundle>[1] = {}) => (await buildBundle(dir, { built: BUILT, ...opts })).bundle;
const of = (fs: Finding[], rule: string) => fs.filter((f) => `${f.pack}/${f.rule}` === rule);
/** A finding as one string: rule, the record it sits on, severity (no "@", which a package scan reads as an address). */
const keys = (fs: Finding[]) => fs.map((f) => `${f.pack}/${f.rule} on ${f.at} ${f.severity}`);
const CUR_RULES = ["core/current-valid", "plan/retire-before-replace"];
const curFindings = (b: Bundle) => b.findings.filter((f) => CUR_RULES.includes(`${f.pack}/${f.rule}`) || (f.rule === "fidelity-moves-up"));

const DATA_OPEN = '<script type="application/json" id="de-bundle">';
const extractClient = (doc: string) => { const i = doc.indexOf("</script>", doc.indexOf(DATA_OPEN)); const open = doc.indexOf("<script>", i); return doc.slice(open + 8, doc.indexOf("</script>", open)); };
const loadClient = (doc: string): any => new Function(extractClient(doc) + "\n;return DE;")();

// ── example acceptance ────────────────────────────────────────────────────────────────────────────────────────────

describe("The examples: what current state reports", () => {
  exTest("inventory's own build reports exactly expected.yaml's three retire-before-replace findings, and nothing else", async () => {
    const exp = Y(join(EX, "expected.yaml"));
    const want = exp.findings.filter((f: any) => CUR_RULES.includes(f.rule));
    expect(want.length).toBe(3);
    const b = await build(join(EX, "designs/inventory"));
    // today's packs find nothing else on inventory once the four moves to retired are legal (examples/README.md), but for
    // the seam rule's v01, which shows in inventory's own build too (the README's seam-crossing table)
    expect(b.findings.map((f) => `${f.pack}/${f.rule}`)).toEqual(["plan/retire-before-replace", "plan/retire-before-replace", "plan/retire-before-replace", "portfolio/seam-crossing-declared"]);
    expect(b.findings.filter((f) => f.rule === "seam-crossing-declared").map((f) => `${f.at} ${f.severity}`)).toEqual(["v01 error"]);
    const got = of(b.findings, "plan/retire-before-replace");
    for (const w of want) {
      const id = String(w.subject).replace(/^inventory:/, "");
      const f = got.find((x) => x.at === id);
      expect(f).toBeDefined();
      expect(f!.severity).toBe(w.severity);
      expect(f!.atKind).toBe("element");
      if (w.clause === "order") expect(f!.message).toMatch(/^unit U-09 retires part tag-sync-job in milestone M3, after milestone M2, where unit U-04 brings its replacement, part reconciler, to built/);
      if (w.clause === "dependency") expect(f!.message).toMatch(/^unit U-08 retires part ownership-macros but does not wait, directly or through other units, for unit U-04/);
    }
    // the sentence on discovered records names its source and unconfirmed state
    expect(got.find((f) => f.at === "tag-sync-job")!.message).toContain("; this rests on a discovered record not yet confirmed: Cloud tag sync job's disposition, discovered by current-state-scout from the cloud account's automation list on 3 Nov");
    expect(got.find((f) => f.at === "ownership-macros")!.message).toContain("Ownership macros' disposition, discovered by current-state-scout from the shared workbook on 3 Nov");
    expect(got.find((f) => f.at === "ownership-spreadsheet")!.message).toBe("part ownership-spreadsheet is to be replaced by part ownership-api, but no unit moves it to retired: the plan adds the new part and never removes the old one");
    // core/current-valid reports nothing on the example
    expect(of(b.findings, "core/current-valid")).toEqual([]);
  });

  exTest("the other designs and the clean base report nothing from current state", async () => {
    for (const d of [join(EX, "designs/intake"), join(EX, "designs/premerge")]) expect(curFindings(await build(d))).toEqual([]);
    const base = variant();
    for (const d of ["alpha", "beta"]) expect((await build(join(base, "designs", d))).findings).toEqual([]);
  });

  for (const v of ["current-valid", "retire-before-replace"]) test(`the ${v} variant reports its one finding and nothing else`, async () => {
    const y = Y(join(FX, "variants", v, "variant.yaml"));
    const d = variant(v);
    expect((await build(join(d, "designs/alpha"))).findings).toEqual([]);
    const b = await build(join(d, "designs/beta"));
    expect(b.findings.map((f) => [`${f.pack}/${f.rule}`, f.severity, f.at])).toEqual([[y.expect[0].rule, y.expect[0].severity, String(y.expect[0].subject).replace(/^beta:/, "").replace(/ \(.*\)$/, "")]]);
  });

  exTest("transition work: 7 of inventory's 11 units, 2 in doing, and U-01's count rests on a discovered disposition", async () => {
    const b = await build(join(EX, "designs/inventory"));
    expect(b.current!.transition).toEqual({ units: ["U-01", "U-06", "U-07", "U-08", "U-09", "U-10", "U-11"], doing: ["U-10", "U-11"], discovered: ["U-01"] });
    expect(b.current!.counts).toEqual({ records: 7, discovered: 4, confirmed: 3, todayOnly: 5 });
  });
});

// ── reading current.yaml ─────────────────────────────────────────────────────────────────────────────────────────

describe("current.yaml loads", () => {
  exTest("every record, with its fields as text and dates as YYYY-MM-DD", () => {
    const c = loadCurrent(join(EX, "designs/inventory"))!;
    expect(c.problem).toBeUndefined();
    expect(c.records.map((r) => r.part)).toEqual(["alert-enrichment", "legacy-cmdb-export", "ownership-spreadsheet", "repo-crawler", "scan-scripts", "tag-sync-job", "ownership-macros"]);
    const sheet = c.records.find((r) => r.part === "ownership-spreadsheet")!;
    expect(sheet).toMatchObject({ baseline: "existing-tool", disposition: "replace", replaced_by: "ownership-api", add: { name: "Ownership spreadsheet", kind: "document", system: "inventory", owner: "governance-risk" } });
    expect(sheet.found).toEqual({ by: "agent:current-state-scout", from: "the shared drive index", as_of: "2026-10-27", confidence: "medium" });
    expect(sheet.confirmed).toEqual({ by: "the governance and risk lead", at: "2026-11-04" });
    expect(loadCurrent(join(EX, "designs/intake"))).toBeUndefined();
  });

  test("an unquoted YAML date reads as a date; an empty file holds no records; a file that does not parse is one error", async () => {
    const d = variant();
    const beta = join(d, "designs/beta");
    writeFileSync(join(beta, "current.yaml"), "parts:\n  b-in:\n    baseline: stand-in\n    disposition: transition\n    found: { by: \"agent:scout\", as_of: 2026-11-03 }\n    confirmed: { by: the team B lead, at: 2026-11-04 }\n");
    const b = await build(beta);
    expect(b.findings).toEqual([]);
    expect(b.current!.records[0]).toMatchObject({ part: "b-in", state: "confirmed", confirmed: { by: "the team B lead", at: "2026-11-04" }, found: { by: "agent:scout", agent: "scout", as_of: "2026-11-03" } });
    writeFileSync(join(beta, "current.yaml"), "");
    expect((await build(beta)).current!.records).toEqual([]);
    writeFileSync(join(beta, "current.yaml"), "parts: [b-in\n");
    const bad = await build(beta);
    expect(keys(bad.findings)).toEqual(["core/current-valid on current.yaml error"]);
    expect(bad.findings[0].message).toMatch(/^current\.yaml: YAML parse error: .*; no current state is read$/);
    writeFileSync(join(beta, "current.yaml"), "parts:\n  - b-in\n");
    expect((await build(beta)).findings[0].message).toBe("current.yaml: parts must be a mapping from part ids to records, not a list; no current state is read");
  });

  test("a key written twice is a yaml-keys-unique error, like every file the engine reads", async () => {
    const d = variant();
    writeFileSync(join(d, "designs/beta/current.yaml"), "parts:\n  b-in:\n    disposition: transition\n    disposition: retain\n");
    expect(keys((await build(join(d, "designs/beta"))).findings)).toContain("core/yaml-keys-unique on current.yaml error");
  });

  exTest("current.yaml is live state: it moves the build's hash, never the model hash, and a release never freezes it", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    const i1 = loadInstance(inv);
    edit(join(inv, "current.yaml"), (s) => s.replace("confidence: low }", "confidence: medium }"));
    const i2 = loadInstance(inv);
    expect(modelHash(i2)).toBe(modelHash(i1));
    expect(contentHash(i2)).not.toBe(contentHash(i1));
    // a released edition builds its frozen design with the live current state of the instance folder
    const pm = join(d, "designs/premerge");
    writeFileSync(join(pm, "current.yaml"), "parts:\n  check-runner:\n    baseline: stand-in\n    disposition: transition\n    found: { by: \"agent:current-state-scout\", from: the runner's config, as_of: \"2026-11-03\" }\n");
    const ed = await build(pm, { edition: "1.0.0" });
    expect(ed.instance.edition?.version).toBe("1.0.0");
    expect(ed.current!.records.map((r) => [r.part, r.state])).toEqual([["check-runner", "discovered"]]);
    const r = release(loadInstance(pm), "1.1.0", "0123456789abcdef", { date: "2026-11-16", build: "test" });
    expect(existsSync(join(r.dir, "current.yaml"))).toBe(false);
    expect(r.stamp.files.map((f) => f.path)).not.toContain("current.yaml");
  });
});

// ── parts that exist only today ──────────────────────────────────────────────────────────────────────────────────

describe("parts that exist only today", () => {
  exTest("come into the compiled model with their mark, in canonical form, and never into the design's base model", async () => {
    const inst = loadInstance(join(EX, "designs/inventory"));
    expect(inst.model.elements.some((e) => e.todayOnly)).toBe(false);
    const b = await build(join(EX, "designs/inventory"));
    const today = b.model.elements.filter((e) => e.todayOnly);
    expect(today.map((e) => e.id)).toEqual(["legacy-cmdb-export", "ownership-macros", "ownership-spreadsheet", "scan-scripts", "tag-sync-job"]);
    expect(today.find((e) => e.id === "ownership-spreadsheet")).toMatchObject({ name: "Ownership spreadsheet", kind: "document", system: "inventory", owner: "org:governance-risk", todayOnly: true });
    expect(b.model.elements.filter((e) => !e.todayOnly && !e.home).every((e) => e.todayOnly === undefined)).toBe(true);
    // a unit that retires one takes its owner team from it, as from any part it moves
    expect(b.teams!.units["U-06"].owners).toEqual(["org:governance-risk"]);
  });

  exTest("must name a system this design places parts in, its own or a shared one", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    edit(join(inv, "current.yaml"), (s) => s
      .replace("{ name: Nightly scan scripts, kind: job, system: inventory, owner: dev-platform }", "{ name: Nightly scan scripts, kind: job, owner: dev-platform }")
      .replace("{ name: Cloud tag sync job, kind: job, system: inventory, owner: dev-platform }", "{ name: Cloud tag sync job, kind: job, system: engineering, owner: dev-platform }")
      .replace("{ name: Ownership macros, kind: script, system: inventory, owner: governance-risk }", "{ name: Ownership macros, kind: script, system: nowhere, owner: governance-risk }")
      .replace("{ name: Legacy CMDB export, kind: export, system: inventory, owner: governance-risk }", "{ name: Legacy CMDB export, kind: export, system: people, owner: governance-risk }"));
    const b = await build(inv);
    expect(of(b.findings, "core/current-valid").map((f) => [f.at, f.message])).toEqual([
      ["ownership-macros", "current.yaml: the part ownership-macros, which exists only today, names system nowhere, which is neither this design's nor its shared layer's"],
      ["scan-scripts", "current.yaml: the part scan-scripts, which exists only today, names no system; it must name a system this design places parts in, its own or a shared one"],
      ["tag-sync-job", "current.yaml: the part tag-sync-job, which exists only today, names system shared:engineering, where this design places none of its parts: it is outside the design's scope"],
    ]);
    // a shared system the design's own parts use (the asset stewards are placed in people) is inside its scope;
    // a system that resolves nowhere is one finding, not two
    expect(of(b.findings, "generic/references-resolve")).toEqual([]);
  });

  test("add: on a part of the model is refused, and the record is read as the part's", async () => {
    const d = variant();
    writeFileSync(join(d, "designs/beta/current.yaml"), "parts:\n  b-in:\n    add: { name: Beta in again, kind: job, system: work, owner: team-b }\n    disposition: transition\n");
    const b = await build(join(d, "designs/beta"));
    expect(keys(b.findings)).toEqual(["core/current-valid on b-in error"]);
    expect(b.findings[0].message).toContain("declares it with add:, but it is a part of this design's model");
    expect(b.model.elements.filter((e) => e.id === "b-in").map((e) => [e.name, !!e.todayOnly])).toEqual([["Beta in", false]]);
    expect(b.current!.records[0]).toMatchObject({ part: "b-in", disposition: "transition", state: "discovered" });
  });
});

// ── dispositions, baselines and what a record names ──────────────────────────────────────────────────────────────

describe("records: dispositions, baselines and the parts they name", () => {
  const CASES: [string, string][] = [
    ["b-in:\n    disposition: rebuild", 'current.yaml: the record for b-in has disposition "rebuild", which is not new, retain, transition, replace or retire'],
    ["b-in:\n    baseline: shiny\n    disposition: retain", 'current.yaml: the record for b-in has baseline "shiny", which is not on the ladder (none < stand-in < existing-tool < built)'],
    ["b-in:\n    baseline: retired\n    disposition: retain", 'current.yaml: the record for b-in has baseline "retired", which is not on the ladder (none < stand-in < existing-tool < built); a part stands at a ladder level today, and retired is where a unit moves it'],
    ["b-in:\n    disposition: replace", "current.yaml: the record for b-in is to be replaced, but names no part to replace it (replaced_by)"],
    ["b-in:\n    disposition: replace\n    replaced_by: b-nowhere", "current.yaml: the record for b-in is replaced by b-nowhere, which is not a part of this design or its shared layer"],
    ["b-in:\n    disposition: replace\n    replaced_by: b-in", "current.yaml: the record for b-in is replaced by itself; replaced_by names the part that takes over"],
    ["b-in:\n    disposition: replace\n    replaced_by: org:team-b", "current.yaml: the record for b-in is replaced by org:team-b, which names the org layer, which holds no parts"],
    ["b-gone:\n    disposition: retain", "current.yaml: the record for b-gone names no part of this design; a part that exists only today is declared with add: { name, kind, system, owner }"],
    ["hub:\n    disposition: retain", "current.yaml: the record for hub names the shared layer's part hub; a design records current state for its own parts only"],
    ["\"alpha:a-in\":\n    disposition: retain", "current.yaml: the record for alpha:a-in names a part of alpha, another design; a design records current state for its own parts only, and its parts that exist only today are declared with add:"],
    ["b-in: transition", 'current.yaml: the record for b-in must be a mapping (baseline, disposition, found and the rest), not the string "transition"; it is not read'],
    ["b-old:\n    add: an old job\n    disposition: retire", 'current.yaml: the record for b-old has add: the string "an old job", where a part that exists only today is a mapping (name, kind, system, owner); it is not read'],
  ];
  for (const [rec, message] of CASES) test(message.replace(/^current\.yaml: the record for /, "").slice(0, 90), async () => {
    const d = variant();
    writeFileSync(join(d, "designs/beta/current.yaml"), `parts:\n  ${rec}\n`);
    const b = await build(join(d, "designs/beta"));
    // one finding of the record's own; a part to be replaced that no unit retires is also retire-before-replace's
    expect(b.findings.filter((f) => f.rule !== "retire-before-replace").map((f) => [`${f.pack}/${f.rule}`, f.severity, f.message])).toEqual([["core/current-valid", "error", message]]);
  });

  test("a part to be replaced whose replacement does not resolve is still one that no unit retires", async () => {
    const d = variant();
    writeFileSync(join(d, "designs/beta/current.yaml"), "parts:\n  b-in:\n    disposition: replace\n    replaced_by: b-nowhere\n");
    const b = await build(join(d, "designs/beta"));
    expect(of(b.findings, "plan/retire-before-replace").map((f) => [f.severity, f.message])).toEqual([["warning",
      "part b-in is to be replaced, but no unit moves it to retired: the plan adds the new part and never removes the old one; this rests on a discovered record not yet confirmed: Beta in's disposition, which records no source"]]);
  });

  test("a whole record of every disposition reads, with the ladder's first level when it gives no baseline", async () => {
    const d = variant();
    writeFileSync(join(d, "designs/beta/current.yaml"), "parts:\n  b-in:\n    disposition: new\n  b-out:\n    baseline: stand-in\n    disposition: retain\n");
    const b = await build(join(d, "designs/beta"));
    expect(b.findings).toEqual([]);
    expect(b.current!.records.map((r) => [r.part, r.baseline, !!r.baselineDefault, r.disposition, r.state, r.text])).toEqual([
      ["b-in", "none", true, "new", "discovered", "Recorded with no source; not confirmed."],
      ["b-out", "stand-in", false, "retain", "discovered", "Recorded with no source; not confirmed."],
    ]);
  });

  test("replaced_by may name a shared part, or another design's part, which resolves where that design is composed", async () => {
    const d = variant();
    const beta = join(d, "designs/beta");
    writeFileSync(join(beta, "current.yaml"), "parts:\n  old-hub-feed:\n    add: { name: Old hub feed, kind: job, system: work, owner: team-b }\n    baseline: built\n    disposition: replace\n    replaced_by: hub\n  old-spec-copy:\n    add: { name: Old spec copy, kind: job, system: work, owner: team-b }\n    baseline: built\n    disposition: replace\n    replaced_by: alpha:a-out\n");
    const b = await build(beta);
    expect(b.current!.records.map((r) => [r.part, r.replaced_by])).toEqual([["old-hub-feed", "shared:hub"], ["old-spec-copy", "alpha:a-out"]]);
    expect(of(b.findings, "core/current-valid")).toEqual([]);
    // composed, a part alpha does not hold is reported
    edit(join(beta, "current.yaml"), (s) => s.replace("alpha:a-out", "alpha:a-nowhere"));
    const c = await build(beta, { compose: [composeDesign(join(d, "designs/alpha"))] });
    expect(of(c.findings, "core/current-valid").map((f) => f.message)).toEqual(["current.yaml: the record for old-spec-copy is replaced by alpha:a-nowhere, which Alpha (alpha) does not hold"]);
  });
});

// ── discovered and confirmed ─────────────────────────────────────────────────────────────────────────────────────

describe("discovered and confirmed", () => {
  test("missing disposition warns while discovered, errors once confirmed, and stays undecided on the page", async () => {
    const beta = join(variant(), "designs/beta");
    const path = join(beta, "current.yaml");
    const source = "parts:\n  b-in:\n    baseline: built\n    found: { by: \"agent:scout\", from: the service catalog, as_of: \"2026-11-03\" }\n";
    for (const [confirmation, state, severity] of [
      ["", "discovered", "warning"],
      ['    confirmed: { by: the team B lead, at: "2026-11-04" }\n', "confirmed", "error"],
      ['    confirmed: { by: "agent:scout", at: "2026-11-04" }\n', "discovered", "warning"],
    ] as const) {
      writeFileSync(path, source + confirmation);
      const b = await build(beta);
      const missing = of(b.findings, "core/current-valid").find((f) => f.message.includes("gives no disposition"));
      expect(missing).toMatchObject({ at: "b-in", severity });
      expect(b.current!.records[0]).toMatchObject({ state });
      expect(b.current!.records[0].disposition).toBeUndefined();
      expect(b.current!.transition.units).toEqual([]);
      expect(of(b.findings, "plan/retire-before-replace")).toEqual([]);
      const C = loadClient(renderSite(b)), ix = C.buildIndex(b);
      expect(C.todayHtml(ix, "b-in")).toContain("Undecided: needs a disposition");
      expect(C.cardMore(ix, "element", "b-in").find((r: any) => r.label === "Today").html).toContain("disposition undecided");
    }
  });

  test("shared current state is refused with bare and namespaced keys, even when confirmed", async () => {
    const beta = join(variant(), "designs/beta");
    for (const key of ["hub", "shared:hub", "alpha:a-in"]) {
      writeFileSync(join(beta, "current.yaml"), `parts:\n  "${key}":\n    disposition: retain\n    confirmed: { by: the team B lead, at: "2026-11-04" }\n`);
      const b = await build(beta);
      expect(b.current!.records).toEqual([]);
      expect(of(b.findings, "core/current-valid")).toHaveLength(1);
      expect(b.findings[0]).toMatchObject({ severity: "error" });
      expect(b.findings[0].message).toContain("a design records current state for its own parts only");
    }
  });

  test("a confirmation by an agent is refused: the record stays discovered, and says why", async () => {
    const b = await build(join(variant("current-valid"), "designs/beta"));
    const r = b.current!.records[0];
    expect(r.state).toBe("discovered");
    expect(r.confirmed).toBeUndefined();
    expect(r.text).toBe("Discovered by current-state-scout from the service catalog export, 3 Nov; not confirmed: an agent wrote the confirmation, and only a person confirms a record.");
    expect(b.findings[0].message).toBe("current.yaml: the record for b-in is confirmed by an agent (agent:current-state-scout); only a person confirms a record, so it stays discovered");
  });

  test("who counts as an agent; a confirmation with no name or no date does not count either", async () => {
    for (const by of ["agent:org-scout", "agent", "Agent:X", "Claude", "claude code"]) expect(isAgent(by)).toBe(true);
    for (const by of ["the team B lead", "Agentha Smith", "the agent programme lead"]) expect(isAgent(by)).toBe(false);
    const d = variant();
    for (const [conf, msg] of [
      ["{ by: Claude, at: \"2026-11-04\" }", "is confirmed by an agent (Claude); only a person confirms a record, so it stays discovered"],
      ["{ at: \"2026-11-04\" }", "is confirmed without saying by whom (confirmed.by); it stays discovered"],
      ["{ by: the team B lead }", "is confirmed by the team B lead with no date (confirmed.at); it stays discovered"],
      ["{ by: the team B lead, at: soon }", 'is confirmed by the team B lead on "soon", which is not a date (YYYY-MM-DD); it stays discovered'],
    ]) {
      writeFileSync(join(d, "designs/beta/current.yaml"), `parts:\n  b-in:\n    disposition: transition\n    confirmed: ${conf}\n`);
      const b = await build(join(d, "designs/beta"));
      expect(b.findings.map((f) => f.message)).toEqual([`current.yaml: the record for b-in ${msg}`]);
      expect(b.current!.records[0].state).toBe("discovered");
    }
  });

  test("the provenance sentence, discovered and confirmed", () => {
    expect(provenanceText({ state: "discovered", found: { by: "agent:current-state-scout", agent: "current-state-scout", from: "the service catalog export", as_of: "2026-11-03" } }))
      .toBe("Discovered by current-state-scout from the service catalog export, 3 Nov; not confirmed.");
    expect(provenanceText({ state: "confirmed", confirmed: { by: "the AppSec platform lead", at: "2026-11-05" }, found: { by: "agent:current-state-scout", agent: "current-state-scout", from: "the gateway's config repository", as_of: "2026-11-03" } }))
      .toBe("Confirmed by the AppSec platform lead on 5 Nov; discovered by current-state-scout from the gateway's config repository, 3 Nov.");
    expect(provenanceText({ state: "discovered", found: { by: "the AppSec platform lead" } })).toBe("Discovered by the AppSec platform lead; not confirmed.");
  });
});

// ── the retired level ────────────────────────────────────────────────────────────────────────────────────────────

describe("to: retired, only where allowed", () => {
  exTest("plan/fidelity-moves-up accepts retired for a part whose disposition is replace or retire, and refuses it elsewhere", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    expect(of((await build(inv)).findings, "plan/fidelity-moves-up")).toEqual([]);
    // U-11 extends alert enrichment (transition); retiring it instead is refused
    edit(join(inv, "plan.yaml"), (s) => s.replace("elements: [{ id: alert-enrichment, from: built, to: built }]", "elements: [{ id: alert-enrichment, from: built, to: retired }]")
      .replace("elements: [{ id: reconciler, from: none, to: stand-in }]", "elements: [{ id: reconciler, from: none, to: stand-in }, { id: cloud-accounts, from: existing-tool, to: retired }]"));
    const b = await build(inv);
    expect(of(b.findings, "plan/fidelity-moves-up").map((f) => [f.at, f.message])).toEqual([
      ["U-02", "unit U-02 moves cloud-accounts to retired, which is allowed only for a part whose disposition in current state is replace or retire; it has no current-state record"],
      ["U-11", "unit U-11 moves alert-enrichment to retired, which is allowed only for a part whose disposition in current state is replace or retire; its disposition is transition"],
    ]);
  });

  test("a 0.4 design with no current.yaml has nothing to retire; a lone instance keeps the old message", async () => {
    const d = variant();
    edit(join(d, "designs/beta/plan.yaml"), (s) => s.replace("elements: [{ id: b-out, from: none, to: built }]", "elements: [{ id: b-out, from: built, to: retired }]"));
    const b = await build(join(d, "designs/beta"));
    expect(of(b.findings, "plan/fidelity-moves-up").map((f) => f.message)).toEqual(["unit BU-2 moves b-out to retired, which is allowed only for a part whose disposition in current state is replace or retire; it has no current-state record"]);
    expect(b.current).toBeUndefined();
    const { packs } = await loadPacks(["plan"]);
    const rule = packs[0].rules.find((r) => r.id === "fidelity-moves-up")!;
    const model = { teams: [], systems: [], zones: [], elements: [{ id: "x", name: "X", kind: "service" }], relationships: [], contracts: [], views: [] };
    const plan = { phases: [{ id: "P1", name: "One", exit_test: "t", order: 1 }], units: [{ id: "U-1", title: "Retire x", kind: "code", phase: "P1", check: "c", elements: [{ id: "x", from: "built", to: "retired" }] }] };
    expect(rule.check(buildContext({ name: "lone", title: "Lone", packs: ["plan"] }, model, plan)).map((f) => f.message)).toEqual(['unit U-1 moves x to "retired", which is not on the ladder (none < stand-in < existing-tool < built)']);
  });
});

// ── retire-before-replace ────────────────────────────────────────────────────────────────────────────────────────

describe("plan/retire-before-replace", () => {
  exTest("an error on a confirmed record, a warning with its sentence on a discovered one", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    // confirm the cloud tag sync job: the order finding becomes an error and loses its sentence
    edit(join(inv, "current.yaml"), (s) => s.replace("from: \"the cloud account's automation list\", as_of: \"2026-11-03\", confidence: medium }", "from: \"the cloud account's automation list\", as_of: \"2026-11-03\", confidence: medium }\n    confirmed: { by: the developer platform lead, at: \"2026-11-12\" }"));
    const b = await build(inv);
    const tag = of(b.findings, "plan/retire-before-replace").find((f) => f.at === "tag-sync-job")!;
    expect(tag.severity).toBe("error");
    expect(tag.message).toBe("unit U-09 retires part tag-sync-job in milestone M3, after milestone M2, where unit U-04 brings its replacement, part reconciler, to built, so the old part runs beside the new one until then");
    // and unconfirm the spreadsheet: its error becomes a warning naming the record
    edit(join(inv, "current.yaml"), (s) => s.replace("    confirmed: { by: the governance and risk lead, at: \"2026-11-04\" }\n  # ── discovered", "  # ── discovered"));
    const c = await build(inv);
    const sheet = of(c.findings, "plan/retire-before-replace").find((f) => f.at === "ownership-spreadsheet")!;
    expect(sheet.severity).toBe("warning");
    expect(sheet.message).toContain("; this rests on a discovered record not yet confirmed: Ownership spreadsheet's disposition, discovered by current-state-scout from the shared drive index on 27 Oct");
  });

  exTest("the ordering clause: the old part retired a milestone after its replacement arrives; same milestone is clean", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    edit(join(inv, "plan.yaml"), (s) => s.replace("  - id: U-09\n    title: Retire the cloud tag sync job\n    kind: code\n    phase: M3", "  - id: U-09\n    title: Retire the cloud tag sync job\n    kind: code\n    phase: M2"));
    const b = await build(inv);
    expect(of(b.findings, "plan/retire-before-replace").map((f) => f.at)).toEqual(["ownership-macros", "ownership-spreadsheet"]);
    const rt = b.current!.retirements.find((r) => r.part === "tag-sync-job")!;
    expect(rt).toMatchObject({ by: ["U-09"], milestone: "M2", order: "same", waitsFor: ["U-09"], doesNotWait: [], replacement: { part: "reconciler", level: "built", units: ["U-04"], milestone: "M2" } });
  });

  exTest("the dependency clause: always a warning, even on a confirmed record, and gone once the retiring unit waits", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    edit(join(inv, "current.yaml"), (s) => s.replace("from: the shared workbook, as_of: \"2026-11-03\", confidence: low }", "from: the shared workbook, as_of: \"2026-11-03\", confidence: low }\n    confirmed: { by: the governance and risk lead, at: \"2026-11-12\" }"));
    const b = await build(inv);
    const mac = of(b.findings, "plan/retire-before-replace").find((f) => f.at === "ownership-macros")!;
    expect(mac.severity).toBe("warning");
    expect(mac.message).toBe("unit U-08 retires part ownership-macros but does not wait, directly or through other units, for unit U-04, which brings its replacement, part reconciler, to built: the old part could go before the new one is there");
    edit(join(inv, "plan.yaml"), (s) => s.replace("elements: [{ id: ownership-macros, from: built, to: retired }]\n    requires: [cap.accounts]", "elements: [{ id: ownership-macros, from: built, to: retired }]\n    requires: [cap.one-list]"));
    expect(of((await build(inv)).findings, "plan/retire-before-replace").map((f) => f.at)).toEqual(["ownership-spreadsheet", "tag-sync-job"]);
  });

  exTest("a part to be retired that no unit retires; a replacement that nothing brings anywhere orders nothing", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    edit(join(inv, "plan.yaml"), (s) => s.replace("elements: [{ id: scan-scripts, from: built, to: retired }]", "elements: [{ id: repo-crawler, from: existing-tool, to: existing-tool }]"));
    edit(join(inv, "current.yaml"), (s) => s.replace("    replaced_by: reconciler\n    found: { by: \"agent:current-state-scout\", from: the shared workbook", "    replaced_by: cloud-accounts\n    found: { by: \"agent:current-state-scout\", from: the shared workbook"));
    const b = await build(inv);
    const fs = of(b.findings, "plan/retire-before-replace");
    expect(fs.find((f) => f.at === "scan-scripts")!.message).toBe("part scan-scripts is to be retired, but no unit moves it to retired; this rests on a discovered record not yet confirmed: Nightly scan scripts' disposition, discovered by current-state-scout from the scheduler's job list on 27 Oct");
    expect(fs.find((f) => f.at === "ownership-macros")).toBeUndefined(); // no unit moves the cloud account list
    expect(b.current!.retirements.find((r) => r.part === "ownership-macros")!.replacement).toEqual({ part: "cloud-accounts", units: [] });
  });

  exTest("a proposed patch that adds the missing retiring unit resolves the error", async () => {
    const d = examples();
    const inv = join(d, "designs/inventory");
    mkdirSync(join(inv, "patches"));
    writeFileSync(join(inv, "patches/P-1-retire-spreadsheet.yaml"), "id: P-1\ntitle: Retire the ownership spreadsheet\nstatus: proposed\nwhy: The ownership feed replaces it in M2.\nops:\n  - op: add\n    kind: unit\n    value: { id: U-12, title: Retire the ownership spreadsheet, kind: code, phase: M2, elements: [{ id: ownership-spreadsheet, from: existing-tool, to: retired }], requires: [cap.asset-owners], check: The spreadsheet is read-only and nobody has opened it for a month., flow_item: debt }\n");
    const b = await build(inv);
    const im = b.patches[0].impact;
    expect(keys(im.findingsResolved)).toEqual(["plan/retire-before-replace on ownership-spreadsheet error"]);
    // the new unit is Governance and risk's, through the spreadsheet it retires: one more open unit for that team
    expect(keys(im.findingsIntroduced)).toEqual(["teams/team-load on org:governance-risk warning"]);
    expect(im.verdict?.level).toBe("caution");
  });

  test("across designs: target dates order a replacement in another design, a missing date orders nothing, a shared capability is a dependency", async () => {
    const d = variant();
    const beta = join(d, "designs/beta"), alpha = join(d, "designs/alpha");
    writeFileSync(join(beta, "current.yaml"), "parts:\n  old-spec-copy:\n    add: { name: Old spec copy, kind: job, system: work, owner: team-b }\n    baseline: built\n    disposition: replace\n    replaced_by: alpha:a-out\n    confirmed: { by: the team B lead, at: \"2026-11-10\" }\n");
    edit(join(beta, "plan.yaml"), (s) => s + "  - id: BU-3\n    title: Retire the old spec copy\n    kind: code\n    phase: B2\n    elements: [{ id: old-spec-copy, from: built, to: retired }]\n    check: The old copy is gone.\n    flow_item: debt\n");
    // alone, beta cannot see alpha's plan: nothing to order against
    const lone = await build(beta);
    expect(of(lone.findings, "plan/retire-before-replace")).toEqual([]);
    expect(lone.current!.retirements[0]).toEqual({ part: "old-spec-copy", by: ["BU-3"], milestone: "B2", replacement: { part: "alpha:a-out", units: [] } });
    // composed: alpha's AU-2 brings a-out to built in A1 (target 2026-12-15); BU-3 retires the copy in B2 (target 2027-04-15)
    const both = await build(beta, { compose: [composeDesign(alpha)] });
    expect(of(both.findings, "plan/retire-before-replace").map((f) => [f.severity, f.message])).toEqual([
      ["warning", "unit BU-3 retires part old-spec-copy but does not wait, directly or through other units, for unit alpha:AU-2, which brings its replacement, part alpha:a-out, to built: the old part could go before the new one is there"],
      ["error", "unit BU-3 retires part old-spec-copy in milestone B2 (target 2027-04-15), after milestone A1 of alpha (target 2026-12-15), where unit alpha:AU-2 brings its replacement, part alpha:a-out, to built, so the old part runs beside the new one until then"],
    ]);
    expect(both.current!.retirements[0]).toMatchObject({ order: "after", replacement: { units: ["alpha:AU-2"], milestone: "alpha:A1", design: "alpha", target: "2026-12-15" } });
    // in B1 (target 2027-01-15) and waiting for the spec through the shared capability: still after A1's date, but it waits
    edit(join(beta, "plan.yaml"), (s) => s.replace("    phase: B2\n    elements: [{ id: old-spec-copy", "    phase: B1\n    requires: [cap.spec]\n    elements: [{ id: old-spec-copy"));
    edit(join(beta, "plan.yaml"), (s) => s.replace('target: "2027-01-15"', 'target: "2026-12-15"'));
    const same = await build(beta, { compose: [composeDesign(alpha)] });
    expect(of(same.findings, "plan/retire-before-replace")).toEqual([]);
    expect(same.current!.retirements[0]).toMatchObject({ order: "same", waitsFor: ["BU-3"], doesNotWait: [] });
    // a milestone with no target: the order is unknown, and nothing is reported for it
    edit(join(beta, "plan.yaml"), (s) => s.replace('target: "2026-12-15"', "exit_test_note: no date"));
    const unknown = await build(beta, { compose: [composeDesign(alpha)] });
    expect(unknown.current!.retirements[0].order).toBe("unknown");
    expect(of(unknown.findings, "plan/retire-before-replace")).toEqual([]);
    // either side may lack a date; the separate dependency warning still applies.
    edit(join(beta, "plan.yaml"), (s) => s.replace("exit_test_note: no date", 'target: "2026-12-15"').replace("    requires: [cap.spec]\n    elements: [{ id: old-spec-copy", "    elements: [{ id: old-spec-copy"));
    edit(join(alpha, "plan.yaml"), (s) => s.replace('target: "2026-12-15"', "exit_test_note: no date"));
    const noArrivalDate = await build(beta, { compose: [composeDesign(alpha)] });
    expect(noArrivalDate.current!.retirements[0].order).toBe("unknown");
    expect(of(noArrivalDate.findings, "plan/retire-before-replace").map((f) => [f.severity, f.message.includes("does not wait")])).toEqual([["warning", true]]);
  });
});

// ── a lone instance, and the rule sets ───────────────────────────────────────────────────────────────────────────

describe("a lone instance behaves as today; a 0.4 design lists the current-state rules", () => {
  test("packsFor leaves a lone instance's packs as they are and gives a 0.4 design the plan pack's rules04", async () => {
    const { packs } = await loadPacks(["generic", "plan"]);
    expect(packsFor(packs, false)).toBe(packs);
    const p04 = packsFor(packs, true);
    expect(p04[0]).toBe(packs[0]); // a pack with no rules04 is the same object
    expect(p04[1].rules.map((r) => r.id)).toEqual([...packs[1].rules.map((r) => r.id), "retire-before-replace"]);
    expect(p04[1].rules.find((r) => r.id === "fidelity-moves-up")!.why).toContain("Retiring a part is the one move off the ladder");
    expect(packs[1].rules.find((r) => r.id === "fidelity-moves-up")!.why).not.toContain("retir"); // the cached pack is untouched
  });

  test("the delivery stream lists no current-state rule, carries no current state and draws no today-only mark", async () => {
    const b = (await buildBundle(DS_DIR, { built: "2026-10-22T09:00:00.000Z" })).bundle;
    const plan = b.instance.packs.find((p) => p.name === "plan")!;
    expect(plan.rules.map((r) => r.id)).not.toContain("retire-before-replace");
    expect(plan.rules.find((r) => r.id === "fidelity-moves-up")!.why).not.toContain("retir");
    expect(b.current).toBeUndefined();
    expect(b.model.elements.some((e) => e.todayOnly)).toBe(false);
    const markup = renderSite(b).replace(/<script[\s\S]*?<\/script>/g, ""); // the page's own script holds the words
    expect(markup).not.toContain("Today only");
    expect(markup).not.toContain(">Discovered<");
    expect(Object.keys(DIGEST.digest(b).r).filter((k) => k.startsWith("current:"))).toEqual([]);
  });

  test("a 0.4 design's bundle lists retire-before-replace in its plan pack, and current-valid in its core pack once a core finding fires", async () => {
    const b = await build(join(variant("current-valid"), "designs/beta"));
    expect(b.instance.packs.find((p) => p.name === "plan")!.rules.map((r) => r.id)).toContain("retire-before-replace");
    const core = b.instance.packs.find((p) => p.name === "core")!;
    expect(core.rules.map((r) => r.id)).toContain("current-valid");
    for (const r of [...core.rules, ...b.instance.packs.find((p) => p.name === "plan")!.rules]) expect(`${r.title} ${r.why}`).not.toMatch(/—|attrs\.|\.yaml|`/);
  });
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("the page: the Today block, the today-only mark and what the pod added", () => {
  const ready = (async () => {
    if (!HAVE_EX) throw new Error("no examples");
    const b = await build(join(EX, "designs/inventory"));
    const html = renderSite(b);
    const DEc = loadClient(html);
    return { b, html, DE: DEc, ix: DEc.buildIndex(b) };
  })();
  ready.catch(() => {}); // the tests that await it skip without the examples

  exTest("a part page's Today block, once discovered and once confirmed", async () => {
    const { DE: C, ix } = await ready;
    const disc = C.todayHtml(ix, "tag-sync-job") as string;
    expect(disc).toContain("<h3>Today</h3>");
    expect(disc).toContain('<span class="cur-state" data-state="discovered"><svg class="icon icon-sm st-warning"');
    expect(disc).toContain("Discovered by current-state-scout from the cloud account&#39;s automation list, 3 Nov; not confirmed.");
    expect(disc).toContain("Only today: the target design has no part like it");
    expect(disc).toContain('Replace: <a href="#model/element/reconciler"');
    expect(disc).toContain("Retire the cloud tag sync job");
    expect(disc).toContain('Reconciler</a> reaches built with');
    const conf = C.todayHtml(ix, "legacy-cmdb-export") as string;
    expect(conf).toContain('<span class="cur-state" data-state="confirmed"><svg class="icon icon-sm st-pass"');
    expect(conf).not.toContain("not confirmed");
    expect(conf).toContain("Confirmed by the governance and risk lead on 4 Nov; discovered by current-state-scout from the scheduler&#39;s job list, 27 Oct.");
    const page = C.elementDetail(ix, "tag-sync-job") as string;
    expect(page).toContain('<span class="tag">Today only</span>');
    expect(page.indexOf("<h3>Today</h3>")).toBeLessThan(page.indexOf("<h3>Work that changes it"));
    // a target part with a record shows it too; a part with no record shows no Today block
    expect(C.todayHtml(ix, "repo-crawler")).toContain("Transition: it exists, and changes to meet the target");
    expect(C.todayHtml(ix, "reconciler")).toBe("");
    expect(C.elementDetail(ix, "reconciler")).not.toContain("<h3>Today</h3>");
  });

  exTest("the card's Today line, the drawing's today-only mark and the parts table's tags", async () => {
    const { b, html, DE: C, ix } = await ready;
    const more = C.cardMore(ix, "element", "ownership-macros") as { label: string; html: string }[];
    expect(more.find((x) => x.label === "Today")!.html).toBe("Exists only today, stands at built; to be replaced by “Reconciler”; discovered, not confirmed");
    const scene = b.zoneScenes!.find((s) => s.layout.nodes.some((n) => n.id === "tag-sync-job"))!;
    const out = C.renderDiagram(ix, C.zoneDiagram(ix, scene, {}), { prefix: "t", fixed: true });
    expect(out.svg).toContain('style="stroke-dasharray:2 3"');
    expect(out.svg).toContain("Cloud tag sync job, job, exists only today");
    expect(out.svg).toContain(">Today only</text>");
    expect(out.legend).toContain("Today only: a part that exists now and is not in the target design");
    const row = html.slice(html.indexOf('data-element="tag-sync-job" data-kind'), html.indexOf("</tr>", html.indexOf('data-element="tag-sync-job" data-kind')));
    expect(row).toContain('<span class="tag">Today only</span>');
    expect(row).toContain('<span class="tag warning" title="Discovered by current-state-scout from the cloud account&#39;s automation list, 3 Nov; not confirmed.">Discovered</span>');
    const confirmedRow = html.slice(html.indexOf('data-element="alert-enrichment" data-kind'), html.indexOf("</tr>", html.indexOf('data-element="alert-enrichment" data-kind')));
    expect(confirmedRow).not.toContain("Discovered");
  });

  exTest("since you last looked: what the pod added shows as added records, a confirmation as a change", async () => {
    const { b } = await ready;
    const after = DIGEST.digest(b);
    expect(after.k).toContain("current");
    expect(after.r["current:tag-sync-job"]).toMatch(/\|discovered$/);
    expect(after.r["current:legacy-cmdb-export"]).toMatch(/\|confirmed$/);
    const before: Bundle = structuredClone(b);
    before.current!.records = before.current!.records.filter((r) => r.part !== "tag-sync-job");
    const confirmed: Bundle = structuredClone(b);
    const rec = confirmed.current!.records.find((r) => r.part === "repo-crawler")!;
    rec.state = "confirmed"; rec.confirmed = { by: "the developer platform lead", at: "2026-11-15" };
    const cmp = DIGEST.compare(DIGEST.digest(before), after, DIGEST.names(b));
    expect(cmp.added.map((r) => [r.kind, r.id, r.name])).toEqual([["current", "tag-sync-job", "Cloud tag sync job"]]);
    const cmp2 = DIGEST.compare(after, DIGEST.digest(confirmed), DIGEST.names(confirmed));
    expect(cmp2.changed.map((r) => [r.kind, r.id])).toEqual([["current", "repo-crawler"]]);
    const html = renderSite(b);
    const C = loadClient(html);
    expect(C.sinceList(cmp, {})).toBe("1 record added");
    expect(C.sinceHtml(C.buildIndex(b), cmp, "")).toContain('<span class="tag">current-state record</span> <a href="#model/element/tag-sync-job">Cloud tag sync job</a>');
  });

  exTest("the brief lists the discovered records waiting for a person", async () => {
    const md = await briefMd(join(EX, "designs/inventory"));
    expect(md).toContain("### Discovered current-state records waiting for a person to confirm (4 of 7)");
    expect(md).toContain("- `tag-sync-job` Cloud tag sync job (exists only today): replace by `reconciler`. Discovered by current-state-scout from the cloud account's automation list, 3 Nov; not confirmed.");
    expect(await briefMd(join(EX, "designs/premerge"))).not.toContain("current-state records");
  });
});

// ── compile, without a build ─────────────────────────────────────────────────────────────────────────────────────

exTest("compile brings today-only parts in for any caller that passes current state, and leaves a plain state alone", () => {
  const inst = loadInstance(join(EX, "designs/inventory"));
  expect(compile(inst).model.elements.filter((e) => e.todayOnly).length).toBe(5);
  expect(compile({ model: inst.model, plan: inst.plan, patches: inst.patches }).model.elements.some((e) => e.todayOnly)).toBe(false);
  expect(compile(inst).current!.findings).toEqual([]);
});
