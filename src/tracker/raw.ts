// Read a raw tracker export directory: every *.json file in it, parsed, in natural name order.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { natCompare } from "../core/util.ts";
import type { RawExport } from "./adapter.ts";

export function readRaw(dirIn: string): RawExport {
  const dir = resolve(dirIn);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dirIn}: no such export directory`);
  const names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(natCompare);
  if (!names.length) throw new Error(`${dirIn}: no .json files; save the tracker's REST responses there first`);
  const files = names.map((name) => {
    try { return { name, json: JSON.parse(readFileSync(resolve(dir, name), "utf8")) as unknown }; }
    catch (e) { throw new Error(`${dirIn}/${name}: not JSON: ${(e as Error).message}`); }
  });
  return { dir, files };
}
