// Composition and the lock; the portfolio's check and
// impact as data; crossings held in the shared layer, undeclared edges and module seams; exceptions applied; a design's
// own edge judged with the declared exposure; composed checks; split parity; portfolio/one-root.
//
// Marks come from computeMarks (src/core/shared.ts) and the root's patches apply in loadRoot, so these
// tests run on the real derivation and the real loader.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, PortfolioData, PortfolioFinding, Rule } from "../src/types.ts";
import { portfolioImpact, readLock, readPortfolio, runPortfolio, writeLock } from "../src/core/portfolio.ts";
import { seamReport } from "../src/core/seams.ts";
import { loadRoot } from "../src/core/root.ts";
import { loadInstance } from "../src/core/load.ts";
import { compile } from "../src/core/compile.ts";
import { buildBundle, modelHash } from "../src/core/bundle.ts";
import { buildContext, CORE_PACK, CORE_RULES_04, runRules } from "../src/core/rules.ts";
import { pack as security } from "../packs/security/index.ts";
import { renameIds, splitAtModule, toYaml } from "./seam04-helpers.ts";
import { } from "./instance-dirs.ts";

const DE = join(import.meta.dir, "..");
const EX = join(DE, "examples");
const FX = join(import.meta.dir, "fixtures/portfolio");
const BUILT = "2026-11-16T10:00:00Z";
const HAVE_EX = existsSync(join(EX, "portfolio/portfolio.yaml")); // tests that read the examples skip when those examples are absent
const Y = (p: string): any => Bun.YAML.parse(readFileSync(p, "utf8"));
const sha = (p: string) => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");
const edit = (p: string, f: (s: string) => string) => writeFileSync(p, f(readFileSync(p, "utf8")));
const yaml = (p: string, v: unknown) => writeFileSync(p, toYaml(v).trimStart() + "\n");

/** A temporary copy of the base portfolio fixture, with one variant laid over it (or none). */
function fixture(variant?: string): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-seam04-"));
  cpSync(join(FX, "base"), d, { recursive: true });
  if (variant) cpSync(join(FX, "variants", variant), d, { recursive: true });
  return d;
}
/** A temporary copy of the example portfolio. */
function example(): string {
  const d = mkdtempSync(join(tmpdir(), "plumb-seam04-ex-"));
  cpSync(EX, d, { recursive: true });
  return d;
}
/** After a hand edit to a fixture's seams.yaml: the root records the new hash, as rehash.ts does, so the file is intact. */
function rehash(d: string) {
  const e = join(d, "shared/engine.yaml");
  edit(e, (s) => s.replace(/sha256: [0-9a-f]{64}/, `sha256: ${sha(join(d, "shared/seams.yaml"))}`));
}
async function check(d: string, opts: Parameters<typeof runPortfolio>[1] = {}): Promise<PortfolioData> {
  return (await runPortfolio(join(d, "portfolio"), { built: BUILT, ...opts })).data;
}
const of = (fs: PortfolioFinding[], rule: string) => fs.filter((f) => `${f.pack}/${f.rule}` === rule);
const brief = (f: PortfolioFinding) => `${f.pack}/${f.rule} ${f.severity} ${f.subject}`;

/** Is a rule of the plan's on this branch yet (the core's, or a pack that lists it)? */
async function available(rule: string): Promise<boolean> {
  const [pack, id] = rule.split("/");
  if (pack === "core") return [...CORE_PACK.rules, ...CORE_RULES_04].some((r) => r.id === id);
  const p = join(DE, "packs", pack, "index.ts");
  if (!existsSync(p)) return false;
  const loaded = (await import(p)).pack;
  return ([...loaded.rules, ...(loaded.rules04 ?? [])] as Rule[]).some((r) => r.id === id);
}
/** Does a finding match an expectation of expected.yaml or a variant.yaml: rule and severity exactly, the subject by its id? */
function matches(exp: { rule: string; severity: string; subject: string }, f: PortfolioFinding): boolean {
  if (`${f.pack}/${f.rule}` !== exp.rule || f.severity !== exp.severity) return false;
  const token = String(exp.subject).split(/[\s(]/)[0];
  if (token.includes(":")) return f.subject === token || f.at === token;
  return f.design === token || f.subject === token || f.subject.split(/[\s(:]/)[0] === token;
}

// Seam and reference-resolution rules, which a portfolio check also surfaces from the designs' own builds
const OURS = ["core/xref-resolves", "core/xref-pin-stale", "core/xref-no-cycle", "core/deprecated-key", "core/schema-known", "core/one-home",
  "portfolio/seam-crossing-declared", "portfolio/no-cross-effort-cycle", "portfolio/one-root"];

describe.skipIf(!HAVE_EX)("the example portfolio (the README's expectations)", () => {
  const exp = HAVE_EX ? Y(join(EX, "expected.yaml")) : { findings: [], presenting_drops: [] };

  test("working: the seam findings and the stale pin, exactly, and nothing composed-only", async () => {
    const data = await check(example());
    const ours = data.findings.filter((f) => OURS.includes(`${f.pack}/${f.rule}`));
    const want = exp.findings.filter((x: any) => OURS.includes(x.rule));
    expect(want.length).toBe(4);
    expect(ours.length).toBe(want.length);
    for (const x of want) expect(ours.filter((f) => matches(x, f)).map(brief)).toHaveLength(1);
    const r08 = ours.find((f) => f.subject === "intake:r08")!;
    expect(r08.excepted_by).toBe("org exception on intake:autotriage");
    expect(ours.find((f) => f.rule === "xref-pin-stale")!.message).toContain("Check runner (check-runner)");
    expect(data.findings.filter((f) => f.composedOnly)).toEqual([]);
    expect(data.notes).toEqual([]);
    // the complete findings list matches expected.yaml
    if ((await Promise.all(exp.findings.map((x: any) => available(x.rule)))).every(Boolean)) {
      expect(data.findings.length).toBe(exp.findings.length);
      for (const x of exp.findings) expect(data.findings.filter((f) => matches(x, f))).toHaveLength(1);
    }
  });

  test("presenting composes premerge 1.0.0: the stale pin goes, the seam findings stay", async () => {
    const data = await check(example(), { mode: "presenting" });
    expect(exp.presenting_drops).toEqual(["core/xref-pin-stale"]);
    expect(of(data.findings, "core/xref-pin-stale")).toEqual([]);
    expect(of(data.findings, "portfolio/seam-crossing-declared").map((f) => `${f.subject} ${f.severity}`)).toEqual(["inventory:v01 error", "intake:r08 warning", "premerge:p12 warning"]);
    expect(data.designs.map((d) => [d.namespace, d.edition ?? "latest", d.label])).toEqual([
      ["intake", "latest", "no released edition; working copy shown"], ["premerge", "1.0.0", "1.0.0, released 2026-10-28"], ["inventory", "latest", "no released edition; working copy shown"],
    ]);
  });

  test("the seams: every crossing of the shared layer declared, with its mark; exceptions in force", async () => {
    const data = await check(example());
    const s = data.seams;
    expect(s.marksAvailable).toBe(true);
    expect(s.crossings.filter((c) => c.declared).map((c) => c.id)).toEqual(["intake:r05", "intake:r07", ...["x01", "x02", "x03", "x04", "x05", "x06", "x07"].map((x) => `shared:${x}`)]);
    expect(s.crossings.filter((c) => c.declaredBy === "module seam").map((c) => c.id)).toEqual(["intake:r05", "intake:r07"]);
    const seam = (k: string) => s.seams.find((x) => x.key === k)!;
    expect(seam("intake-premerge").crossings).toEqual(["shared:x01", "shared:x02", "shared:x03"]);
    expect(seam("inventory-intake").crossings).toEqual(["shared:x07"]); // the organization's seam, added by a root patch
    expect(seam("intake:autotriage")).toMatchObject({ kind: "module", design: "intake", between: ["core", "autotriage"], undeclared: ["intake:r08"] });
    expect(seam("intake-premerge").exceptions.map((e) => [e.source, e.state, e.contracts])).toEqual([["default", "in force", ["shared:CheckYield"]]]);
    expect(seam("intake:autotriage").exceptions.map((e) => [e.source, e.state, e.accepted_by, e.until])).toEqual([["org", "in force", "the head of vulnerability management", "2027-01-29"]]);
    expect(s.undeclared.map((c) => [c.id, c.severity, c.mark?.relevant])).toEqual([["inventory:v01", "error", true], ["intake:r08", "warning", true], ["premerge:p12", "warning", false]]);
    // a crossing between a design and a shared part sits on no seam
    expect(s.crossings.filter((c) => !c.seams.length).map((c) => c.id)).toEqual(["inventory:v01", "premerge:p12", "shared:x04", "shared:x05", "shared:x06"]);
  });

  test("each seam finding also shows in its design's own build, and the portfolio reports it once", async () => {
    const d = example();
    const run = await runPortfolio(join(d, "portfolio"), { built: BUILT });
    const own = (ns: string) => run.designs.find((x) => x.namespace === ns)!.findings.filter((f) => f.rule === "seam-crossing-declared").map((f) => `${f.at} ${f.severity}`);
    expect(own("inventory")).toEqual(["v01 error"]);
    expect(own("intake")).toEqual(["r08 warning"]);
    expect(own("premerge")).toEqual(["p12 warning"]);
    const seams = of(run.data.findings, "portfolio/seam-crossing-declared");
    expect(seams.map((f) => [f.subject, f.alsoIn])).toEqual([["inventory:v01", ["inventory"]], ["intake:r08", ["intake"]], ["premerge:p12", ["premerge"]]]);
  });

  test("the lock: both modes, each with the editions it composed and the root it composed them over", async () => {
    const d = example();
    const file = readPortfolio(join(d, "portfolio"));
    const root = loadRoot(join(d, "shared"));
    const working = await runPortfolio(file.path, { built: BUILT, root });
    writeLock(file, "working", working.data.lock);
    const presenting = await runPortfolio(file.path, { built: "2026-11-16T11:00:00Z", root, mode: "presenting" });
    writeLock(file, "presenting", presenting.data.lock);
    const lock = readLock(file);
    const rootStamp = { hash: expect.stringMatching(/^[0-9a-f]{12}$/), shared_sha256: sha(join(d, "shared/seams.yaml")).slice(0, 12), accepted_patches: 4 };
    expect(lock.working).toMatchObject({ built: BUILT, root: rootStamp });
    expect(Object.keys(lock.working!.designs)).toEqual(["intake", "premerge", "inventory"]);
    for (const ns of ["intake", "inventory"]) expect(lock.working!.designs[ns]).toEqual({ edition: "latest", model: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(lock.working!.designs.premerge).toEqual({ edition: "latest", model: expect.stringMatching(/^[0-9a-f]{12}$/), since_release: { version: "1.0.0", accepted_patches: 0 } });
    expect(lock.working!.designs.intake.model).toBe(modelHash(loadInstance(join(d, "designs/intake"))).slice(0, 12));
    expect(lock.presenting!.built).toBe("2026-11-16T11:00:00Z");
    expect(lock.presenting!.designs.premerge).toEqual({ edition: "1.0.0", released: "2026-10-28", sha256: sha(join(d, "designs/premerge/editions/1.0.0/edition.yaml")).slice(0, 12) });
    expect(lock.presenting!.designs.intake).toMatchObject({ edition: "latest", note: "no released edition; working copy shown" });
    // a later working build keeps the presenting section as it was
    writeLock(file, "working", (await runPortfolio(file.path, { built: "2026-11-17T09:00:00Z", root })).data.lock);
    const again = readLock(file);
    expect(again.working!.built).toBe("2026-11-17T09:00:00Z");
    expect(again.presenting).toEqual(lock.presenting);
    expect(readFileSync(join(d, "portfolio/portfolio.lock"), "utf8")).toStartWith("# portfolio.lock: written by bun plumb.ts portfolio build.");
  });

  test("bun plumb.ts portfolio build writes portfolio.json, each design's bundle and the lock; check prints the findings", () => {
    const d = example(), out = mkdtempSync(join(tmpdir(), "plumb-seam04-out-"));
    const r = Bun.spawnSync(["bun", join(DE, "plumb.ts"), "portfolio", "build", join(d, "portfolio"), "--out", out], { stdout: "pipe", stderr: "pipe" });
    expect([0, 1]).toContain(r.exitCode);
    expect(r.stdout.toString()).toContain("Built Findings to fixes (working copies): 3 designs");
    const data = JSON.parse(readFileSync(join(out, "portfolio.json"), "utf8")) as PortfolioData;
    expect(data.portfolio).toMatchObject({ name: "example", mode: "working", root: "../shared" });
    for (const ns of ["intake", "premerge", "inventory"]) expect(existsSync(join(out, ns, "bundle.json"))).toBe(true);
    expect(Y(join(d, "portfolio/portfolio.lock")).working.designs.premerge.since_release).toEqual({ version: "1.0.0", accepted_patches: 0 });
    const c = Bun.spawnSync(["bun", join(DE, "plumb.ts"), "portfolio", "check", join(d, "portfolio")], { stdout: "pipe", stderr: "pipe" });
    expect(c.stdout.toString()).toContain("### portfolio / seam-crossing-declared");
    expect(c.stdout.toString()).toContain("`intake:r08`");
  });
});

describe("crossings: declared or not, and the severity their marks give", () => {
  test("a crossing the shared layer holds is declared; the base reports nothing", async () => {
    const data = await check(fixture());
    expect(data.findings).toEqual([]);
    expect(data.seams.crossings.map((c) => [c.id, c.declared, c.declaredBy, c.seams])).toEqual([
      ["shared:s1", true, "shared layer", ["alpha-beta"]], ["shared:s2", true, "shared layer", []], ["shared:s3", true, "shared layer", []],
    ]);
  });

  test("a design's own edge to a shared part is undeclared: an error when security-relevant, else a warning, in its own build too", async () => {
    const d = fixture();
    const model = Y(join(d, "designs/beta/model.yaml"));
    model.relationships.push({ id: "b3", from: "b-out", to: "shared:hub", kind: "data", carries: ["BetaWork"] });
    const work = model.contracts.find((c: any) => c.name === "BetaWork");
    work.produced_by.push("b-out"); work.consumed_by.push("shared:hub");
    yaml(join(d, "designs/beta/model.yaml"), model);
    let data = await check(d);
    expect(data.findings.map(brief)).toEqual(["portfolio/seam-crossing-declared warning beta:b3"]);
    expect(data.findings[0].message).toContain("between Beta and the shared layer, and nothing declares it: the shared layer does not hold it");
    expect(data.findings[0].message).toContain("not security-relevant (engine signal: none)");
    expect(data.findings[0].alsoIn).toEqual(["beta"]);
    // untrusted fields make it security-relevant
    model.contracts.find((c: any) => c.name === "BetaWork").untrusted_fields = ["note"];
    yaml(join(d, "designs/beta/model.yaml"), model);
    data = await check(d);
    expect(data.findings.map(brief)).toEqual(["portfolio/seam-crossing-declared error beta:b3"]);
    const { bundle } = await buildBundle(join(d, "designs/beta"), { built: BUILT });
    expect(bundle.findings.filter((f) => f.rule === "seam-crossing-declared").map((f) => `${f.at} ${f.severity}`)).toEqual(["b3 error"]);
  });

  test("a module crossing its seam names is declared; one it does not name, or names without a contract it carries, is not", async () => {
    const d = fixture();
    const model = Y(join(d, "designs/alpha/model.yaml"));
    model.elements.find((e: any) => e.id === "a-vault").module = "vault";
    const seam = (crossings: unknown) => ({ id: "vault", name: "The vault", between: ["core", "vault"], owner_role: "the seam owner", ...(crossings ? { crossings } : {}) });
    const write = (crossings: unknown) => { model.seams = [seam(crossings)]; yaml(join(d, "designs/alpha/model.yaml"), model); };
    write([{ id: "a2", carries: ["Secret"] }]);
    let data = await check(d);
    expect(data.findings).toEqual([]);
    expect(data.seams.crossings.find((c) => c.id === "alpha:a2")).toMatchObject({ declared: true, declaredBy: "module seam", seams: ["alpha:vault"] });
    write(undefined);
    data = await check(d);
    expect(data.findings.map(brief)).toEqual(["portfolio/seam-crossing-declared warning alpha:a2"]);
    expect(data.findings[0].message).toContain("the module seam The vault (alpha:vault) does not name it");
    write([{ id: "a2" }]);
    data = await check(d);
    expect(data.findings.map(brief)).toEqual(["portfolio/seam-crossing-declared warning alpha:a2"]);
    expect(data.findings[0].message).toContain("names it without Secret");
    // a relationship inside the module, or inside the rest of the design, crosses nothing
    expect(data.seams.crossings.map((c) => c.id)).not.toContain("alpha:a1");
  });

  /** The base with beta's own edge b3 into a shared part `target`, carrying beta's own contract Probe; each argument adds marks. */
  function probe(o: { part?: Record<string, unknown>; contract?: Record<string, unknown>; rel?: Record<string, unknown> } = {}): string {
    const d = fixture();
    const s = Y(join(d, "shared/seams.yaml"));
    s.parts.push({ id: "target", name: "Target", kind: "service", system: "work", zone: "inner", owner: "the hub owner", description: "A shared part beta's own edge reaches.", ...(o.part ?? {}) });
    yaml(join(d, "shared/seams.yaml"), s);
    rehash(d);
    const m = Y(join(d, "designs/beta/model.yaml"));
    m.contracts.push({ name: "Probe", description: "What beta sends the target.", produced_by: ["b-out"], consumed_by: ["shared:target"], ...(o.contract ?? {}) });
    m.relationships.push({ id: "b3", from: "b-out", to: "shared:target", kind: "data", carries: ["Probe"], ...(o.rel ?? {}) });
    yaml(join(d, "designs/beta/model.yaml"), m);
    return d;
  }

  test("each crossing signal alone makes an undeclared crossing security-relevant; with none it is a warning", async () => {
    const cases: [string, Parameters<typeof probe>[0]][] = [
      ["agent-reach", { part: { agent_reachable: true } }],
      ["untrusted-content", { rel: { content: "untrusted" } }],
      ["untrusted-fields", { contract: { untrusted_fields: ["note"] } }],
      ["evidence-partitioned", { part: { kind: "store", partitioned_by: ["tenant"] }, contract: { evidence_content: true } }],
      ["grants-authority", { part: { grants_authority: true } }],
      ["model-boundary", { part: { model_boundary: true } }],
      ["none", {}],
    ];
    for (const [signal, o] of cases) {
      const data = await check(probe(o));
      const f = of(data.findings, "portfolio/seam-crossing-declared");
      expect(f.map((x) => `${x.subject} ${x.severity}`)).toEqual([`beta:b3 ${signal === "none" ? "warning" : "error"}`]);
      expect(data.seams.crossings.find((c) => c.id === "beta:b3")!.mark).toMatchObject({ relevant: signal !== "none", floor_source: `engine signal: ${signal}` });
    }
  });

  test("a shipped floor is read: a crossing carrying a contract the shared file marks relevant is relevant", async () => {
    const d = fixture();
    const s = Y(join(d, "shared/seams.yaml"));
    s.contracts.push({ name: "Gate", description: "Pass or fail, which the hub acts on.", produced_by: ["beta:b-out"], consumed_by: ["hub"], security: { relevant: true, floor: ["gate-feed"] } });
    yaml(join(d, "shared/seams.yaml"), s);
    rehash(d);
    const m = Y(join(d, "designs/beta/model.yaml"));
    m.relationships.push({ id: "b3", from: "b-out", to: "shared:hub", kind: "control", carries: ["Gate"] });
    yaml(join(d, "designs/beta/model.yaml"), m);
    const data = await check(d);
    expect(of(data.findings, "portfolio/seam-crossing-declared").map((x) => `${x.subject} ${x.severity}`)).toEqual(["beta:b3 error"]);
    expect(data.marks!.contracts["shared:Gate"]).toMatchObject({ relevant: true, floor: ["gate-feed"], floor_source: "shipped" });
  });

  test("a mark written lower than its floor changes nothing: the crossing stays security-relevant", async () => {
    const data = await check(probe({ part: { agent_reachable: true }, contract: { untrusted_fields: ["note"], security: { relevant: false } } }));
    expect(of(data.findings, "portfolio/seam-crossing-declared").map((x) => `${x.subject} ${x.severity}`)).toEqual(["beta:b3 error"]);
    expect(data.marks!.contracts["beta:Probe"].relevant).toBe(true);
  });

  test("the severity is the crossing's mark, whatever the record says; with no mark the crossing counts as relevant", async () => {
    const d = fixture();
    const model = Y(join(d, "designs/beta/model.yaml"));
    model.relationships.push({ id: "b3", from: "b-out", to: "shared:hub", kind: "data", carries: ["BetaWork"] });
    yaml(join(d, "designs/beta/model.yaml"), model);
    const inst = loadInstance(join(d, "designs/beta"));
    const c = compile(inst);
    const design = { namespace: "beta", title: "Beta", model: c.model, plan: c.plan };
    const root = inst.ns!.root!.input!;
    const mark = (relevant: boolean) => ({ contracts: {}, crossings: { "beta:b3": { relevant, floor: relevant ? ["agent-input"] : [], floor_source: "shipped" } } });
    const sev = (r: ReturnType<typeof seamReport>) => r.undeclared.map((x) => `${x.id} ${x.severity}`);
    expect(sev(seamReport({ root, designs: [design], own: "beta", marks: mark(true), marksAvailable: true }))).toEqual(["beta:b3 error"]);
    expect(sev(seamReport({ root, designs: [design], own: "beta", marks: mark(false), marksAvailable: true }))).toEqual(["beta:b3 warning"]);
    const none = seamReport({ root, designs: [design], own: "beta", marksAvailable: false });
    expect(sev(none)).toEqual(["beta:b3 error"]);
    expect(none.marksAvailable).toBe(false);
  });
});

describe("exceptions: a seam's default, the organization's own list, and their ends", () => {
  /** The base with one undeclared, security-relevant crossing on the seam alpha-beta: alpha's own a3 into beta, carrying Spec. */
  function withA3(): string {
    const d = fixture();
    const model = Y(join(d, "designs/alpha/model.yaml"));
    model.relationships.push({ id: "a3", from: "a-out", to: "beta:b-in", kind: "data", carries: ["Spec"], content: "untrusted" });
    yaml(join(d, "designs/alpha/model.yaml"), model);
    return d;
  }
  const setDefault = (d: string, exceptions: unknown[]) => {
    const s = Y(join(d, "shared/seams.yaml"));
    s.seams[0].default_exceptions = exceptions;
    yaml(join(d, "shared/seams.yaml"), s);
    rehash(d);
  };
  const setOrg = (d: string, exceptions: Record<string, unknown[]>) => {
    const o = Y(join(d, "shared/org.yaml"));
    o.seam_exceptions = exceptions;
    yaml(join(d, "shared/org.yaml"), o);
  };
  const a3 = (data: PortfolioData) => of(data.findings, "portfolio/seam-crossing-declared").find((f) => f.subject === "alpha:a3")!;
  const DEFAULT = { contracts: ["Spec"], accepted_by: "the security risk owner", until: "2027-01-31", why: "The spec feed is still being wired." };

  test("with none, the undeclared security-relevant crossing is an error", async () => {
    const data = await check(withA3());
    expect(a3(data).severity).toBe("error");
    expect(of(data.findings, "core/xref-resolves").map((f) => f.subject)).toEqual(["alpha:a3"]); // naming another design is its own error
  });

  test("a default exception in force makes the error a warning, naming the seam's default", async () => {
    const d = withA3();
    setDefault(d, [DEFAULT]);
    const f = a3(await check(d));
    expect([f.severity, f.excepted_by]).toEqual(["warning", "default exception on alpha-beta"]);
    expect(f.message).toContain("the default exception on alpha-beta, accepted by the security risk owner until 2027-01-31, makes it a warning");
  });

  test("the organization's list replaces the default, and an empty list declines it", async () => {
    const d = withA3();
    setDefault(d, [DEFAULT]);
    setOrg(d, { "alpha-beta": [{ contracts: ["Spec"], accepted_by: "the head of security engineering", until: "2027-02-28", why: "Our own call." }] });
    let data = await check(d);
    expect([a3(data).severity, a3(data).excepted_by]).toEqual(["warning", "org exception on alpha-beta"]);
    expect(data.seams.seams[0].exceptions.map((e) => [e.source, e.accepted_by])).toEqual([["org", "the head of security engineering"]]);
    setOrg(d, { "alpha-beta": [] });
    data = await check(d);
    expect(a3(data).severity).toBe("error");
    expect(data.seams.seams[0].exceptions).toEqual([]);
  });

  test("an exception past its end stops applying: a date gone by, or a milestone reached", async () => {
    const d = withA3();
    setDefault(d, [{ ...DEFAULT, until: "2026-11-01" }]);
    let data = await check(d);
    expect(a3(data).severity).toBe("error");
    expect(data.seams.seams[0].exceptions[0].state).toBe("ended");
    setDefault(d, [{ ...DEFAULT, until: "alpha:A1" }]);
    data = await check(d);
    expect([a3(data).severity, data.seams.seams[0].exceptions[0].state]).toEqual(["warning", "in force"]); // AU-2 is still in doing
    edit(join(d, "designs/alpha/progress.yaml"), (s) => s.replace("AU-2: { status: doing", "AU-2: { status: done"));
    data = await check(d);
    expect([a3(data).severity, data.seams.seams[0].exceptions[0].state]).toEqual(["error", "ended"]);
  });

  test("an exception with no acceptor, no end, or a contract its seam does not carry does not apply", async () => {
    for (const [ex, problem] of [
      [{ contracts: ["Spec"], until: "2027-01-31" }, "names no risk acceptor (accepted_by)"],
      [{ contracts: ["Spec"], accepted_by: "the security risk owner" }, "has no end (until: a milestone or a date)"],
      [{ contracts: ["Spec", "HubEvent"], accepted_by: "the security risk owner", until: "2027-01-31" }, "names shared:HubEvent, which its seam does not carry"],
    ] as const) {
      const d = withA3();
      setDefault(d, [ex]);
      const data = await check(d);
      expect(a3(data).severity).toBe("error");
      expect(data.seams.seams[0].exceptions[0]).toMatchObject({ state: "not applied", problems: [problem] });
    }
  });

  test("an exception never softens a composed security finding", async () => {
    const d = withA3();
    setDefault(d, [DEFAULT]);
    const beta = Y(join(d, "designs/beta/model.yaml"));
    beta.elements.find((e: any) => e.id === "b-in").agent_reachable = true;
    yaml(join(d, "designs/beta/model.yaml"), beta);
    const data = await check(d);
    expect(a3(data).severity).toBe("warning");
    const reach = of(data.findings, "security/agent-reach");
    expect(reach.map((f) => [f.subject, f.severity])).toEqual([["beta:b-in", "error"]]);
  });
});

describe("composed checks", () => {
  test("a wait loop through two designs' plans, by shared capabilities, is one error that neither design's own plan shows", async () => {
    const d = fixture("no-cross-effort-cycle");
    const run = await runPortfolio(join(d, "portfolio"), { built: BUILT });
    expect(run.data.findings.map(brief)).toEqual(["portfolio/no-cross-effort-cycle error alpha:AU-2"]);
    expect(run.data.findings[0].message).toBe("Alpha's “Send the spec to beta” waits on Beta's “Take the spec in”, which waits on Alpha's “Send the spec to beta”. The loop holds 2 units of 2 designs (alpha:AU-2, beta:BU-1), so none of them can start first.");
    for (const r of run.designs) expect(r.findings.filter((f) => f.rule === "no-dependency-cycles")).toEqual([]);
  });

  test("a finding only the composed graph can see is reported, marked found only with the designs composed", async () => {
    const d = fixture();
    const alpha = Y(join(d, "designs/alpha/model.yaml"));
    alpha.relationships.find((r: any) => r.id === "a1").content = "untrusted";    // alpha's own edge, which beta never sees
    yaml(join(d, "designs/alpha/model.yaml"), alpha);
    const beta = Y(join(d, "designs/beta/model.yaml"));
    beta.elements.find((e: any) => e.id === "b-in").agent_reachable = true;     // and the seam declares no exposure for it
    yaml(join(d, "designs/beta/model.yaml"), beta);
    const run = await runPortfolio(join(d, "portfolio"), { built: BUILT });
    const reach = of(run.data.findings, "security/agent-reach");
    // beta's part: only the composed graph sees the untrusted text reach it; the shared sandbox at alpha's own edge: alpha's own build sees it
    expect(reach.map((f) => [f.subject, f.severity, f.composedOnly ?? false, f.design])).toEqual([["beta:b-in", "error", true, undefined], ["shared:sandbox", "error", false, "alpha"]]);
    expect(reach[0].message).toEndWith("(found only with the designs composed)");
    for (const r of run.designs) expect(r.alone.filter((f) => f.rule === "agent-reach" && f.at === "beta:b-in" || f.at === "b-in")).toEqual([]); // neither design built alone sees it
  });

  test.skipIf(!HAVE_EX)("a reference into a design the portfolio does not compose is skipped with a note", async () => {
    const d = example();
    edit(join(d, "portfolio/portfolio.yaml"), (s) => s.replace("  - { namespace: inventory, from: ../designs/inventory }\n", ""));
    const data = await check(d);
    expect(data.designs.map((x) => x.namespace)).toEqual(["intake", "premerge"]);
    expect(data.notes.some((n) => n.startsWith("The shared layer's crossing x07 names inventory, which this portfolio does not compose; it is skipped"))).toBe(true);
    expect(data.notes.some((n) => n.includes("inventory:ownership-api"))).toBe(true);
    expect(data.findings.filter((f) => f.composedOnly)).toEqual([]);
    expect(data.findings.filter((f) => /inventory/.test(f.subject))).toEqual([]);
    expect(data.seams.crossings.map((c) => c.id)).not.toContain("shared:x07");
  });

  test("portfolio/one-root: a design under another root is an error, one under none a warning", async () => {
    let data = await check(fixture("one-root"));
    expect(data.findings.map(brief)).toEqual(["portfolio/one-root error beta"]);
    const d = fixture();
    edit(join(d, "designs/beta/engine.yaml"), (s) => s.replace("root: ../../shared\n", ""));
    data = await check(d);
    expect(of(data.findings, "portfolio/one-root").map((f) => [f.subject, f.severity])).toEqual([["beta", "warning"]]);
  });
});


describe("The broken example variants: each fires its one finding where its rule is in, and nothing else", () => {
  const variants = readdirSync(join(FX, "variants")).sort();
  for (const v of variants) {
    test(v, async () => {
      const exp = Y(join(FX, "variants", v, "variant.yaml")).expect[0];
      const data = await check(fixture(v));
      const hit = data.findings.filter((f) => matches(exp, f));
      expect(data.findings.filter((f) => !matches(exp, f)).map(brief)).toEqual([]);
      if (await available(exp.rule)) expect(hit.map(brief)).toHaveLength(1);
    });
  }
});

describe("the impact of a root patch, as data", () => {
  /** The base with beta's own edge into the hub (a warning), and a root patch that makes the hub reachable by coding agents. */
  function withPatch(status: string): string {
    const d = fixture();
    const model = Y(join(d, "designs/beta/model.yaml"));
    model.relationships.push({ id: "b3", from: "b-out", to: "shared:hub", kind: "data", carries: ["BetaWork"] });
    yaml(join(d, "designs/beta/model.yaml"), model);
    mkdirSync(join(d, "shared/patches"), { recursive: true });
    yaml(join(d, "shared/patches/P-001-hub-agents.yaml"), {
      id: "P-001", title: "Coding agents reach the hub", status, why: "Agents now run beside the hub.",
      provenance: { author: "person", requested_by: "the team B lead", created: "2026-11-03" },
      ops: [{ op: "modify", kind: "element", id: "hub", set: { agent_reachable: true } }] });
    return d;
  }

  test("a proposed patch that makes an undeclared crossing security-relevant fails", async () => {
    const d = withPatch("proposed");
    const im = await portfolioImpact(join(d, "portfolio"), "P-001", { built: BUILT });
    expect([im.patch, im.status, im.verdict.level]).toEqual(["P-001", "proposed", "fail"]);
    expect(im.introduced.map(brief)).toEqual(["portfolio/seam-crossing-declared error beta:b3"]);
    expect(im.resolved.map(brief)).toEqual(["portfolio/seam-crossing-declared warning beta:b3"]);
    expect(im.effect).toBe("Accepting P-001 adds one finding (portfolio/seam-crossing-declared on beta:b3) and resolves one finding (portfolio/seam-crossing-declared on beta:b3).");
    expect(im.verdict.reasons).toEqual(["It adds one error: portfolio/seam-crossing-declared on beta:b3."]);
  });

  test("an accepted patch is weighed against the portfolio without it", async () => {
    const d = withPatch("accepted");
    const im = await portfolioImpact(join(d, "portfolio"), "P-001-hub-agents.yaml", { built: BUILT });
    expect([im.status, im.verdict.level]).toEqual(["accepted", "fail"]);
    expect(im.effect).toStartWith("Keeping P-001 adds one finding");
    expect(readFileSync(join(d, "shared/patches/P-001-hub-agents.yaml"), "utf8")).toContain("status: \"accepted\""); // the root itself is never changed
  });

  test.skipIf(!HAVE_EX)("the example's proposed refresh P-005: a caution once capacity is checked, and nothing to weigh before", async () => {
    const d = example();
    const im = await portfolioImpact(join(d, "portfolio"), "P-005", { built: BUILT });
    expect(im.status).toBe("proposed");
    const adds = Y(join(EX, "expected.yaml"))["P-005_adds"];
    if (await available("portfolio/team-over-capacity")) {
      expect(im.verdict.level).toBe("caution");
      for (const x of adds) expect(im.introduced.filter((f) => matches(x, f))).toHaveLength(1);
    } else expect(im.effect).toBe("Accepting P-005 changes no finding of the portfolio.");
  });
});

describe("a lone instance behaves as today", () => {
});
