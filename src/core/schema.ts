import { invocation } from "./invocation.ts";
// Schema versions. The engine reads schema 0.3 and 0.4.
//
// - No `schema:` and no 0.4 key: schema 0.3, read in silence. This is every lone instance, and it builds as 0.3.1 did.
// - `schema: "0.4"`: a 0.4 design.
// - A newer schema stops the build with core/schema-known ("this instance is written to schema 0.5; this engine reads
//   up to 0.4"); so does a value that is not a version.
// - An older schema gets one build warning line naming `plumb migrate`, and is read as 0.3.
// - A 0.4 key (engine.yaml namespace, root or pins; a current.yaml; flow_item or relieves on a unit) without
//   `schema: "0.4"`: a core/schema-known warning. With no schema at all the keys are read (the instance is read as
//   0.4); under a declared older schema they are not, until it declares 0.4.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Finding } from "../types.ts";

export const SCHEMA_NOW = "0.4";
export const SCHEMA_OLDEST = "0.3";

/** A finding that stops the build: the CLI prints it and exits 1, and nothing is written. */
export class SchemaError extends Error {
  constructor(public finding: Finding) { super(`${finding.pack}/${finding.rule}: ${finding.message}`); }
}

/** Compare two versions written as numbers joined by dots ("0.3" < "0.4" < "0.10"); undefined when either is not one. */
export function cmpVersion(a: string, b: string): number | undefined {
  if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) return undefined;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}

/** The 0.4 keys an instance uses, in words: engine.yaml keys, current.yaml, and unit fields. */
export function keys04(cfgRaw: Record<string, unknown>, dir: string, unitsRaw: unknown[]): string[] {
  const out = ["namespace", "root", "pins"].filter((k) => cfgRaw[k] !== undefined && cfgRaw[k] !== null);
  if (existsSync(join(dir, "current.yaml"))) out.push("current.yaml");
  for (const k of ["flow_item", "relieves"]) if (unitsRaw.some((u) => u && typeof u === "object" && (u as Record<string, unknown>)[k] !== undefined)) out.push(k);
  return out;
}

export interface SchemaRead {
  read: "0.3" | "0.4";
  declared?: string;
  uses04: string[];
  findings: Finding[];                   // core/schema-known warnings
  warnings: string[];                    // build warning lines (an older schema)
}

const at = (dir: string) => relative(process.cwd(), dir) || ".";
const schemaFinding = (severity: Finding["severity"], message: string): Finding => ({ pack: "core", rule: "schema-known", severity, at: "engine.yaml", atKind: "instance", message });

/** Read engine.yaml's `schema:` and the 0.4 keys. Throws SchemaError for a schema this engine cannot read. */
export function readSchema(cfgRaw: Record<string, unknown>, dir: string, unitsRaw: unknown[] = []): SchemaRead {
  const v = cfgRaw.schema;
  const declared = v === undefined || v === null ? undefined : String(v).trim();
  const uses04 = keys04(cfgRaw, dir, unitsRaw);
  const migrate = `${invocation()} migrate ${at(dir)}`;
  if (declared === undefined) {
    if (!uses04.length) return { read: "0.3", uses04, findings: [], warnings: [] };
    return { read: "0.4", uses04, warnings: [], findings: [schemaFinding("warning",
      `this instance uses 0.4 keys (${uses04.join(", ")}) without declaring schema 0.4; they are read as 0.4, and engine.yaml should say schema: "0.4" (${migrate} writes it)`)] };
  }
  const c = cmpVersion(declared, SCHEMA_NOW);
  if (c === undefined) throw new SchemaError(schemaFinding("error", `this instance declares schema "${declared}", which is not a schema version; this engine reads ${SCHEMA_OLDEST} and ${SCHEMA_NOW}`));
  if (c > 0) throw new SchemaError(schemaFinding("error", `this instance is written to schema ${declared}; this engine reads up to ${SCHEMA_NOW}`));
  if (c === 0) return { read: "0.4", declared, uses04, findings: [], warnings: [] };
  return {
    read: "0.3", declared, uses04,
    warnings: [`warning: this instance declares schema ${declared}, older than ${SCHEMA_NOW}; run ${migrate} to bring it to ${SCHEMA_NOW}`],
    findings: uses04.length ? [schemaFinding("warning", `this instance uses 0.4 keys (${uses04.join(", ")}) but declares schema ${declared}, so they are not read; ${migrate} brings it to ${SCHEMA_NOW}`)] : [],
  };
}
