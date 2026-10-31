import { parseYaml } from "../core/yaml.ts";
import { invocation } from "../core/invocation.ts";
// Expand and contract: every renamed key, the version it was renamed in and the version that
// removes the old one. For one minor version the loader reads the old key through the new one, and in an instance that
// declares schema 0.4, core/deprecated-key warns with the file, the line, the new key and the version that removes it.
// `plumb migrate` renames them in place. A lone 0.3 instance reads them in silence, as it always has.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../types.ts";
import { keyLines } from "../core/yaml-keys.ts";

export interface DeprecatedKey {
  file: string;                          // relative to the instance folder
  path: string;                          // where the key sits: "a.b" for a mapping, "a[]" for each item of a list
  old: string; new: string;
  since: string;                         // the version the new key came in (the old one has been read in silence since)
  removed_in: string;                    // the version that stops reading the old key
}

export const DEPRECATED_KEYS: DeprecatedKey[] = [
  { file: "tour.yaml", path: "steps[].target", old: "gate", new: "milestone", since: "0.2", removed_in: "0.5" },
  { file: "deck.yaml", path: "slides[]", old: "gates", new: "milestones", since: "0.2", removed_in: "0.5" },
];

type Raw = Record<string, unknown>;

/** How many times `key` is written at `path` in a parsed file. */
export function countAt(raw: unknown, path: string, key: string): number {
  const segs = path.split(".");
  const walk = (v: unknown, i: number): number => {
    if (i === segs.length) return v && typeof v === "object" && !Array.isArray(v) && (v as Raw)[key] !== undefined ? 1 : 0;
    const s = segs[i], each = s.endsWith("[]"), name = each ? s.slice(0, -2) : s;
    if (!v || typeof v !== "object" || Array.isArray(v)) return 0;
    const next = (v as Raw)[name];
    if (each) return Array.isArray(next) ? next.reduce((n: number, x) => n + walk(x, i + 1), 0) : 0;
    return walk(next, i + 1);
  };
  return walk(raw, 0);
}

export interface KeyUse { entry: DeprecatedKey; lines: number[]; count: number }

/** Where an instance writes each deprecated key: the lines, and how many uses its path holds. */
export function deprecatedUses(dir: string): KeyUse[] {
  const out: KeyUse[] = [];
  for (const entry of DEPRECATED_KEYS) {
    const path = join(dir, entry.file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    let raw: unknown;
    try { raw = parseYaml(text,path); } catch { continue; } // the file's own loader reports a parse error
    const count = countAt(raw, entry.path, entry.old);
    if (!count) continue;
    out.push({ entry, count, lines: keyLines(text, entry.old) });
  }
  return out;
}

/** core/deprecated-key findings for an instance that declares schema 0.4: one per use, with its line. */
export function deprecatedKeyFindings(dir: string): Finding[] {
  const out: Finding[] = [];
  for (const u of deprecatedUses(dir)) {
    const { entry } = u;
    const lines = u.lines.length === u.count ? u.lines : [];
    const said = (line?: number) => `${entry.file}${line ? ` line ${line}` : ""}: the key ${entry.old} (${entry.path}) is deprecated; write ${entry.new}, which it is read as until ${entry.removed_in} removes ${entry.old} (${invocation()} migrate renames it)`;
    if (lines.length) for (const n of lines) out.push({ pack: "core", rule: "deprecated-key", severity: "warning", at: `${entry.file}:${n}`, atKind: "instance", message: said(n) });
    else out.push({ pack: "core", rule: "deprecated-key", severity: "warning", at: entry.file, atKind: "instance", message: said() + (u.count > 1 ? ` (${u.count} uses)` : "") });
  }
  return out;
}

/** Rename one deprecated key in a file's text, on the lines that write it; comments and the rest stay as they are. */
export function renameKey(text: string, entry: DeprecatedKey, path = entry.file): { text: string; lines: number[]; unsafe: boolean; problem?: string } {
  let raw: unknown;
  try { raw = parseYaml(text,path); } catch (e) { return { text, lines: [], unsafe: true, problem: (e as Error).message }; }
  const count = countAt(raw, entry.path, entry.old);
  if (!count) return { text, lines: [], unsafe: false };
  const lines = keyLines(text, entry.old);
  if (lines.length !== count) return { text, lines, unsafe: true }; // the key is also written elsewhere: rename by hand
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const all = text.split(/\r?\n/);
  const re = new RegExp(`(^|[\\s{,\\-])(["']?)${entry.old}\\2(\\s*:)(?=\\s|$)`);
  for (const n of lines) all[n - 1] = all[n - 1].replace(re, `$1$2${entry.new}$2$3`);
  return { text: all.join(eol), lines, unsafe: false };
}
