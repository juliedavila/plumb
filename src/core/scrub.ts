import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setting } from "./env.ts";

export const SCRUB_DEFAULT = "~/.config/plumb/scrub.txt";
export const DEFAULT_REPLACEMENT = "[scrubbed]";
export type ScrubList = [RegExp, string, boolean?][];

let warnedLegacyPath = false;

export function scrubListPath(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const configured = setting("SCRUB_LIST", env);
  if (configured) return configured.startsWith("~/") ? join(home, configured.slice(2)) : resolve(configured);
  const path = join(home, ".config/plumb/scrub.txt");
  const old = join(home, ".config/design-engine/scrub.txt");
  if (!existsSync(path) && existsSync(old)) {
    if (!warnedLegacyPath) process.stderr.write(`The design-engine scrub path is deprecated; found ${old}. Move it to ${path}, or set PLUMB_SCRUB_LIST explicitly to silence this notice.\n`);
    warnedLegacyPath = true;
    return old;
  }
  return path;
}

/** A declared section pattern matches Markdown heading text (without its # prefix). */
export function parseScrubList(text: string): { list: ScrubList; sections: RegExp[]; problems: string[] } {
  const list: ScrubList = [], sections: RegExp[] = [], problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    let t = line.trim();
    if (!t || t.startsWith("#")) return;
    try {
      if (t.startsWith("section:")) { sections.push(new RegExp(t.slice(8).trim(), "i")); return; }
      const allowed = /^(?:allow-in-section|landscape):\s+/.test(t);
      t = t.replace(/^(?:allow-in-section|landscape):\s+/, "");
      const k = t.indexOf(" => ");
      const pat = k >= 0 ? t.slice(0, k).trim() : t, rep = k >= 0 ? t.slice(k + 4).trim() : DEFAULT_REPLACEMENT;
      list.push(allowed ? [new RegExp(pat, "gi"), rep, true] : [new RegExp(pat, "gi"), rep]);
    } catch (e) { problems.push(`line ${i + 1}: ${(e as Error).message}`); }
  });
  return { list, sections, problems };
}

export function loadScrubList(path = scrubListPath(), warn: (msg: string) => void = console.warn): { list: ScrubList; sections: RegExp[]; path: string; found: boolean } {
  if (!existsSync(path)) {
    warn(`warning: no scrub list at ${path} (set PLUMB_SCRUB_LIST); sensitive names were not checked`);
    return { list: [], sections: [], path, found: false };
  }
  const { list, sections, problems } = parseScrubList(readFileSync(path, "utf8"));
  for (const p of problems) warn(`warning: scrub list ${path}: ${p}; that line is skipped`);
  return { list, sections, path, found: true };
}
