import { parseYaml } from "../core/yaml.ts";
// Ids that a split moves: `plumb migrate --moved <moved.yaml>` rewrites them in an instance's hand-written
// files: milestones, progress, tour, deck, notes, current state, the team map and the patches. Generated files are left
// to their importer. These are not key renames: an id moves, often into a namespace (`U-434` to `intake:U-12`).
//
// moved.yaml, as the split writes it (old id to new namespaced id), in any of these shapes:
//   { <old>: <new>, ... }                         a flat map
//   { <kind>: { <old>: <new> }, ... }             by kind (elements, units, phases, ...)
//   [{ old, new }, ...] or { moved: [...] }       a list
// Every whole-token use of an old id is rewritten, in values, keys and free text alike, since an id in a patch's why is
// a reference too. A token already in a namespace (`intake:x`, `intake:phase/x`) is left alone, so a second run changes nothing.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { natCompare } from "../core/util.ts";
import { generatedBy } from "./text.ts";

/** The hand-written files an id may appear in, relative to the instance folder. */
export function movedTargets(dir: string): string[] {
  const out = ["milestones.yaml", "progress.yaml", "tour.yaml", "deck.yaml", "notes.yaml", "current.yaml", "team-map.yaml"].filter((f) => existsSync(join(dir, f)));
  const pd = join(dir, "patches");
  if (existsSync(pd)) out.push(...readdirSync(pd).filter((f) => /\.ya?ml$/.test(f)).sort(natCompare).map((f) => `patches/${f}`));
  return out;
}

/** Read moved.yaml into old id -> new id. Throws, in words, when it holds no map. */
export function readMoved(path: string): Map<string, string> {
  const raw = parseYaml(readFileSync(path, "utf8"),path) as unknown;
  const out = new Map<string, string>();
  const add = (o: unknown, n: unknown) => { if (o != null && n != null && String(o) !== String(n)) out.set(String(o), String(n)); };
  const fromList = (xs: unknown[]) => { for (const x of xs) if (x && typeof x === "object") { const r = x as Record<string, unknown>; add(r.old ?? r.from, r.new ?? r.to); } };
  if (Array.isArray(raw)) fromList(raw);
  else if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.moved)) fromList(r.moved);
    else for (const [k, v] of Object.entries(r)) {
      if (v && typeof v === "object" && !Array.isArray(v)) for (const [o, n] of Object.entries(v as Record<string, unknown>)) add(o, n);
      else if (typeof v === "string" || typeof v === "number") add(k, v);
    }
  }
  if (!out.size) throw new Error(`${path} names no moved ids (expected old id to new id, flat, by kind, or as a list of { old, new })`);
  // a chain (A to B, and B to C) would move A to B on one run and on to C on the next: refuse it, so a run is idempotent
  for (const [o, n] of out) { const bare = n.includes(":") ? undefined : n; if (bare !== undefined && out.has(bare)) throw new Error(`${path} moves ${o} to ${n} and ${n} to ${out.get(n)}; a move map must not chain`); }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rewrite every whole-token use of a moved id in a text. Longer ids first, so one id inside another is never cut. */
export function rewriteIds(text: string, moved: Map<string, string>): { text: string; count: number } {
  let count = 0;
  const olds = [...moved.keys()].sort((a, b) => b.length - a.length || natCompare(a, b));
  if (!olds.length) return { text, count };
  // a token: not inside a longer id, not after a namespace or a kind ("intake:", "intake:phase/"), and not a namespace itself
  const re = new RegExp(`(?<![A-Za-z0-9._:/-])(${olds.map(esc).join("|")})(?![A-Za-z0-9_-]|\\.[A-Za-z0-9]|:[^\\s])`, "g");
  const out = text.replace(re, (m) => { count++; return moved.get(m)!; });
  return { text: out, count };
}

/** The rewrites for one instance: per file, the new text and how many ids moved. Generated files are skipped and named. */
export function movedEdits(dir: string, moved: Map<string, string>, read: (path: string) => string | undefined = (p) => readFileSync(p, "utf8")): { edits: { file: string; before: string; after: string; count: number }[]; skipped: string[] } {
  const edits: { file: string; before: string; after: string; count: number }[] = [], skipped: string[] = [];
  for (const f of movedTargets(dir)) {
    const before = read(join(dir, f));
    if (before === undefined) continue;
    if (generatedBy(before)) { skipped.push(f); continue; }
    const r = rewriteIds(before, moved);
    if (r.count) edits.push({ file: f, before, after: r.text, count: r.count });
  }
  return { edits, skipped };
}
