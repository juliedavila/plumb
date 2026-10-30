import { setting } from "../src/core/env.ts";
// The fictional delivery stream keeps the 0.3.1 bundle contract.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildBundle } from "../src/core/bundle.ts";
import { DS_DIR } from "./instance-dirs.ts";
import { goldenDiff, goldenOf } from "./golden.ts";
import { instanceYamlFiles } from "../src/core/load.ts";
import { canonicalJson, sha256 } from "../src/core/util.ts";

/** The instance's input files as the test copy holds them: every YAML file the engine reads, and the tracker's JSON. */
function inputsHash(dir: string): string {
  const files = instanceYamlFiles(dir).filter((f) => f !== "notes.yaml");
  for (const f of ["tracker/inventory.json", "tracker/reconcile.json"]) if (existsSync(join(dir, f))) files.push(f);
  return sha256(canonicalJson(files.map((f) => [f, f.endsWith(".json") ? "" : readFileSync(join(dir, f), "utf8")]))).slice(0, 16);
}

const GOLDEN = join(import.meta.dir, "fixtures/golden");
const BUILT = "2026-10-22T09:00:00.000Z";
const WRITE = setting("GOLDEN_WRITE") === "1";

describe("a lone instance builds as 0.3.1 did", () => {
  for (const [name, dir] of [["delivery-stream", DS_DIR]] as const) {
    test(`${name}: the bundle equals its 0.3.1 bundle except engine.version and engine.built`, async () => {
      const { bundle, warnings } = await buildBundle(dir, { built: BUILT });
      const got = { inputs: inputsHash(dir), modelHash: bundle.engine.modelHash, rules: bundle.engine.rules, warnings, keys: goldenOf(bundle) };
      const file = join(GOLDEN, `${name}.json`);
      if (WRITE) { mkdirSync(GOLDEN, { recursive: true }); writeFileSync(file, JSON.stringify(got, null, 2) + "\n"); }
      expect(existsSync(file)).toBe(true);
      const want = JSON.parse(readFileSync(file, "utf8"));
      // the golden is of these files: a change to the instance itself needs a new golden, made on purpose
      expect(`${name} input files ${got.inputs}`).toBe(`${name} input files ${want.inputs}`);
      expect(bundle.engine.modelHash).toBe(want.modelHash);
      expect(bundle.engine.rules).toBe(want.rules);
      expect(warnings).toEqual(want.warnings);
      expect(goldenDiff(want.keys, got.keys)).toEqual([]);
      // nothing 0.4 leaks into a lone bundle
      const inst = bundle.instance as Record<string, unknown>;
      for (const k of ["namespace", "schema", "root", "pins", "edition"]) expect(inst[k]).toBeUndefined();
      expect(bundle.model.elements.some((e) => (e as { home?: string }).home)).toBe(false);
      expect(bundle.findings.some((f) => /^(xref-|schema-known|deprecated-key|one-home)/.test(f.rule))).toBe(false);
    });
  }
});
