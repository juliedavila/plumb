import { parseYaml } from "../core/yaml.ts";
// Load <instance>/tracker/: inventory.json (from `tracker discover`), mapping.yaml (declared by the organization),
// links.yaml (confirmed matches) and the live issue state, read from the raw export the inventory records.
// Nothing here throws on a bad file: problems are collected and the tracker rule pack reports them.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TrackerInput, TrackerInventory } from "../types.ts";
import { getAdapter } from "./adapter.ts";
import { parseLinks } from "./links.ts";
import { normalizeMapping } from "./mapping.ts";
import { readRaw } from "./raw.ts";

export const TRACKER_DIR = "tracker";
export const FILES = { inventory: "inventory.json", mapping: "mapping.yaml", links: "links.yaml", reconcile: "reconcile.json" } as const;

export function trackerDir(instanceDir: string): string {
  return join(resolve(instanceDir), TRACKER_DIR);
}

/**
 * The raw export directory: an explicit --from, else engine.yaml `tracker: { export: <dir> }`, else the one discovery
 * recorded in inventory.json; the last two are relative to the instance directory (where engine.yaml is), so a copied
 * instance finds its export wherever the copy sits once the path is set there.
 */
export function sourceDir(instanceDir: string, inv?: TrackerInventory, from?: string): string | undefined {
  return exportSource(instanceDir, inv, from)?.dir;
}

/** The export directory and where its path came from, for the message when it is missing. */
export function exportSource(instanceDir: string, inv?: TrackerInventory, from?: string): { dir: string; written: string; via: string } | undefined {
  if (from) return { dir: resolve(from), written: from, via: "--from" };
  const configured = engineExport(instanceDir);
  if (configured) return { dir: resolve(instanceDir, configured), written: configured, via: "engine.yaml tracker.export" };
  if (inv?.source?.dir) return { dir: resolve(instanceDir, inv.source.dir), written: inv.source.dir, via: "tracker/inventory.json (source.dir, where discovery read it)" };
  return undefined;
}

function engineExport(instanceDir: string): string | undefined {
  const p = join(resolve(instanceDir), "engine.yaml");
  if (!existsSync(p)) return undefined;
  try {
    const c = parseYaml(readFileSync(p, "utf8"),p) as any;
    const e = c?.tracker?.export;
    return typeof e === "string" && e.trim() ? e.trim() : undefined;
  } catch { return undefined; }
}

export function loadTracker(instanceDir: string, opts: { from?: string } = {}): TrackerInput | undefined {
  const dir = trackerDir(instanceDir);
  if (!existsSync(dir)) return undefined;
  const t: TrackerInput = { dir, links: [], problems: [] };
  const ip = join(dir, FILES.inventory), mp = join(dir, FILES.mapping), lp = join(dir, FILES.links);
  if (existsSync(ip)) {
    try { t.inventory = JSON.parse(readFileSync(ip, "utf8")); }
    catch (e) { t.problems.push({ file: `tracker/${FILES.inventory}`, message: `does not parse: ${(e as Error).message}` }); }
  }
  if (existsSync(mp)) {
    try {
      const { mapping, problems } = normalizeMapping(parseYaml(readFileSync(mp, "utf8"),mp));
      if (mapping) t.mapping = mapping;
      for (const message of problems) t.problems.push({ file: `tracker/${FILES.mapping}`, message });
    } catch (e) { t.problems.push({ file: `tracker/${FILES.mapping}`, message: `does not parse: ${(e as Error).message}` }); }
  }
  if (existsSync(lp)) {
    const { links, problems } = parseLinks(readFileSync(lp, "utf8"));
    t.links = links;
    for (const message of problems) t.problems.push({ file: `tracker/${FILES.links}`, message });
  }
  const src = exportSource(instanceDir, t.inventory, opts.from);
  if (src && !existsSync(src.dir)) {
    t.problems.push({ file: "tracker export", message: `the raw tracker export "${src.written}" (from ${src.via}, relative to the instance directory) is not there, so there is no live state; set \`tracker: { export: <dir> }\` in engine.yaml to where the export sits relative to this instance, or pass --from <dir>` });
  } else if (src) {
    try {
      const adapter = getAdapter(t.mapping?.adapter ?? t.inventory?.adapter ?? "jira");
      const raw = readRaw(src.dir);
      t.issues = adapter.readState(raw, t.inventory);
      const at = adapter.exportedAt?.(raw); // when the export was taken, when it says: a BAU measure's window ends there
      if (at) t.exportedAt = at;
    } catch (e) { t.problems.push({ file: "tracker export", message: (e as Error).message }); }
  }
  return t;
}
