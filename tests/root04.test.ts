// The shared root. The org namespace (teams,
// estimates with history from patches, activities, slowdowns, exceptions), the shared namespace's loader and shape
// checks, the security marks on what crosses (the one derivation, src/core/shared.ts), the team map in the root,
// patches on both namespaces, notes on both, and the root's own build. Acceptance: the example portfolio and the broken
// example variants for the root's rules. Every test works on a temporary copy.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle, modelHash } from "../src/core/bundle.ts";
import { loadInstance } from "../src/core/load.ts";
import { compile } from "../src/core/compile.ts";
import { composeDesign } from "../src/core/compose.ts";
import { loadRoot } from "../src/core/root.ts";
import { buildRoot, checkRoot } from "../src/core/root-build.ts";
import { estimateHistory, estimateProblems, normEstimate } from "../src/core/estimate.ts";
import { exceptionInForce, readOrgView, slowdownInForce } from "../src/core/org.ts";
import { computeMarks, crossingSignals } from "../src/core/shared.ts";
import type { ComposedDesign, Finding, Relationship } from "../src/types.ts";

const DE = join(import.meta.dir, "..");
const EX = join(DE, "examples");
const FX = join(import.meta.dir, "fixtures/portfolio");
const BUILT = "2026-11-16T10:00:00Z";
/** Tests that read the examples skip when those examples are absent. */
const HAVE_EX = existsSync(join(EX, "portfolio/portfolio.yaml"));
const testEx = test.skipIf(!HAVE_EX);

const tmp = (tag: string) => mkdtempSync(join(tmpdir(), `plumb-root04-${tag}-`));
const edit = (path: string, f: (s: string) => string) => writeFileSync(path, f(readFileSync(path, "utf8")));
const keys = (fs: Finding[]) => fs.map((f) => `${f.pack}/${f.rule}@${f.at}`);
const of = (fs: Finding[], rule: string) => fs.filter((f) => `${f.pack}/${f.rule}` === rule);

/** A copy of the base fixture, with a variant's files laid over it. */
function fixture(variant?: string): string {
  const d = tmp(variant ?? "base");
  cpSync(join(FX, "base"), d, { recursive: true });
  if (variant) cpSync(join(FX, "variants", variant), d, { recursive: true });
  return d;
}
/** A copy of the example portfolio (root and designs). */
function examples(): string {
  const d = tmp("ex");
  cpSync(EX, d, { recursive: true });
  return d;
}
const compose = (d: string, names: string[]): ComposedDesign[] => names.map((n) => composeDesign(join(d, "designs", n)));
const rootCheck = (d: string, designs?: string[], extra: Parameters<typeof checkRoot>[1] = {}) => checkRoot(join(d, "shared"), { built: BUILT, ...(designs ? { compose: compose(d, designs) } : {}), ...extra });
const writePatch = (root: string, file: string, body: string) => { mkdirSync(join(root, "patches"), { recursive: true }); writeFileSync(join(root, "patches", file), body); };

// ── the root loads both namespaces, with its patches applied ──────────────────────────────────────────────────────

describe("the shared root: two namespaces, one folder", () => {
  test("a root with only the shared layer: no org layer, and a design keeps its own teams", async () => {
    const d = fixture();
    rmSync(join(d, "shared/org.yaml"));
    edit(join(d, "designs/alpha/model.yaml"), (s) => `teams:\n  - { id: team-a, name: Team A, lead: the team A lead }\n  - { id: team-b, name: Team B }\n${s}`);
    const root = loadRoot(join(d, "shared"));
    expect(root.org).toBeUndefined();
    expect(root.shared!.parts.map((p) => p.id)).toEqual(["hub", "sandbox"]);
    const { bundle: b } = await buildBundle(join(d, "designs/alpha"), { built: BUILT });
    expect(b.findings).toEqual([]);
    expect(b.model.teams.map((t) => [t.id, t.home])).toEqual([["team-a", undefined], ["team-b", undefined]]);
    const r = await rootCheck(d);
    expect(r.findings).toEqual([]);
    expect(r.check.org?.teams ?? []).toEqual([]);
  });

  test("a root with both: a design names the org's teams, which bring their names and leads", async () => {
    const d = fixture();
    const { bundle: b } = await buildBundle(join(d, "designs/alpha"), { built: BUILT });
    expect(b.findings).toEqual([]);
    expect(b.model.teams.map((t) => [t.id, t.home, t.name, t.lead])).toEqual([["org:team-a", "org", "Team A", "the team A lead"]]);
    expect(b.teams!.load.map((l) => l.team)).toEqual(["org:team-a"]);
  });

  test("a design that declares teams while its root has an org layer is core/one-home", async () => {
    const d = fixture("one-home");
    const { bundle: b } = await buildBundle(join(d, "designs/alpha"), { built: BUILT });
    expect(keys(b.findings)).toEqual(["core/one-home@team-a"]);
    expect((await rootCheck(d, ["alpha", "beta"])).findings).toEqual([]); // the root itself is fine
  });

  testEx("the team map lives in the root: seams and shared parts get their owner teams, and every team it names must exist", async () => {
    const d = examples();
    const { bundle } = await buildRoot(join(d, "shared"), { built: BUILT });
    expect(bundle.teamMap!.seams).toEqual({ "shared:intake-premerge": ["org:appsec-platform"], "shared:inventory-intake": ["org:governance-risk"] });
    expect(bundle.teamMap!.parts).toEqual({ "shared:code-host": ["org:dev-platform"] });
    expect(bundle.teamMap!.unmapped).toEqual([]);
    edit(join(d, "shared/team-map.yaml"), (s) => s.replace(`"the developer platform owner": { teams: [dev-platform] }`, `"the developer platform owner": { teams: [platform-team] }`));
    const r = await checkRoot(join(d, "shared"), { built: BUILT });
    expect(of(r.findings, "core/xref-resolves").map((f) => f.message)).toEqual([`team-map.yaml owner "the developer platform owner" names the team platform-team, which the org layer does not hold`]);
  });
});

describe("root patches apply to both namespaces", () => {
  testEx("accepted patches apply in natural id order; a proposed one does not; the shipped layer stays as the file holds it", () => {
    const d = examples();
    const root = loadRoot(join(d, "shared"));
    expect(root.applied).toEqual(["P-001", "P-002", "P-003", "P-004"]);
    expect(Object.values(root.results!).map((r) => r.namespaces)).toEqual([["org"], ["shared"], ["shared"], ["org"]]);
    expect(root.org!.teams.find((t) => t.id === "appsec-platform")!.attrs!.capacity).toMatchObject({ value: 5, as_of: "2026-09-14" });  // P-001
    expect(root.shared!.crossings.map((x) => x.id)).toEqual(["x01", "x02", "x03", "x04", "x05", "x06", "x07"]);                   // P-002
    expect(root.shipped!.crossings.map((x) => x.id)).toEqual(["x01", "x02", "x03", "x04", "x05", "x06"]);
    expect(root.shared!.capabilities.map((c) => c.id)).toContain("cap.asset-owners");
    expect(root.shared!.seams.map((s) => s.id)).toEqual(["intake-premerge", "inventory-intake"]);
    expect(root.shared!.contracts.find((c) => c.name === "AssetOwnership")!.attrs!.security).toEqual({ raised: { by: "the head of security engineering", why: "A wrong owner sends a finding to a queue nobody reads." } }); // P-003
    expect((root.org!.activities.find((a) => a.id === "vuln-triage")!.share as { value: number }).value).toBe(0.34);              // P-004, not P-005
    expect(root.shared!.sha256).toBe(root.shipped!.sha256);
    expect(root.shared!.sha256).toBe(new Bun.CryptoHasher("sha256").update(readFileSync(join(d, "shared/seams.yaml"))).digest("hex"));
  });

  testEx("with and without one patch, as a portfolio's impact composes them", () => {
    const d = examples();
    const w = loadRoot(join(d, "shared"), { with: "P-005" });
    expect(w.applied).toEqual(["P-001", "P-002", "P-003", "P-004", "P-005"]);
    expect((w.org!.activities.find((a) => a.id === "incident-oncall")!.share as { value: number }).value).toBe(0.52);
    const wo = loadRoot(join(d, "shared"), { without: "patches/P-002-inventory-seam.yaml" });
    expect(wo.shared!.crossings.map((x) => x.id)).not.toContain("x07");
    expect(wo.applied).toEqual(["P-001", "P-003", "P-004"]);
    expect(wo.loadFindings?.map((f) => f.message)).toEqual([`P-003 op 1 (modify contract): unknown contract "AssetOwnership"`]); // P-003 raises what P-002 adds
  });

  test("an op that cannot apply is core/patch-applies; a root patch changes no design record", async () => {
    const d = fixture();
    writePatch(join(d, "shared"), "P-001-bad.yaml", `id: P-001
title: Two bad ops
status: accepted
why: To show the refusals.
ops:
  - { op: modify, kind: team, id: team-z, set: { name: Team Z } }
  - { op: add, kind: unit, value: { id: U-1, title: A unit } }
  - { op: modify, kind: contract, id: org:Spec, set: { description: x } }
  - { op: modify, kind: activity, id: org:chores, set: { name: Household chores } }
`);
    const r = await rootCheck(d);
    expect(of(r.findings, "core/patch-applies").map((f) => f.message)).toEqual([
      `P-001 op 1 (modify team): unknown team "team-z"`,
      `P-001 op 2 (add unit): a root patch changes the org layer (team, activity, slowdown, exception) or the shared layer (element, relationship, contract, capability, seam, system, zone, claim, manual-work), not "unit": a unit belongs to a design, so its patch goes in that design's folder`,
      `P-001 op 3 (modify contract): names org:Spec, but a contract lives in the shared layer`,
    ]);
    expect(r.root.org!.activities.find((a) => a.id === "chores")!.name).toBe("Household chores"); // the op that could apply did
  });

  testEx("a design reads the patched layers: the organization's crossing, capability and numbers", async () => {
    const d = examples();
    const { bundle: b } = await buildBundle(join(d, "designs/intake"), { built: BUILT });
    expect(keys(b.findings)).not.toContain("plan/requires-provided@U-08"); // cap.asset-owners arrives with P-002
    expect(b.plan.capabilities?.map((c) => c.id)).toEqual(["shared:cap.asset-owners"]);
    expect(b.model.relationships.filter((r) => r.home).map((r) => r.id)).toContain("shared:x07");
    expect(b.model.elements.find((e) => e.id === "inventory:ownership-api")?.home).toBe("inventory");
    expect((b.model.teams.find((t) => t.id === "org:appsec-platform")!.attrs as { capacity: { value: number } }).capacity.value).toBe(5);
  });

  test("an org patch can bring the org layer into being (de migrate --root), and one whose ops all fail does not", async () => {
    const d = fixture();
    rmSync(join(d, "shared/org.yaml"));
    writePatch(join(d, "shared"), "P-001-bad-org.yaml", `id: P-001
title: A team with no id
status: accepted
why: To show that a failed op leaves no org layer.
ops:
  - { op: add, kind: team, value: { name: Nameless } }
`);
    expect(loadRoot(join(d, "shared")).org).toBeUndefined();
    writePatch(join(d, "shared"), "P-002-move-teams.yaml", `id: P-002
title: Move the teams into the org layer
status: accepted
why: The designs now import this root.
ops:
  - { op: add, kind: team, value: { id: team-a, name: Team A, lead: the team A lead } }
  - { op: add, kind: team, value: { id: team-b, name: Team B } }
`);
    const root = loadRoot(join(d, "shared"));
    expect(root.org!.teams.map((t) => t.id)).toEqual(["team-a", "team-b"]);
    edit(join(d, "designs/alpha/model.yaml"), (s) => `teams:\n  - { id: team-a, name: Team A }\n${s}`);
    const { bundle: b } = await buildBundle(join(d, "designs/alpha"), { built: BUILT });
    expect(keys(b.findings)).toEqual(["core/one-home@team-a"]); // remove the design's teams once the move is accepted
  });

  testEx("a design's build rests on its root's accepted patches: its content hash moves with them, its model hash does not", async () => {
    const d = examples();
    const at = async () => (await buildBundle(join(d, "designs/intake"), { built: BUILT })).bundle.engine;
    const a = await at();
    writePatch(join(d, "shared"), "P-006-x.yaml", "id: P-006\ntitle: Rename\nstatus: proposed\nwhy: x\nops:\n  - { op: modify, kind: team, id: appsec-platform, set: { name: Application security platform } }\n");
    const b = await at();
    expect(b.hash).toBe(a.hash); // a proposed root patch changes nothing a design builds on
    edit(join(d, "shared/patches/P-006-x.yaml"), (s) => s.replace("status: proposed", "status: accepted"));
    const c = await at();
    expect(c.hash).not.toBe(a.hash);
    expect(c.modelHash).toBe(a.modelHash);
  });

  testEx("a stale shared file is judged on the shipped file: the organization's patches are never staleness", async () => {
    const d = examples();
    // the shipped file moves on in wording only, and the organization raises a contract pre-merge checks names
    edit(join(d, "shared/seams.yaml"), (s) => s.replace("Hosts every repository, runs CI on each change and merges what passes.", "Hosts every repository and runs CI on each change."));
    writePatch(join(d, "shared"), "P-006-raise.yaml", `id: P-006
title: Raise the check result
status: accepted
why: To show that a patch is not staleness.
ops:
  - { op: modify, kind: contract, id: CheckResult, set: { security: { raised: { by: the head of security engineering, why: A wrong result merges a bad change. } } } }
`);
    const { bundle: b } = await buildBundle(join(d, "designs/premerge"), { built: BUILT });
    const stale = b.findings.filter((f) => f.rule === "xref-pin-stale" && f.at === "seams.yaml");
    expect(stale.length).toBe(1);
    expect(stale[0].message).toMatch(/: none of the \d+ shared records this design names changed$/);
  });

  testEx("a design loads against a root already loaded, with or without one root patch, as a portfolio's impact needs", () => {
    const d = examples();
    writePatch(join(d, "shared"), "P-006-rename.yaml", "id: P-006\ntitle: Rename\nstatus: proposed\nwhy: x\nops:\n  - { op: modify, kind: team, id: appsec-platform, set: { name: Application security platform } }\n");
    const name = (inst: ReturnType<typeof loadInstance>) => compile(inst).model.teams.find((t) => t.id === "org:appsec-platform")!.name;
    expect(name(loadInstance(join(d, "designs/intake")))).toBe("AppSec platform");
    const withP = loadRoot(join(d, "shared"), { with: "P-006" });
    expect(name(loadInstance(join(d, "designs/intake"), { root: withP }))).toBe("Application security platform");
    expect(name(loadInstance(join(d, "designs/intake"), { root: loadRoot(join(FX, "base/shared")) }))).toBe("AppSec platform"); // not its root: loads its own
  });

  testEx("a raise merges into a shipped contract's mark and leaves its floor; a set replaces a whole estimate", () => {
    const d = examples();
    writePatch(join(d, "shared"), "P-006-raise.yaml", `id: P-006
title: Raise the merge stamp
status: accepted
why: To show a raise.
ops:
  - { op: modify, kind: contract, id: MergeStamp, set: { security: { raised: { by: the head of security engineering, why: Stamps are audit evidence. } } } }
  - { op: modify, kind: team, id: org:product-eng, set: { capacity: { value: 3, source: person, by: the product engineering lead, as_of: "2026-11-10", confidence: high } } }
`);
    const root = loadRoot(join(d, "shared"));
    expect(root.shared!.contracts.find((c) => c.name === "MergeStamp")!.attrs!.security).toEqual({ relevant: true, floor: ["signed-record"], raised: { by: "the head of security engineering", why: "Stamps are audit evidence." } });
    expect(root.org!.teams.find((t) => t.id === "product-eng")!.attrs!.capacity).toEqual({ value: 3, source: "person", by: "the product engineering lead", as_of: "2026-11-10", confidence: "high" }); // the note went with the old estimate
  });
});

// ── estimates with provenance ───────────────────────────────────────────────────────────────────────────────────

describe("estimates with provenance", () => {
  const ok = { value: 0.2, source: "person", by: "the team A lead", as_of: "2026-11-02", confidence: "medium" };
  test("value, source, by, as_of and confidence are required; a share is 0 to 1, a capacity a whole number of at least 1", () => {
    expect(estimateProblems(ok, "share")).toEqual({ required: [], extra: [] });
    expect(normEstimate(ok, "share")).toEqual(ok as never);
    expect(normEstimate({ ...ok, as_of: new Date("2026-11-02T00:00:00Z") }, "share")!.as_of).toBe("2026-11-02"); // an unquoted YAML date
    for (const k of ["value", "source", "by", "as_of", "confidence"]) {
      const { [k]: _gone, ...rest } = ok as Record<string, unknown>;
      expect(estimateProblems(rest, "share").required.length).toBe(1);
      expect(normEstimate(rest, "share")).toBeUndefined();
    }
    expect(estimateProblems({ ...ok, value: 1.2 }, "share").required).toEqual(["has value 1.2, and a share is between 0 and 1"]);
    expect(estimateProblems({ ...ok, value: 2.5 }, "capacity").required).toEqual(["has value 2.5, and a capacity is a whole number of at least 1"]);
    expect(estimateProblems({ ...ok, value: 0 }, "capacity").required).toEqual(["has value 0, and a capacity is a whole number of at least 1"]);
    expect(estimateProblems({ ...ok, source: "guess" }, "share").required).toEqual([`has source "guess", which is not person, agent, tracker or derived`]);
    expect(estimateProblems({ ...ok, confidence: "very" }, "share").required).toEqual([`has confidence "very", which is not low, medium or high`]);
    expect(estimateProblems({ ...ok, as_of: "Nov 2" }, "share").required).toEqual([`has as_of "Nov 2", which is not a date (YYYY-MM-DD)`]);
    // a stated figure or a history entry that is not whole is a problem, and leaves the value in force standing
    const p = estimateProblems({ ...ok, stated: { value: 0.1 }, history: [{ value: 0.3 }] }, "share");
    expect(p.required).toEqual([]);
    expect(p.extra).toEqual(["its stated figure does not say who stated it (by)", "its history entry 1 has no as_of date (YYYY-MM-DD)"]);
    expect(normEstimate({ ...ok, stated: { value: 0.1, by: "x", as_of: "2026-10-01" } }, "share")!.stated).toEqual({ value: 0.1, by: "x", as_of: "2026-10-01" });
  });

  testEx("history: the record's own, then the file's value, then each accepted patch in order, with provenance and decision", async () => {
    const d = examples();
    const { bundle } = await buildRoot(join(d, "shared"), { built: BUILT });
    const est = (rec: string, field: string) => bundle.org!.estimates.find((e) => e.record === rec && e.field === field)!;
    const appsec = est("org:appsec-platform", "capacity");
    expect(appsec.history.map((h) => [h.value, h.as_of, h.from, h.patch])).toEqual([[7, "2026-05-04", "history", undefined], [6, "2026-08-03", "file", undefined], [5, "2026-09-14", "patch", "P-001"]]);
    expect(appsec.history[2].decision).toEqual({ by: "the program lead", at: "2026-09-15", reason: "Stated by the team's lead, who owns the row." });
    expect(appsec.value!.value).toBe(5);
    expect(est("org:vuln-mgmt", "capacity").history.map((h) => h.value)).toEqual([5, 4, 3]);
    const triage = est("org:vuln-triage", "share");
    expect(triage.history.map((h) => [h.value, h.from, h.patch])).toEqual([[0.25, "file", undefined], [0.34, "patch", "P-004"]]);
    expect(triage.history[1].stated).toEqual({ value: 0.25, by: "the vulnerability management lead", as_of: "2026-09-14" });
    expect(triage.history[1].provenance?.agent).toEqual({ tool: "Claude Code", name: "org-scout" });
    // two accepted patches on one field apply in natural id order: P-9 before P-10
    for (const [id, v, day] of [["P-10", 0.3, "2026-11-12"], ["P-9", 0.2, "2026-11-11"]] as const)
      writePatch(join(d, "shared"), `${id}.yaml`, `id: ${id}\ntitle: Pen test share\nstatus: accepted\nwhy: Restated.\nops:\n  - { op: modify, kind: activity, id: pentest-coordination, set: { share: { value: ${v}, source: person, by: the AppSec platform lead, as_of: "${day}", confidence: medium } } }\n`);
    const again = await buildRoot(join(d, "shared"), { built: BUILT });
    expect(again.bundle.org!.estimates.find((e) => e.record === "org:pentest-coordination" && e.field === "share")!.history.map((h) => [h.value, h.patch])).toEqual([[0.1, undefined], [0.2, "P-9"], [0.3, "P-10"]]);
  });

  test("estimateHistory reads a record an accepted patch added from that patch alone", () => {
    const patches = [{ id: "P-1", title: "t", status: "accepted" as const, why: "", ops: [], file: "patches/P-1.yaml" }];
    const results = { "patches/P-1.yaml": { added: [], removed: [], modified: [], cascade: [], errors: [], namespaces: [], sets: [{ kind: "activity" as const, id: "a", field: "share", value: { value: 0.4, as_of: "2026-11-01", source: "person", by: "x", confidence: "low" }, op: "add" as const }] } };
    expect(estimateHistory(undefined, "share", { kind: "activity", id: "a", field: "share" }, patches, ["P-1"], results).map((h) => [h.value, h.from, h.patch])).toEqual([[0.4, "patch", "P-1"]]);
  });

  testEx("a proposed patch shows under each number it would change, naming its agent; a row value its owner did not state is marked", async () => {
    const { bundle } = await buildRoot(join(examples(), "shared"), { built: BUILT });
    const shares = bundle.org!.estimates.filter((e) => e.field === "share");
    expect(shares.map((e) => [e.record, e.pending.map((p) => [p.patch, (p.value as { value: number }).value, p.agent])])).toEqual([
      ["org:audit-evidence", [["P-005", 0.24, "org-scout"]]], ["org:incident-oncall", [["P-005", 0.52, "org-scout"]]],
      ["org:pentest-coordination", [["P-005", 0.12, "org-scout"]]], ["org:questionnaires", [["P-005", 0.28, "org-scout"]]],
      ["org:scanner-rule-upkeep", [["P-005", 0.2, "org-scout"]]], ["org:vuln-triage", [["P-005", 0.38, "org-scout"]]],
    ]);
    const caps = bundle.org!.estimates.filter((e) => e.field === "capacity");
    expect(caps.filter((e) => e.rowOwner && !e.rowOwner.statedByOwner).map((e) => e.record)).toEqual(["org:governance-risk"]);
    expect(caps.find((e) => e.record === "org:governance-risk")!.rowOwner).toEqual({ owner: "the governance and risk lead", statedByOwner: false });
  });

  testEx("stale at the build date, against the root's estimates.stale_after_days", async () => {
    const d = examples();
    let r = await rootCheck(d);
    expect(r.findings.map((f) => [`${f.pack}/${f.rule}`, f.severity, f.at])).toEqual([["org/estimate-stale", "warning", "org:dev-platform"]]);
    expect(r.check.org!.estimates.find((e) => e.record === "org:dev-platform")).toMatchObject({ ageDays: 119, stale: true });
    edit(join(d, "shared/engine.yaml"), (s) => s.replace("stale_after_days: 90", "stale_after_days: 200"));
    r = await rootCheck(d);
    expect(r.findings.map((f) => [`${f.pack}/${f.rule}`, f.severity, f.at])).toEqual([]);
  });
});

// ── activities, slowdowns, exceptions ────────────────────────────────────────────────────────────────────────────

describe("activities, slowdowns and exceptions", () => {
  testEx("the example's activities, reliefs and catalog links read as written", async () => {
    const r = await rootCheck(examples());
    const a = r.check.org!.activities;
    expect(a.map((x) => [x.id, x.team, x.type, x.share?.value, x.manual_work ?? null])).toEqual([
      ["vuln-triage", "org:vuln-mgmt", "bau", 0.34, "shared:finding-triage"], ["pentest-coordination", "org:appsec-platform", "bau", 0.1, null],
      ["incident-oncall", "org:detection-response", "bau", 0.4, null], ["audit-evidence", "org:governance-risk", "bau", 0.25, "shared:evidence-gathering"],
      ["scanner-rule-upkeep", "org:appsec-platform", "bau", 0.17, "shared:rule-tuning"], ["questionnaires", "org:governance-risk", "stream", 0.2, null],
    ]);
    expect(a[0].relieved_by.map((x) => [x.at, x.effect, x.to?.value ?? null])).toEqual([["intake:U-09", "reduce", 0.12], ["intake:U-14", "retire", null]]);
  });

  testEx("a slowdown is in force from its start until it ends, and only when it is whole", async () => {
    const d = examples();
    const r = await rootCheck(d, ["intake"]);
    const sd = r.check.org!.slowdowns[0];
    expect(sd).toMatchObject({ id: "SD-1", activity: "org:vuln-triage", valid: true, until: "intake:M2", accepted_by: ["the security risk owner", "the business risk owner"] });
    const c = compose(d, ["intake"]);
    expect([slowdownInForce(sd, "2026-11-14", c), slowdownInForce(sd, "2026-11-16", c), slowdownInForce(sd, "2027-04-01", c)]).toEqual([false, true, false]); // max_until 2027-03-31
    const bad = await rootCheck(fixture("slowdown-valid"));
    expect(bad.check.org!.slowdowns[0].valid).toBe(false);
    expect(slowdownInForce(bad.check.org!.slowdowns[0], "2026-11-16")).toBe(false);
  });

  test("a slowdown whose ending milestone is late is overdue where its design is composed", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (s) => s.replace("slowdowns: []", `slowdowns:
  - id: SD-2
    activity: chores
    what: Chores once a week.
    share_during: { value: 0.1, source: person, by: the team A lead, as_of: "2026-12-01", confidence: medium }
    from: "2026-12-01"
    until: alpha:A1
    risk: { rises: Chores pile up. }
    accepted_by: [the security risk owner]
    accepted_at: "2026-12-01"`));
    const late = "2026-12-20T09:00:00Z"; // A1's target is 2026-12-15 and its units are not done
    expect(of((await checkRoot(join(d, "shared"), { built: late })).findings, "org/slowdown-overdue")).toEqual([]); // alpha not composed: cannot tell
    const withAlpha = await checkRoot(join(d, "shared"), { built: late, compose: compose(d, ["alpha", "beta"]) });
    expect(of(withAlpha.findings, "org/slowdown-overdue").map((f) => f.message)).toEqual(["The slowdown SD-2 on Chores: its ending milestone alpha:A1 was due 2026-12-15 and is not reached. Record its end, or review it and write a new review_by"]);
  });

  testEx("exceptions: the organization's list replaces the shipped default, an empty list declines it, and an ended one stops applying", async () => {
    const d = examples();
    let r = await rootCheck(d);
    const ex = r.check.org!.exceptions;
    expect(ex["intake-premerge"].map((e) => [e.source, e.contracts, e.accepted_by, e.until, e.valid])).toEqual([["default", ["shared:CheckYield"], "the security risk owner", "intake:M2", true]]);
    expect(ex["intake:autotriage"].map((e) => [e.source, e.contracts, e.until, e.valid])).toEqual([["org", ["intake:TriageHint"], "2027-01-29", true]]);
    expect(ex["inventory-intake"]).toEqual([]);
    expect(exceptionInForce(ex["intake:autotriage"][0], "2027-01-29")).toBe(true);
    expect(exceptionInForce(ex["intake:autotriage"][0], "2027-01-30")).toBe(false);
    edit(join(d, "shared/org.yaml"), (s) => s.replace(`seam_exceptions:\n`, `seam_exceptions:\n  intake-premerge: []\n`));
    r = await rootCheck(d);
    expect(r.check.org!.exceptions["intake-premerge"]).toEqual([]);
    expect(r.check.org!.declined).toEqual(["intake-premerge"]);
  });

  testEx("exception patches: append one, decline a default with an empty list, replace a list, and remove one to restore the default", async () => {
    const d = examples();
    const root = join(d, "shared");
    writePatch(root, "P-006-ex.yaml", `id: P-006
title: Exceptions
status: accepted
why: To show the exception ops.
ops:
  - { op: add, kind: exception, value: { seam: intake:autotriage, contracts: [intake:Finding], accepted_by: the head of vulnerability management, until: "2027-02-26", why: The queue moves. } }
  - { op: add, kind: exception, value: { seam: shared:intake-premerge, exceptions: [] } }
`);
    let r = await checkRoot(root, { built: BUILT });
    expect(r.check.org!.exceptions["intake:autotriage"].map((e) => [e.index, e.contracts])).toEqual([[1, ["intake:TriageHint"]], [2, ["intake:Finding"]]]);
    expect(r.check.org!.exceptions["intake-premerge"]).toEqual([]);
    expect(r.check.org!.declined).toEqual(["intake-premerge"]);
    writePatch(root, "P-007-ex.yaml", `id: P-007
title: Exceptions again
status: accepted
why: To show replace and remove.
ops:
  - { op: modify, kind: exception, id: intake-premerge, set: { exceptions: [{ contracts: [CheckYield], accepted_by: the head of security engineering, until: "2027-03-01", why: Still wiring. }] } }
  - { op: remove, kind: exception, id: intake:autotriage }
`);
    r = await checkRoot(root, { built: BUILT });
    expect(r.check.org!.exceptions["intake-premerge"].map((e) => [e.source, e.accepted_by])).toEqual([["org", "the head of security engineering"]]);
    expect(r.check.org!.exceptions["intake:autotriage"]).toBeUndefined();
    expect(r.findings.filter((f) => f.pack === "core")).toEqual([]);
  });

  testEx("an exception names contracts its seam carries; a module seam's are judged where its design is composed", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (s) => s.replace("seam_exceptions: {}", `seam_exceptions:
  alpha-beta:
    - { contracts: [HubEvent], accepted_by: the head of security engineering, until: "2027-01-31", why: Wiring. }`));
    const r = await rootCheck(d);
    expect(of(r.findings, "org/exception-valid").map((f) => [f.at, f.message])).toEqual([["shared:alpha-beta", "The organization's exception on the seam alpha-beta names shared:HubEvent, which its seam does not carry; it does not apply"]]);
    expect(r.check.org!.exceptions["alpha-beta"][0].valid).toBe(false);
    // intake's module seam carries Finding and TriageHint, by the crossings it names and the edges across it
    const e = examples();
    edit(join(e, "shared/org.yaml"), (s) => s.replace("contracts: [intake:TriageHint]", "contracts: [intake:TriageHint, intake:ClassOracle]"));
    expect(of((await rootCheck(e)).findings, "org/exception-valid")).toEqual([]); // intake not composed: not judged
    expect(of((await rootCheck(e, ["intake"])).findings, "org/exception-valid").map((f) => f.message)).toEqual(["The organization's exception on the seam intake:autotriage names intake:ClassOracle, which its seam does not carry; it does not apply"]);
  });

  test("references inside the root that resolve nowhere are core/xref-resolves", async () => {
    const d = fixture();
    edit(join(d, "shared/org.yaml"), (s) => s.replace("    team: team-a\n", "    team: team-z\n").replace("manual_work: chore-work", "manual_work: chore-wrk"));
    edit(join(d, "shared/org.yaml"), (s) => s.replace("seam_exceptions: {}", `seam_exceptions:\n  no-such-seam: []`));
    const r = await rootCheck(d);
    expect(of(r.findings, "core/xref-resolves").map((f) => [f.at, f.message])).toEqual([
      ["org:chores", "activity chores links the manual work chore-wrk, which the shared catalog does not hold"],
      ["org:chores", "activity chores names team team-z, which the org layer does not hold"],
      ["org:no-such-seam", "the org layer declares exceptions for the seam no-such-seam, which the shared layer does not hold (a design's own module seam is named <namespace>:<seam id>)"],
    ]);
  });
});

// ── the shared layer: marks and shape ──────────────────────────────────────────────────────────────────────────

describe("marks on what crosses (the one derivation)", () => {
  testEx("computeMarks covers the shared layer's crossings and every crossing in the designs, keyed canonically", async () => {
    const d = examples();
    const root = loadRoot(join(d, "shared"));
    const m = computeMarks(root, compose(d, ["intake", "premerge", "inventory"]));
    const line = (x: { relevant: boolean; floor: string[]; floor_source: string; raised?: { by?: string } }) => `${x.relevant} [${x.floor.join(" ")}] ${x.floor_source}${x.raised ? ` raised by ${x.raised.by}` : ""}`;
    expect(Object.fromEntries(Object.entries(m.crossings).map(([k, v]) => [k, line(v)]))).toEqual({
      "intake:r05": "true [model-boundary] engine signal: model-boundary", // into the triage agent, at a model boundary
      "intake:r07": "true [untrusted-fields] engine signal: untrusted-fields",
      "intake:r08": "true [untrusted-fields] engine signal: untrusted-fields",
      "inventory:v01": "true [untrusted-content untrusted-fields] engine signal: untrusted-content, untrusted-fields",
      "premerge:p12": "false [] engine signal: none",
      "shared:x01": "true [agent-input] shipped",
      "shared:x02": "true [signed-record] shipped",
      "shared:x03": "true [] shipped raised by the shared layer's authors",
      "shared:x04": "false [] shipped",
      "shared:x05": "true [outsider-text] shipped",
      "shared:x06": "true [gate-feed] shipped",
      "shared:x07": "true [] engine signal: none raised by the head of security engineering" });
    expect(Object.keys(m.contracts)).toEqual(["intake:Finding", "intake:TriageHint", "inventory:RepoMetadata", "premerge:YieldBadge", "shared:AssetOwnership", "shared:CheckResult", "shared:CheckYield", "shared:MergeRequest", "shared:MergeStamp", "shared:ProvenClass", "shared:RepoOwners"]);
    expect(m.contracts["inventory:RepoMetadata"]).toEqual({ relevant: true, floor: ["untrusted-content", "untrusted-fields"], floor_source: "engine signal: untrusted-content, untrusted-fields" });
    expect(m.contracts["shared:AssetOwnership"]).toEqual({ relevant: true, floor: [], floor_source: "engine signal: none", raised: { by: "the head of security engineering", why: "A wrong owner sends a finding to a queue nobody reads." } });
  });

  testEx("one design: its own compiled model, with far ends marked from the seam's exposure", async () => {
    const d = examples();
    const root = loadRoot(join(d, "shared"));
    const { bundle: b } = await buildBundle(join(d, "designs/intake"), { built: BUILT });
    const own: ComposedDesign = { namespace: "intake", dir: join(d, "designs/intake"), title: b.instance.title, model: b.model, plan: b.plan, pins: [] };
    const m = computeMarks(root, [own]);
    expect(Object.keys(m.crossings)).toEqual(["intake:r05", "intake:r07", "intake:r08", "shared:x01", "shared:x02", "shared:x03", "shared:x04", "shared:x05", "shared:x06", "shared:x07"]);
    expect(m.crossings["shared:x01"].relevant).toBe(true);
    // the far end of x01 reached through intake's exposure list: an organization's own crossing into it would read agent-reach
    const x: Relationship = { id: "y1", from: "intake:class-registry", to: "premerge:check-runner", kind: "data", carries: ["shared:RepoOwners"] };
    const rootModel = { elements: [...b.model.elements.filter((e) => e.home).map((e) => e)], contracts: [] };
    expect(crossingSignals(x, rootModel)).toEqual(["agent-reach"]);
  });

  test("the shipped floor is authoritative, even empty; the engine's signals give a provisional floor only to what the shipped file never held", async () => {
    const d = fixture();
    // beta's entry part becomes agent-reachable through the seam's exposure: Spec (shipped floor []) stays not relevant
    edit(join(d, "shared/seams.yaml"), (s) => s.replace("exposure: { alpha: [], beta: [] }", "exposure: { alpha: [beta:b-in], beta: [] }"));
    writePatch(join(d, "shared"), "P-001-org-feed.yaml", `id: P-001
title: The organization's own feed into the sandbox
status: accepted
why: To show a provisional floor.
ops:
  - { op: add, kind: contract, value: { name: Hint, description: A hint., produced_by: [alpha:a-out], consumed_by: [sandbox] } }
  - { op: add, kind: relationship, value: { id: s4, from: alpha:a-out, to: sandbox, kind: data, carries: [Hint] } }
`);
    const root = loadRoot(join(d, "shared"));
    const m = computeMarks(root, []);
    expect(m.contracts["shared:Spec"]).toEqual({ relevant: false, floor: [], floor_source: "shipped" });
    expect(m.crossings["shared:s1"]).toEqual({ relevant: false, floor: [], floor_source: "shipped" });
    expect(m.contracts["shared:Hint"]).toEqual({ relevant: true, floor: ["agent-reach"], floor_source: "engine signal: agent-reach" });
    expect(m.crossings["shared:s4"]).toEqual({ relevant: true, floor: ["agent-reach"], floor_source: "engine signal: agent-reach" });
  });

  test("crossingSignals: each signal alone", () => {
    const el = (id: string, attrs: Record<string, unknown> = {}, kind = "service") => ({ id, name: id, kind, attrs });
    const model = {
      elements: [el("a"), el("agent", { agent_reachable: true }), el("auth", { grants_authority: true }), el("llm", { model_boundary: true }), el("vault", { partitioned_by: ["tenant"] }, "store"), el("plain")],
      contracts: [{ name: "Plain" }, { name: "Text", attrs: { untrusted_fields: ["body"] } }, { name: "Proof", attrs: { evidence_content: true } }, { name: "ValidationRecord", attrs: { evidence_content:true } }] };
    const rel = (to: string, carries: string[], attrs?: Record<string, unknown>): Relationship => ({ id: "r", from: "a", to, kind: "data", carries, ...(attrs ? { attrs } : {}) });
    expect(crossingSignals(rel("plain", ["Plain"]), model)).toEqual([]);
    expect(crossingSignals(rel("agent", ["Plain"]), model)).toEqual(["agent-reach"]);
    expect(crossingSignals(rel("plain", ["Plain"], { content: "untrusted" }), model)).toEqual(["untrusted-content"]);
    expect(crossingSignals(rel("plain", ["Text"]), model)).toEqual(["untrusted-fields"]);
    expect(crossingSignals(rel("vault", ["Proof"]), model)).toEqual(["evidence-partitioned"]);
    expect(crossingSignals(rel("vault", ["ValidationRecord"]), model)).toEqual(["evidence-partitioned"]); // a design-classified evidence contract
    expect(crossingSignals(rel("plain", ["Proof"]), model)).toEqual([]);                                      // evidence, not into a partitioned store
    expect(crossingSignals(rel("auth", ["Plain"]), model)).toEqual(["grants-authority"]);
    expect(crossingSignals(rel("llm", ["Plain"]), model)).toEqual(["model-boundary"]);
    expect(crossingSignals(rel("plain", ["Plain", "Text"]), model, "Plain")).toEqual([]);                      // one contract's own signals only
  });

  test("shared/mark-valid: a lowered mark, a raise with no why, relevant above an empty floor, and a floor a patch writes", async () => {
    const d = fixture();
    writePatch(join(d, "shared"), "P-001-marks.yaml", `id: P-001
title: Four marks
status: accepted
why: To show the refusals.
ops:
  - { op: modify, kind: contract, id: Task, set: { security: { relevant: false } } }
  - { op: modify, kind: contract, id: Spec, set: { security: { raised: { by: the team A lead } } } }
  - { op: modify, kind: contract, id: HubEvent, set: { security: { relevant: true } } }
  - { op: modify, kind: relationship, id: s2, set: { security: { floor: [made-up] } } }
`);
    const r = await rootCheck(d);
    expect(of(r.findings, "shared/mark-valid").map((f) => [f.at, f.atKind, f.message])).toEqual([
      ["shared:HubEvent", "contract", "The contract HubEvent is marked security-relevant above an empty floor with no raise saying who and why; write the raise as security.raised: { by, why }"],
      ["shared:Spec", "contract", "The contract Spec is raised with no why: a raise says who raised it and why (security.raised: { by, why })"],
      ["shared:Task", "contract", "The contract Task is marked not security-relevant, below its floor (agent-input, shipped); a mark is never lowered, so this one is ignored and it stays relevant"],
      ["shared:s2", "relationship", "The crossing s2 has a floor (made-up) that the shipped file does not record (none); a floor comes from the checks and is never written by hand, so raise the mark with security.raised: { by, why } instead"],
    ]);
    expect(r.check.marks.contracts["shared:Task"].relevant).toBe(true);
    expect(r.check.marks.contracts["shared:HubEvent"].relevant).toBe(true); // nothing lowers
  });

  test("ROOT-contracts: shipped and organization crossings need a contract or a written reason", async () => {
    const d = fixture();
    writePatch(join(d, "shared"), "P-001-crossings.yaml", `id: P-001
title: Crossings
status: accepted
why: To show the checks.
ops:
  - { op: add, kind: relationship, value: { id: s5, from: alpha:a-out, to: beta:b-out, kind: data } }
  - { op: add, kind: relationship, value: { id: s6, from: alpha:a-in, to: beta:b-in, kind: data, carries: [alpha:Secret, Nothing] } }
  - { op: add, kind: seam, value: { id: alpha-hub, between: [alpha, shared:hub], owner_role: the seam owner } }
  - { op: add, kind: relationship, value: { id: s7, from: alpha:a-out, to: hub, kind: data } }
  - { op: add, kind: relationship, value: { id: s8, from: alpha:a-out, to: sandbox, kind: control, no_contract: "A trigger only; nothing in it is read as a fact." } }
`);
    const r = await rootCheck(d);
    expect(of(r.findings, "shared/crossing-valid").map((f) => [f.at, f.message])).toEqual([
      ["shared:s5", "The crossing s5 (alpha:a-out to beta:b-out) carries no contract across the seam alpha-beta and gives no written reason why none is needed; add a contract or a non-empty no_contract reason"],
      ["shared:s6", "The crossing s6 (alpha:a-in to beta:b-in) carries alpha:Secret across the seam alpha-beta, whose never_cross list holds it; carries alpha:Secret and shared:Nothing, which the shared layer does not define; every contract that crosses is defined once in the shared layer"],
      ["shared:s7", "The crossing s7 (alpha:a-out to hub) carries no contract across the seam alpha-hub and gives no written reason why none is needed; add a contract or a non-empty no_contract reason"],
    ]);
    const patch = join(d, "shared/patches/P-001-crossings.yaml");
    edit(patch, (s) => s + `  - { op: modify, kind: relationship, id: s5, set: { no_contract: "A trigger only; nothing in it is read as a fact." } }
  - { op: modify, kind: relationship, id: s6, set: { no_contract: "This reason cannot excuse a forbidden or undefined contract." } }
  - { op: modify, kind: relationship, id: s7, set: { attrs: { no_contract: "A control action carrying no record." } } }
`);
    const reasoned = await rootCheck(d);
    expect(of(reasoned.findings, "shared/crossing-valid").map((f) => f.at)).toEqual(["shared:s6"]);
    expect(reasoned.check.marks.crossings["shared:s5"]).toEqual(r.check.marks.crossings["shared:s5"]);
    expect(reasoned.check.marks.crossings["shared:s7"]).toEqual(r.check.marks.crossings["shared:s7"]);
    expect(reasoned.check.marks.crossings["shared:s8"]).toMatchObject({ relevant: true, floor: ["agent-reach"] });
    for (const reason of ["", "   ", false, 42, ["a reason"], { why: "a reason" }]) {
      edit(patch, (s) => s + `  - { op: modify, kind: relationship, id: s7, set: { attrs: { no_contract: ${JSON.stringify(reason)} } } }\n`);
      expect(of((await rootCheck(d)).findings, "shared/crossing-valid").map((f) => f.at)).toContain("shared:s7");
    }
  });

  test("ROOT-floor: additive and empty patch floors are refused and ignored; a reasoned raise adds relevance", async () => {
    const d = fixture();
    writePatch(join(d, "shared"), "P-001-floors.yaml", `id: P-001
title: Written floors
status: accepted
why: To pin the floor refusals.
ops:
  - { op: modify, kind: contract, id: Task, set: { security: { floor: [] } } }
  - { op: modify, kind: contract, id: Spec, set: { security: { floor: [added-rule] } } }
  - { op: modify, kind: contract, id: HubEvent, set: { security: { raised: { by: the seam owner, why: "A wrong event starts the wrong run." } } } }
`);
    const r = await rootCheck(d);
    const fs = of(r.findings, "shared/mark-valid");
    expect(fs.map((f) => [f.at, f.severity])).toEqual([["shared:Spec", "error"], ["shared:Task", "error"]]);
    expect(fs.every((f) => f.message.includes("raise the mark with security.raised: { by, why } instead"))).toBe(true);
    expect(r.check.marks.contracts["shared:Task"]).toMatchObject({ relevant: true, floor: ["agent-input"] });
    expect(r.check.marks.contracts["shared:Spec"]).toMatchObject({ relevant: false, floor: [] });
    expect(r.check.marks.contracts["shared:HubEvent"]).toMatchObject({ relevant: true, raised: { by: "the seam owner" } });
  });
});

// ── notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("notes pin to records of both namespaces", () => {
  testEx("the example's notes name an org activity and a shared contract, canonically", async () => {
    const { bundle } = await buildRoot(join(examples(), "shared"), { built: BUILT });
    expect(bundle.notes!.items.map((n) => [n.id, n.target.kind, n.target.id])).toEqual([["N-1", "activity", "org:vuln-triage"], ["N-2", "contract", "shared:CheckYield"]]);
    expect(of(bundle.findings, "notes/target-exists")).toEqual([]);
    expect(bundle.root.packs.map((p) => p.name)).toEqual(["org", "shared", "tracker", "notes"]); // Out-of-scope links produce no root findings or extra pack.
  });

  testEx("a note on a record the root does not hold is notes/target-exists; one on a design's kind is a problem", async () => {
    const d = examples();
    edit(join(d, "shared/notes.yaml"), (s) => s.replace("target: { kind: activity, id: vuln-triage }", "target: { kind: slowdown, id: SD-9 }") + `  - id: N-3
    target: { kind: unit, id: U-1 }
    kind: note
    text: A unit belongs to a design.
    status: open
    author: person
    created: "2026-11-05T09:00:00Z"
    updated: "2026-11-05T09:00:00Z"
`);
    const root = loadRoot(join(d, "shared"));
    expect(root.notes!.problems).toEqual(["notes.yaml N-3: a note in the root is pinned to a record of the shared or org layer (element, relationship, contract, claim, seam, capability, system, zone, manual-work, team, activity, slowdown, exception, patch, finding), not a unit"]);
    const r = await checkRoot(root, { built: BUILT });
    expect(of(r.findings, "notes/target-exists").map((f) => [f.at, f.message])).toEqual([["N-1", "Question N-1 is pinned to slowdown org:SD-9, which no longer exists"], ["N-3", "Note N-3 is pinned to unit U-1, which no longer exists"]]);
  });
});

// ── the root's own build ─────────────────────────────────────────────────────────────────────────────────────────

describe("the root's own build", () => {
  test("ROOT-rowowner: an explicit row owner changes the model hash; a default lead does not", () => {
    const d = fixture(), path = join(d, "shared/org.yaml");
    const base = readFileSync(path, "utf8");
    const hash = () => loadRoot(join(d, "shared")).modelHash;
    const original = hash();
    writeFileSync(path, base.replace("row_owner: the team A lead", "row_owner: the capacity owner"));
    expect(hash()).not.toBe(original);
    writeFileSync(path, base.replace("    row_owner: the team A lead\n", ""));
    const defaultOwner = hash();
    expect(readOrgView(loadRoot(join(d, "shared")), { today: BUILT.slice(0, 10) })!.teams.find((t) => t.id === "team-a")!.row_owner).toBe("the team A lead");
    writeFileSync(path, readFileSync(path, "utf8").replace("lead: the team A lead", "lead: the new team lead"));
    expect(hash()).toBe(defaultOwner);
  });

  testEx("the root's model hash leaves leads and estimate notes out; patches move only its content hash", () => {
    const d = examples();
    const at = () => { const r = loadRoot(join(d, "shared")); return [r.modelHash, r.hash]; };
    const [m0, h0] = at();
    edit(join(d, "shared/org.yaml"), (s) => s.replace("lead: the AppSec platform lead", "lead: A. Person").replace("note: Two analysts moved to the incident rotation in September.", "note: Reworded."));
    const [m1, h1] = at();
    expect(m1).toBe(m0);
    expect(h1).toBe(h0);
    edit(join(d, "shared/org.yaml"), (s) => s.replace(`capacity: { value: 4, source: person, by: the detection and response lead`, `capacity: { value: 5, source: person, by: the detection and response lead`));
    const [m2] = at();
    expect(m2).not.toBe(m0);
    writePatch(join(d, "shared"), "P-006-x.yaml", "id: P-006\ntitle: x\nstatus: proposed\nwhy: x\nops: []\n");
    const [m3, h3] = at();
    expect(m3).toBe(m2);
    expect(h3).not.toBe(h1);
  });

  testEx("the example root reports exactly what examples/expected.yaml gives its rules, in both views and with P-005", async () => {
    const d = examples();
    const exp = Bun.YAML.parse(readFileSync(join(EX, "expected.yaml"), "utf8")) as { findings: { rule: string; severity: string; subject: string }[] };
    const mine = exp.findings.filter((f) => /^(org|shared)\//.test(f.rule)).map((f) => `${f.rule} ${f.severity} ${f.subject.split(" ")[0]}`);
    expect(mine).toEqual(["org/estimate-stale warning org:dev-platform"]);
    const got = (fs: Finding[]) => fs.map((f) => `${f.pack}/${f.rule} ${f.severity} ${f.at}`);
    expect(got((await rootCheck(d, ["intake", "premerge", "inventory"])).findings)).toEqual([...mine, "premises/links-valid warning PL-004"]);
    expect(got((await rootCheck(d)).findings)).toEqual(mine);
    expect(got((await rootCheck(d, ["intake", "premerge", "inventory"], { with: "P-005" })).findings)).toEqual([...mine, "premises/links-valid warning PL-004"]); // P-005 adds a capacity warning, which is the portfolio's
  });

  test("every broken variant for root rules fires its one rule and nothing else; each design's own build stays clean", async () => {
    const owned = ["estimate-valid", "estimate-stale", "shares-exceed-capacity", "slowdown-valid", "slowdown-overdue", "exception-valid", "mark-valid", "crossing-valid", "file-intact"];
    const base = fixture();
    expect((await rootCheck(base, ["alpha", "beta"])).findings).toEqual([]);
    for (const v of owned) {
      const d = fixture(v);
      const spec = Bun.YAML.parse(readFileSync(join(FX, "variants", v, "variant.yaml"), "utf8")) as { expect: { rule: string; severity: string; subject: string }[] };
      const r = await rootCheck(d, ["alpha", "beta"]);
      const want = spec.expect.map((e) => `${e.rule} ${e.severity} ${e.subject.split(" ")[0]}`);
      expect([v, r.findings.map((f) => `${f.pack}/${f.rule} ${f.severity} ${f.at === "seams.yaml" ? "shared" : f.at}`)]).toEqual([v, want]);
      for (const n of ["alpha", "beta"]) {
        const { bundle } = await buildBundle(join(d, "designs", n), { built: BUILT });
        expect([v, n, keys(bundle.findings)]).toEqual([v, n, []]);
      }
    }
  });

  test("what each finding says, for the variants", async () => {
    const msg = async (v: string) => (await rootCheck(fixture(v), ["alpha", "beta"])).findings.map((f) => f.message);
    expect(await msg("estimate-valid")).toEqual(["Team B (org:team-b): its capacity has no confidence (low, medium or high); it counts as not stated"]);
    expect(await msg("estimate-stale")).toEqual(["Team B (org:team-b): its capacity is from 2026-06-01, 168 days before the build date, older than estimates.stale_after_days (90); ask the team B lead to state it again, or refresh it from the tracker"]);
    expect(await msg("shares-exceed-capacity")).toEqual(["Team B (org:team-b): its activities take 1 of its capacity (Support rotation 0.6, Upkeep 0.4), so keeping the lights on and other streams leave nothing for design work"]);
    expect(await msg("slowdown-valid")).toEqual(["The slowdown SD-1 on Chores names no one who accepted it (accepted_by); it is not applied"]);
    expect(await msg("slowdown-overdue")).toEqual(["The slowdown SD-1 on Chores: its review date, 2026-11-01, has passed. Record its end, or review it and write a new review_by"]);
    expect(await msg("exception-valid")).toEqual(["The organization's exception on the seam alpha-beta names no risk acceptor (accepted_by); it does not apply"]);
    expect(await msg("crossing-valid")).toEqual(["The crossing s1 (alpha:a-out to beta:b-in) carries shared:Spec across the seam alpha-beta, whose never_cross list holds it"]);
    expect((await msg("file-intact"))[0]).toMatch(/^seams\.yaml has sha256 [0-9a-f]{12}, and the root recorded [0-9a-f]{12} when the file was put here \(engine\.yaml shared_from\.sha256\): the shipped file was changed by hand/);
  });

  testEx("de check and de build take a root folder", async () => {
    const d = examples();
    const run = (args: string[]) => Bun.spawnSync(["bun", join(DE, "plumb.ts"), ...args], { cwd: DE });
    const c = run(["check", join(d, "shared")]);
    expect(c.exitCode).toBe(0);
    expect(c.stdout.toString()).toStartWith("# Checks: Example shared root\n");
    const out = join(d, "out");
    const b = run(["build", join(d, "shared"), "--out", out]);
    expect(b.exitCode).toBe(0);
    const j = JSON.parse(readFileSync(join(out, "root.json"), "utf8"));
    expect(j.root).toMatchObject({ kind: "root", name: "example-root", title: "Example shared root", approver: "the program lead" });
    expect(j.engine.modelHash).toBe(loadRoot(join(d, "shared")).modelHash);
  });


  testEx("readOrgView needs no design: a root's org layer reads alone", () => {
    const v = readOrgView(loadRoot(join(examples(), "shared")), { today: "2026-11-16" })!;
    expect(v.teams.map((t) => [t.id, t.capacity?.value, t.row_owner])).toEqual([
      ["appsec-platform", 5, "the AppSec platform lead"], ["vuln-mgmt", 3, "the vulnerability management lead"], ["detection-response", 4, "the detection and response lead"],
      ["product-eng", 2, "the product engineering lead"], ["dev-platform", 3, "the developer platform lead"], ["governance-risk", 4, "the governance and risk lead"],
    ]);
  });
});
