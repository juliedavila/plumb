// Report snapshots: what a snapshot holds, where it is saved, which one the deck compares with (the last presented,
// else the last saved), the CLI, and the dev server's "Mark as presented" write with its guards.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { baseline, loadReports, makeSnapshot, saveSnapshot, snapshotFile } from "../src/core/snapshot.ts";
import { startDev, type DevServer } from "../src/dev/server.ts";
import { DIGEST } from "../src/core/digest.ts";

const ROOT = join(import.meta.dir, "..");
const DS = join(ROOT, "examples/delivery-stream");
const copy = (src: string) => { const d = mkdtempSync(join(tmpdir(), "plumb-reports-")); cpSync(src, d, { recursive: true }); rmSync(join(d, "reports"), { recursive: true, force: true }); return d; }; // a temporary copy without the instance's own snapshots

describe("snapshots", () => {
  test("a snapshot holds the digest, phase status, findings, tracker, premises and ownership summaries", async () => {
    const { bundle } = await buildBundle(DS);
    const s = makeSnapshot(bundle, { now: new Date("2026-10-20T09:00:00Z") });
    expect(s.v).toBe(1);
    expect(s.saved).toBe("2026-10-20T09:00:00Z");
    expect(s.presented).toBeUndefined();
    expect(s.hash).toBe(bundle.engine.hash);
    expect(s.digest).toEqual(DIGEST.digest(bundle));
    expect(s.phases.map((p) => p.id)).toEqual([...bundle.plan.phases].sort((a, b) => a.order - b.order).map((p) => p.id));
    expect(s.phases.reduce((n, p) => n + p.total, 0)).toBe(bundle.plan.units.length);
    expect(s.findings.errors + s.findings.warnings).toBe(bundle.findings.length);
    expect(s.tracker?.linked).toBe(bundle.tracker!.reconcile!.counts.linked);
    expect(s.premises?.claims).toBe(bundle.model.claims!.length);
    expect(s.owners).toEqual({ parts: bundle.model.elements.length, unownedParts: 0, units: bundle.plan.units.length, unassignedUnits: 0 });
    // compact: no model, no layouts
    expect(JSON.stringify(s).length).toBeLessThan(20000);
  });
  test("--presented sets the presented time; file names carry no colons and never overwrite", async () => {
    const { bundle } = await buildBundle(DS);
    const s = makeSnapshot(bundle, { presented: true, now: new Date("2026-10-20T09:00:00Z") });
    expect(s.presented).toBe("2026-10-20T09:00:00Z");
    expect(snapshotFile(s.saved)).toBe("2026-10-20T09-00-00Z.json");
    const d = copy(DS);
    const a = saveSnapshot(d, s), b = saveSnapshot(d, s);
    expect(a).toBe("reports/2026-10-20T09-00-00Z.json");
    expect(b).toBe("reports/2026-10-20T09-00-00Z-2.json");
    expect(readdirSync(join(d, "reports")).filter((f) => f.startsWith("."))).toEqual([]);
  });
  test("the baseline is the last presented snapshot, else the last saved one", async () => {
    const { bundle } = await buildBundle(DS);
    const at = (iso: string, presented = false) => ({ ...makeSnapshot(bundle, { presented, now: new Date(iso) }), file: iso });
    expect(baseline([])).toBeUndefined();
    const saved = [at("2026-10-01T00:00:00Z"), at("2026-10-05T00:00:00Z")];
    expect(baseline(saved)).toEqual({ snap: saved[1], basis: "saved" });
    const mixed = [at("2026-10-01T00:00:00Z"), at("2026-10-03T00:00:00Z", true), at("2026-10-05T00:00:00Z")];
    expect(baseline(mixed)!.basis).toBe("presented");
    expect(baseline(mixed)!.snap.file).toBe("2026-10-03T00:00:00Z");
  });
  test("the build compares with the baseline and says which; a change after it shows up", async () => {
    const d = copy(DS);
    const first = (await buildBundle(d)).bundle;
    expect(first.sinceReport).toBeUndefined();
    saveSnapshot(d, makeSnapshot(first, { now: new Date("2026-10-01T00:00:00Z") }));
    const same = (await buildBundle(d)).bundle;
    expect(same.reports?.length).toBe(1);
    expect(same.sinceReport?.basis).toBe("saved");
    expect(DIGEST.isEmpty(same.sinceReport!.diff)).toBe(true);
    // mark one as presented, then change the plan: a unit moves to done
    saveSnapshot(d, makeSnapshot(same, { presented: true, now: new Date("2026-10-02T00:00:00Z") }));
    const plan = join(d, "plan.yaml");
    const text = readFileSync(plan, "utf8");
    const open = (await buildBundle(d)).bundle.analysis.frontier[0];
    const lines = text.split("\n"), at = lines.indexOf(`  - id: ${open}`);
    let j = at + 1; while (j < lines.length && lines[j].startsWith("    ") && !lines[j].startsWith("    status:")) j++;
    if (lines[j]?.startsWith("    status:")) lines[j] = "    status: done"; else lines.splice(j, 0, "    status: done");
    writeFileSync(plan, lines.join("\n"));
    const after = (await buildBundle(d)).bundle;
    expect(after.sinceReport?.basis).toBe("presented");
    expect(after.sinceReport?.against.presented).toBe("2026-10-02T00:00:00Z");
    expect(after.sinceReport!.diff.units.done.map((u) => u.id)).toContain(open);
    expect(after.sinceReport!.against.phases.length).toBe(after.plan.phases.length);
  });
  test("unreadable snapshot files are skipped", () => {
    const d = copy(DS);
    saveSnapshot(d, { v: 1, saved: "2026-10-01T00:00:00Z", built: "x", hash: "h", digest: { v: 1, built: "x", hash: "h", r: {} }, phases: [], findings: { errors: 0, warnings: 0, byRule: {} } });
    writeFileSync(join(d, "reports", "broken.json"), "{");
    writeFileSync(join(d, "reports", "other.json"), JSON.stringify({ v: 2 }));
    expect(loadReports(d).map((r) => r.file)).toEqual(["reports/2026-10-01T00-00-00Z.json"]);
  });
});

describe("plumb report", () => {
  test("saves a snapshot and says what it compares with", () => {
    const d = copy(DS);
    const run = (...a: string[]) => Bun.spawnSync(["bun", join(ROOT, "plumb.ts"), "report", d, ...a], { stdout: "pipe", stderr: "pipe" });
    const one = run();
    expect(one.exitCode).toBe(0);
    expect(one.stdout.toString()).toContain("No earlier report");
    // the same build again: no second snapshot; --presented marks the one already saved
    const two = run("--presented");
    expect(two.stdout.toString()).toMatch(/already saved as reports\/.*; marked it as presented/);
    expect(two.stdout.toString()).toMatch(/Nothing changed since the report saved .*none was marked as presented/);
    const snaps = loadReports(d);
    expect(snaps.length).toBe(1);
    expect(snaps.filter((s) => s.presented).length).toBe(1);
    expect(run("--bogus").exitCode).toBe(2);
  });
});

describe("Mark as presented, under the dev server", () => {
  const d = copy(DS);
  const out = mkdtempSync(join(tmpdir(), "plumb-reports-out-"));
  let dev: DevServer;
  afterAll(() => dev?.close());
  const post = async (body: unknown, h: Record<string, string> = {}) => {
    const res = await fetch(`http://127.0.0.1:${dev.port}/__de/report`, {
      method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${dev.port}`, "x-de-token": dev.token, ...h }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  };
  test("the served page knows the report path; the file on disk does not", async () => {
    dev = await startDev(d, { port: 0, outDir: out, debounceMs: 30 });
    const html = await (await fetch(dev.url)).text();
    expect(html).toContain('"report":"/__de/report"');
    expect(html).toContain("__deReport");
    expect(readFileSync(join(out, "index.html"), "utf8")).not.toContain("window.__deReport = function"); // the page only calls it when the dev snippet defined it
  });
  test("without the token, from another origin, or with another body, nothing is saved", async () => {
    expect((await post({ op: "present" }, { "x-de-token": "nope" })).status).toBe(403);
    expect((await post({ op: "present" }, { origin: "http://evil.example" })).status).toBe(403);
    expect((await post({ op: "present", extra: 1 })).status).toBe(400);
    expect((await post({ op: "delete" })).status).toBe(400);
    expect(existsSync(join(d, "reports"))).toBe(false);
  });
  test("with the token, it saves a presented snapshot of the build on screen, without a rebuild; the next rebuild compares with it", async () => {
    const before = dev.builds();
    const r = await post({ op: "present" });
    expect(r.status).toBe(200);
    expect(r.body.file).toMatch(/^reports\/.*\.json$/);
    const snaps = loadReports(d);
    expect(snaps.length).toBe(1);
    expect(snaps[0].presented).toBeTruthy();
    await Bun.sleep(600);
    expect(dev.builds()).toBe(before); // the page and its button stay put (the dev loop ignores reports/)
    await dev.rebuild();
    const b = JSON.parse(readFileSync(join(out, "bundle.json"), "utf8"));
    expect(b.sinceReport.basis).toBe("presented");
  });
});

describe("the page asks no server for a favicon", () => {
  test("an inline SVG icon is in the head", async () => {
    const { renderSite } = await import("../src/site/render.ts");
    const { bundle } = await buildBundle(DS);
    const html = renderSite(bundle);
    expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
  });
});
