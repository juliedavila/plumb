// The lone golden: a bundle reduced to one hash per top-level key and per key one level down, with what may differ
// between engine versions and machines taken out first. A lone instance (no schema, namespace, root or pins) must
// build under 0.4 to the bundle 0.3.1 built from the same files, except `engine.version` and `engine.built`.
//
// Taken out before hashing: engine.version and engine.built; every string equal to the engine version (a report
// snapshot records it) or to engine.hash (the content hash covers the tracker inventory, whose export folder is an
// absolute path in the test copies); absolute paths under this repository or the system's temporary folder.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256 } from "../src/core/util.ts";
import type { Bundle } from "../src/types.ts";

const ROOT = join(import.meta.dir, "..");

function normalize(v: unknown, version: string, hash: string): unknown {
  if (typeof v === "string") {
    if (v === version) return "<version>";
    if (v === hash) return "<hash>";
    return v.replaceAll("bun plumb.ts","bun de.ts").split(ROOT).join("<root>").split(tmpdir()).join("<tmp>");
  }
  if (Array.isArray(v)) return v.map((x) => normalize(x, version, hash));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = normalize(x, version, hash);
    return out;
  }
  return v;
}

/** One hash per top-level key of the bundle and per key one level below, after normalizing. */
export function goldenOf(b: Bundle): Record<string, string> {
  const j = normalize(structuredClone(b), b.engine.version, b.engine.hash) as Record<string, any>;
  delete j.engine.version;
  delete j.engine.built;
  const out: Record<string, string> = {};
  const h = (x: unknown) => sha256(canonicalJson(x)).slice(0, 16);
  for (const k of Object.keys(j).sort()) {
    const v = j[k];
    out[k] = h(v);
    if (v && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v).sort()) out[`${k}.${k2}`] = h(v[k2]);
  }
  return out;
}

/** The keys whose hashes differ, both ways, for a failure message that says where to look. */
export function goldenDiff(want: Record<string, string>, got: Record<string, string>): string[] {
  const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
  return keys.filter((k) => want[k] !== got[k]).map((k) => `${k}: ${want[k] ?? "(absent)"} -> ${got[k] ?? "(absent)"}`);
}
