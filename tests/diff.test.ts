// Comparing builds: the digest (shared with the page), the comparison, the Markdown, `plumb diff` from a bundle file.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { DIGEST, diffBundles, diffMd, isEditionImport, resolveSide } from "../src/core/diff.ts";
import type { Bundle } from "../src/types.ts";
import { DS_DIR } from "./instance-dirs.ts";

const ROOT = join(import.meta.dir, "..");
const { bundle: ds } = await buildBundle(DS_DIR, { built: "2026-10-22T10:00:00Z" });

/** A copy of the bundle changed the way a week of work changes one. */
function later(b: Bundle): Bundle {
  const x: Bundle = structuredClone(b);
  x.model.elements = x.model.elements.filter((e) => e.id !== "release-notes");
  x.model.elements.push({ id: "new-part", name: "New part", kind: "service" });
  x.model.elements.find((e) => e.id === "ci-pipeline")!.description = "Changed";
  x.model.elements.find((e) => e.id === "ci-pipeline")!.attrs = { ...(x.model.elements.find((e) => e.id === "ci-pipeline")!.attrs ?? {}), gates_deploy: true }; // a change in the design, not only its wording
  x.plan.units.find((u) => u.id === "U-05")!.status = "done";
  x.analysis.frontier = [...x.analysis.frontier, "U-07"];
  x.findings = x.findings.slice(1);
  x.findings.push({ pack: "generic", rule: "x", severity: "error", at: "new-part", atKind: "element", message: "new" });
  x.patches[0].status = "accepted";
  x.model.claims!.find((c) => c.id === "PR-2")!.grade = "evidence";
  x.notes = { version: "v2", items: [{ id: "N-1", target: { kind: "element", id: "ci-pipeline" }, kind: "question", text: "Q", status: "answered", answer: "A", author: "agent", created: "t", updated: "t2" }] };
  return x;
}

describe("digest and compare", () => {
  const a = structuredClone(ds);
  a.notes = { version: "v1", items: [{ id: "N-1", target: { kind: "element", id: "ci-pipeline" }, kind: "question", text: "Q", status: "open", author: "person", created: "t", updated: "t" }] };
  const b = later(a);
  const d = diffBundles(a, b, { from: "before", to: "after" });
  test("a build compared with itself has nothing to say", () => {
    expect(DIGEST.isEmpty(diffBundles(a, a, { from: "x", to: "x" }))).toBe(true);
  });
  test("records added, removed and changed, by kind", () => {
    expect(d.added.map((r) => r.id)).toContain("new-part");
    expect(d.removed.map((r) => r.id)).toContain("release-notes");
    expect(d.changed.map((r) => r.id)).toContain("ci-pipeline");
    expect(d.counts.element).toEqual({ added: 1, removed: 1, changed: 1 });
  });
  test("new and gone findings; units newly ready and done", () => {
    expect(d.findings.added.map((r) => r.id)).toEqual(["generic/x@new-part"]);
    expect(d.findings.gone).toHaveLength(1);
    expect(d.units.done.map((r) => r.id)).toEqual(["U-05"]);
    expect(d.units.ready.map((r) => r.id)).toContain("U-07");
  });
  test("notes answered, patches decided, claims regraded, with names", () => {
    expect(d.notes.answered.map((r) => r.id)).toEqual(["N-1"]);
    expect(d.patches.decided).toEqual([{ kind: "patch", id: "P-001", name: ds.patches[0].title, from: "proposed", to: "accepted" }]);
    expect(d.claims.regraded[0]).toMatchObject({ id: "PR-2", from: "untested", to: "evidence" });
    expect(d.removed.find((r) => r.id === "release-notes")!.name).toBe("Release notes"); // named from the older build
  });
  test("the digest is compact: one short string per record", () => {
    const g = DIGEST.digest(ds);
    expect(Object.keys(g.r).length).toBeGreaterThan(80);
    // 48 characters a record, plus five for the wording-free hash ("~" and four) on parts, relationships and units
    expect(JSON.stringify(g.r).length).toBeLessThan(Object.keys(g.r).length * 53);
    // Compare each record's name (up to 70 characters) so a gone record is named by title, and the fields compared by value
    expect(JSON.stringify(g).length).toBeLessThan(Object.keys(g.r).length * 160);
  });
  test("Markdown lists each group with counts", () => {
    const md = diffMd(d);
    expect(md).toContain("| parts | 1 | 1 | 1 |");
    expect(md).toContain("## Notes answered (1)");
    expect(md).toContain("`P-001`");
    expect(diffMd(diffBundles(a, a, { from: "x", to: "x" }))).toContain("Nothing changed.");
  });
});

describe("plumb diff", () => {
  test("from a bundle file against the instance now", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plumb-diff-"));
    const old = later(ds);
    writeFileSync(join(dir, "old.json"), JSON.stringify(old));
    const a = await resolveSide(DS_DIR, join(dir, "old.json"));
    const b = await resolveSide(DS_DIR, undefined);
    const d = diffBundles(a.bundle, b.bundle, { from: a.label, to: b.label });
    expect(d.from.label).toBe("old.json");
    expect(d.added.map((r) => r.id)).toContain("release-notes");
  });
});
